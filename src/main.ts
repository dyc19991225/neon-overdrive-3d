import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  MECHS,
  PASSIVES,
  WEAPONS,
  xpForNextLevel,
  type MechDef,
  type PassiveId,
  type WeaponId,
} from './config';
import {
  HANGAR_UPGRADES,
  WeaponDpsTracker,
  computeRunRewardCores,
  getTotalRefundCores,
  getUpgradeCost,
  loadMetaSave,
  saveMetaSave,
  type HangarUpgradeId,
  type MetaSaveData,
} from './meta';
import { CyberAudio } from './audio';
import { VfxSystem } from './vfx';

const MAX_ENEMIES = 1200;
const MAX_PROJ = 460;
const MAX_GEMS = 720;
const MAX_SAW_BLADES = 10;
const MAX_LASER_BEAMS = 4;
const MAX_GRAVITY_WELLS = 8;
const MAX_ORBITAL_STRIKES = 18;
const MAX_POWERUPS = 10;
const MAX_BOSS_METEORS = 12;
const MAX_OFFSCREEN_INDICATORS = 8;
const MAX_MAP_PROPS = 96;
const MAP_CHUNK = 22;
const GRID_CELL = 2.4;
const GRID_DIM = 64;
const GRID_TOTAL = GRID_DIM * GRID_DIM;

type ScreenState = 'title' | 'playing' | 'upgrade' | 'recipe' | 'gameover' | 'victory';
type BossSkillMode =
  | 'chase'
  | 'charge_windup'
  | 'charge_dash'
  | 'laser_windup'
  | 'laser_sweep'
  | 'meteor_windup';
type PowerUpKind = 'magnet' | 'frenzy';

interface UpgradeChoice {
  kind: 'weapon' | 'passive' | 'heal' | 'overclock';
  weaponId?: WeaponId;
  passiveId?: PassiveId;
  artImg: string;
  badgeText: string;
  title: string;
  role: string;
  desc: string;
  pairImg?: string;
  pairHint: string;
  hyperReady: boolean;
}

interface ChestDrop {
  active: boolean;
  x: number;
  z: number;
  age: number;
  group: THREE.Group;
}

interface PowerUpDrop {
  active: boolean;
  kind: PowerUpKind;
  x: number;
  z: number;
  age: number;
  group: THREE.Group;
  coreMesh: THREE.Mesh;
}

interface GravityWellSlot {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  age: number;
  dur: number;
  tickTimer: number;
  tickDmg: number;
  collapseDmg: number;
  hyper: boolean;
  group: THREE.Group;
  ringA: THREE.Mesh;
  ringB: THREE.Mesh;
}

interface OrbitalStrikeSlot {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  delay: number;
  age: number;
  dur: number;
  dmg: number;
  hyper: boolean;
  group: THREE.Group;
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
}

interface BossMeteorSlot {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  age: number;
  dur: number;
  group: THREE.Group;
  fillDisk: THREE.Mesh;
}

interface ActiveMapProp {
  key: string;
  kind: 0 | 1 | 2;
  x: number;
  z: number;
  rotY: number;
  radius: number;
}

class NeonOverdriveGame {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public mixer: THREE.AnimationMixer | null = null;
  private composer: EffectComposer;
  private timer = new THREE.Timer();
  private audio = new CyberAudio();
  private vfx: VfxSystem;
  private dmgCanvas: HTMLCanvasElement;
  private dmgCtx: CanvasRenderingContext2D;
  private gltfLoader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  private modelsLoaded = false;

  // Persistent Meta-Hangar Save & Per-Weapon DPS Tracker
  private metaSave: MetaSaveData;
  private dpsTracker = new WeaponDpsTracker();

  public screen: ScreenState = 'title';
  private selectedMechIdx = 0;
  private currentMech: MechDef = MECHS[0];

  // Dual-clock, Witch-Time, Rotational Trauma2 + FOV & Dutch-Roll Springs
  private timeScale = 1.0;
  private hitstopTimer = 0;
  private witchTimer = 0;
  private postMenuGrace = 0;
  private trauma = 0;
  private shakeClock = 0;
  private shakeStrength = 1.0;
  private camFocus = new THREE.Vector3(0, 0, 0);
  private baseFov = 46;
  private fovOffset = 0;
  private fovVel = 0;
  private rollSpring = 0;
  private rollVel = 0;

  // Player Mech Rig + World-Aligned Diegetic 3D Arc Gauges (P0.1)
  private playerGroup = new THREE.Group();
  private diegeticGroup = new THREE.Group();
  private hpArcSegs: THREE.Mesh[] = [];
  private dashArcSegs: THREE.Mesh[] = [];
  private frenzyHaloMesh!: THREE.Mesh;
  private chestKitMount = new THREE.Group();
  private thrusterFlames: THREE.Mesh[] = [];
  private recoilZ = 0;
  private recoilVel = 0;
  private kitMeshes: Record<string, THREE.Object3D> = {};
  private playerArmorMats: THREE.MeshStandardMaterial[] = [];
  private animActions: Record<string, THREE.AnimationAction> = {};
  private activeLocoAction: THREE.AnimationAction | null = null;
  private isMovingAnim = false;
  private noseIndicator!: THREE.Mesh;

  // Smooth Kinetic Dash + 0.18s Input Buffer + Frenzy & Revive States
  private px = 0;
  private pz = 0;
  private pvx = 0;
  private pvz = 0;
  private facingYaw = 0;
  private hp = 100;
  private maxHp = 100;
  private iFrameTimer = 0;
  private dashCd = 0;
  private dashMaxCd = 2.6;
  private dashBufferTimer = 0;
  private dashActiveTimer = 0;
  private dashGhostAccum = 0;
  private dashDirX = 0;
  private dashDirZ = -1;
  private dashBoostMagTimer = 0;
  private frenzyTimer = 0;
  private revivesLeft = 0;

  // Run, Zero-Timer Combo Streak & RPG progression
  private runTime = 0;
  private kills = 0;
  private bossesDefeated = 0;
  private comboCount = 0;
  private comboTimer = 0;
  private comboPopTimer = 0;
  private level = 1;
  private xp = 0;
  private xpNext = 8;
  private pendingLevels = 0;
  private rerollsLeft = 2;
  private overclockStacks = 0;
  private weaponLevels: Partial<Record<WeaponId, number>> = {};
  private weaponHyper: Partial<Record<WeaponId, boolean>> = {};
  private weaponTimers: Record<WeaponId, number> = {
    kunai: 0,
    saw: 0,
    arc: 0,
    laser: 0,
    gravity: 0,
    orbital: 0,
  };
  private passiveLevels: Partial<Record<PassiveId, number>> = {};

  // Active 6-Weapon Pools
  private sawAngle = 0;
  private sawMeshes: THREE.Mesh[] = [];
  private laserBeams: THREE.Mesh[] = [];
  private laserTex!: THREE.Texture;
  private laserActiveTimer = 0;
  private laserMaxDur = 0.42;
  private laserStartYaw = 0;
  private laserIsHyper = false;
  private laserTickTimer = 0;
  private gravityWells: GravityWellSlot[] = [];
  private orbitalStrikes: OrbitalStrikeSlot[] = [];

  // Projectiles SoA + InstancedMesh
  private projMesh!: THREE.InstancedMesh;
  private projActive = new Uint8Array(MAX_PROJ);
  private projX = new Float32Array(MAX_PROJ);
  private projZ = new Float32Array(MAX_PROJ);
  private projVx = new Float32Array(MAX_PROJ);
  private projVz = new Float32Array(MAX_PROJ);
  private projDmg = new Float32Array(MAX_PROJ);
  private projLife = new Float32Array(MAX_PROJ);
  private projPierce = new Int16Array(MAX_PROJ);
  private projSplit = new Uint8Array(MAX_PROJ);
  private projLastHit = new Int32Array(MAX_PROJ);
  private projCursor = 0;

  // Enemies SoA + Spatial Hash Grid
  private enemyMeshes: THREE.InstancedMesh[] = [];
  private eActive = new Uint8Array(MAX_ENEMIES);
  private eType = new Uint8Array(MAX_ENEMIES);
  private eElite = new Uint8Array(MAX_ENEMIES);
  private eX = new Float32Array(MAX_ENEMIES);
  private eZ = new Float32Array(MAX_ENEMIES);
  private eHp = new Float32Array(MAX_ENEMIES);
  private eMaxHp = new Float32Array(MAX_ENEMIES);
  private eSpeed = new Float32Array(MAX_ENEMIES);
  private eFlash = new Float32Array(MAX_ENEMIES);
  private eWobble = new Float32Array(MAX_ENEMIES);
  private eKx = new Float32Array(MAX_ENEMIES);
  private eKz = new Float32Array(MAX_ENEMIES);
  private eFuse = new Float32Array(MAX_ENEMIES);
  private activeEnemyCount = 0;

  private gridHead = new Int32Array(GRID_TOTAL);
  private gridNext = new Int32Array(MAX_ENEMIES);
  private gridOriginX = 0;
  private gridOriginZ = 0;
  private typeSlotCounts = [0, 0, 0, 0];

  // Infinite Chunked 3D Cyber-City Map Props
  private propMeshes: THREE.InstancedMesh[] = [];
  private activeMapProps: ActiveMapProp[] = [];
  private destroyedBarrels = new Set<string>();
  private lastChunkX = 999999;
  private lastChunkZ = 999999;

  // Boss 3-Attack Red-Telegraph State Machine (P1.1)
  private spawnAccum = 0;
  private triggeredEvents = new Set<string>();
  private bossActive = false;
  private bossStage = 0;
  private bossX = 0;
  private bossZ = 0;
  private bossHp = 0;
  private bossMaxHp = 1;
  private bossWobble = 0;
  private bossMode: BossSkillMode = 'chase';
  private bossSkillTimer = 2.2;
  private bossPatternIdx = 0;
  private bossChargeYaw = 0;
  private bossChargeLen = 19;
  private bossLaserYaw = 0;
  private bossLaserTick = 0;
  private bossChargeCarpet!: THREE.Mesh;
  private bossCrossLasers: THREE.Mesh[] = [];
  private bossMeteors: BossMeteorSlot[] = [];

  private bossGroup = new THREE.Group();
  private bossTorsoNode: THREE.Object3D | null = null;
  private bossLeftArmNode: THREE.Object3D | null = null;
  private bossRightArmNode: THREE.Object3D | null = null;
  private bossWingsNode: THREE.Object3D | null = null;
  private arenaRing!: THREE.Mesh;
  private arenaCenter = new THREE.Vector2();

  // XP Gems + Orbital Drop Pods + Power-Up Drops (P0.3)
  private gemMesh!: THREE.InstancedMesh;
  private gActive = new Uint8Array(MAX_GEMS);
  private gX = new Float32Array(MAX_GEMS);
  private gZ = new Float32Array(MAX_GEMS);
  private gVal = new Float32Array(MAX_GEMS);
  private gState = new Uint8Array(MAX_GEMS);
  private gMagAge = new Float32Array(MAX_GEMS);
  private gPushX = new Float32Array(MAX_GEMS);
  private gPushZ = new Float32Array(MAX_GEMS);
  private activeGemCount = 0;

  private chests: ChestDrop[] = [];
  private powerups: PowerUpDrop[] = [];
  private podTemplateMesh: THREE.Mesh | null = null;
  private magnetGeo: THREE.BufferGeometry | null = null;
  private frenzyGeo: THREE.BufferGeometry | null = null;

  private floorMesh!: THREE.Mesh;
  private sunLight!: THREE.DirectionalLight;

  // Cached HUD & Offscreen Indicator DOM elements
  private offscreenEls: { root: HTMLDivElement; arrow: HTMLSpanElement; label: HTMLSpanElement }[] =
    [];
  private comboPillEl!: HTMLElement;
  private comboCountEl!: HTMLElement;
  private comboLabelEl!: HTMLElement;

  private keys = new Set<string>();
  private currentChoices: UpgradeChoice[] = [];
  private focusedCardIdx = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private displayedFps = 60;
  private hudDirtyTimer = 0;
  private toastTimer = 0;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpProj = new THREE.Vector3();

  constructor() {
    this.metaSave = loadMetaSave();
    this.audio.setVolumes(this.metaSave.bgmVolume, this.metaSave.sfxVolume);

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.dmgCanvas = document.getElementById('dmg-canvas') as HTMLCanvasElement;
    this.dmgCtx = this.dmgCanvas.getContext('2d')!;
    this.comboPillEl = document.getElementById('combo-pill')!;
    this.comboCountEl = document.getElementById('combo-count')!;
    this.comboLabelEl = document.getElementById('combo-label')!;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050814);
    this.scene.fog = new THREE.FogExp2(0x050814, 0.014);

    this.camera = new THREE.PerspectiveCamera(
      this.baseFov,
      window.innerWidth / window.innerHeight,
      0.5,
      120
    );
    this.camera.position.set(0, 19.5, 14.8);
    this.camera.lookAt(0, 0.8, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.44,
      0.32,
      0.72
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.setupLightingAndPbrFloor();
    this.setupPlayerAndDiegeticGauges();
    this.setupWeaponMeshes();
    this.setupInstancedPoolsFallback();
    this.setupMapPropPoolsFallback();
    this.setupBossChestsAndPowerups();
    this.setupOffscreenIndicators();
    this.vfx = new VfxSystem(this.scene);

    this.bindEvents();
    this.syncAudioUiControls();
    this.renderTitleCards();
    this.renderHangarPanel();
    this.renderRecipeBook();
    this.onResize();
    this.refreshMapChunks(true);

    this.loadAllModels();

    this.timer.connect(document);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private async loadAllModels(): Promise<void> {
    try {
      const [robotGltf, armoryGltf, enemyGltf, bossGltf, mapGltf, wpnLootGltf] = await Promise.all([
        this.gltfLoader.loadAsync('./models/RobotExpressive.glb'),
        this.gltfLoader.loadAsync('./models/mech_armory.glb'),
        this.gltfLoader.loadAsync('./models/enemy_mechs.glb'),
        this.gltfLoader.loadAsync('./models/boss_titan.glb'),
        this.gltfLoader.loadAsync('./models/map_props.glb'),
        this.gltfLoader.loadAsync('./models/weapons_and_loot.glb'),
      ]);

      const robotRoot = robotGltf.scene;
      robotRoot.scale.setScalar(0.46);
      robotRoot.rotation.y = Math.PI;
      this.playerArmorMats = [];

      robotRoot.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const cloned = mats.map((m) => {
            const std = (m as THREE.MeshStandardMaterial).clone();
            if (/main/i.test(std.name)) {
              std.color.setHex(0x1e293b);
              std.metalness = 0.78;
              std.roughness = 0.32;
              std.emissive.setHex(this.currentMech.color);
              std.emissiveIntensity = 0.22;
              this.playerArmorMats.push(std);
            } else if (/black/i.test(std.name)) {
              std.color.setHex(0x090d16);
              std.emissive.setHex(0xfde047);
              std.emissiveIntensity = 0.85;
            } else {
              std.color.setHex(0x475569);
              std.metalness = 0.72;
              std.roughness = 0.35;
            }
            return std;
          });
          mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
        }
      });
      this.playerGroup.add(robotRoot);

      this.mixer = new THREE.AnimationMixer(robotRoot);
      Object.assign(window, { mixer: this.mixer });
      for (const clip of robotGltf.animations) {
        this.animActions[clip.name] = this.mixer.clipAction(clip);
      }
      if (this.animActions.Jump) {
        this.animActions.Jump.setLoop(THREE.LoopOnce, 1);
        this.animActions.Jump.clampWhenFinished = false;
      }
      if (this.animActions.Idle) {
        this.activeLocoAction = this.animActions.Idle;
        this.activeLocoAction.play();
      }

      this.chestKitMount.position.set(0, 1.18, 0.08);
      this.playerGroup.add(this.chestKitMount);
      const flameGeo = new THREE.ConeGeometry(0.14, 0.75, 8);
      flameGeo.rotateX(Math.PI / 2);
      flameGeo.translate(0, 0, 0.36);
      this.thrusterFlames = [];
      for (const sx of [-0.26, 0.26]) {
        const fm = new THREE.Mesh(
          flameGeo,
          new THREE.MeshBasicMaterial({
            color: 0x67e8f9,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        fm.position.set(sx, -0.08, 0.38);
        this.chestKitMount.add(fm);
        this.thrusterFlames.push(fm);
      }

      const kitMap: Record<string, string> = {
        striker: 'Kit_Striker',
        aegis: 'Kit_Aegis',
        nexus: 'Kit_Nexus',
      };
      for (const [mechId, nodeName] of Object.entries(kitMap)) {
        const found = armoryGltf.scene.getObjectByName(nodeName);
        if (found) {
          found.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              const km = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
              if (km && km.emissiveIntensity > 0.85) km.emissiveIntensity = 0.85;
            }
          });
          this.kitMeshes[mechId] = found;
          this.chestKitMount.add(found);
        }
      }
      this.applySelectedMechVisuals();

      const enemyNames = [
        'Enemy_Crawler',
        'Enemy_Kamikaze',
        'Enemy_ShieldMech',
        'Enemy_Juggernaut',
      ];
      enemyNames.forEach((name, tIdx) => {
        const obj = enemyGltf.scene.getObjectByName(name) as THREE.Mesh | undefined;
        if (!obj || !obj.geometry) return;
        const oldIm = this.enemyMeshes[tIdx];
        this.scene.remove(oldIm);
        oldIm.geometry.dispose();

        const vcolMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.34,
          metalness: 0.68,
        });
        const newIm = new THREE.InstancedMesh(obj.geometry.clone(), vcolMat, MAX_ENEMIES);
        newIm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        newIm.castShadow = true;
        newIm.receiveShadow = true;
        newIm.frustumCulled = false;
        newIm.count = 0;
        for (let i = 0; i < MAX_ENEMIES; i++) {
          this.hideInstance(newIm, i);
          newIm.setColorAt(i, this.tmpColor.setRGB(1.15, 1.15, 1.15));
        }
        this.scene.add(newIm);
        this.enemyMeshes[tIdx] = newIm;
      });

      this.bossGroup.clear();
      const bossRoot = bossGltf.scene;
      bossRoot.scale.setScalar(1.18);
      bossRoot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          const bm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (bm && bm.emissiveIntensity > 0.95) bm.emissiveIntensity = 0.95;
        }
      });
      this.bossTorsoNode = bossRoot.getObjectByName('Boss_Torso') || null;
      this.bossLeftArmNode = bossRoot.getObjectByName('Boss_LeftArm') || null;
      this.bossRightArmNode = bossRoot.getObjectByName('Boss_RightArm') || null;
      this.bossWingsNode = bossRoot.getObjectByName('Boss_Wings') || null;
      this.bossGroup.add(bossRoot);

      const propNames = ['Prop_HoloPylon', 'Prop_CargoCrate', 'Prop_PlasmaBarrel'];
      propNames.forEach((pName, pIdx) => {
        const obj = mapGltf.scene.getObjectByName(pName) as THREE.Mesh | undefined;
        if (!obj || !obj.geometry) return;
        const oldIm = this.propMeshes[pIdx];
        this.scene.remove(oldIm);
        oldIm.geometry.dispose();

        const pMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.36,
          metalness: 0.72,
        });
        const newIm = new THREE.InstancedMesh(obj.geometry.clone(), pMat, MAX_MAP_PROPS);
        newIm.castShadow = true;
        newIm.receiveShadow = true;
        newIm.frustumCulled = false;
        newIm.count = 0;
        this.scene.add(newIm);
        this.propMeshes[pIdx] = newIm;
      });
      this.refreshMapChunks(true);

      const kunaiObj = wpnLootGltf.scene.getObjectByName('Weapon_Kunai') as THREE.Mesh | undefined;
      if (kunaiObj?.geometry) {
        this.scene.remove(this.projMesh);
        this.projMesh.geometry.dispose();
        this.projMesh = new THREE.InstancedMesh(
          kunaiObj.geometry.clone(),
          new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
          MAX_PROJ
        );
        this.projMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.projMesh.frustumCulled = false;
        for (let i = 0; i < MAX_PROJ; i++) {
          this.hideInstance(this.projMesh, i);
          this.projMesh.setColorAt(i, this.tmpColor.setHex(0xffffff));
        }
        this.scene.add(this.projMesh);
      }

      const sawObj = wpnLootGltf.scene.getObjectByName('Weapon_Saw') as THREE.Mesh | undefined;
      if (sawObj?.geometry) {
        const sawGeo = sawObj.geometry.clone();
        for (const m of this.sawMeshes) {
          m.geometry.dispose();
          m.geometry = sawGeo;
          m.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
          });
        }
      }

      const crysObj = wpnLootGltf.scene.getObjectByName('Loot_Crystal') as THREE.Mesh | undefined;
      if (crysObj?.geometry) {
        this.scene.remove(this.gemMesh);
        this.gemMesh.geometry.dispose();
        this.gemMesh = new THREE.InstancedMesh(
          crysObj.geometry.clone(),
          new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
          MAX_GEMS
        );
        this.gemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.gemMesh.frustumCulled = false;
        for (let i = 0; i < MAX_GEMS; i++) {
          this.hideInstance(this.gemMesh, i);
          this.gemMesh.setColorAt(i, this.tmpColor.setHex(0x60a5fa));
        }
        this.scene.add(this.gemMesh);
      }

      const podObj = wpnLootGltf.scene.getObjectByName('Loot_HyperPod') as THREE.Mesh | undefined;
      if (podObj?.geometry) {
        this.podTemplateMesh = new THREE.Mesh(
          podObj.geometry.clone(),
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 0.25,
            metalness: 0.78,
          })
        );
        for (const ch of this.chests) {
          const oldBox = ch.group.children[0] as THREE.Mesh;
          const podClone = this.podTemplateMesh.clone();
          podClone.castShadow = true;
          ch.group.remove(oldBox);
          ch.group.add(podClone);
          ch.group.children.reverse();
        }
      }

      // 3D Power-Up Meshes: Loot_MagnetCore & Loot_FrenzyOrb (P0.3)
      const magObj = wpnLootGltf.scene.getObjectByName('Loot_MagnetCore') as THREE.Mesh | undefined;
      const frzObj = wpnLootGltf.scene.getObjectByName('Loot_FrenzyOrb') as THREE.Mesh | undefined;
      if (magObj?.geometry) this.magnetGeo = magObj.geometry.clone();
      if (frzObj?.geometry) this.frenzyGeo = frzObj.geometry.clone();
      for (const pu of this.powerups) {
        const g = pu.kind === 'magnet' ? this.magnetGeo : this.frenzyGeo;
        if (g) {
          pu.coreMesh.geometry.dispose();
          pu.coreMesh.geometry = g;
          pu.coreMesh.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
          });
        }
      }

      this.modelsLoaded = true;
    } catch (err) {
      console.error('Failed to load GLB assets:', err);
    }
  }

  private applySelectedMechVisuals(): void {
    const m = MECHS[this.selectedMechIdx];
    for (const mat of this.playerArmorMats) {
      mat.emissive.setHex(m.color);
    }
    for (const [id, obj] of Object.entries(this.kitMeshes)) {
      obj.visible = id === m.id;
    }
    for (const fm of this.thrusterFlames) {
      (fm.material as THREE.MeshBasicMaterial).color.setHex(m.color);
    }
  }

  private transitionLocomotion(moving: boolean): void {
    if (!this.mixer) return;
    if (moving === this.isMovingAnim) return;
    this.isMovingAnim = moving;
    const target = moving ? this.animActions.Running : this.animActions.Idle;
    if (!target || target === this.activeLocoAction) return;
    target.reset();
    if (moving) target.timeScale = 1.28;
    target.play();
    if (this.activeLocoAction) {
      this.activeLocoAction.crossFadeTo(target, 0.16, false);
    }
    this.activeLocoAction = target;
  }

  private setupLightingAndPbrFloor(): void {
    const hemi = new THREE.HemisphereLight(0x7dd3fc, 0x1e1b4b, 1.55);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.85);
    this.sunLight.position.set(10, 22, 12);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    const sc = this.sunLight.shadow.camera;
    sc.near = 2;
    sc.far = 55;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const albedo = this.texLoader.load('./textures/floor_albedo.png');
    albedo.colorSpace = THREE.SRGBColorSpace;
    const normal = this.texLoader.load('./textures/floor_normal.png');
    const emissive = this.texLoader.load('./textures/floor_emissive.png');
    emissive.colorSpace = THREE.SRGBColorSpace;

    for (const t of [albedo, normal, emissive]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(24, 24);
    }

    const floorGeo = new THREE.PlaneGeometry(144, 144);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      emissive: new THREE.Color(0xffffff),
      emissiveMap: emissive,
      emissiveIntensity: 0.85,
      roughness: 0.58,
      metalness: 0.52,
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
  }

  private setupMapPropPoolsFallback(): void {
    const geo = new THREE.BoxGeometry(1, 2, 1);
    for (let i = 0; i < 3; i++) {
      const im = new THREE.InstancedMesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0x1e293b }),
        MAX_MAP_PROPS
      );
      im.count = 0;
      im.frustumCulled = false;
      this.scene.add(im);
      this.propMeshes.push(im);
    }
  }

  private hash2D(cx: number, cz: number, salt: number): number {
    let n = Math.imul(cx, 374761393) + Math.imul(cz, 668265263) + Math.imul(salt, 1442695041);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  private refreshMapChunks(force = false): void {
    const ccx = Math.floor(this.px / MAP_CHUNK);
    const ccz = Math.floor(this.pz / MAP_CHUNK);
    if (!force && ccx === this.lastChunkX && ccz === this.lastChunkZ) return;
    this.lastChunkX = ccx;
    this.lastChunkZ = ccz;

    this.activeMapProps = [];
    const counts = [0, 0, 0];

    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const baseX = cx * MAP_CHUNK;
        const baseZ = cz * MAP_CHUNK;

        for (let slot = 0; slot < 2; slot++) {
          const rKind = this.hash2D(cx, cz, slot * 7 + 1);
          if (rKind < 0.28) continue;
          const ox = (this.hash2D(cx, cz, slot * 7 + 2) - 0.5) * (MAP_CHUNK - 5);
          const oz = (this.hash2D(cx, cz, slot * 7 + 3) - 0.5) * (MAP_CHUNK - 5);
          const wx = baseX + MAP_CHUNK * 0.5 + ox;
          const wz = baseZ + MAP_CHUNK * 0.5 + oz;
          if (wx * wx + wz * wz < 8.5 * 8.5) continue;

          const key = `${cx}_${cz}_${slot}`;
          let kind: 0 | 1 | 2 = 2;
          if (rKind > 0.76) kind = 0;
          else if (rKind > 0.52) kind = 1;
          else kind = 2;

          if (kind === 2 && this.destroyedBarrels.has(key)) continue;
          if (counts[kind] >= MAX_MAP_PROPS) continue;

          const rotY = Math.floor(this.hash2D(cx, cz, slot * 7 + 4) * 4) * (Math.PI / 2);
          const radius = kind === 0 ? 1.0 : kind === 1 ? 1.25 : 0.62;
          this.activeMapProps.push({ key, kind, x: wx, z: wz, rotY, radius });

          const idx = counts[kind]++;
          this.dummy.position.set(wx, 0, wz);
          this.dummy.rotation.set(0, rotY, 0);
          this.dummy.scale.setScalar(1.0);
          this.dummy.updateMatrix();
          this.propMeshes[kind].setMatrixAt(idx, this.dummy.matrix);
        }
      }
    }

    for (let k = 0; k < 3; k++) {
      this.propMeshes[k].count = counts[k];
      this.propMeshes[k].instanceMatrix.needsUpdate = true;
    }
  }

  private damageBarrelsInRadius(cx: number, cz: number, r: number): void {
    let anyBroken = false;
    for (const p of this.activeMapProps) {
      if (p.kind !== 2 || this.destroyedBarrels.has(p.key)) continue;
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (dx * dx + dz * dz < (r + p.radius) * (r + p.radius)) {
        this.destroyedBarrels.add(p.key);
        anyBroken = true;
        this.vfx.spawnBurst(p.x, 0.7, p.z, 0xff6b00, 24, 12);
        this.vfx.spawnRing(p.x, p.z, 4.8, 0xfbbf24, 0.36);
        this.audio.playExplosion(true);
        this.triggerHitstop(0.055, 0.04);
        this.addTrauma(0.36);
        this.punchCamera(-125, 0.045);
        this.spawnGem(p.x, p.z, 10);
        // P0.3: 32% chance for explosive barrel to drop Fullscreen Magnet or Frenzy Orb!
        if (Math.random() < 0.32) {
          this.spawnPowerUp(p.x, p.z, Math.random() < 0.55 ? 'magnet' : 'frenzy');
        }
        this.damageCircle(p.x, p.z, 4.6, 135 * this.getDamageMult(), 15, 0xff7b00, undefined, false);
      }
    }
    if (anyBroken) this.refreshMapChunks(true);
  }

  // World-aligned Diegetic 3D HP (Left) & Dash (Right) Arc Gauges (P0.1)
  private setupPlayerAndDiegeticGauges(): void {
    const baseRingGeo = new THREE.RingGeometry(0.84, 0.96, 28);
    baseRingGeo.rotateX(-Math.PI / 2);
    const baseRing = new THREE.Mesh(
      baseRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    baseRing.position.y = 0.04;
    this.playerGroup.add(baseRing);

    const arrowGeo = new THREE.ConeGeometry(0.24, 0.62, 4);
    arrowGeo.rotateX(-Math.PI / 2);
    this.noseIndicator = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({ color: 0xfde047 })
    );
    this.noseIndicator.position.set(0, 0.14, -1.42);
    this.playerGroup.add(this.noseIndicator);
    this.scene.add(this.playerGroup);

    // Subtle dark backing arcs + segmented neon HP (left) and Dash (right) gauges
    const bgArcGeo = new THREE.RingGeometry(1.18, 1.34, 36);
    bgArcGeo.rotateX(-Math.PI / 2);
    const bgArc = new THREE.Mesh(
      bgArcGeo,
      new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      })
    );
    bgArc.position.y = 0.05;
    this.diegeticGroup.add(bgArc);

    // Left semicircle (angles PI*0.58 .. PI*1.42 in XZ plane) -> 10 HP segments
    const hpTotalSpan = Math.PI * 0.82;
    const hpStart = Math.PI * 0.59;
    const hpSegCount = 10;
    for (let i = 0; i < hpSegCount; i++) {
      const a0 = hpStart + (i / hpSegCount) * hpTotalSpan;
      const span = (hpTotalSpan / hpSegCount) * 0.82;
      const segGeo = new THREE.RingGeometry(1.19, 1.35, 5, 1, a0, span);
      segGeo.rotateX(-Math.PI / 2);
      const seg = new THREE.Mesh(
        segGeo,
        new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      );
      seg.position.y = 0.065;
      this.diegeticGroup.add(seg);
      this.hpArcSegs.push(seg);
    }

    // Right semicircle (angles -PI*0.41 .. +PI*0.41) -> 8 Dash segments
    const dashTotalSpan = Math.PI * 0.82;
    const dashStart = -Math.PI * 0.41;
    const dashSegCount = 8;
    for (let i = 0; i < dashSegCount; i++) {
      const a0 = dashStart + (i / dashSegCount) * dashTotalSpan;
      const span = (dashTotalSpan / dashSegCount) * 0.8;
      const segGeo = new THREE.RingGeometry(1.19, 1.35, 5, 1, a0, span);
      segGeo.rotateX(-Math.PI / 2);
      const seg = new THREE.Mesh(
        segGeo,
        new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      );
      seg.position.y = 0.065;
      this.diegeticGroup.add(seg);
      this.dashArcSegs.push(seg);
    }

    // Golden Frenzy Aura Halo
    const frenzyGeo = new THREE.RingGeometry(1.48, 1.72, 36);
    frenzyGeo.rotateX(-Math.PI / 2);
    this.frenzyHaloMesh = new THREE.Mesh(
      frenzyGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.frenzyHaloMesh.position.y = 0.07;
    this.frenzyHaloMesh.visible = false;
    this.diegeticGroup.add(this.frenzyHaloMesh);

    this.diegeticGroup.visible = false;
    this.scene.add(this.diegeticGroup);
  }

  private updateDiegeticGauges(): void {
    this.diegeticGroup.position.set(this.px, 0, this.pz);
    const hpRatio = Math.max(0, Math.min(1, this.hp / Math.max(1, this.maxHp)));
    const hpActive = Math.ceil(hpRatio * this.hpArcSegs.length);
    const hpHex = hpRatio > 0.5 ? 0x34d399 : hpRatio > 0.25 ? 0xfbbf24 : 0xf43f5e;
    for (let i = 0; i < this.hpArcSegs.length; i++) {
      const m = this.hpArcSegs[i];
      m.visible = i < hpActive;
      if (m.visible) {
        (m.material as THREE.MeshBasicMaterial).color.setHex(hpHex);
      }
    }

    const dashReady = Math.max(0, Math.min(1, 1 - this.dashCd / Math.max(0.01, this.dashMaxCd)));
    const dashActive = Math.floor(dashReady * this.dashArcSegs.length + 0.01);
    const fullHex = dashReady >= 0.999 ? 0x67e8f9 : 0x0284c7;
    for (let i = 0; i < this.dashArcSegs.length; i++) {
      const m = this.dashArcSegs[i];
      m.visible = i < dashActive;
      if (m.visible) {
        (m.material as THREE.MeshBasicMaterial).color.setHex(fullHex);
        (m.material as THREE.MeshBasicMaterial).opacity = dashReady >= 0.999 ? 0.95 : 0.55;
      }
    }

    if (this.frenzyTimer > 0) {
      this.frenzyHaloMesh.visible = true;
      const pulse = 1 + Math.sin(this.runTime * 18) * 0.12;
      this.frenzyHaloMesh.scale.setScalar(pulse);
    } else {
      this.frenzyHaloMesh.visible = false;
    }
  }

  private setupOffscreenIndicators(): void {
    const layer = document.getElementById('offscreen-layer')!;
    for (let i = 0; i < MAX_OFFSCREEN_INDICATORS; i++) {
      const root = document.createElement('div');
      root.className = 'edge-indicator hidden';
      const arrow = document.createElement('span');
      arrow.className = 'edge-arrow';
      arrow.textContent = '➤';
      const label = document.createElement('span');
      root.append(arrow, label);
      layer.appendChild(root);
      this.offscreenEls.push({ root, arrow, label });
    }
  }

  private updateOffscreenIndicators(): void {
    if (this.screen !== 'playing') {
      for (const el of this.offscreenEls) el.root.classList.add('hidden');
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    let slotIdx = 0;

    const pushTarget = (tx: number, tz: number, cls: 'boss' | 'pod' | 'powerup', text: string) => {
      if (slotIdx >= MAX_OFFSCREEN_INDICATORS) return;
      this.tmpProj.set(tx, 1.0, tz).project(this.camera);
      let nx = this.tmpProj.x;
      let ny = this.tmpProj.y;
      if (this.tmpProj.z > 1) {
        nx = -nx;
        ny = -ny;
      }
      // Only show edge arrow when target is near or outside screen border
      if (Math.abs(nx) < 0.88 && Math.abs(ny) < 0.84) return;

      const angle = Math.atan2(-ny, nx);
      const padX = 76;
      const padY = 54;
      const halfW = w * 0.5 - padX;
      const halfH = h * 0.5 - padY;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const scale = Math.min(
        Math.abs(cos) > 0.001 ? halfW / Math.abs(cos) : 99999,
        Math.abs(sin) > 0.001 ? halfH / Math.abs(sin) : 99999
      );
      const sx = w * 0.5 + cos * scale;
      const sy = h * 0.5 + sin * scale;
      const distM = Math.round(Math.hypot(tx - this.px, tz - this.pz));

      const ui = this.offscreenEls[slotIdx++];
      ui.root.className = `edge-indicator ${cls}`;
      ui.root.style.left = `${sx.toFixed(0)}px`;
      ui.root.style.top = `${sy.toFixed(0)}px`;
      ui.arrow.style.transform = `rotate(${((angle * 180) / Math.PI).toFixed(0)}deg)`;
      ui.label.textContent = `${text} ${distM}m`;
    };

    if (this.bossActive) {
      pushTarget(this.bossX, this.bossZ, 'boss', '⚠ 泰坦');
    }
    for (const ch of this.chests) {
      if (ch.active) pushTarget(ch.x, ch.z, 'pod', '📦 空投舱');
    }
    for (const pu of this.powerups) {
      if (pu.active) {
        pushTarget(pu.x, pu.z, 'powerup', pu.kind === 'magnet' ? '🧲 全屏磁铁' : '🔥 狂暴球');
      }
    }

    for (let i = slotIdx; i < MAX_OFFSCREEN_INDICATORS; i++) {
      this.offscreenEls[i].root.classList.add('hidden');
    }
  }

  private setupWeaponMeshes(): void {
    const sawGeo = new THREE.TorusGeometry(0.48, 0.11, 8, 18);
    sawGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < MAX_SAW_BLADES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(sawGeo, mat);
      m.visible = false;
      this.scene.add(m);
      this.sawMeshes.push(m);
    }

    this.laserTex = this.texLoader.load('./vfx/fx_laser.png');
    this.laserTex.colorSpace = THREE.SRGBColorSpace;
    this.laserTex.wrapS = THREE.RepeatWrapping;
    this.laserTex.wrapT = THREE.ClampToEdgeWrapping;
    this.laserTex.repeat.set(4, 1);

    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.rotateY(Math.PI / 2);
    beamGeo.translate(0, 0, -0.5);
    for (let i = 0; i < MAX_LASER_BEAMS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.laserTex,
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.visible = false;
      this.scene.add(beam);
      this.laserBeams.push(beam);
    }

    // Weapon 5 Pool: Gravity Wells / Singularity Collapse (P0.2)
    const coreGeo = new THREE.SphereGeometry(0.52, 16, 12);
    const accGeoA = new THREE.RingGeometry(0.65, 1.0, 28);
    accGeoA.rotateX(-Math.PI / 2);
    const accGeoB = new THREE.RingGeometry(0.32, 0.92, 24);
    accGeoB.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_GRAVITY_WELLS; i++) {
      const grp = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0x1e0538 }));
      core.position.y = 0.55;
      const ringA = new THREE.Mesh(
        accGeoA,
        new THREE.MeshBasicMaterial({
          color: 0xc084fc,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      ringA.position.y = 0.1;
      const ringB = new THREE.Mesh(
        accGeoB,
        new THREE.MeshBasicMaterial({
          color: 0xf472b6,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      ringB.position.y = 0.35;
      grp.add(core, ringA, ringB);
      grp.visible = false;
      this.scene.add(grp);
      this.gravityWells.push({
        active: false,
        x: 0,
        z: 0,
        radius: 3.6,
        age: 0,
        dur: 3,
        tickTimer: 0,
        tickDmg: 15,
        collapseDmg: 75,
        hyper: false,
        group: grp,
        ringA,
        ringB,
      });
    }

    // Weapon 6 Pool: Orbital Strike Lock-On Reticles (P0.2)
    const outerRetGeo = new THREE.RingGeometry(0.9, 1.0, 32);
    outerRetGeo.rotateX(-Math.PI / 2);
    const innerRetGeo = new THREE.CircleGeometry(0.95, 28);
    innerRetGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_ORBITAL_STRIKES; i++) {
      const grp = new THREE.Group();
      const outerRing = new THREE.Mesh(
        outerRetGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfbbf24,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      outerRing.position.y = 0.07;
      const innerRing = new THREE.Mesh(
        innerRetGeo,
        new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      innerRing.position.y = 0.065;
      grp.add(outerRing, innerRing);
      grp.visible = false;
      this.scene.add(grp);
      this.orbitalStrikes.push({
        active: false,
        x: 0,
        z: 0,
        radius: 3.2,
        delay: 0,
        age: 0,
        dur: 0.55,
        dmg: 68,
        hyper: false,
        group: grp,
        outerRing,
        innerRing,
      });
    }
  }

  private setupInstancedPoolsFallback(): void {
    const projGeo = new THREE.ConeGeometry(0.2, 0.85, 4);
    projGeo.rotateX(-Math.PI / 2);
    this.projMesh = new THREE.InstancedMesh(
      projGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_PROJ
    );
    this.projMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.projMesh.frustumCulled = false;
    for (let i = 0; i < MAX_PROJ; i++) {
      this.hideInstance(this.projMesh, i);
      this.projMesh.setColorAt(i, this.tmpColor.setHex(0x22d3ee));
    }
    this.scene.add(this.projMesh);

    const fallbackGeo = new THREE.BoxGeometry(0.6, 0.9, 0.6);
    for (let t = 0; t < 4; t++) {
      const im = new THREE.InstancedMesh(
        fallbackGeo,
        new THREE.MeshStandardMaterial({ color: 0x8855ff }),
        MAX_ENEMIES
      );
      im.count = 0;
      im.frustumCulled = false;
      this.scene.add(im);
      this.enemyMeshes.push(im);
    }

    const gemGeo = new THREE.OctahedronGeometry(0.28, 0);
    this.gemMesh = new THREE.InstancedMesh(
      gemGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_GEMS
    );
    this.gemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gemMesh.frustumCulled = false;
    for (let i = 0; i < MAX_GEMS; i++) {
      this.hideInstance(this.gemMesh, i);
      this.gemMesh.setColorAt(i, this.tmpColor.setHex(0x38bdf8));
    }
    this.scene.add(this.gemMesh);
  }

  private setupBossChestsAndPowerups(): void {
    this.bossGroup.visible = false;
    this.scene.add(this.bossGroup);

    const arenaGeo = new THREE.RingGeometry(21.6, 22.1, 48);
    arenaGeo.rotateX(-Math.PI / 2);
    this.arenaRing = new THREE.Mesh(
      arenaGeo,
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.arenaRing.position.y = 0.05;
    this.arenaRing.visible = false;
    this.scene.add(this.arenaRing);

    // Boss Telegraph 1: Crimson Dash Red-Carpet Corridor (width 3.2, length 1, anchored at origin -Z)
    const carpetGeo = new THREE.PlaneGeometry(3.2, 1.0);
    carpetGeo.rotateX(-Math.PI / 2);
    carpetGeo.translate(0, 0, -0.5);
    this.bossChargeCarpet = new THREE.Mesh(
      carpetGeo,
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.bossChargeCarpet.position.y = 0.075;
    this.bossChargeCarpet.visible = false;
    this.scene.add(this.bossChargeCarpet);

    // Boss Telegraph 2: 4-Way Rotating Crimson Cross-Lasers
    const bLaserGeo = new THREE.PlaneGeometry(1, 1);
    bLaserGeo.rotateX(-Math.PI / 2);
    bLaserGeo.rotateY(Math.PI / 2);
    bLaserGeo.translate(0, 0, -0.5);
    for (let i = 0; i < 4; i++) {
      const bm = new THREE.Mesh(
        bLaserGeo,
        new THREE.MeshBasicMaterial({
          map: this.laserTex,
          color: 0xf43f5e,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      bm.visible = false;
      this.scene.add(bm);
      this.bossCrossLasers.push(bm);
    }

    // Boss Telegraph 3: Multi-Circle Ground Red Barrage Zones
    const mRimGeo = new THREE.RingGeometry(0.88, 1.0, 28);
    mRimGeo.rotateX(-Math.PI / 2);
    const mFillGeo = new THREE.CircleGeometry(0.92, 28);
    mFillGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_BOSS_METEORS; i++) {
      const grp = new THREE.Group();
      const rim = new THREE.Mesh(
        mRimGeo,
        new THREE.MeshBasicMaterial({
          color: 0xf43f5e,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      rim.position.y = 0.075;
      const fillDisk = new THREE.Mesh(
        mFillGeo,
        new THREE.MeshBasicMaterial({
          color: 0xe11d48,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      fillDisk.position.y = 0.07;
      grp.add(rim, fillDisk);
      grp.visible = false;
      this.scene.add(grp);
      this.bossMeteors.push({
        active: false,
        x: 0,
        z: 0,
        radius: 2.7,
        age: 0,
        dur: 0.85,
        group: grp,
        fillDisk,
      });
    }

    // 6 Orbital Hyper Supply Pods
    for (let i = 0; i < 6; i++) {
      const grp = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.72, 0.95),
        new THREE.MeshStandardMaterial({
          color: 0x78350f,
          emissive: 0xfbbf24,
          emissiveIntensity: 0.9,
          metalness: 0.8,
          roughness: 0.2,
        })
      );
      box.position.y = 0.45;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.55, 14, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfde047,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      beam.position.y = 7;
      grp.add(box, beam);
      grp.visible = false;
      this.scene.add(grp);
      this.chests.push({ active: false, x: 0, z: 0, age: 0, group: grp });
    }

    // Power-Up Drops Pool (Loot_MagnetCore & Loot_FrenzyOrb)
    const fallbackPuGeo = new THREE.OctahedronGeometry(0.42, 1);
    const puRingGeo = new THREE.RingGeometry(0.65, 0.82, 24);
    puRingGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_POWERUPS; i++) {
      const kind: PowerUpKind = i % 2 === 0 ? 'magnet' : 'frenzy';
      const grp = new THREE.Group();
      const coreMesh = new THREE.Mesh(
        fallbackPuGeo.clone(),
        new THREE.MeshBasicMaterial({ color: kind === 'magnet' ? 0x38bdf8 : 0xfbbf24 })
      );
      coreMesh.position.y = 0.55;
      const halo = new THREE.Mesh(
        puRingGeo,
        new THREE.MeshBasicMaterial({
          color: kind === 'magnet' ? 0x38bdf8 : 0xf97316,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      halo.position.y = 0.07;
      grp.add(coreMesh, halo);
      grp.visible = false;
      this.scene.add(grp);
      this.powerups.push({ active: false, kind, x: 0, z: 0, age: 0, group: grp, coreMesh });
    }
  }

  private hideInstance(im: THREE.InstancedMesh, index: number): void {
    this.dummy.position.set(0, -100, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    im.setMatrixAt(index, this.dummy.matrix);
  }

  // =========================================================================
  // Stat Modifier Stack (Includes Meta-Hangar Permanent Upgrades + Frenzy!)
  // =========================================================================
  private getDamageMult(): number {
    const capLv = this.passiveLevels.capacitor || 0;
    const hangarDmg = (this.metaSave.upgrades.overcharge || 0) * 0.06;
    let pct = capLv * 0.14 + this.overclockStacks * 0.05 + hangarDmg;
    if (this.currentMech.id === 'aegis') {
      const missingTenPct = Math.floor(((1 - this.hp / Math.max(1, this.maxHp)) * 100) / 10);
      pct += Math.max(0, missingTenPct) * 0.06;
    }
    return (1 + pct) * this.currentMech.dmgMult;
  }

  private getCooldownMult(): number {
    const coolLv = this.passiveLevels.cooler || 0;
    const baseCd = Math.max(0.35, 1 - coolLv * 0.09);
    return this.frenzyTimer > 0 ? baseCd * 0.44 : baseCd;
  }

  private getAreaMult(): number {
    const ampLv = this.passiveLevels.amp || 0;
    return 1 + this.currentMech.areaBonus + ampLv * 0.14;
  }

  private getDurationSpeedMult(): number {
    return 1 + (this.passiveLevels.thruster || 0) * 0.15;
  }

  private getExtraProj(): number {
    return this.currentMech.extraProj + (this.passiveLevels.splitter || 0);
  }

  private getMagnetRadius(): number {
    const magLv = this.passiveLevels.magnet || 0;
    const hangarMag = (this.metaSave.upgrades.siphon || 0) * 0.18;
    const base = 3.6 * (1 + magLv * 0.3 + hangarMag);
    return this.dashBoostMagTimer > 0 ? base * 1.85 : base;
  }

  private getMoveSpeed(): number {
    const magLv = this.passiveLevels.magnet || 0;
    const hangarSpd = (this.metaSave.upgrades.thrusters || 0) * 0.04;
    const frenzySpd = this.frenzyTimer > 0 ? 0.2 : 0;
    return this.currentMech.speed * (1 + magLv * 0.04 + hangarSpd + frenzySpd);
  }

  private getDashMaxCd(): number {
    const thrLv = this.passiveLevels.thruster || 0;
    return 2.5 * this.currentMech.dashCdMult * Math.max(0.65, 1 - thrLv * 0.05);
  }

  private getArmor(): number {
    return this.currentMech.armor + (this.passiveLevels.armor || 0) * 6;
  }

  private getCritChance(): number {
    return 0.06 + this.currentMech.critBonus + (this.frenzyTimer > 0 ? 0.12 : 0);
  }

  // =========================================================================
  // Camera Feel: Rotational Trauma2 + FOV Zoom-Punch + Dutch Roll
  // =========================================================================
  private triggerHitstop(duration: number, slow = 0.04): void {
    if (duration > this.hitstopTimer) {
      this.hitstopTimer = duration;
      this.timeScale = slow;
    }
  }

  private addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount * this.shakeStrength);
  }

  private punchCamera(fovImpulse: number, rollRad: number): void {
    this.fovVel += fovImpulse * this.shakeStrength;
    const sign = Math.random() < 0.5 ? -1 : 1;
    this.rollVel += rollRad * sign * 18 * this.shakeStrength;
  }

  private kickWeaponRecoil(impulse: number): void {
    this.recoilVel += impulse;
  }

  // =========================================================================
  // Run Start / Reset
  // =========================================================================
  public startRun(mechIdx = this.selectedMechIdx): void {
    this.audio.unlock();
    this.audio.setBulletTimeMuffle(false);
    this.selectedMechIdx = mechIdx;
    this.currentMech = MECHS[mechIdx];
    this.applySelectedMechVisuals();

    this.px = 0;
    this.pz = 0;
    this.pvx = 0;
    this.pvz = 0;
    this.facingYaw = 0;
    const bonusHp = (this.metaSave.upgrades.hull || 0) * 15;
    this.maxHp = this.currentMech.hp + bonusHp;
    this.hp = this.maxHp;
    this.iFrameTimer = 0;
    this.dashCd = 0;
    this.dashMaxCd = this.getDashMaxCd();
    this.dashBufferTimer = 0;
    this.dashActiveTimer = 0;
    this.dashBoostMagTimer = 0;
    this.frenzyTimer = 0;
    this.revivesLeft = this.metaSave.upgrades.phoenix || 0;

    this.runTime = 0;
    this.kills = 0;
    this.bossesDefeated = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboPopTimer = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpForNextLevel(1);
    this.pendingLevels = 0;
    this.rerollsLeft = 2 + (this.metaSave.upgrades.tactical || 0);
    this.overclockStacks = 0;

    this.weaponLevels = { [this.currentMech.startWeapon]: 1 };
    this.weaponHyper = {};
    this.weaponTimers = {
      kunai: 0.1,
      saw: 0.1,
      arc: 0.2,
      laser: 0.3,
      gravity: 0.4,
      orbital: 0.4,
    };
    this.passiveLevels = {};
    this.laserActiveTimer = 0;
    this.dpsTracker.reset(this.currentMech.startWeapon);

    for (const gw of this.gravityWells) {
      gw.active = false;
      gw.group.visible = false;
    }
    for (const os of this.orbitalStrikes) {
      os.active = false;
      os.group.visible = false;
    }

    this.camFocus.set(0, 0, 0);
    this.trauma = 0;
    this.fovOffset = 0;
    this.fovVel = 0;
    this.rollSpring = 0;
    this.rollVel = 0;
    this.hitstopTimer = 0;
    this.witchTimer = 0;
    this.timeScale = 1.0;
    document.getElementById('witch-vignette')!.classList.add('hidden');
    this.comboPillEl.classList.add('hidden');

    this.eActive.fill(0);
    this.eWobble.fill(0);
    this.projActive.fill(0);
    this.gActive.fill(0);
    this.activeEnemyCount = 0;
    this.activeGemCount = 0;
    this.triggeredEvents.clear();
    this.destroyedBarrels.clear();
    this.refreshMapChunks(true);

    this.clearBossVisuals();
    document.getElementById('boss-banner')!.classList.add('hidden');
    for (const ch of this.chests) {
      ch.active = false;
      ch.group.visible = false;
    }
    for (const pu of this.powerups) {
      pu.active = false;
      pu.group.visible = false;
    }
    for (let i = 0; i < MAX_PROJ; i++) this.hideInstance(this.projMesh, i);
    this.projMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_GEMS; i++) this.hideInstance(this.gemMesh, i);
    this.gemMesh.instanceMatrix.needsUpdate = true;
    for (const im of this.enemyMeshes) {
      im.count = 0;
      im.instanceMatrix.needsUpdate = true;
    }

    this.diegeticGroup.visible = true;
    this.updateDiegeticGauges();
    this.spawnRingWave(16, 0, 19);
    this.spawnRingWave(6, 2, 21);

    this.setScreen('playing');
    this.updateSlotBadges();
    this.updateHud();
    this.showToast(`机甲【${this.currentMech.name}】出击！脚下左绿血槽 · 右青冲刺槽！`);
  }

  private clearBossVisuals(): void {
    this.bossActive = false;
    this.bossMode = 'chase';
    this.bossGroup.visible = false;
    this.arenaRing.visible = false;
    this.bossChargeCarpet.visible = false;
    for (const bl of this.bossCrossLasers) bl.visible = false;
    for (const bm of this.bossMeteors) {
      bm.active = false;
      bm.group.visible = false;
    }
  }

  private setScreen(next: ScreenState): void {
    this.screen = next;
    if (next !== 'playing') {
      this.audio.setBulletTimeMuffle(false);
    }
    if (next === 'title') {
      this.diegeticGroup.visible = false;
      this.renderHangarPanel();
      this.renderTitleCards();
    }
    document.getElementById('title-screen')!.classList.toggle('hidden', next !== 'title');
    document.getElementById('hud')!.classList.toggle('hidden', next === 'title');
    document.getElementById('upgrade-modal')!.classList.toggle('hidden', next !== 'upgrade');
    document.getElementById('recipe-modal')!.classList.toggle('hidden', next !== 'recipe');
    document.getElementById('result-screen')!.classList.toggle(
      'hidden',
      next !== 'gameover' && next !== 'victory'
    );
  }

  // =========================================================================
  // Main Loop (Dual-Clock + Adaptive Synthwave BGM Tick)
  // =========================================================================
  private tick(): void {
    this.timer.update();
    const rawDt = Math.min(Math.max(this.timer.getDelta(), 0), 0.05);

    this.fpsAccum += rawDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.displayedFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= rawDt;
      if (this.toastTimer <= 0) {
        document.getElementById('toast-banner')!.classList.add('hidden');
      }
    }

    // Drive Beat-Synced Adaptive Synthwave BGM (P2.1)
    const hasHyper = Object.values(this.weaponHyper).some(Boolean);
    const bgmIntensity: 0 | 1 | 2 =
      this.bossActive || this.frenzyTimer > 0 || hasHyper || this.runTime >= 360
        ? 2
        : this.runTime >= 150 || this.comboCount >= 12
        ? 1
        : 0;
    const bgmActive =
      this.screen === 'playing' || this.screen === 'upgrade' || this.screen === 'recipe';
    const bgmDucked =
      this.screen === 'upgrade' || this.screen === 'recipe' || this.witchTimer > 0;
    this.audio.stepAdaptiveBgm(bgmActive, bgmIntensity, bgmDucked);

    if (this.screen === 'playing') {
      if (this.hitstopTimer > 0) {
        this.hitstopTimer -= rawDt;
        if (this.hitstopTimer <= 0) {
          this.timeScale = this.witchTimer > 0 ? 0.28 : 1.0;
        }
      } else if (this.witchTimer > 0) {
        this.witchTimer -= rawDt;
        this.timeScale = 0.28;
        if (this.witchTimer <= 0) {
          this.timeScale = 1.0;
          this.audio.setBulletTimeMuffle(false);
          document.getElementById('witch-vignette')!.classList.add('hidden');
        }
      } else if (this.postMenuGrace > 0) {
        this.postMenuGrace -= rawDt;
        this.timeScale = 0.55 + 0.45 * (1 - Math.max(0, this.postMenuGrace) / 0.35);
      } else {
        this.timeScale = 1.0;
      }

      const scaledDt = rawDt * this.timeScale;
      const playerDt = this.witchTimer > 0 && this.hitstopTimer <= 0 ? rawDt * 0.88 : scaledDt;

      if (this.mixer) this.mixer.update(playerDt);
      this.stepPlayerAndDash(playerDt, rawDt);
      this.stepSimulation(scaledDt, rawDt);
      this.updateDiegeticGauges();
      this.updateOffscreenIndicators();

      this.hudDirtyTimer += rawDt;
      if (this.hudDirtyTimer >= 0.08) {
        this.hudDirtyTimer = 0;
        this.updateHud();
      }
    } else if (this.screen === 'title') {
      if (this.mixer) this.mixer.update(rawDt);
      this.playerGroup.rotation.y += rawDt * 0.85;
    }

    this.updateCamera(rawDt);
    this.vfx.update(
      rawDt,
      this.camera,
      this.dmgCtx,
      this.dmgCanvas.width,
      this.dmgCanvas.height
    );
    this.composer.render();
  }

  private stepSimulation(dt: number, rawDt: number): void {
    this.runTime += dt;
    if (this.frenzyTimer > 0) {
      this.frenzyTimer = Math.max(0, this.frenzyTimer - rawDt);
    }

    if (this.comboPopTimer > 0) {
      this.comboPopTimer = Math.max(0, this.comboPopTimer - rawDt);
      const scale = 1 + (this.comboPopTimer / 0.1) * 0.2;
      this.comboPillEl.style.transform = `scale(${scale.toFixed(2)})`;
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= rawDt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboPillEl.classList.add('hidden');
      }
    }

    this.refreshMapChunks(false);
    this.stepWaveDirector(dt);
    this.rebuildSpatialGrid();
    this.stepEnemies(dt, rawDt);
    this.stepBoss(dt, rawDt);
    this.stepWeapons(dt);
    this.stepGravityWells(dt);
    this.stepOrbitalStrikes(dt);
    this.stepProjectiles(dt);
    this.stepGemsChestsAndPowerups(dt);
  }

  // =========================================================================
  // Spatial Hash Neighborhood Query (P2.2: Eliminates O(N) full-array scans!)
  // =========================================================================
  private rebuildSpatialGrid(): void {
    this.gridHead.fill(-1);
    this.gridOriginX = this.px - GRID_DIM * GRID_CELL * 0.5;
    this.gridOriginZ = this.pz - GRID_DIM * GRID_CELL * 0.5;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!this.eActive[i]) continue;
      const cx = Math.floor((this.eX[i] - this.gridOriginX) / GRID_CELL);
      const cz = Math.floor((this.eZ[i] - this.gridOriginZ) / GRID_CELL);
      if (cx >= 0 && cx < GRID_DIM && cz >= 0 && cz < GRID_DIM) {
        const cell = cz * GRID_DIM + cx;
        this.gridNext[i] = this.gridHead[cell];
        this.gridHead[cell] = i;
      } else {
        this.gridNext[i] = -1;
      }
    }
  }

  private forEachEnemyInRadius(
    cx: number,
    cz: number,
    radius: number,
    visit: (idx: number, dx: number, dz: number, d2: number) => void
  ): void {
    const padR = radius + 1.6; // Include elite hitbox margin
    const r2 = radius * radius;
    const minGx = Math.max(0, Math.floor((cx - padR - this.gridOriginX) / GRID_CELL));
    const maxGx = Math.min(GRID_DIM - 1, Math.floor((cx + padR - this.gridOriginX) / GRID_CELL));
    const minGz = Math.max(0, Math.floor((cz - padR - this.gridOriginZ) / GRID_CELL));
    const maxGz = Math.min(GRID_DIM - 1, Math.floor((cz + padR - this.gridOriginZ) / GRID_CELL));

    for (let gz = minGz; gz <= maxGz; gz++) {
      const rowOff = gz * GRID_DIM;
      for (let gx = minGx; gx <= maxGx; gx++) {
        let e = this.gridHead[rowOff + gx];
        while (e !== -1) {
          const next = this.gridNext[e];
          if (this.eActive[e]) {
            const dx = this.eX[e] - cx;
            const dz = this.eZ[e] - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 <= r2) {
              visit(e, dx, dz, d2);
            }
          }
          e = next;
        }
      }
    }
  }

  // =========================================================================
  // Player Locomotion + Kinetic Burst Dash + Perfect Dodge Witch-Time
  // =========================================================================
  private stepPlayerAndDash(dt: number, rawDt: number): void {
    this.dashMaxCd = this.getDashMaxCd();
    if (this.iFrameTimer > 0) this.iFrameTimer -= rawDt;
    if (this.dashCd > 0) this.dashCd = Math.max(0, this.dashCd - rawDt);
    if (this.dashBoostMagTimer > 0) this.dashBoostMagTimer -= rawDt;

    if (this.dashBufferTimer > 0) {
      this.dashBufferTimer -= dt;
      if (this.dashCd <= 0 && this.dashActiveTimer <= 0) {
        this.dashBufferTimer = 0;
        this.executeDash();
      }
    }

    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;

    const len = Math.hypot(ix, iz);
    if (len > 0.001) {
      ix /= len;
      iz /= len;
      const targetYaw = Math.atan2(ix, -iz);
      let diff = targetYaw - this.facingYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingYaw += diff * (1 - Math.exp(-18 * dt));
    }

    if (this.dashActiveTimer > 0) {
      this.dashActiveTimer -= rawDt;
      const burstRatio = Math.max(0, this.dashActiveTimer / 0.145);
      const burstSpd = 22 + 28 * burstRatio;
      this.pvx = this.dashDirX * burstSpd;
      this.pvz = this.dashDirZ * burstSpd;
      this.px += this.pvx * rawDt;
      this.pz += this.pvz * rawDt;

      this.dashGhostAccum += rawDt;
      if (this.dashGhostAccum >= 0.025) {
        this.dashGhostAccum = 0;
        this.vfx.spawnSingleGhost(this.px, this.pz, this.facingYaw, this.currentMech.color);
      }

      if (this.currentMech.id === 'striker') {
        const slashDmg = Math.round(26 * this.getDamageMult());
        this.damageCircle(this.px, this.pz, 2.3, slashDmg, 8, 0x22d3ee, 'kunai');
      }
    } else {
      const spd = this.getMoveSpeed();
      this.transitionLocomotion(len > 0.01);
      const rate = len > 0.01 ? 18 : 22;
      const damp = 1 - Math.exp(-rate * dt);
      this.pvx += (ix * spd - this.pvx) * damp;
      this.pvz += (iz * spd - this.pvz) * damp;
      this.px += this.pvx * dt;
      this.pz += this.pvz * dt;
    }

    for (const p of this.activeMapProps) {
      const dx = this.px - p.x;
      const dz = this.pz - p.z;
      const minD = p.radius + 0.55;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        this.px = p.x + (dx / d) * minD;
        this.pz = p.z + (dz / d) * minD;
      }
    }

    if (this.bossActive) {
      const dx = this.px - this.arenaCenter.x;
      const dz = this.pz - this.arenaCenter.y;
      const dist = Math.hypot(dx, dz);
      if (dist > 21.2) {
        this.px = this.arenaCenter.x + (dx / dist) * 21.2;
        this.pz = this.arenaCenter.y + (dz / dist) * 21.2;
      }
    }

    const rForce = -240 * this.recoilZ - 18 * this.recoilVel;
    this.recoilVel += rForce * rawDt;
    this.recoilZ = Math.max(-0.25, Math.min(0.35, this.recoilZ + this.recoilVel * rawDt));

    this.playerGroup.position.set(this.px, 0, this.pz);
    this.playerGroup.rotation.y = -this.facingYaw;
    this.playerGroup.rotation.z = Math.max(-0.18, Math.min(0.18, -this.pvx * 0.016));
    this.playerGroup.rotation.x =
      Math.max(-0.22, Math.min(0.22, this.pvz * 0.016)) - this.recoilZ * 0.35;

    const bob =
      len > 0.01 ? Math.abs(Math.sin(this.runTime * 12)) * 0.08 : Math.sin(this.runTime * 3) * 0.04;
    this.chestKitMount.position.set(0, 1.18 + bob, 0.08 + this.recoilZ);

    const speedNorm = Math.min(2.6, Math.hypot(this.pvx, this.pvz) / 8.0);
    const flicker = 0.85 + Math.sin(this.runTime * 48) * 0.2;
    for (const fm of this.thrusterFlames) {
      fm.visible = speedNorm > 0.08;
      fm.scale.set(
        0.8 + speedNorm * 0.25,
        0.8 + speedNorm * 0.25,
        (0.35 + speedNorm * 0.95) * flicker
      );
    }

    const blink =
      this.iFrameTimer > 0 &&
      this.shakeStrength > 0 &&
      Math.floor(this.iFrameTimer * 24) % 2 === 0;
    const armorColor = this.frenzyTimer > 0 ? 0xfde047 : this.currentMech.color;
    for (const mat of this.playerArmorMats) {
      mat.emissive.setHex(blink ? 0xffffff : armorColor);
      mat.emissiveIntensity = blink ? 1.6 : this.frenzyTimer > 0 ? 0.65 : 0.22;
    }

    const snapX = Math.floor(this.px / 6) * 6;
    const snapZ = Math.floor(this.pz / 6) * 6;
    this.floorMesh.position.set(snapX, 0, snapZ);

    this.sunLight.position.set(this.px + 10, 22, this.pz + 12);
    this.sunLight.target.position.set(this.px, 0, this.pz);
  }

  private isPlayerInBossTelegraphDanger(): boolean {
    if (!this.bossActive) return false;
    if (Math.hypot(this.bossX - this.px, this.bossZ - this.pz) < 3.9) return true;
    if (this.bossMode === 'charge_windup' || this.bossMode === 'charge_dash') {
      const endX = this.bossX + Math.sin(this.bossChargeYaw) * this.bossChargeLen;
      const endZ = this.bossZ - Math.cos(this.bossChargeYaw) * this.bossChargeLen;
      if (this.pointToSegmentDistSq(this.px, this.pz, this.bossX, this.bossZ, endX, endZ) < 2.2 * 2.2) {
        return true;
      }
    }
    if (this.bossMode === 'laser_windup' || this.bossMode === 'laser_sweep') {
      for (let b = 0; b < 4; b++) {
        const a = this.bossLaserYaw + (b * Math.PI) / 2;
        const ex = this.bossX + Math.sin(a) * 17.5;
        const ez = this.bossZ - Math.cos(a) * 17.5;
        if (this.pointToSegmentDistSq(this.px, this.pz, this.bossX, this.bossZ, ex, ez) < 1.8 * 1.8) {
          return true;
        }
      }
    }
    for (const bm of this.bossMeteors) {
      if (bm.active && Math.hypot(this.px - bm.x, this.pz - bm.z) < bm.radius + 0.6) {
        return true;
      }
    }
    return false;
  }

  private executeDash(): void {
    this.dashCd = this.dashMaxCd;
    this.iFrameTimer = Math.max(this.iFrameTimer, 0.34);
    this.dashBoostMagTimer = 0.85;
    this.dashActiveTimer = 0.145;
    this.dashGhostAccum = 0;
    this.dashDirX = Math.sin(this.facingYaw);
    this.dashDirZ = -Math.cos(this.facingYaw);

    if (this.animActions.Jump) {
      this.animActions.Jump.reset().play();
    }

    let closeDanger = this.isPlayerInBossTelegraphDanger();
    if (!closeDanger) {
      this.forEachEnemyInRadius(this.px, this.pz, 2.45, () => {
        closeDanger = true;
      });
    }

    this.audio.playDash();
    this.vfx.spawnSlashWave(this.px, this.pz, this.facingYaw, 0x67e8f9);
    this.vfx.spawnRing(this.px, this.pz, 4.2, 0x22d3ee, 0.26);
    this.punchCamera(75, 0.025);

    if (closeDanger && this.witchTimer <= 0) {
      this.witchTimer = 0.58;
      this.dashCd *= 0.65;
      this.audio.playPerfectDodge();
      this.audio.setBulletTimeMuffle(true);
      document.getElementById('witch-vignette')!.classList.remove('hidden');
      this.vfx.spawnRing(this.px, this.pz, 8.5, 0xe879f9, 0.42);
      this.vfx.spawnDamageNumber(this.px, this.pz, '★ 极限闪避!', true, '#67e8f9');
      this.grantXp(5);
    } else {
      this.addTrauma(0.18);
    }
  }

  private updateCamera(rawDt: number): void {
    const vMag = Math.hypot(this.pvx, this.pvz);
    const clampedScale = vMag > 12 ? 12 / vMag : 1;
    const leadX = this.pvx * clampedScale * 0.18;
    const leadZ = this.pvz * clampedScale * 0.18;
    const smooth = 1 - Math.exp(-9.5 * rawDt);
    this.camFocus.x += (this.px + leadX - this.camFocus.x) * smooth;
    this.camFocus.z += (this.pz + leadZ - this.camFocus.z) * smooth;

    const targetFovOff = this.witchTimer > 0 ? -3.5 : 0;
    const fovForce = -210 * (this.fovOffset - targetFovOff) - 17 * this.fovVel;
    this.fovVel += fovForce * rawDt;
    this.fovOffset = Math.max(-7, Math.min(7, this.fovOffset + this.fovVel * rawDt));
    if (Math.abs(this.camera.fov - (this.baseFov + this.fovOffset)) > 0.02) {
      this.camera.fov = this.baseFov + this.fovOffset;
      this.camera.updateProjectionMatrix();
    }

    const rForce = -190 * this.rollSpring - 15 * this.rollVel;
    this.rollVel += rForce * rawDt;
    this.rollSpring += this.rollVel * rawDt;

    this.camera.position.set(this.camFocus.x, 19.2, this.camFocus.z + 14.6);
    this.camera.lookAt(this.camFocus.x, 0.85, this.camFocus.z);

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - 1.55 * rawDt);
      const shake = this.trauma * this.trauma * this.shakeStrength;
      this.shakeClock += rawDt * 2.4;
      const nPitch =
        0.6 * Math.sin(this.shakeClock * 11.0 + 1.3) + 0.4 * Math.sin(this.shakeClock * 23.0 + 2.6);
      const nYaw =
        0.6 * Math.sin(this.shakeClock * 13.0 + 4.1) + 0.4 * Math.sin(this.shakeClock * 29.0 + 8.2);
      const nRoll =
        0.6 * Math.sin(this.shakeClock * 17.0 + 6.7) + 0.4 * Math.sin(this.shakeClock * 31.0 + 3.4);
      this.camera.rotateX(nPitch * 0.032 * shake);
      this.camera.rotateY(nYaw * 0.024 * shake);
      this.camera.rotateZ(nRoll * 0.048 * shake + this.rollSpring);
    } else if (Math.abs(this.rollSpring) > 0.0005) {
      this.camera.rotateZ(this.rollSpring);
    }
  }

  // =========================================================================
  // Wave Director
  // =========================================================================
  private getWaveScale(): number {
    const mins = this.runTime / 60;
    if (mins < 3) return 1 + mins * 0.22;
    if (mins < 6) return 1.66 + (mins - 3) * 0.62;
    if (mins < 9) return 3.52 + (mins - 6) * 1.45;
    return 7.87 + (mins - 9) * 3.1;
  }

  private stepWaveDirector(dt: number): void {
    const t = this.runTime;
    const mins = t / 60;

    let minQuota = 38;
    let spawnRate = 5.5;
    if (mins < 3) {
      minQuota = Math.round(35 + mins * 48);
      spawnRate = 5 + mins * 4;
    } else if (mins < 6) {
      minQuota = Math.round(180 + (mins - 3) * 85);
      spawnRate = 18 + (mins - 3) * 6;
    } else if (mins < 9) {
      minQuota = Math.round(440 + (mins - 6) * 125);
      spawnRate = 36 + (mins - 6) * 10;
    } else {
      minQuota = Math.min(1050, Math.round(820 + (mins - 9) * 85));
      spawnRate = 68;
    }

    if (this.bossActive && this.bossStage === 3) {
      minQuota = 180;
      spawnRate = 10;
    }

    if (this.activeEnemyCount < minQuota * 0.55) {
      spawnRate *= 2.5;
    }

    this.spawnAccum += spawnRate * dt;
    while (this.spawnAccum >= 1 && this.activeEnemyCount < MAX_ENEMIES - 12) {
      this.spawnAccum -= 1;
      const type = this.pickEnemyType(mins);
      const ang = Math.random() * Math.PI * 2;
      const rad = 22.5 + Math.random() * 5.5;
      this.spawnEnemy(type, this.px + Math.cos(ang) * rad, this.pz + Math.sin(ang) * rad, false);
    }

    const eliteTimes = [75, 165, 310, 430, 580];
    for (const et of eliteTimes) {
      const key = `elite_${et}`;
      if (t >= et && !this.triggeredEvents.has(key)) {
        this.triggeredEvents.add(key);
        const ang = Math.random() * Math.PI * 2;
        this.spawnEnemy(3, this.px + Math.cos(ang) * 19, this.pz + Math.sin(ang) * 19, true);
        this.showToast('⚡ 金甲重装统领来袭！击坠必掉【超导进化空投舱】+【狂暴球】');
      }
    }

    const ringTimes = [135, 340, 610];
    for (const rt of ringTimes) {
      const key = `ring_${rt}`;
      if (t >= rt && !this.triggeredEvents.has(key)) {
        this.triggeredEvents.add(key);
        this.spawnRingWave(34, mins >= 5 ? 2 : 0, 21.5);
        this.showToast('🚨 警告：侦测到环形机甲包围网！集中火力撕开缺口！');
      }
    }

    if (t >= 240 && !this.triggeredEvents.has('boss_1')) {
      this.triggeredEvents.add('boss_1');
      this.spawnBoss(1, '⚠ 阶段 BOSS：六翼重装机神·壹型', 3200);
    } else if (t >= 480 && !this.triggeredEvents.has('boss_2')) {
      this.triggeredEvents.add('boss_2');
      this.spawnBoss(2, '⚠ 阶段 BOSS：六翼重装机神·贰型', 12500);
    } else if (t >= 720 && !this.triggeredEvents.has('boss_3')) {
      this.triggeredEvents.add('boss_3');
      this.spawnBoss(3, '☠ 终局泰坦：奥米茄炽天使机神 (击败即破关!)', 36000);
    }
  }

  private pickEnemyType(mins: number): number {
    const r = Math.random();
    if (mins < 1.5) {
      if (r < 0.68) return 0;
      if (r < 0.85) return 2;
      return 1;
    }
    if (mins < 4.5) {
      if (r < 0.48) return 0;
      if (r < 0.72) return 1;
      if (r < 0.92) return 2;
      return 3;
    }
    if (r < 0.36) return 0;
    if (r < 0.58) return 1;
    if (r < 0.8) return 2;
    return 3;
  }

  private spawnRingWave(count: number, type: number, radius: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      this.spawnEnemy(type, this.px + Math.cos(ang) * radius, this.pz + Math.sin(ang) * radius, false);
    }
  }

  private spawnEnemy(type: number, x: number, z: number, elite: boolean): void {
    let idx = -1;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!this.eActive[i]) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;

    const scale = this.getWaveScale();
    const baseHps = [22, 32, 90, 230];
    const baseSpds = [3.9, 6.0, 3.1, 2.45];

    this.eActive[idx] = 1;
    this.eType[idx] = type;
    this.eElite[idx] = elite ? 1 : 0;
    this.eX[idx] = x;
    this.eZ[idx] = z;
    const hp = baseHps[type] * scale * (elite ? 9.5 : 1);
    this.eHp[idx] = hp;
    this.eMaxHp[idx] = hp;
    this.eSpeed[idx] = baseSpds[type] * (elite ? 1.12 : 1);
    this.eFlash[idx] = 0;
    this.eWobble[idx] = 0;
    this.eKx[idx] = 0;
    this.eKz[idx] = 0;
    this.eFuse[idx] = 0;
    this.activeEnemyCount++;
  }

  public spawnBoss(stage: number, title: string, hp: number): void {
    this.clearBossVisuals();
    this.bossActive = true;
    this.bossStage = stage;
    this.bossX = this.px + 7.2;
    this.bossZ = this.pz - 5.6;
    this.bossHp = hp;
    this.bossMaxHp = hp;
    this.bossWobble = 0;
    this.bossMode = 'chase';
    this.bossSkillTimer = 1.4; // Triggers first red-carpet telegraph quickly!
    this.bossPatternIdx = 0;
    this.arenaCenter.set(this.px, this.pz);

    this.bossGroup.visible = true;
    this.bossGroup.position.set(this.bossX, 0, this.bossZ);
    this.arenaRing.visible = true;
    this.arenaRing.position.set(this.arenaCenter.x, 0.05, this.arenaCenter.y);

    document.getElementById('boss-banner')!.classList.remove('hidden');
    document.getElementById('boss-name')!.textContent = title;
    this.audio.playFanfare(false);
    this.addTrauma(0.5);
    this.punchCamera(-120, 0.05);
    this.showToast(`${title} · 注意地面红毯预警，闪避触发子弹时间！`);
  }

  // =========================================================================
  // Enemy Step + Kamikaze Spatial-Hash Friendly-Fire
  // =========================================================================
  private stepEnemies(dt: number, rawDt: number): void {
    this.typeSlotCounts[0] = 0;
    this.typeSlotCounts[1] = 0;
    this.typeSlotCounts[2] = 0;
    this.typeSlotCounts[3] = 0;

    let count = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!this.eActive[i]) continue;
      count++;
      const type = this.eType[i];
      const elite = this.eElite[i] === 1;

      let dx = this.px - this.eX[i];
      let dz = this.pz - this.eZ[i];
      const distSq = dx * dx + dz * dz;

      if (!elite && distSq > 38 * 38) {
        const ang = this.facingYaw + (Math.random() - 0.5) * 1.8;
        this.eX[i] = this.px + Math.sin(ang) * 25;
        this.eZ[i] = this.pz - Math.cos(ang) * 25;
        dx = this.px - this.eX[i];
        dz = this.pz - this.eZ[i];
      }

      const dist = Math.max(0.001, Math.hypot(dx, dz));

      if (type === 1 && (this.eFuse[i] > 0 || dist < 2.85)) {
        if (this.eFuse[i] === 0) {
          this.vfx.spawnRing(this.eX[i], this.eZ[i], 3.3, 0xf43f5e, 0.72);
        }
        this.eFuse[i] += dt;
        if (this.eFuse[i] >= 0.72) {
          this.detonateKamikaze(i);
          continue;
        }
      } else if (this.hitstopTimer <= 0) {
        let sepX = 0;
        let sepZ = 0;
        const cx = Math.floor((this.eX[i] - this.gridOriginX) / GRID_CELL);
        const cz = Math.floor((this.eZ[i] - this.gridOriginZ) / GRID_CELL);
        if (cx >= 1 && cx < GRID_DIM - 1 && cz >= 1 && cz < GRID_DIM - 1) {
          const cell = cz * GRID_DIM + cx;
          let n = this.gridHead[cell];
          let checks = 0;
          while (n !== -1 && checks < 6) {
            if (n !== i) {
              const ox = this.eX[i] - this.eX[n];
              const oz = this.eZ[i] - this.eZ[n];
              const od2 = ox * ox + oz * oz;
              if (od2 > 0.0001 && od2 < 1.35) {
                const inv = 1 / Math.sqrt(od2);
                sepX += ox * inv * 2.6;
                sepZ += oz * inv * 2.6;
              }
              checks++;
            }
            n = this.gridNext[n];
          }
        }

        const spd = this.eSpeed[i];
        this.eX[i] += ((dx / dist) * spd + sepX + this.eKx[i]) * dt;
        this.eZ[i] += ((dz / dist) * spd + sepZ + this.eKz[i]) * dt;

        const kDecay = Math.exp(-10 * dt);
        this.eKx[i] *= kDecay;
        this.eKz[i] *= kDecay;
      }

      const hitRadius = elite ? 1.55 : 0.95;
      if (dist < hitRadius && this.iFrameTimer <= 0 && this.dashActiveTimer <= 0) {
        const rawDmg = [8, 14, 14, 20][type] * (elite ? 1.5 : 1);
        this.damagePlayer(rawDmg);
      }

      let sy = 1.0;
      let sxz = 1.0;
      let jitterX = 0;
      if (this.eWobble[i] > 0) {
        this.eWobble[i] = Math.max(0, this.eWobble[i] - rawDt);
        const wNorm = this.eWobble[i] / 0.16;
        sy = 1.0 - Math.sin(wNorm * Math.PI) * 0.28;
        sxz = 1.0 / Math.sqrt(Math.max(0.5, sy));
        if (this.hitstopTimer > 0) {
          jitterX = Math.sin(this.hitstopTimer * 195 + i) * 0.11;
        }
      }

      const slot = this.typeSlotCounts[type]++;
      const im = this.enemyMeshes[type];
      const baseScale = elite ? 1.85 : 1.08;
      const stridePhase = this.runTime * (type <= 1 ? 14 : 9) + i * 1.7;
      const walkBob = Math.abs(Math.sin(stridePhase)) * (type === 3 ? 0.05 : 0.11);
      const walkRoll = Math.sin(stridePhase) * (type <= 1 ? 0.09 : 0.06);
      const fusePulse =
        type === 1 && this.eFuse[i] > 0 ? 1 + Math.sin(this.eFuse[i] * 35) * 0.28 : 1;

      const sFinal = baseScale * fusePulse;
      this.dummy.position.set(this.eX[i] + jitterX, walkBob, this.eZ[i]);
      this.dummy.rotation.set(0, Math.atan2(dx, dz), walkRoll);
      this.dummy.scale.set(sFinal * sxz, sFinal * sy, sFinal * sxz);
      this.dummy.updateMatrix();
      im.setMatrixAt(slot, this.dummy.matrix);

      if (this.eFlash[i] > 0) {
        this.eFlash[i] -= rawDt;
        if (this.shakeStrength <= 0) {
          im.setColorAt(slot, this.tmpColor.setRGB(1.6, 0.9, 1.2));
        } else if (this.eFlash[i] > 0.035) {
          im.setColorAt(slot, this.tmpColor.setRGB(3.6, 3.6, 3.6));
        } else {
          im.setColorAt(slot, this.tmpColor.setRGB(2.5, 0.45, 0.9));
        }
      } else if (type === 1 && this.eFuse[i] > 0) {
        im.setColorAt(slot, this.tmpColor.setRGB(2.4, 1.6, 0.4));
      } else if (elite) {
        im.setColorAt(slot, this.tmpColor.setRGB(1.85, 1.45, 0.45));
      } else {
        im.setColorAt(slot, this.tmpColor.setRGB(1.15, 1.15, 1.15));
      }
    }

    this.activeEnemyCount = count;
    for (let t = 0; t < 4; t++) {
      const im = this.enemyMeshes[t];
      im.count = this.typeSlotCounts[t];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private detonateKamikaze(idx: number): void {
    const x = this.eX[idx];
    const z = this.eZ[idx];
    this.eActive[idx] = 0;
    this.activeEnemyCount = Math.max(0, this.activeEnemyCount - 1);

    this.vfx.spawnBurst(x, 0.5, z, 0xf97316, 16, 10);
    this.vfx.spawnRing(x, z, 3.4, 0xf97316, 0.26);
    this.audio.playExplosion(false);
    this.addTrauma(0.24);
    this.punchCamera(-75, 0.025);

    if (Math.hypot(this.px - x, this.pz - z) < 3.25 && this.iFrameTimer <= 0) {
      this.damagePlayer(22);
    }
    const ffDmg = Math.round(58 * this.getWaveScale());
    this.forEachEnemyInRadius(x, z, 3.4, (j, dx, dz) => {
      this.damageEnemy(j, ffDmg, dx * 3, dz * 3, 0xf97316);
    });
  }

  // =========================================================================
  // Boss 3-Attack State Machine with Ground Red Telegraphs (P1.1)
  // =========================================================================
  private stepBoss(dt: number, rawDt: number): void {
    if (!this.bossActive) return;

    const dx = this.px - this.bossX;
    const dz = this.pz - this.bossZ;
    const dist = Math.max(0.01, Math.hypot(dx, dz));

    this.bossSkillTimer -= dt;

    if (this.bossMode === 'chase') {
      const spd = 2.95 + this.bossStage * 0.45;
      if (this.hitstopTimer <= 0) {
        this.bossX += (dx / dist) * spd * dt;
        this.bossZ += (dz / dist) * spd * dt;
      }
      this.bossGroup.rotation.y = Math.atan2(dx, dz);

      if (this.bossSkillTimer <= 0) {
        const pick = this.bossPatternIdx % 3;
        this.bossPatternIdx++;
        if (pick === 0) {
          // 1. Crimson Red-Carpet Dash Lock-On
          this.bossMode = 'charge_windup';
          this.bossSkillTimer = 0.78;
          this.bossChargeYaw = Math.atan2(dx, -dz);
          this.bossChargeLen = 18.5;
          this.bossChargeCarpet.visible = true;
          this.bossChargeCarpet.position.set(this.bossX, 0.075, this.bossZ);
          this.bossChargeCarpet.rotation.set(0, -this.bossChargeYaw, 0);
          this.bossChargeCarpet.scale.set(1, 1, this.bossChargeLen);
          this.audio.playBossTelegraph();
        } else if (pick === 1) {
          // 2. 4-Way Rotating Crimson Cross-Lasers
          this.bossMode = 'laser_windup';
          this.bossSkillTimer = 0.68;
          this.bossLaserYaw = Math.atan2(dx, -dz) + Math.PI * 0.25;
          this.audio.playBossTelegraph();
        } else {
          // 3. Multi-Circle Orbital Meteor Barrage
          this.bossMode = 'meteor_windup';
          this.bossSkillTimer = 0.9;
          this.audio.playBossTelegraph();
          const salvo = Math.min(MAX_BOSS_METEORS, 5 + this.bossStage * 2);
          for (let k = 0; k < salvo; k++) {
            const slot = this.bossMeteors[k];
            slot.active = true;
            slot.age = 0;
            slot.dur = 0.85;
            slot.radius = 2.65;
            if (k === 0) {
              slot.x = this.px + this.pvx * 0.35;
              slot.z = this.pz + this.pvz * 0.35;
            } else {
              const a = (k / (salvo - 1)) * Math.PI * 2 + Math.random() * 0.5;
              const r = 3.2 + Math.random() * 7.5;
              slot.x = this.px + Math.cos(a) * r;
              slot.z = this.pz + Math.sin(a) * r;
            }
            slot.group.position.set(slot.x, 0, slot.z);
            slot.group.scale.setScalar(slot.radius);
            slot.fillDisk.scale.setScalar(0.15);
            slot.group.visible = true;
          }
        }
      }
    } else if (this.bossMode === 'charge_windup') {
      const pulse = 0.38 + Math.abs(Math.sin(this.runTime * 22)) * 0.45;
      (this.bossChargeCarpet.material as THREE.MeshBasicMaterial).opacity = pulse;
      this.bossGroup.rotation.y = Math.atan2(
        Math.sin(this.bossChargeYaw),
        -Math.cos(this.bossChargeYaw)
      );
      if (this.bossSkillTimer <= 0) {
        this.bossMode = 'charge_dash';
        this.bossSkillTimer = 0.54;
        this.bossChargeCarpet.visible = false;
        this.audio.playDash();
        this.addTrauma(0.32);
      }
    } else if (this.bossMode === 'charge_dash') {
      const dashSpd = 26.5 + this.bossStage * 2;
      this.bossX += Math.sin(this.bossChargeYaw) * dashSpd * dt;
      this.bossZ += -Math.cos(this.bossChargeYaw) * dashSpd * dt;
      // Clamp Boss inside arena
      const adx = this.bossX - this.arenaCenter.x;
      const adz = this.bossZ - this.arenaCenter.y;
      const ad = Math.hypot(adx, adz);
      if (ad > 20.2) {
        this.bossX = this.arenaCenter.x + (adx / ad) * 20.2;
        this.bossZ = this.arenaCenter.y + (adz / ad) * 20.2;
      }
      if (Math.random() < 0.45) {
        this.vfx.spawnRing(this.bossX, this.bossZ, 3.2, 0xf43f5e, 0.22);
      }
      if (this.bossSkillTimer <= 0) {
        this.bossMode = 'chase';
        this.bossSkillTimer = Math.max(1.8, 2.9 - this.bossStage * 0.3);
      }
    } else if (this.bossMode === 'laser_windup') {
      for (let b = 0; b < 4; b++) {
        const bm = this.bossCrossLasers[b];
        bm.visible = true;
        const yaw = this.bossLaserYaw + (b * Math.PI) / 2;
        bm.position.set(this.bossX, 0.9, this.bossZ);
        bm.rotation.set(0, -yaw, 0);
        bm.scale.set(0.22, 1, 17.5);
        (bm.material as THREE.MeshBasicMaterial).opacity = 0.42;
      }
      if (this.bossSkillTimer <= 0) {
        this.bossMode = 'laser_sweep';
        this.bossSkillTimer = 2.15;
        this.bossLaserTick = 0;
        this.audio.playLaser(true);
        this.addTrauma(0.3);
      }
    } else if (this.bossMode === 'laser_sweep') {
      const rotSpd = 1.05 + this.bossStage * 0.16;
      this.bossLaserYaw += rotSpd * dt;
      this.bossGroup.rotation.y = -this.bossLaserYaw;
      this.bossLaserTick -= dt;
      const checkPlayer = this.bossLaserTick <= 0;
      if (checkPlayer) this.bossLaserTick = 0.12;

      for (let b = 0; b < 4; b++) {
        const bm = this.bossCrossLasers[b];
        bm.visible = true;
        const yaw = this.bossLaserYaw + (b * Math.PI) / 2;
        bm.position.set(this.bossX, 0.9, this.bossZ);
        bm.rotation.set(0, -yaw, 0);
        bm.scale.set(0.92, 1, 17.5);
        (bm.material as THREE.MeshBasicMaterial).opacity = 0.92;

        if (checkPlayer && this.iFrameTimer <= 0 && this.dashActiveTimer <= 0) {
          const ex = this.bossX + Math.sin(yaw) * 17.5;
          const ez = this.bossZ - Math.cos(yaw) * 17.5;
          if (this.pointToSegmentDistSq(this.px, this.pz, this.bossX, this.bossZ, ex, ez) < 0.85 * 0.85) {
            this.damagePlayer(18 + this.bossStage * 5);
          }
        }
      }
      if (this.bossSkillTimer <= 0) {
        for (const bm of this.bossCrossLasers) bm.visible = false;
        this.bossMode = 'chase';
        this.bossSkillTimer = Math.max(1.8, 2.8 - this.bossStage * 0.3);
      }
    } else if (this.bossMode === 'meteor_windup') {
      if (this.bossSkillTimer <= 0) {
        this.bossMode = 'chase';
        this.bossSkillTimer = Math.max(1.9, 3.0 - this.bossStage * 0.3);
      }
    }

    // Step active Boss Meteor ground circles
    for (const bm of this.bossMeteors) {
      if (!bm.active) continue;
      bm.age += dt;
      const p = Math.min(1, bm.age / bm.dur);
      bm.fillDisk.scale.setScalar(0.15 + p * 0.85);
      if (bm.age >= bm.dur) {
        bm.active = false;
        bm.group.visible = false;
        this.vfx.spawnSkyPillar(bm.x, bm.z, bm.radius * 0.55, 0xf43f5e, 0.32);
        this.vfx.spawnRing(bm.x, bm.z, bm.radius * 1.15, 0xf43f5e, 0.3);
        this.vfx.spawnBurst(bm.x, 0.4, bm.z, 0xf43f5e, 12, 9);
        this.audio.playExplosion(false);
        this.addTrauma(0.18);
        if (
          Math.hypot(this.px - bm.x, this.pz - bm.z) < bm.radius &&
          this.iFrameTimer <= 0 &&
          this.dashActiveTimer <= 0
        ) {
          this.damagePlayer(22 + this.bossStage * 5);
        }
      }
    }

    let bSy = 1.0;
    let bSxz = 1.0;
    let bJit = 0;
    if (this.bossWobble > 0) {
      this.bossWobble = Math.max(0, this.bossWobble - rawDt);
      bSy = 1.0 - Math.sin((this.bossWobble / 0.14) * Math.PI) * 0.14;
      bSxz = 1.0 / Math.sqrt(bSy);
      if (this.hitstopTimer > 0) bJit = Math.sin(this.hitstopTimer * 210) * 0.12;
    }

    const stompBob = Math.abs(Math.sin(this.runTime * 5.5)) * 0.16;
    this.bossGroup.position.set(this.bossX + bJit, stompBob, this.bossZ);
    this.bossGroup.scale.set(bSxz, bSy, bSxz);

    if (this.bossTorsoNode) {
      this.bossTorsoNode.rotation.y = Math.sin(this.runTime * 3.2) * 0.18;
    }
    if (this.bossLeftArmNode) {
      this.bossLeftArmNode.rotation.x = Math.sin(this.runTime * 4.5) * 0.45;
    }
    if (this.bossRightArmNode) {
      this.bossRightArmNode.rotation.x = -0.15 + Math.cos(this.runTime * 6.0) * 0.12;
    }
    if (this.bossWingsNode) {
      this.bossWingsNode.scale.setScalar(1 + Math.sin(this.runTime * 4.0) * 0.08);
    }

    if (
      Math.hypot(this.px - this.bossX, this.pz - this.bossZ) < 2.35 &&
      this.iFrameTimer <= 0 &&
      this.dashActiveTimer <= 0
    ) {
      this.damagePlayer(24 + this.bossStage * 6);
    }

    const fill = document.getElementById('boss-hp-fill')!;
    fill.style.width = `${Math.max(0, (this.bossHp / this.bossMaxHp) * 100).toFixed(1)}%`;
  }

  // =========================================================================
  // All 6 Core Weapons + 6 Hyper Evolutions (P0.2)
  // =========================================================================
  private stepWeapons(dt: number): void {
    const cdMult = this.getCooldownMult();
    const dmgMult = this.getDamageMult();
    const areaMult = this.getAreaMult();
    const durSpdMult = this.getDurationSpeedMult();
    const extraProj = this.getExtraProj();

    // 1. Plasma Kunai / ★ Phantom Barrage
    const kunaiLv = this.weaponLevels.kunai || 0;
    if (kunaiLv > 0) {
      const hyper = !!this.weaponHyper.kunai;
      this.weaponTimers.kunai -= dt;
      if (this.weaponTimers.kunai <= 0) {
        const def = WEAPONS.kunai;
        this.weaponTimers.kunai =
          (hyper ? def.hyperCooldown : def.baseCooldown * Math.pow(0.94, kunaiLv - 1)) * cdMult;
        const count = (hyper ? 2 : 1 + Math.floor(kunaiLv / 3)) + extraProj;
        const dmg = (hyper ? def.hyperDamage : def.baseDamage + (kunaiLv - 1) * 5) * dmgMult;
        const pierce = hyper ? 3 : 1 + Math.floor(kunaiLv / 3);
        const spd = (hyper ? 30 : 23) * durSpdMult;
        const baseAng = this.findNearestEnemyAngle(18) ?? this.facingYaw;
        for (let c = 0; c < count; c++) {
          const spread = (c - (count - 1) * 0.5) * (hyper ? 0.14 : 0.11);
          const ang = baseAng + spread;
          this.spawnProjectile(
            this.px,
            this.pz,
            Math.sin(ang) * spd,
            -Math.cos(ang) * spd,
            dmg,
            pierce,
            hyper,
            hyper ? 0xfde047 : 0xffffff
          );
        }
        this.vfx.spawnHitFlare(
          this.px + Math.sin(baseAng) * 0.85,
          1.05,
          this.pz - Math.cos(baseAng) * 0.85,
          hyper ? 0xfde047 : 0x22d3ee,
          0.95
        );
        this.kickWeaponRecoil(hyper ? 1.6 : 2.4);
        this.audio.playKunai(hyper);
      }
    }

    // 2. Orbiting Saw / ★ Corona Halo
    const sawLv = this.weaponLevels.saw || 0;
    if (sawLv > 0) {
      const hyper = !!this.weaponHyper.saw;
      const bladeCount = Math.min(
        MAX_SAW_BLADES,
        (hyper ? 8 : 2 + Math.floor(sawLv / 2)) + extraProj
      );
      this.sawAngle += dt * (hyper ? 5.5 : 4.0) * durSpdMult;
      const baseR = 3.25 * areaMult;

      for (let i = 0; i < MAX_SAW_BLADES; i++) {
        const m = this.sawMeshes[i];
        if (i >= bladeCount) {
          m.visible = false;
          continue;
        }
        m.visible = true;
        const outer = hyper && i >= Math.ceil(bladeCount / 2);
        const ringCount = hyper
          ? outer
            ? bladeCount - Math.ceil(bladeCount / 2)
            : Math.ceil(bladeCount / 2)
          : bladeCount;
        const ringIdx = outer ? i - Math.ceil(bladeCount / 2) : i;
        const dir = outer ? -1.25 : 1;
        const r = outer ? baseR * 1.48 : baseR;
        const a = this.sawAngle * dir + (ringIdx / Math.max(1, ringCount)) * Math.PI * 2;
        m.position.set(this.px + Math.cos(a) * r, 0.88, this.pz + Math.sin(a) * r);
        m.rotation.y += dt * 16;
        m.scale.setScalar((hyper ? 1.35 : 1.0) * areaMult);
        (m.material as THREE.MeshBasicMaterial).color.setHex(hyper ? 0xfde047 : 0xffffff);
      }

      this.weaponTimers.saw -= dt;
      if (this.weaponTimers.saw <= 0) {
        this.weaponTimers.saw =
          (hyper ? WEAPONS.saw.hyperCooldown : WEAPONS.saw.baseCooldown) * cdMult;
        const dmg =
          (hyper ? WEAPONS.saw.hyperDamage : WEAPONS.saw.baseDamage + (sawLv - 1) * 4) * dmgMult;
        for (let b = 0; b < bladeCount; b++) {
          const m = this.sawMeshes[b];
          this.damageCircle(
            m.position.x,
            m.position.z,
            1.15 * areaMult,
            dmg,
            10.5,
            hyper ? 0xfbbf24 : 0xf43f5e,
            'saw'
          );
        }
      }
    } else {
      for (const m of this.sawMeshes) m.visible = false;
    }

    // 3. Tesla Arc / ★ Thor Matrix
    const arcLv = this.weaponLevels.arc || 0;
    if (arcLv > 0) {
      const hyper = !!this.weaponHyper.arc;
      this.weaponTimers.arc -= dt;
      if (this.weaponTimers.arc <= 0) {
        const def = WEAPONS.arc;
        this.weaponTimers.arc =
          (hyper ? def.hyperCooldown : def.baseCooldown * Math.pow(0.94, arcLv - 1)) * cdMult;
        const bolts = (hyper ? 2 : 1) + Math.floor(extraProj * 0.7);
        const chains = hyper ? 16 : 3 + arcLv;
        const dmg = (hyper ? def.hyperDamage : def.baseDamage + (arcLv - 1) * 6) * dmgMult;
        let fired = false;
        for (let b = 0; b < bolts; b++) {
          if (this.fireChainLightning(chains, dmg, hyper)) fired = true;
        }
        if (fired) {
          this.kickWeaponRecoil(3.2);
          this.audio.playArc(hyper);
        }
      }
    }

    // 4. Rail Laser Sweep / ★ Prism Obliterator
    const laserLv = this.weaponLevels.laser || 0;
    if (laserLv > 0) {
      const hyper = !!this.weaponHyper.laser;
      this.weaponTimers.laser -= dt;
      if (this.weaponTimers.laser <= 0 && this.laserActiveTimer <= 0) {
        const def = WEAPONS.laser;
        this.weaponTimers.laser =
          (hyper ? def.hyperCooldown : def.baseCooldown * Math.pow(0.94, laserLv - 1)) * cdMult;
        this.laserMaxDur = (hyper ? 1.25 : 0.44) * durSpdMult;
        this.laserActiveTimer = this.laserMaxDur;
        this.laserStartYaw = this.facingYaw;
        this.laserIsHyper = hyper;
        this.laserTickTimer = 0;
        this.kickWeaponRecoil(4.5);
        this.punchCamera(hyper ? -95 : -55, 0.02);
        this.audio.playLaser(hyper);
        this.addTrauma(hyper ? 0.26 : 0.14);
      }

      if (this.laserActiveTimer > 0) {
        this.laserActiveTimer -= dt;
        this.laserTex.offset.x -= dt * 8.0;
        const prog = 1 - Math.max(0, this.laserActiveTimer) / this.laserMaxDur;
        const beamLen = (this.laserIsHyper ? 19 : 15 + laserLv * 0.6) * areaMult;
        const beamWidth = (this.laserIsHyper ? 1.35 : 0.98) * areaMult;
        const beamCount = this.laserIsHyper ? 4 : 1;

        this.laserTickTimer -= dt;
        const shouldHit = this.laserTickTimer <= 0;
        if (shouldHit) this.laserTickTimer = 0.095;

        const tickDmg =
          (this.laserIsHyper
            ? WEAPONS.laser.hyperDamage
            : WEAPONS.laser.baseDamage + (laserLv - 1) * 8) * dmgMult;

        for (let b = 0; b < MAX_LASER_BEAMS; b++) {
          const mesh = this.laserBeams[b];
          if (b >= beamCount || this.laserActiveTimer <= 0) {
            mesh.visible = false;
            continue;
          }
          mesh.visible = true;
          const yaw = this.laserIsHyper
            ? this.laserStartYaw + prog * Math.PI * 1.65 + (b * Math.PI) / 2
            : this.facingYaw + (prog - 0.5) * 1.75;
          mesh.position.set(this.px, 0.95, this.pz);
          mesh.rotation.set(0, -yaw, 0);
          mesh.scale.set(beamWidth, 1, beamLen);
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(
            this.laserIsHyper ? WEAPONS.laser.hyperColor : WEAPONS.laser.color
          );

          if (shouldHit) {
            const endX = this.px + Math.sin(yaw) * beamLen;
            const endZ = this.pz - Math.cos(yaw) * beamLen;
            this.damageBeamSegment(
              this.px,
              this.pz,
              endX,
              endZ,
              beamWidth * 0.85,
              tickDmg,
              this.laserIsHyper ? 0xfde047 : 0x38bdf8,
              'laser'
            );
          }
        }
      } else {
        for (const m of this.laserBeams) m.visible = false;
      }
    } else {
      for (const m of this.laserBeams) m.visible = false;
    }

    // 5. Nano Gravity Pool / ★ Singularity Collapse
    const gravLv = this.weaponLevels.gravity || 0;
    if (gravLv > 0) {
      const hyper = !!this.weaponHyper.gravity;
      this.weaponTimers.gravity -= dt;
      if (this.weaponTimers.gravity <= 0) {
        const def = WEAPONS.gravity;
        this.weaponTimers.gravity =
          (hyper ? def.hyperCooldown : def.baseCooldown * Math.pow(0.95, gravLv - 1)) * cdMult;
        const count = (hyper ? 2 : 1 + Math.floor(gravLv / 5)) + Math.floor(extraProj * 0.5);
        const radius = (hyper ? 5.8 : 3.6 + gravLv * 0.22) * areaMult;
        const dur = (hyper ? 3.5 : 2.8) * durSpdMult;
        const tickDmg = (hyper ? def.hyperDamage : def.baseDamage + (gravLv - 1) * 4) * dmgMult;
        const collapseDmg = (hyper ? 195 : 70 + gravLv * 12) * dmgMult;

        for (let k = 0; k < count; k++) {
          const target = this.pickEnemyClusterTarget(14);
          this.spawnGravityWell(target.x, target.z, radius, dur, tickDmg, collapseDmg, hyper);
        }
        this.audio.playGravityWell(false, hyper);
      }
    }

    // 6. Orbital Ion Mortar / ★ Skynet Judgement
    const orbLv = this.weaponLevels.orbital || 0;
    if (orbLv > 0) {
      const hyper = !!this.weaponHyper.orbital;
      this.weaponTimers.orbital -= dt;
      if (this.weaponTimers.orbital <= 0) {
        const def = WEAPONS.orbital;
        this.weaponTimers.orbital =
          (hyper ? def.hyperCooldown : def.baseCooldown * Math.pow(0.94, orbLv - 1)) * cdMult;
        const strikes = (hyper ? 3 : 1 + Math.floor(orbLv / 3)) + extraProj;
        const radius = (hyper ? 4.4 : 3.2 + orbLv * 0.16) * areaMult;
        const fuse = hyper ? 0.26 : 0.54;
        const dmg = (hyper ? def.hyperDamage : def.baseDamage + (orbLv - 1) * 12) * dmgMult;

        for (let s = 0; s < strikes; s++) {
          const target = this.pickEnemyClusterTarget(17);
          const jitter = s === 0 ? 0 : 1.6;
          this.queueOrbitalStrike(
            target.x + (Math.random() - 0.5) * jitter,
            target.z + (Math.random() - 0.5) * jitter,
            radius,
            s * 0.09,
            fuse,
            dmg,
            hyper
          );
        }
      }
    }
  }

  private pickEnemyClusterTarget(maxDist: number): { x: number; z: number } {
    if (this.bossActive && Math.random() < 0.45) {
      return { x: this.bossX, z: this.bossZ };
    }
    let bestIdx = -1;
    for (let tries = 0; tries < 12; tries++) {
      const idx = Math.floor(Math.random() * MAX_ENEMIES);
      if (this.eActive[idx]) {
        const d = Math.hypot(this.eX[idx] - this.px, this.eZ[idx] - this.pz);
        if (d < maxDist) {
          bestIdx = idx;
          if (this.eElite[idx] || this.eType[idx] >= 2) break;
        }
      }
    }
    if (bestIdx >= 0) {
      return { x: this.eX[bestIdx], z: this.eZ[bestIdx] };
    }
    const ang = this.facingYaw + (Math.random() - 0.5) * 1.4;
    const dist = 5.5 + Math.random() * 5.5;
    return { x: this.px + Math.sin(ang) * dist, z: this.pz - Math.cos(ang) * dist };
  }

  private spawnGravityWell(
    x: number,
    z: number,
    radius: number,
    dur: number,
    tickDmg: number,
    collapseDmg: number,
    hyper: boolean
  ): void {
    const slot = this.gravityWells.find((w) => !w.active) || this.gravityWells[0];
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.radius = radius;
    slot.age = 0;
    slot.dur = dur;
    slot.tickTimer = 0.05;
    slot.tickDmg = tickDmg;
    slot.collapseDmg = collapseDmg;
    slot.hyper = hyper;
    slot.group.position.set(x, 0, z);
    slot.group.visible = true;
    slot.ringA.scale.setScalar(radius);
    slot.ringB.scale.setScalar(radius * 0.68);
    (slot.ringA.material as THREE.MeshBasicMaterial).color.setHex(hyper ? 0xf472b6 : 0xc084fc);
    this.vfx.spawnRing(x, z, radius, hyper ? 0xf472b6 : 0xa855f7, 0.35);
  }

  private stepGravityWells(dt: number): void {
    for (const gw of this.gravityWells) {
      if (!gw.active) continue;
      gw.age += dt;
      gw.ringA.rotation.z += dt * (gw.hyper ? 8.5 : 5.2);
      gw.ringB.rotation.z -= dt * (gw.hyper ? 11.0 : 6.8);
      const pulse = 0.92 + Math.sin(gw.age * 16) * 0.08;
      gw.ringA.scale.setScalar(gw.radius * pulse);

      // Pull enemies smoothly into the singularity core!
      const pullStrength = gw.hyper ? 9.8 : 5.4;
      this.forEachEnemyInRadius(gw.x, gw.z, gw.radius, (idx, dx, dz, d2) => {
        if (d2 > 0.25) {
          const d = Math.sqrt(d2);
          const resist = this.eElite[idx] ? 0.3 : 1.0;
          this.eX[idx] -= (dx / d) * pullStrength * resist * dt;
          this.eZ[idx] -= (dz / d) * pullStrength * resist * dt;
        }
      });

      gw.tickTimer -= dt;
      if (gw.tickTimer <= 0) {
        gw.tickTimer = 0.24;
        this.damageCircle(
          gw.x,
          gw.z,
          gw.radius,
          gw.tickDmg,
          -3.5,
          gw.hyper ? 0xf472b6 : 0xc084fc,
          'gravity',
          false
        );
      }

      if (gw.age >= gw.dur) {
        gw.active = false;
        gw.group.visible = false;
        this.audio.playGravityWell(true, gw.hyper);
        this.vfx.spawnRing(gw.x, gw.z, gw.radius * 1.25, gw.hyper ? 0xf472b6 : 0xe879f9, 0.42);
        this.vfx.spawnBurst(gw.x, 0.5, gw.z, gw.hyper ? 0xf472b6 : 0xc084fc, gw.hyper ? 28 : 16, 11);
        this.addTrauma(gw.hyper ? 0.35 : 0.18);
        this.punchCamera(gw.hyper ? -95 : -55, 0.03);
        this.damageCircle(
          gw.x,
          gw.z,
          gw.radius * 1.15,
          gw.collapseDmg,
          gw.hyper ? 16 : 9,
          gw.hyper ? 0xf472b6 : 0xc084fc,
          'gravity'
        );
      }
    }
  }

  private queueOrbitalStrike(
    x: number,
    z: number,
    radius: number,
    delay: number,
    dur: number,
    dmg: number,
    hyper: boolean
  ): void {
    const slot = this.orbitalStrikes.find((o) => !o.active) || this.orbitalStrikes[0];
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.radius = radius;
    slot.delay = delay;
    slot.age = 0;
    slot.dur = dur;
    slot.dmg = dmg;
    slot.hyper = hyper;
    slot.group.position.set(x, 0, z);
    slot.group.scale.setScalar(radius);
    slot.innerRing.scale.setScalar(0.12);
    (slot.outerRing.material as THREE.MeshBasicMaterial).color.setHex(hyper ? 0xfef08a : 0xfbbf24);
    slot.group.visible = delay <= 0;
  }

  private stepOrbitalStrikes(dt: number): void {
    for (const os of this.orbitalStrikes) {
      if (!os.active) continue;
      if (os.delay > 0) {
        os.delay -= dt;
        if (os.delay <= 0) os.group.visible = true;
        continue;
      }
      os.age += dt;
      const p = Math.min(1, os.age / os.dur);
      os.innerRing.scale.setScalar(0.12 + p * 0.88);
      os.outerRing.rotation.z += dt * 4.5;

      if (os.age >= os.dur) {
        os.active = false;
        os.group.visible = false;
        const col = os.hyper ? 0xfef08a : 0xfbbf24;
        this.vfx.spawnSkyPillar(os.x, os.z, os.radius * 0.55, col, os.hyper ? 0.42 : 0.3);
        this.vfx.spawnRing(os.x, os.z, os.radius * 1.15, col, 0.36);
        if (os.hyper) {
          this.vfx.spawnRing(os.x, os.z, os.radius * 1.65, 0xf97316, 0.48);
        }
        this.vfx.spawnBurst(os.x, 0.4, os.z, col, os.hyper ? 22 : 12, 10);
        this.audio.playOrbitalStrike(os.hyper);
        this.addTrauma(os.hyper ? 0.3 : 0.16);
        this.punchCamera(os.hyper ? -85 : -45, 0.025);
        this.damageCircle(os.x, os.z, os.radius, os.dmg, os.hyper ? 15 : 10, col, 'orbital');
      }
    }
  }

  private spawnProjectile(
    x: number,
    z: number,
    vx: number,
    vz: number,
    dmg: number,
    pierce: number,
    canSplit: boolean,
    colorHex: number
  ): void {
    const idx = this.projCursor;
    this.projCursor = (this.projCursor + 1) % MAX_PROJ;
    this.projActive[idx] = 1;
    this.projX[idx] = x;
    this.projZ[idx] = z;
    this.projVx[idx] = vx;
    this.projVz[idx] = vz;
    this.projDmg[idx] = dmg;
    this.projLife[idx] = 0.85;
    this.projPierce[idx] = pierce;
    this.projSplit[idx] = canSplit ? 1 : 0;
    this.projLastHit[idx] = -1;
    this.projMesh.setColorAt(idx, this.tmpColor.setHex(colorHex));
    if (this.projMesh.instanceColor) this.projMesh.instanceColor.needsUpdate = true;
  }

  private stepProjectiles(dt: number): void {
    for (let i = 0; i < MAX_PROJ; i++) {
      if (!this.projActive[i]) continue;
      this.projLife[i] -= dt;
      if (this.projLife[i] <= 0) {
        this.projActive[i] = 0;
        this.hideInstance(this.projMesh, i);
        continue;
      }
      this.projX[i] += this.projVx[i] * dt;
      this.projZ[i] += this.projVz[i] * dt;

      this.damageBarrelsInRadius(this.projX[i], this.projZ[i], 0.55);

      if (this.bossActive && this.projLastHit[i] !== -999) {
        const bdx = this.projX[i] - this.bossX;
        const bdz = this.projZ[i] - this.bossZ;
        if (bdx * bdx + bdz * bdz < 2.4 * 2.4) {
          this.projLastHit[i] = -999;
          this.vfx.spawnHitFlare(this.projX[i], 1.2, this.projZ[i], 0xfde047, 1.8);
          this.damageBoss(this.projDmg[i], 'kunai');
          this.projPierce[i]--;
        }
      }

      const cx = Math.floor((this.projX[i] - this.gridOriginX) / GRID_CELL);
      const cz = Math.floor((this.projZ[i] - this.gridOriginZ) / GRID_CELL);
      outer: for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gz = cz + oz;
          if (gx < 0 || gx >= GRID_DIM || gz < 0 || gz >= GRID_DIM) continue;
          let e = this.gridHead[gz * GRID_DIM + gx];
          while (e !== -1) {
            if (this.eActive[e] && e !== this.projLastHit[i]) {
              const dx = this.eX[e] - this.projX[i];
              const dz = this.eZ[e] - this.projZ[i];
              const hitR = this.eElite[e] ? 1.55 : 0.95;
              if (dx * dx + dz * dz < hitR * hitR) {
                this.projLastHit[i] = e;
                this.vfx.spawnHitFlare(this.projX[i], 0.95, this.projZ[i], 0x67e8f9, 1.35);
                this.damageEnemy(
                  e,
                  this.projDmg[i],
                  this.projVx[i] * 0.25,
                  this.projVz[i] * 0.25,
                  0x22d3ee,
                  'kunai'
                );
                if (this.projSplit[i] === 1) {
                  this.projSplit[i] = 0;
                  const baseA = Math.atan2(this.projVx[i], -this.projVz[i]);
                  for (const off of [-0.55, 0.55]) {
                    const a = baseA + off;
                    this.spawnProjectile(
                      this.projX[i],
                      this.projZ[i],
                      Math.sin(a) * 25,
                      -Math.cos(a) * 25,
                      this.projDmg[i] * 0.65,
                      1,
                      false,
                      0xfde047
                    );
                  }
                }
                this.projPierce[i]--;
                if (this.projPierce[i] <= 0) break outer;
              }
            }
            e = this.gridNext[e];
          }
        }
      }

      if (this.projPierce[i] <= 0) {
        this.projActive[i] = 0;
        this.hideInstance(this.projMesh, i);
        continue;
      }

      const sBase = this.projSplit[i] ? 1.35 : 1.05;
      this.dummy.position.set(this.projX[i], 0.95, this.projZ[i]);
      this.dummy.rotation.set(0, Math.atan2(-this.projVx[i], -this.projVz[i]), 0);
      this.dummy.scale.set(sBase, sBase, sBase * 1.65);
      this.dummy.updateMatrix();
      this.projMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.projMesh.instanceMatrix.needsUpdate = true;
  }

  private fireChainLightning(maxJumps: number, dmg: number, hyper: boolean): boolean {
    const visited = new Set<number>();
    let curX = this.px;
    let curZ = this.pz;
    let jumps = 0;

    while (jumps < maxJumps) {
      const searchR = jumps === 0 ? 13 : 8.5;
      let bestIdx = -1;
      let bestD2 = searchR * searchR;
      this.forEachEnemyInRadius(curX, curZ, searchR, (idx, _dx, _dz, d2) => {
        if (!visited.has(idx) && d2 < bestD2) {
          bestD2 = d2;
          bestIdx = idx;
        }
      });

      if (bestIdx === -1) {
        if (this.bossActive && !visited.has(-999)) {
          const bdx = this.bossX - curX;
          const bdz = this.bossZ - curZ;
          if (bdx * bdx + bdz * bdz < 14 * 14) {
            visited.add(-999);
            this.vfx.spawnArc(curX, curZ, this.bossX, this.bossZ, hyper ? 0xfdf4ff : 0xc084fc);
            this.damageBoss(dmg, 'arc');
            jumps++;
          }
        }
        break;
      }

      visited.add(bestIdx);
      const nx = this.eX[bestIdx];
      const nz = this.eZ[bestIdx];
      this.vfx.spawnArc(curX, curZ, nx, nz, hyper ? 0xfdf4ff : 0xc084fc);
      const killed = this.damageEnemy(
        bestIdx,
        dmg,
        0,
        0,
        hyper ? 0xe879f9 : 0xa855f7,
        'arc'
      );
      if (killed && hyper) {
        this.vfx.spawnRing(nx, nz, 2.7, 0xe879f9, 0.22);
        this.damageCircle(nx, nz, 2.6, dmg * 0.55, 4, 0xe879f9, 'arc');
      }
      curX = nx;
      curZ = nz;
      jumps++;
    }
    return jumps > 0;
  }

  private damageCircle(
    cx: number,
    cz: number,
    radius: number,
    dmg: number,
    knock: number,
    colorHex: number,
    weaponId?: WeaponId,
    checkBarrels = true
  ): void {
    if (checkBarrels) this.damageBarrelsInRadius(cx, cz, radius);
    this.forEachEnemyInRadius(cx, cz, radius, (i, dx, dz, d2) => {
      const d = Math.max(0.1, Math.sqrt(d2));
      this.damageEnemy(i, dmg, (dx / d) * knock, (dz / d) * knock, colorHex, weaponId);
    });
    if (this.bossActive) {
      const bdx = this.bossX - cx;
      const bdz = this.bossZ - cz;
      if (bdx * bdx + bdz * bdz < (radius + 2.0) * (radius + 2.0)) {
        this.damageBoss(dmg, weaponId);
      }
    }
  }

  private damageBeamSegment(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    halfWidth: number,
    dmg: number,
    colorHex: number,
    weaponId?: WeaponId
  ): void {
    const hw2 = (halfWidth + 0.65) * (halfWidth + 0.65);
    const dirX = x2 - x1;
    const dirZ = z2 - z1;
    const len = Math.max(0.1, Math.hypot(dirX, dirZ));
    const midX = (x1 + x2) * 0.5;
    const midZ = (z1 + z2) * 0.5;
    const boundR = len * 0.5 + halfWidth + 1.2;

    this.forEachEnemyInRadius(midX, midZ, boundR, (i) => {
      if (this.pointToSegmentDistSq(this.eX[i], this.eZ[i], x1, z1, x2, z2) < hw2) {
        this.vfx.spawnHitFlare(this.eX[i], 0.95, this.eZ[i], colorHex, 1.2);
        this.damageEnemy(i, dmg, (dirX / len) * 6, (dirZ / len) * 6, colorHex, weaponId);
      }
    });

    for (const p of this.activeMapProps) {
      if (p.kind === 2 && !this.destroyedBarrels.has(p.key)) {
        if (this.pointToSegmentDistSq(p.x, p.z, x1, z1, x2, z2) < (halfWidth + p.radius) ** 2) {
          this.damageBarrelsInRadius(p.x, p.z, 0.2);
        }
      }
    }
    if (
      this.bossActive &&
      this.pointToSegmentDistSq(this.bossX, this.bossZ, x1, z1, x2, z2) < (halfWidth + 2.0) ** 2
    ) {
      this.damageBoss(dmg, weaponId);
    }
  }

  private findNearestEnemyAngle(maxDist: number): number | null {
    let bestD2 = maxDist * maxDist;
    let tx = 0;
    let tz = 0;
    let found = false;
    if (this.bossActive) {
      const bdx = this.bossX - this.px;
      const bdz = this.bossZ - this.pz;
      const bd2 = bdx * bdx + bdz * bdz;
      if (bd2 < bestD2) {
        bestD2 = bd2;
        tx = bdx;
        tz = bdz;
        found = true;
      }
    }
    this.forEachEnemyInRadius(this.px, this.pz, maxDist, (_idx, dx, dz, d2) => {
      if (d2 < bestD2) {
        bestD2 = d2;
        tx = dx;
        tz = dz;
        found = true;
      }
    });
    return found ? Math.atan2(tx, -tz) : null;
  }

  private pointToSegmentDistSq(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number
  ): number {
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    if (len2 < 0.0001) return (px - ax) ** 2 + (pz - az) ** 2;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2));
    const cx = ax + abx * t;
    const cz = az + abz * t;
    return (px - cx) ** 2 + (pz - cz) ** 2;
  }

  // =========================================================================
  // Damage, DPS Tracking, Zero-Timer Combo Pill & Phoenix Auto-Revive
  // =========================================================================
  private damageEnemy(
    idx: number,
    rawDmg: number,
    kx: number,
    kz: number,
    vfxColor: number,
    weaponId?: WeaponId
  ): boolean {
    if (!this.eActive[idx]) return false;
    const crit = Math.random() < this.getCritChance();
    const variance = 0.9 + Math.random() * 0.2;
    const finalDmg = Math.max(1, Math.round(rawDmg * (crit ? 1.85 : 1.0) * variance));

    const actualDealt = Math.min(this.eHp[idx], finalDmg);
    this.dpsTracker.record(weaponId, actualDealt, this.runTime);

    this.eHp[idx] -= finalDmg;
    this.eFlash[idx] = 0.072;
    this.eWobble[idx] = 0.16;
    const kbResist = this.eElite[idx] ? 0.15 : this.eType[idx] === 2 ? 0.4 : 1.0;
    this.eKx[idx] += kx * kbResist;
    this.eKz[idx] += kz * kbResist;

    if (crit) {
      this.vfx.spawnHitFlare(this.eX[idx], 1.0, this.eZ[idx], 0xfde047, 1.6);
    }
    if (crit || finalDmg >= 45 || Math.random() < 0.38) {
      this.vfx.spawnDamageNumber(this.eX[idx], this.eZ[idx], finalDmg, crit);
    }
    this.audio.playHit(crit);

    if (this.eHp[idx] <= 0) {
      const x = this.eX[idx];
      const z = this.eZ[idx];
      const type = this.eType[idx];
      const elite = this.eElite[idx] === 1;
      this.eActive[idx] = 0;
      this.activeEnemyCount = Math.max(0, this.activeEnemyCount - 1);
      this.kills++;

      this.comboCount++;
      this.comboTimer = 2.2;
      this.audio.playKillCrunch(this.comboCount);
      if (this.comboCount >= 5) {
        const label =
          this.comboCount >= 50
            ? 'GODLIKE!'
            : this.comboCount >= 25
            ? 'RAMPAGE!'
            : this.comboCount >= 12
            ? 'OVERKILL!'
            : 'COMBO!';
        this.comboCountEl.textContent = `x${this.comboCount}`;
        this.comboLabelEl.textContent = label;
        this.comboPillEl.classList.remove('hidden');
        this.comboPopTimer = 0.1;
      }

      this.vfx.spawnBurst(
        x,
        0.5,
        z,
        elite ? 0xfbbf24 : vfxColor,
        elite ? 26 : 8,
        elite ? 12 : 7
      );
      if (elite) {
        this.triggerHitstop(0.075, 0.03);
        this.addTrauma(0.45);
        this.punchCamera(-130, 0.05);
        this.audio.playExplosion(true);
        this.spawnChest(x, z);
        this.spawnPowerUp(x + 1.4, z, Math.random() < 0.5 ? 'frenzy' : 'magnet');
      } else {
        const xpVals = [1, 2, 5, 22];
        this.spawnGem(x, z, xpVals[type]);
        if (type === 3 && Math.random() < 0.1) {
          this.spawnPowerUp(x, z, Math.random() < 0.55 ? 'magnet' : 'frenzy');
        }
      }
      return true;
    }
    return false;
  }

  private damageBoss(rawDmg: number, weaponId?: WeaponId): void {
    if (!this.bossActive) return;
    const crit = Math.random() < this.getCritChance();
    const finalDmg = Math.max(1, Math.round(rawDmg * (crit ? 1.85 : 1.0)));
    this.dpsTracker.record(weaponId, Math.min(this.bossHp, finalDmg), this.runTime);

    this.bossHp -= finalDmg;
    this.bossWobble = 0.14;
    this.vfx.spawnDamageNumber(this.bossX, this.bossZ, finalDmg, crit, '#fda4af');
    this.audio.playHit(crit);

    if (this.bossHp <= 0) {
      const bx = this.bossX;
      const bz = this.bossZ;
      const stg = this.bossStage;
      this.bossesDefeated++;
      this.clearBossVisuals();
      document.getElementById('boss-banner')!.classList.add('hidden');

      this.vfx.spawnBurst(bx, 1.4, bz, 0xfbbf24, 48, 15);
      this.vfx.spawnRing(bx, bz, 12, 0xfde047, 0.55);
      this.triggerHitstop(0.12, 0.03);
      this.addTrauma(0.85);
      this.punchCamera(-165, 0.075);
      this.audio.playExplosion(true);

      if (stg === 3) {
        this.finishRun(true);
        return;
      }
      this.spawnChest(bx, bz);
      this.spawnPowerUp(bx - 1.8, bz, 'frenzy');
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        this.spawnGem(bx + Math.cos(a) * 2.2, bz + Math.sin(a) * 2.2, 25);
      }
      this.showToast('🏆 六翼泰坦机神已击破！拾取超导空投舱与无限超载球！');
    }
  }

  private damagePlayer(rawDmg: number): void {
    const armor = this.getArmor();
    const taken = Math.max(1, Math.round((rawDmg * 50) / (50 + armor)));
    this.hp = Math.max(0, this.hp - taken);
    this.iFrameTimer = 0.42;
    this.triggerHitstop(0.05, 0.05);
    this.addTrauma(0.42);
    this.punchCamera(95, 0.055);
    this.vfx.spawnRing(this.px, this.pz, 3.6, 0xf43f5e, 0.25);
    this.vfx.spawnDamageNumber(this.px, this.pz, `-${taken}`, true, '#fb7185');
    this.audio.playExplosion(false);

    if (this.hp <= 0) {
      if (this.revivesLeft > 0) {
        this.revivesLeft--;
        this.hp = Math.round(this.maxHp * 0.65);
        this.iFrameTimer = 2.2;
        this.audio.playPowerup('revive');
        this.vfx.spawnSkyPillar(this.px, this.pz, 3.2, 0x34d399, 0.55);
        this.vfx.spawnRing(this.px, this.pz, 14, 0xfbbf24, 0.6);
        this.damageCircle(this.px, this.pz, 11, 260 * this.getDamageMult(), 22, 0x34d399, undefined, true);
        this.showToast('🛡 涅槃协议激活！恢复 65% 装甲并震碎全屏近身敌群！');
        return;
      }
      this.finishRun(false);
    }
  }

  // =========================================================================
  // 3D Crystal Clusters, Orbital Supply Pods & Dopamine Power-Up Drops (P0.3)
  // =========================================================================
  private spawnGem(x: number, z: number, val: number): void {
    if (this.activeGemCount > 460 && val < 20) {
      for (let i = 0; i < MAX_GEMS; i++) {
        if (this.gActive[i] && this.gState[i] === 0 && this.gVal[i] < 80) {
          this.gVal[i] += val;
          return;
        }
      }
    }

    for (let i = 0; i < MAX_GEMS; i++) {
      if (!this.gActive[i]) {
        this.gActive[i] = 1;
        this.gX[i] = x;
        this.gZ[i] = z;
        this.gVal[i] = val;
        this.gState[i] = 0;
        this.gMagAge[i] = 0;
        this.activeGemCount++;
        return;
      }
    }
  }

  public spawnChest(x: number, z: number): void {
    const slot = this.chests.find((c) => !c.active) || this.chests[0];
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.age = 0;
    slot.group.position.set(x, 0, z);
    slot.group.visible = true;
    this.vfx.spawnRing(x, z, 4.5, 0xfbbf24, 0.45);
  }

  public spawnPowerUp(x: number, z: number, kind: PowerUpKind): void {
    const slot =
      this.powerups.find((p) => !p.active && p.kind === kind) ||
      this.powerups.find((p) => !p.active) ||
      this.powerups[0];
    slot.active = true;
    slot.kind = kind;
    slot.x = x;
    slot.z = z;
    slot.age = 0;
    const targetGeo = kind === 'magnet' ? this.magnetGeo : this.frenzyGeo;
    if (targetGeo && slot.coreMesh.geometry !== targetGeo) {
      slot.coreMesh.geometry = targetGeo;
      slot.coreMesh.material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
      });
    }
    slot.group.position.set(x, 0, z);
    slot.group.visible = true;
    this.vfx.spawnRing(x, z, 3.2, kind === 'magnet' ? 0x38bdf8 : 0xf97316, 0.35);
  }

  private activateMagnetVacuum(): void {
    let pulled = 0;
    for (let i = 0; i < MAX_GEMS; i++) {
      if (this.gActive[i]) {
        this.gState[i] = 1;
        this.gMagAge[i] = 0.14; // Skip push-back and vacuum immediately at high velocity!
        pulled++;
      }
    }
    this.audio.playPowerup('magnet');
    this.vfx.spawnRing(this.px, this.pz, 18, 0x38bdf8, 0.55);
    this.vfx.spawnDamageNumber(this.px, this.pz, '🧲 全屏磁吸!', true, '#67e8f9');
    this.showToast(`🧲 超导磁铁启动！全图 ${pulled} 枚数据晶体尽数归仓！`);
  }

  private activateFrenzyOrb(): void {
    this.frenzyTimer = 5.5;
    this.dashCd = 0;
    this.audio.playPowerup('frenzy');
    this.vfx.spawnRing(this.px, this.pz, 10, 0xfde047, 0.45);
    this.vfx.spawnDamageNumber(this.px, this.pz, '🔥 无限超载 5.5s!', true, '#fde047');
    this.punchCamera(-90, 0.035);
    this.showToast('🔥 无限超载狂暴激活！5.5 秒内全武器射速翻倍 + 移速飙升！');
  }

  private stepGemsChestsAndPowerups(dt: number): void {
    const magR = this.getMagnetRadius();
    const magR2 = magR * magR;
    let activeCount = 0;

    for (let i = 0; i < MAX_GEMS; i++) {
      if (!this.gActive[i]) continue;
      activeCount++;
      const dx = this.px - this.gX[i];
      const dz = this.pz - this.gZ[i];
      const d2 = dx * dx + dz * dz;

      if (this.gState[i] === 0 && d2 < magR2) {
        this.gState[i] = 1;
        this.gMagAge[i] = 0;
        const d = Math.max(0.05, Math.sqrt(d2));
        this.gPushX[i] = (-dx / d) * 4.4;
        this.gPushZ[i] = (-dz / d) * 4.4;
      }

      if (this.gState[i] === 1) {
        this.gMagAge[i] += dt;
        if (this.gMagAge[i] < 0.12) {
          this.gX[i] += this.gPushX[i] * dt;
          this.gZ[i] += this.gPushZ[i] * dt;
        } else {
          const d = Math.max(0.05, Math.sqrt(d2));
          const pullSpd = 26 + (this.gMagAge[i] - 0.12) * 68;
          this.gX[i] += (dx / d) * pullSpd * dt;
          this.gZ[i] += (dz / d) * pullSpd * dt;
        }
      }

      if (d2 < 0.85 * 0.85) {
        const gain = Math.max(1, Math.round(this.gVal[i] * this.currentMech.xpMult));
        this.gActive[i] = 0;
        this.hideInstance(this.gemMesh, i);
        this.audio.playXpGem();
        this.grantXp(gain);
        continue;
      }

      const v = this.gVal[i];
      const scale = v >= 20 ? 1.45 : v >= 5 ? 1.15 : 0.92;
      this.dummy.position.set(
        this.gX[i],
        0.08 + Math.sin(this.runTime * 5 + i) * 0.06,
        this.gZ[i]
      );
      this.dummy.rotation.set(0, this.runTime * 2.8 + i, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.gemMesh.setMatrixAt(i, this.dummy.matrix);
      this.gemMesh.setColorAt(
        i,
        this.tmpColor.setHex(v >= 20 ? 0xfbbf24 : v >= 5 ? 0x22d3ee : 0x60a5fa)
      );
    }
    this.activeGemCount = activeCount;
    this.gemMesh.instanceMatrix.needsUpdate = true;
    if (this.gemMesh.instanceColor) this.gemMesh.instanceColor.needsUpdate = true;

    for (const ch of this.chests) {
      if (!ch.active) continue;
      ch.age += dt;
      ch.group.children[0].rotation.y = ch.age * 2.2;
      const dx = this.px - ch.x;
      const dz = this.pz - ch.z;
      if (dx * dx + dz * dz < 1.85 * 1.85) {
        ch.active = false;
        ch.group.visible = false;
        this.openHyperChest();
      }
    }

    for (const pu of this.powerups) {
      if (!pu.active) continue;
      pu.age += dt;
      pu.coreMesh.rotation.y = pu.age * 3.2;
      pu.coreMesh.position.y = 0.55 + Math.sin(pu.age * 5) * 0.12;
      const dx = this.px - pu.x;
      const dz = this.pz - pu.z;
      if (dx * dx + dz * dz < 1.8 * 1.8) {
        pu.active = false;
        pu.group.visible = false;
        if (pu.kind === 'magnet') this.activateMagnetVacuum();
        else this.activateFrenzyOrb();
      }
    }
  }

  public grantXp(amount: number): void {
    this.xp += amount;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpForNextLevel(this.level);
      this.pendingLevels++;
    }
    if (this.pendingLevels > 0 && this.screen === 'playing') {
      this.openUpgradeModal();
    }
  }

  private openHyperChest(): void {
    const weaponIds = Object.keys(WEAPONS) as WeaponId[];
    for (const wid of weaponIds) {
      const lv = this.weaponLevels[wid] || 0;
      const def = WEAPONS[wid];
      const hasPair = (this.passiveLevels[def.pairPassive] || 0) >= 1;
      if (lv >= 8 && hasPair && !this.weaponHyper[wid]) {
        this.weaponHyper[wid] = true;
        this.dpsTracker.onHyper(wid);
        this.hp = Math.min(this.maxHp, this.hp + 45);
        this.audio.playFanfare(true);
        this.vfx.spawnSkyPillar(this.px, this.pz, 2.8, 0xfef08a, 0.5);
        this.vfx.spawnRing(this.px, this.pz, 14, 0xfbbf24, 0.65);
        this.damageCircle(this.px, this.pz, 9.5, 180 * this.getDamageMult(), 16, 0xfbbf24, wid);
        this.triggerHitstop(0.09, 0.04);
        this.addTrauma(0.75);
        this.punchCamera(-160, 0.065);
        this.updateSlotBadges();
        this.showToast(`★ 超武觉醒：【${def.name}】进化为【${def.hyperName}】！！`);
        return;
      }
    }

    this.hp = Math.min(this.maxHp, this.hp + 40);
    this.audio.playFanfare(false);
    this.vfx.spawnRing(this.px, this.pz, 7, 0x22d3ee, 0.45);
    this.punchCamera(-90, 0.03);
    this.damageCircle(this.px, this.pz, 5.5, 85 * this.getDamageMult(), 12, 0x22d3ee);

    for (const wid of weaponIds) {
      const lv = this.weaponLevels[wid] || 0;
      if (lv > 0 && lv < 8) {
        this.weaponLevels[wid] = lv + 1;
        this.updateSlotBadges();
        this.showToast(`超导空投补给：【${WEAPONS[wid].name}】直升 Lv ${lv + 1} + 恢复 40 HP！`);
        return;
      }
    }
    this.overclockStacks += 2;
    this.showToast('超导空投补给：全武器超频伤害 +10% + 恢复 40 HP！');
  }

  // =========================================================================
  // Illustrated Upgrade Cards, Meta-Hangar UI & Post-Run DPS Leaderboard
  // =========================================================================
  private openUpgradeModal(): void {
    this.pendingLevels--;
    this.vfx.spawnRing(this.px, this.pz, 4.8, 0xa855f7, 0.35);
    this.damageCircle(this.px, this.pz, 4.2, 18 * this.getDamageMult(), 11, 0xa855f7);
    this.audio.playFanfare(false);

    this.rollUpgradeChoices();
    this.focusedCardIdx = 0;
    this.renderUpgradeModal();
    this.setScreen('upgrade');
  }

  private rollUpgradeChoices(): void {
    const pool: { item: UpgradeChoice; weight: number }[] = [];
    const heldWeaponCount = Object.keys(this.weaponLevels).length;
    const heldPassiveCount = Object.keys(this.passiveLevels).length;

    for (const wid of Object.keys(WEAPONS) as WeaponId[]) {
      const def = WEAPONS[wid];
      const lv = this.weaponLevels[wid] || 0;
      if (lv >= 8) continue;
      if (lv === 0 && heldWeaponCount >= 6) continue;
      const pDef = PASSIVES[def.pairPassive];
      const hasPair = (this.passiveLevels[def.pairPassive] || 0) >= 1;
      const nextLv = lv + 1;
      pool.push({
        weight: lv > 0 ? 1.85 : 1.05,
        item: {
          kind: 'weapon',
          weaponId: wid,
          artImg: nextLv === 8 && hasPair ? def.hyperImg : def.iconImg,
          badgeText: lv === 0 ? '新主武器' : `LV ${lv} → LV ${nextLv}`,
          title: def.name,
          role: nextLv === 8 && hasPair ? '★ 升满后拾取空投舱即可进化超武！' : '自动索敌主武器',
          desc: def.desc,
          pairImg: pDef.iconImg,
          pairHint: `配对芯片：${pDef.name} → ${def.hyperName} ${hasPair ? '(已集齐!)' : ''}`,
          hyperReady: nextLv === 8 && hasPair,
        },
      });
    }

    for (const pid of Object.keys(PASSIVES) as PassiveId[]) {
      const pDef = PASSIVES[pid];
      const lv = this.passiveLevels[pid] || 0;
      if (lv >= pDef.maxLv) continue;
      if (lv === 0 && heldPassiveCount >= 6) continue;

      const pairedWeaponHeld = pDef.pairWeapon
        ? (this.weaponLevels[pDef.pairWeapon] || 0) > 0
        : false;
      const weight = pairedWeaponHeld && lv === 0 ? 2.2 : lv > 0 ? 1.45 : 1.0;
      const wDef = pDef.pairWeapon ? WEAPONS[pDef.pairWeapon] : null;
      pool.push({
        weight,
        item: {
          kind: 'passive',
          passiveId: pid,
          artImg: pDef.iconImg,
          badgeText: lv === 0 ? '新核心芯片' : `LV ${lv} → LV ${lv + 1}`,
          title: pDef.name,
          role: pairedWeaponHeld && lv === 0 ? '★ 超武配对核心芯片（推荐!）' : '被动增幅模块',
          desc: pDef.desc,
          pairImg: wDef ? wDef.hyperImg : undefined,
          pairHint: wDef
            ? `可使 Lv8【${wDef.name}】进化为【${wDef.hyperName}】`
            : '重甲防护与最大生命强化模块',
          hyperReady: pairedWeaponHeld && (this.weaponLevels[pDef.pairWeapon!] || 0) >= 8,
        },
      });
    }

    const picked: UpgradeChoice[] = [];
    while (picked.length < 3 && pool.length > 0) {
      const totalW = pool.reduce((s, x) => s + x.weight, 0);
      let r = Math.random() * totalW;
      let chosenIdx = 0;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].weight;
        if (r <= 0) {
          chosenIdx = i;
          break;
        }
      }
      picked.push(pool.splice(chosenIdx, 1)[0].item);
    }

    if (picked.length === 0) {
      picked.push(
        {
          kind: 'heal',
          artImg: './ui/mod_heal.png',
          badgeText: '战地修复',
          title: '纳米紧急修复',
          role: '即时装甲维修',
          desc: '立即恢复 45% 最大生命值，并短暂激活护盾保护。',
          pairHint: '全武器与芯片已达上限',
          hyperReady: false,
        },
        {
          kind: 'overclock',
          artImg: './ui/mod_overclock.png',
          badgeText: `超频 +${(this.overclockStacks + 1) * 5}%`,
          title: '超频反应堆注入',
          role: '无限终局增幅',
          desc: '本局全局所有主武器与超武最终伤害永久 +5%！',
          pairHint: '可无限叠加突破火力极限',
          hyperReady: true,
        }
      );
    }

    this.currentChoices = picked;
  }

  private selectUpgrade(index: number): void {
    const choice = this.currentChoices[index];
    if (!choice) return;

    if (choice.kind === 'weapon' && choice.weaponId) {
      this.weaponLevels[choice.weaponId] = (this.weaponLevels[choice.weaponId] || 0) + 1;
      this.dpsTracker.onAcquire(choice.weaponId, this.runTime);
    } else if (choice.kind === 'passive' && choice.passiveId) {
      this.passiveLevels[choice.passiveId] = (this.passiveLevels[choice.passiveId] || 0) + 1;
      if (choice.passiveId === 'armor') {
        this.maxHp += 25;
        this.hp = Math.min(this.maxHp, this.hp + 25);
      }
    } else if (choice.kind === 'heal') {
      this.hp = Math.min(this.maxHp, Math.round(this.hp + this.maxHp * 0.45));
    } else if (choice.kind === 'overclock') {
      this.overclockStacks++;
    }

    this.updateSlotBadges();

    if (this.pendingLevels > 0) {
      this.openUpgradeModal();
    } else {
      this.postMenuGrace = 0.35;
      this.setScreen('playing');
    }
  }

  private buyHangarUpgrade(id: HangarUpgradeId): void {
    const def = HANGAR_UPGRADES.find((u) => u.id === id);
    if (!def) return;
    const curLv = this.metaSave.upgrades[id] || 0;
    if (curLv >= def.maxLv) return;
    const cost = getUpgradeCost(def, curLv);
    if (this.metaSave.cores < cost) return;

    this.metaSave.cores -= cost;
    this.metaSave.upgrades[id] = curLv + 1;
    saveMetaSave(this.metaSave);
    this.audio.playFanfare(curLv + 1 === def.maxLv);
    this.renderHangarPanel();
    this.renderTitleCards();
  }

  private resetHangarUpgrades(): void {
    const refund = getTotalRefundCores(this.metaSave);
    if (refund <= 0) return;
    this.metaSave.cores += refund;
    for (const def of HANGAR_UPGRADES) {
      this.metaSave.upgrades[def.id] = 0;
    }
    saveMetaSave(this.metaSave);
    this.audio.playXpGem();
    this.renderHangarPanel();
    this.renderTitleCards();
  }

  private renderHangarPanel(): void {
    document.getElementById('core-balance')!.textContent = String(this.metaSave.cores);
    const bestM = String(Math.floor(this.metaSave.bestSurvivalSec / 60)).padStart(2, '0');
    const bestS = String(this.metaSave.bestSurvivalSec % 60).padStart(2, '0');
    document.getElementById('career-summary')!.textContent =
      `累计击坠 ${this.metaSave.totalKills} · 最佳 ${bestM}:${bestS}`;

    const grid = document.getElementById('hangar-grid')!;
    grid.innerHTML = HANGAR_UPGRADES.map((def) => {
      const lv = this.metaSave.upgrades[def.id] || 0;
      const maxed = lv >= def.maxLv;
      const cost = getUpgradeCost(def, lv);
      const canBuy = !maxed && this.metaSave.cores >= cost;
      return `
      <div class="hangar-item ${maxed ? 'maxed' : canBuy ? 'affordable' : ''}" data-upg="${def.id}">
        <div class="hangar-top">
          <span>[${def.hotkey}]</span>
          <span>Lv ${lv}/${def.maxLv}</span>
        </div>
        <div class="hangar-name">${def.name}</div>
        <div class="hangar-bonus">${def.shortBonus}</div>
        <div class="hangar-cost">${maxed ? '★ 已满阶' : `💎 ${cost}`}</div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.hangar-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.audio.unlock();
        this.buyHangarUpgrade((el as HTMLElement).dataset.upg as HangarUpgradeId);
      });
    });
  }

  private renderTitleCards(): void {
    this.applySelectedMechVisuals();
    const bonusHp = (this.metaSave.upgrades.hull || 0) * 15;
    const grid = document.getElementById('mech-grid')!;
    grid.innerHTML = MECHS.map((m, idx) => {
      const startW = WEAPONS[m.startWeapon];
      return `
      <div class="mech-card ${idx === this.selectedMechIdx ? 'selected' : ''}" data-idx="${idx}">
        <div class="card-art-wrap">
          <span class="key-chip">[${idx + 1}]</span>
          <span class="lv-chip">HP ${m.hp + bonusHp} · 甲 ${m.armor}</span>
          <img class="card-art-img" src="${m.portraitImg}" alt="${m.name}" />
        </div>
        <div class="card-title">${m.name}</div>
        <div class="card-role">${m.role}</div>
        <div class="card-desc">${m.desc}</div>
        <div class="card-pair-hint">
          <img class="pair-mini-icon" src="${startW.iconImg}" alt="${startW.name}" />
          <span>初始搭载：${startW.name} · 移速 ${m.speed}</span>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.mech-card').forEach((el) => {
      el.addEventListener('click', () => {
        this.selectedMechIdx = Number((el as HTMLElement).dataset.idx);
        this.renderTitleCards();
      });
      el.addEventListener('dblclick', () => {
        this.startRun(Number((el as HTMLElement).dataset.idx));
      });
    });
  }

  private renderUpgradeModal(): void {
    document.getElementById('modal-title')!.textContent = `机甲升阶 LV ${this.level} · 选择强化模块`;
    document.getElementById('reroll-left')!.textContent = String(this.rerollsLeft);
    const container = document.getElementById('card-container')!;
    container.innerHTML = this.currentChoices
      .map(
        (c, idx) => `
      <div class="upgrade-card ${c.hyperReady ? 'hyper-ready' : ''} ${idx === this.focusedCardIdx ? 'focused' : ''}" data-idx="${idx}">
        <div class="card-art-wrap">
          <span class="key-chip">[${idx + 1}]</span>
          <span class="lv-chip">${c.badgeText}</span>
          <img class="card-art-img" src="${c.artImg}" alt="${c.title}" />
        </div>
        <div class="card-title">${c.title}</div>
        <div class="card-role">${c.role}</div>
        <div class="card-desc">${c.desc}</div>
        <div class="card-pair-hint">
          ${c.pairImg ? `<img class="pair-mini-icon" src="${c.pairImg}" alt="pair" />` : ''}
          <span>${c.pairHint}</span>
        </div>
      </div>`
      )
      .join('');

    container.querySelectorAll('.upgrade-card').forEach((el) => {
      el.addEventListener('click', () => {
        this.selectUpgrade(Number((el as HTMLElement).dataset.idx));
      });
    });
  }

  private renderRecipeBook(): void {
    const list = document.getElementById('recipe-list')!;
    list.innerHTML = (Object.keys(WEAPONS) as WeaponId[])
      .map((wid) => {
        const w = WEAPONS[wid];
        const p = PASSIVES[w.pairPassive];
        return `
        <div class="recipe-item">
          <div class="recipe-formula">
            <img class="recipe-thumb" src="${w.iconImg}" alt="${w.name}" />
            <span><strong>${w.name}</strong> (Lv8) +</span>
            <img class="recipe-thumb" src="${p.iconImg}" alt="${p.name}" />
            <span><strong>${p.name}</strong> (Lv1+) ➜</span>
            <img class="recipe-thumb hyper" src="${w.hyperImg}" alt="${w.hyperName}" />
            <strong>${w.hyperName}</strong>
          </div>
          <div style="color:#cbd5e1;">${w.hyperDesc}</div>
        </div>`;
      })
      .join('');
  }

  private updateSlotBadges(): void {
    const wWrap = document.getElementById('slots-weapons')!;
    wWrap.innerHTML = (Object.keys(this.weaponLevels) as WeaponId[])
      .map((wid) => {
        const lv = this.weaponLevels[wid]!;
        const def = WEAPONS[wid];
        const hyper = !!this.weaponHyper[wid];
        return `<div class="slot-badge weapon ${hyper ? 'hyper' : ''}">
          <img class="slot-icon" src="${hyper ? def.hyperImg : def.iconImg}" alt="${def.name}" />
          <span>${hyper ? def.hyperName : `${def.name} Lv.${lv}`}</span>
        </div>`;
      })
      .join('');

    const pWrap = document.getElementById('slots-passives')!;
    pWrap.innerHTML = (Object.keys(this.passiveLevels) as PassiveId[])
      .map((pid) => {
        const lv = this.passiveLevels[pid]!;
        const def = PASSIVES[pid];
        return `<div class="slot-badge passive">
          <img class="slot-icon" src="${def.iconImg}" alt="${def.name}" />
          <span>${def.name} Lv.${lv}</span>
        </div>`;
      })
      .join('');
  }

  private updateHud(): void {
    const xpPct = Math.min(100, (this.xp / Math.max(1, this.xpNext)) * 100);
    document.getElementById('xp-bar-fill')!.style.width = `${xpPct.toFixed(1)}%`;
    document.getElementById('xp-label')!.textContent = `LV ${this.level} · ${this.xp} / ${this.xpNext} XP`;

    const hpPct = Math.min(100, (this.hp / Math.max(1, this.maxHp)) * 100);
    document.getElementById('hp-bar-fill')!.style.width = `${hpPct.toFixed(1)}%`;
    document.getElementById('hp-text')!.textContent = `${this.hp} / ${this.maxHp}`;

    const dashReadyPct = Math.min(100, (1 - this.dashCd / Math.max(0.01, this.dashMaxCd)) * 100);
    document.getElementById('dash-bar-fill')!.style.width = `${dashReadyPct.toFixed(0)}%`;

    const frenzyEl = document.getElementById('buff-frenzy')!;
    if (this.frenzyTimer > 0) {
      frenzyEl.classList.remove('hidden');
      document.getElementById('frenzy-time')!.textContent = `${this.frenzyTimer.toFixed(1)}s`;
    } else {
      frenzyEl.classList.add('hidden');
    }
    document.getElementById('buff-revive')!.classList.toggle('hidden', this.revivesLeft <= 0);

    const secs = Math.floor(this.runTime);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    document.getElementById('timer-text')!.textContent = `${mm}:${ss}`;

    const mins = this.runTime / 60;
    const stageNames = [
      'STAGE 1 · 觉醒热身',
      'STAGE 2 · 火力成型',
      'STAGE 3 · 超武狂潮',
      'STAGE 4 · 终局超载',
    ];
    document.getElementById('wave-label')!.textContent =
      stageNames[Math.min(3, Math.floor(mins / 3))];

    document.getElementById('kill-count')!.textContent = String(this.kills);
    document.getElementById('enemy-count')!.textContent = String(this.activeEnemyCount);
    document.getElementById('fps-count')!.textContent = String(this.displayedFps);
  }

  private showToast(msg: string): void {
    const el = document.getElementById('toast-banner')!;
    el.textContent = msg;
    el.classList.remove('hidden');
    this.toastTimer = 3.6;
  }

  private syncAudioUiControls(): void {
    const bgmPct = Math.round(this.metaSave.bgmVolume * 100);
    const sfxPct = Math.round(this.metaSave.sfxVolume * 100);
    const muted = this.audio.isBgmMuted();
    (document.getElementById('bgm-slider') as HTMLInputElement).value = String(bgmPct);
    (document.getElementById('sfx-slider') as HTMLInputElement).value = String(sfxPct);
    document.getElementById('bgm-val')!.textContent = muted ? '静音' : `${bgmPct}%`;
    document.getElementById('sfx-val')!.textContent = `${sfxPct}%`;
    document.getElementById('btn-title-mute')!.textContent = `[M] 电音 BGM：${muted ? '已静音' : '开启'}`;
    document.getElementById('btn-hud-mute')!.textContent = muted ? '🔇 [M]' : '🎵 [M]';
  }

  private toggleBgmMute(): void {
    this.audio.unlock();
    const muted = this.audio.toggleBgmMute();
    this.syncAudioUiControls();
    if (this.screen === 'playing') {
      this.showToast(`赛博电音 BGM：${muted ? '已静音' : '已开启'}`);
    }
  }

  private cycleShakeStrength(): void {
    if (this.shakeStrength >= 0.9) this.shakeStrength = 0.5;
    else if (this.shakeStrength >= 0.4) this.shakeStrength = 0.0;
    else this.shakeStrength = 1.0;
    const pct = Math.round(this.shakeStrength * 100);
    document.getElementById('btn-feel-toggle')!.textContent = `[V] 震屏强闪：${pct === 0 ? '关闭' : `${pct}%`}`;
  }

  private finishRun(victory: boolean): void {
    const secs = Math.floor(this.runTime);
    const earnedCores = computeRunRewardCores(
      this.kills,
      this.runTime,
      this.bossesDefeated,
      victory
    );
    this.metaSave.cores += earnedCores;
    this.metaSave.totalRuns++;
    this.metaSave.totalKills += this.kills;
    if (secs > this.metaSave.bestSurvivalSec) {
      this.metaSave.bestSurvivalSec = secs;
    }
    saveMetaSave(this.metaSave);

    this.setScreen(victory ? 'victory' : 'gameover');
    this.audio.playFanfare(victory);
    document.getElementById('result-tag')!.textContent = victory
      ? 'HYPER VICTORY · 12:00 CLEARED'
      : 'SIGNAL LOST · MECH DESTROYED';
    document.getElementById('result-title')!.textContent = victory
      ? '六翼泰坦击破 · 完美通关！'
      : '装甲归零 · 战术回收结算';

    const hyperCount = Object.values(this.weaponHyper).filter(Boolean).length;
    document.getElementById('result-stats')!.innerHTML = `
      <div class="result-row"><span>存活时间</span><strong>${Math.floor(secs / 60)}分 ${secs % 60}秒</strong></div>
      <div class="result-row"><span>总击坠敌机</span><strong>${this.kills} 台</strong></div>
      <div class="result-row"><span>最终升阶 / 超武</span><strong>LV ${this.level} · ${hyperCount} 超武</strong></div>
      <div class="result-row reward"><span>本局核心奖励</span><strong>+💎 ${earnedCores} (持有 ${this.metaSave.cores})</strong></div>
    `;

    const rows = this.dpsTracker.buildBreakdown(this.runTime);
    const chartEl = document.getElementById('dps-chart')!;
    chartEl.innerHTML = rows
      .map(
        (r) => `
      <div class="dps-row">
        <div class="dps-wpn ${r.isHyper ? 'hyper' : ''}">
          <img src="${r.icon}" alt="${r.name}" />
          <span>${r.name}</span>
        </div>
        <div class="dps-bar-track">
          <div class="dps-bar-fill ${r.isHyper ? 'hyper' : ''}" style="width:${Math.max(3, r.sharePct).toFixed(1)}%"></div>
        </div>
        <div class="dps-nums">
          <strong>${r.totalDamage.toLocaleString()}</strong> (${r.sharePct.toFixed(0)}%) · ${r.dps}/s
        </div>
      </div>`
      )
      .join('');
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.onResize());

    document.getElementById('btn-start')!.addEventListener('click', () => this.startRun());
    document.getElementById('btn-restart')!.addEventListener('click', () => this.setScreen('title'));
    document.getElementById('btn-hangar-reset')!.addEventListener('click', () => {
      this.audio.unlock();
      this.resetHangarUpgrades();
    });
    document.getElementById('btn-title-mute')!.addEventListener('click', () => this.toggleBgmMute());
    document.getElementById('btn-hud-mute')!.addEventListener('click', () => this.toggleBgmMute());
    document.getElementById('btn-mute-bgm')!.addEventListener('click', () => this.toggleBgmMute());

    const bgmSlider = document.getElementById('bgm-slider') as HTMLInputElement;
    const sfxSlider = document.getElementById('sfx-slider') as HTMLInputElement;
    bgmSlider.addEventListener('input', () => {
      this.metaSave.bgmVolume = Number(bgmSlider.value) / 100;
      this.audio.setVolumes(this.metaSave.bgmVolume, this.metaSave.sfxVolume);
      saveMetaSave(this.metaSave);
      this.syncAudioUiControls();
    });
    sfxSlider.addEventListener('input', () => {
      this.metaSave.sfxVolume = Number(sfxSlider.value) / 100;
      this.audio.setVolumes(this.metaSave.bgmVolume, this.metaSave.sfxVolume);
      saveMetaSave(this.metaSave);
      this.syncAudioUiControls();
    });

    document.getElementById('btn-resume')!.addEventListener('click', () => {
      this.postMenuGrace = 0.3;
      this.setScreen('playing');
    });
    document
      .getElementById('btn-feel-toggle')!
      .addEventListener('click', () => this.cycleShakeStrength());
    document.getElementById('btn-reroll')!.addEventListener('click', () => {
      if (this.screen === 'upgrade' && this.rerollsLeft > 0) {
        this.rerollsLeft--;
        this.rollUpgradeChoices();
        this.renderUpgradeModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      this.audio.unlock();
      this.keys.add(e.code);
      if (e.repeat) return;

      if (e.code === 'KeyM') {
        this.toggleBgmMute();
        return;
      }

      if (this.screen === 'title') {
        if (e.code === 'Digit1') {
          this.selectedMechIdx = 0;
          this.renderTitleCards();
        } else if (e.code === 'Digit2') {
          this.selectedMechIdx = 1;
          this.renderTitleCards();
        } else if (e.code === 'Digit3') {
          this.selectedMechIdx = 2;
          this.renderTitleCards();
        } else if (e.code === 'Digit4') {
          this.buyHangarUpgrade('hull');
        } else if (e.code === 'Digit5') {
          this.buyHangarUpgrade('overcharge');
        } else if (e.code === 'Digit6') {
          this.buyHangarUpgrade('thrusters');
        } else if (e.code === 'Digit7') {
          this.buyHangarUpgrade('siphon');
        } else if (e.code === 'Digit8') {
          this.buyHangarUpgrade('tactical');
        } else if (e.code === 'Digit9') {
          this.buyHangarUpgrade('phoenix');
        } else if (e.code === 'Digit0') {
          this.resetHangarUpgrades();
        } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
          this.selectedMechIdx = (this.selectedMechIdx + 2) % 3;
          this.renderTitleCards();
        } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
          this.selectedMechIdx = (this.selectedMechIdx + 1) % 3;
          this.renderTitleCards();
        } else if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          this.startRun();
        }
        return;
      }

      if (this.screen === 'upgrade') {
        if (e.code === 'Digit1' || e.code === 'Numpad1') this.selectUpgrade(0);
        else if (e.code === 'Digit2' || e.code === 'Numpad2') this.selectUpgrade(1);
        else if (e.code === 'Digit3' || e.code === 'Numpad3') this.selectUpgrade(2);
        else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
          this.focusedCardIdx =
            (this.focusedCardIdx + this.currentChoices.length - 1) % this.currentChoices.length;
          this.renderUpgradeModal();
        } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
          this.focusedCardIdx = (this.focusedCardIdx + 1) % this.currentChoices.length;
          this.renderUpgradeModal();
        } else if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          this.selectUpgrade(this.focusedCardIdx);
        } else if (e.code === 'KeyR' && this.rerollsLeft > 0) {
          this.rerollsLeft--;
          this.rollUpgradeChoices();
          this.renderUpgradeModal();
        }
        return;
      }

      if (this.screen === 'recipe') {
        if (e.code === 'KeyV') {
          this.cycleShakeStrength();
        } else if (
          e.code === 'Tab' ||
          e.code === 'KeyP' ||
          e.code === 'Escape' ||
          e.code === 'Space'
        ) {
          e.preventDefault();
          this.postMenuGrace = 0.3;
          this.setScreen('playing');
        }
        return;
      }

      if (this.screen === 'gameover' || this.screen === 'victory') {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          this.setScreen('title');
        }
        return;
      }

      if (this.screen === 'playing') {
        if (e.code === 'Space' || e.code === 'ShiftLeft') {
          e.preventDefault();
          this.dashBufferTimer = 0.18;
          if (this.dashCd <= 0 && this.dashActiveTimer <= 0) {
            this.dashBufferTimer = 0;
            this.executeDash();
          }
        } else if (e.code === 'Tab' || e.code === 'KeyP' || e.code === 'Escape') {
          e.preventDefault();
          this.setScreen('recipe');
        } else if (e.code === 'KeyV') {
          this.cycleShakeStrength();
          this.showToast(`震屏与受击强闪强度：${Math.round(this.shakeStrength * 100)}%`);
        } else if (e.code === 'F2') {
          e.preventDefault();
          this.spawnChest(
            this.px + Math.sin(this.facingYaw) * 3.5,
            this.pz - Math.cos(this.facingYaw) * 3.5
          );
          this.showToast('[调试] 已在前方空投 3D 超导进化舱！');
        } else if (e.code === 'F3') {
          e.preventDefault();
          this.grantXp(this.xpNext);
        } else if (e.code === 'F4') {
          e.preventDefault();
          this.spawnBoss(1, '⚠ 阶段 BOSS：六翼重装机神·壹型', 3200);
        } else if (e.code === 'F5') {
          e.preventDefault();
          this.spawnPowerUp(this.px - 2.2, this.pz - 2.8, 'magnet');
          this.spawnPowerUp(this.px + 2.2, this.pz - 2.8, 'frenzy');
          this.showToast('[调试] 已在前方投放【全屏磁铁】与【无限超载狂暴球】！');
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.dmgCanvas.width = w;
    this.dmgCanvas.height = h;
  }

  public getMetrics() {
    return {
      modelsLoaded: this.modelsLoaded,
      screen: this.screen,
      fps: this.displayedFps,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      activeEnemies: this.activeEnemyCount,
      combo: this.comboCount,
      level: this.level,
      cores: this.metaSave.cores,
    };
  }
}

const game = new NeonOverdriveGame();
Object.assign(window, {
  game,
  renderer: game.renderer,
  scene: game.scene,
});
