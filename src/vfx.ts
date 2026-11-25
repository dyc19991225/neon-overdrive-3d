import * as THREE from 'three';

const MAX_SHARDS = 500;
const MAX_FLARES = 180;
const MAX_RINGS = 56;
const MAX_SLASHES = 16;
const MAX_ARCS = 64;
const MAX_GHOSTS = 28;
const MAX_PILLARS = 14;
const MAX_NUMBERS = 180;

interface DamagePopup {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  value: string;
  crit: boolean;
  color: string;
}

function easeOutBack(k: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const m = k - 1;
  return 1 + c3 * m * m * m + c1 * m * m;
}

export class VfxSystem {
  private shardMesh: THREE.InstancedMesh;
  private shardX = new Float32Array(MAX_SHARDS);
  private shardY = new Float32Array(MAX_SHARDS);
  private shardZ = new Float32Array(MAX_SHARDS);
  private shardVx = new Float32Array(MAX_SHARDS);
  private shardVy = new Float32Array(MAX_SHARDS);
  private shardVz = new Float32Array(MAX_SHARDS);
  private shardLife = new Float32Array(MAX_SHARDS);
  private shardMaxLife = new Float32Array(MAX_SHARDS);
  private shardScale = new Float32Array(MAX_SHARDS);
  private shardCursor = 0;

  private flareMesh: THREE.InstancedMesh;
  private flareX = new Float32Array(MAX_FLARES);
  private flareY = new Float32Array(MAX_FLARES);
  private flareZ = new Float32Array(MAX_FLARES);
  private flareRot = new Float32Array(MAX_FLARES);
  private flareAge = new Float32Array(MAX_FLARES);
  private flareDur = new Float32Array(MAX_FLARES);
  private flareSize = new Float32Array(MAX_FLARES);
  private flareCursor = 0;

  private rings: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    age: number;
    dur: number;
    maxR: number;
  }[] = [];
  private slashes: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    age: number;
    dur: number;
    vx: number;
    vz: number;
  }[] = [];
  private arcs: { line: THREE.Line; mat: THREE.LineBasicMaterial; age: number; dur: number }[] = [];
  private ghosts: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; dur: number }[] = [];
  private pillars: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    age: number;
    dur: number;
    radius: number;
  }[] = [];
  private popups: DamagePopup[] = [];

  private flashLight: THREE.PointLight;
  private flashLightAge = 1;
  private flashLightDur = 0.1;
  private flashPeakIntensity = 0;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private projVec = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const texLoader = new THREE.TextureLoader();
    const shockTex = texLoader.load('./vfx/fx_shockwave.png');
    shockTex.colorSpace = THREE.SRGBColorSpace;
    const flareTex = texLoader.load('./vfx/fx_flare.png');
    flareTex.colorSpace = THREE.SRGBColorSpace;
    const slashTex = texLoader.load('./vfx/fx_slash.png');
    slashTex.colorSpace = THREE.SRGBColorSpace;

    this.flashLight = new THREE.PointLight(0x22d3ee, 0, 15, 1.6);
    this.flashLight.position.set(0, 2.2, 0);
    scene.add(this.flashLight);

    const shardGeo = new THREE.DodecahedronGeometry(0.22, 0);
    const shardMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, MAX_SHARDS);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.frustumCulled = false;
    for (let i = 0; i < MAX_SHARDS; i++) {
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.shardMesh.setMatrixAt(i, this.dummy.matrix);
      this.shardMesh.setColorAt(i, this.tmpColor.setHex(0x22d3ee));
    }
    scene.add(this.shardMesh);

    const flareGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const flareMat = new THREE.MeshBasicMaterial({
      map: flareTex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flareMesh = new THREE.InstancedMesh(flareGeo, flareMat, MAX_FLARES);
    this.flareMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flareMesh.frustumCulled = false;
    for (let i = 0; i < MAX_FLARES; i++) {
      this.flareAge[i] = 99;
      this.flareDur[i] = 1;
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.flareMesh.setMatrixAt(i, this.dummy.matrix);
      this.flareMesh.setColorAt(i, this.tmpColor.setHex(0x67e8f9));
    }
    scene.add(this.flareMesh);

    const ringGeo = new THREE.PlaneGeometry(2.0, 2.0);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: shockTex,
        color: 0x22d3ee,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, mat, age: 1, dur: 1, maxR: 1 });
    }

    const slashGeo = new THREE.PlaneGeometry(3.6, 3.6);
    slashGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_SLASHES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: slashTex,
        color: 0x22d3ee,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(slashGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.slashes.push({ mesh, mat, age: 1, dur: 0.3, vx: 0, vz: 0 });
    }

    for (let i = 0; i < MAX_ARCS; i++) {
      const pts = new Float32Array(6 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xe879f9,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.arcs.push({ line, mat, age: 1, dur: 0.16 });
    }

    const ghostGeo = new THREE.BoxGeometry(0.68, 1.48, 0.45);
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ghostGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.ghosts.push({ mesh, mat, age: 1, dur: 0.36 });
    }

    // Towering Orbital Ion Sky-Pillars (for Orbital Strike, Skynet Judgement, Boss Meteors & Revive)
    const pillarGeo = new THREE.CylinderGeometry(0.65, 1.0, 26, 16, 1, true);
    pillarGeo.translate(0, 13, 0);
    for (let i = 0; i < MAX_PILLARS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(pillarGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pillars.push({ mesh, mat, age: 1, dur: 0.34, radius: 1.2 });
    }

    for (let i = 0; i < MAX_NUMBERS; i++) {
      this.popups.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 0.55,
        value: '',
        crit: false,
        color: '#fff',
      });
    }
  }

  public pulseLight(x: number, z: number, colorHex: number, intensity = 16, dur = 0.11): void {
    this.flashLight.position.set(x, 2.2, z);
    this.flashLight.color.setHex(colorHex);
    this.flashPeakIntensity = intensity;
    this.flashLight.intensity = intensity;
    this.flashLightAge = 0;
    this.flashLightDur = dur;
  }

  public spawnSkyPillar(
    x: number,
    z: number,
    radius: number,
    colorHex: number,
    dur = 0.34
  ): void {
    const slot = this.pillars.find((p) => !p.mesh.visible) || this.pillars[0];
    slot.mesh.visible = true;
    slot.mesh.position.set(x, 0, z);
    slot.mesh.scale.set(radius, 1, radius);
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 0.95;
    slot.age = 0;
    slot.dur = dur;
    slot.radius = radius;
    this.spawnHitFlare(x, 0.65, z, colorHex, radius * 2.4);
    this.pulseLight(x, z, colorHex, 20, dur * 0.7);
  }

  public spawnHitFlare(x: number, y: number, z: number, colorHex: number, size = 1.45): void {
    const idx = this.flareCursor;
    this.flareCursor = (this.flareCursor + 1) % MAX_FLARES;
    this.flareX[idx] = x;
    this.flareY[idx] = y;
    this.flareZ[idx] = z;
    this.flareRot[idx] = Math.random() * Math.PI * 2;
    this.flareAge[idx] = 0;
    this.flareDur[idx] = 0.085;
    this.flareSize[idx] = size;
    this.flareMesh.setColorAt(idx, this.tmpColor.setHex(colorHex));
    if (this.flareMesh.instanceColor) this.flareMesh.instanceColor.needsUpdate = true;
  }

  public spawnSlashWave(x: number, z: number, yaw: number, colorHex: number): void {
    const slot = this.slashes.find((s) => !s.mesh.visible) || this.slashes[0];
    slot.mesh.visible = true;
    slot.mesh.position.set(x, 0.88, z);
    slot.mesh.rotation.set(-Math.PI / 2, 0, -yaw);
    slot.mesh.scale.setScalar(1.0);
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 0.96;
    slot.age = 0;
    slot.dur = 0.28;
    slot.vx = Math.sin(yaw) * 19;
    slot.vz = -Math.cos(yaw) * 19;
  }

  public spawnSingleGhost(x: number, z: number, yaw: number, colorHex: number): void {
    const slot = this.ghosts.find((g) => !g.mesh.visible);
    if (!slot) return;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, 0.88, z);
    slot.mesh.rotation.set(0, -yaw, 0);
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 0.72;
    slot.age = 0;
    slot.dur = 0.32;
  }

  public spawnBurst(x: number, y: number, z: number, colorHex: number, count = 10, speed = 7): void {
    this.spawnHitFlare(x, y + 0.5, z, colorHex, count > 15 ? 3.2 : 1.75);
    if (count >= 14) {
      this.pulseLight(x, z, colorHex, count >= 24 ? 22 : 14, 0.14);
    }
    this.tmpColor.setHex(colorHex);
    for (let k = 0; k < count; k++) {
      const idx = this.shardCursor;
      this.shardCursor = (this.shardCursor + 1) % MAX_SHARDS;
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      this.shardX[idx] = x;
      this.shardY[idx] = y + 0.35;
      this.shardZ[idx] = z;
      this.shardVx[idx] = Math.cos(ang) * spd;
      this.shardVy[idx] = 3.5 + Math.random() * 5.5;
      this.shardVz[idx] = Math.sin(ang) * spd;
      this.shardMaxLife[idx] = 0.28 + Math.random() * 0.26;
      this.shardLife[idx] = this.shardMaxLife[idx];
      this.shardScale[idx] = 0.55 + Math.random() * 0.75;
      this.shardMesh.setColorAt(idx, this.tmpColor);
    }
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
  }

  public spawnRing(x: number, z: number, maxR: number, colorHex: number, dur = 0.34): void {
    const slot = this.rings.find((r) => !r.mesh.visible) || this.rings[0];
    slot.mesh.visible = true;
    slot.mesh.position.set(x, 0.08, z);
    slot.mesh.scale.setScalar(0.2);
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 0.95;
    slot.age = 0;
    slot.dur = dur;
    slot.maxR = maxR;
  }

  public spawnArc(x1: number, z1: number, x2: number, z2: number, colorHex: number): void {
    const slot = this.arcs.find((a) => !a.line.visible) || this.arcs[0];
    const attr = slot.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const segs = 5;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const jitter = i === 0 || i === segs ? 0 : (Math.random() - 0.5) * 0.85;
      arr[i * 3] = x1 + (x2 - x1) * t + jitter;
      arr[i * 3 + 1] = 0.92 + (i === 0 || i === segs ? 0 : Math.random() * 0.45);
      arr[i * 3 + 2] = z1 + (z2 - z1) * t - jitter;
    }
    attr.needsUpdate = true;
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 1.0;
    slot.line.visible = true;
    slot.age = 0;
    slot.dur = 0.16;
    this.spawnHitFlare(x2, 0.95, z2, colorHex, 1.35);
    this.pulseLight(x2, z2, colorHex, 11, 0.09);
  }

  public spawnDamageNumber(
    x: number,
    z: number,
    dmg: number | string,
    crit: boolean,
    color = '#f8fafc'
  ): void {
    const slot = this.popups.find((p) => !p.active);
    if (!slot) return;
    slot.active = true;
    slot.x = x + (Math.random() - 0.5) * 0.35;
    slot.y = 1.55 + Math.random() * 0.25;
    slot.z = z + (Math.random() - 0.5) * 0.35;
    const fanAng = Math.random() * Math.PI * 2;
    const fanSpd = 1.6 + Math.random() * 1.8;
    slot.vx = Math.cos(fanAng) * fanSpd;
    slot.vz = Math.sin(fanAng) * fanSpd;
    slot.vy = crit ? 6.4 : 4.8;
    slot.age = 0;
    slot.life = crit ? 0.72 : 0.52;
    slot.value = typeof dmg === 'string' ? dmg : crit ? `${dmg}!` : `${dmg}`;
    slot.crit = crit;
    slot.color = crit && color === '#f8fafc' ? '#fde047' : color;
  }

  public update(
    rawDt: number,
    camera: THREE.Camera,
    ctx2d: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    if (this.flashLightAge < this.flashLightDur) {
      this.flashLightAge += rawDt;
      const p = Math.max(0, 1 - this.flashLightAge / this.flashLightDur);
      this.flashLight.intensity = this.flashPeakIntensity * p * p;
    } else {
      this.flashLight.intensity = 0;
    }

    for (let i = 0; i < MAX_SHARDS; i++) {
      const life = this.shardLife[i];
      if (life <= 0) continue;
      const next = life - rawDt;
      this.shardLife[i] = next;
      if (next <= 0) {
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.shardMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      this.shardVy[i] -= 19 * rawDt;
      this.shardX[i] += this.shardVx[i] * rawDt;
      this.shardY[i] += this.shardVy[i] * rawDt;
      this.shardZ[i] += this.shardVz[i] * rawDt;
      if (this.shardY[i] < 0.1) {
        this.shardY[i] = 0.1;
        this.shardVy[i] *= -0.48;
      }
      const ratio = next / this.shardMaxLife[i];
      this.dummy.position.set(this.shardX[i], this.shardY[i], this.shardZ[i]);
      this.dummy.rotation.set(next * 10, next * 13, 0);
      this.dummy.scale.setScalar(this.shardScale[i] * ratio);
      this.dummy.updateMatrix();
      this.shardMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MAX_FLARES; i++) {
      if (this.flareAge[i] >= this.flareDur[i]) continue;
      this.flareAge[i] += rawDt;
      if (this.flareAge[i] >= this.flareDur[i]) {
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.flareMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      const p = 1 - this.flareAge[i] / this.flareDur[i];
      this.dummy.position.set(this.flareX[i], this.flareY[i], this.flareZ[i]);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.rotateZ(this.flareRot[i]);
      this.dummy.scale.setScalar(this.flareSize[i] * (0.45 + p * 0.75));
      this.dummy.updateMatrix();
      this.flareMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.flareMesh.instanceMatrix.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += rawDt;
      if (r.age >= r.dur) {
        r.mesh.visible = false;
        continue;
      }
      const p = r.age / r.dur;
      const eased = 1 - Math.pow(1 - p, 3);
      r.mesh.scale.setScalar(0.25 + eased * r.maxR);
      r.mesh.rotation.z = p * 1.25;
      r.mat.opacity = (1 - p) * 0.95;
    }

    for (const s of this.slashes) {
      if (!s.mesh.visible) continue;
      s.age += rawDt;
      if (s.age >= s.dur) {
        s.mesh.visible = false;
        continue;
      }
      const p = s.age / s.dur;
      s.mesh.position.x += s.vx * rawDt;
      s.mesh.position.z += s.vz * rawDt;
      s.mesh.scale.setScalar(0.95 + p * 1.2);
      s.mat.opacity = (1 - p) * 0.92;
    }

    for (const a of this.arcs) {
      if (!a.line.visible) continue;
      a.age += rawDt;
      if (a.age >= a.dur) {
        a.line.visible = false;
        continue;
      }
      a.mat.opacity = 1 - a.age / a.dur;
    }

    for (const g of this.ghosts) {
      if (!g.mesh.visible) continue;
      g.age += rawDt;
      if (g.age >= g.dur) {
        g.mesh.visible = false;
        continue;
      }
      g.mat.opacity = (1 - g.age / g.dur) * 0.68;
    }

    for (const pl of this.pillars) {
      if (!pl.mesh.visible) continue;
      pl.age += rawDt;
      if (pl.age >= pl.dur) {
        pl.mesh.visible = false;
        continue;
      }
      const p = pl.age / pl.dur;
      const rScale = pl.radius * (1.25 - p * 0.85);
      pl.mesh.scale.set(rScale, 1, rScale);
      pl.mat.opacity = (1 - p) * 0.95;
    }

    ctx2d.clearRect(0, 0, width, height);
    ctx2d.textAlign = 'center';
    for (const p of this.popups) {
      if (!p.active) continue;
      p.age += rawDt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      p.vy -= 14.5 * rawDt;
      p.x += p.vx * rawDt;
      p.y += p.vy * rawDt;
      p.z += p.vz * rawDt;

      this.projVec.set(p.x, p.y, p.z).project(camera);
      if (this.projVec.z > 1) continue;
      const sx = (this.projVec.x * 0.5 + 0.5) * width;
      const sy = (-this.projVec.y * 0.5 + 0.5) * height;
      const norm = p.age / p.life;
      const alpha = Math.min(1, (1 - norm) * 1.6);
      const popScale =
        norm < 0.22 ? 0.65 + 0.55 * easeOutBack(norm / 0.22) : 1.0 - (norm - 0.22) * 0.15;
      const pxSize = Math.round((p.crit ? 20 : 14) * popScale);

      ctx2d.globalAlpha = alpha;
      ctx2d.font = `${p.crit ? 900 : 700} ${pxSize}px "Segoe UI", sans-serif`;
      ctx2d.strokeStyle = 'rgba(0,0,0,0.88)';
      ctx2d.lineWidth = 3.2;
      ctx2d.strokeText(p.value, sx, sy);
      ctx2d.fillStyle = p.color;
      ctx2d.fillText(p.value, sx, sy);
    }
    ctx2d.globalAlpha = 1;
  }
}
