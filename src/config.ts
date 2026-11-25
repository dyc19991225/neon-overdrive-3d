export type WeaponId = 'kunai' | 'saw' | 'arc' | 'laser' | 'gravity' | 'orbital';
export type PassiveId =
  | 'cooler'
  | 'amp'
  | 'splitter'
  | 'capacitor'
  | 'magnet'
  | 'thruster'
  | 'armor';
export type MechId = 'striker' | 'aegis' | 'nexus';
export type StageId = 'ruins' | 'foundry' | 'cryo';

export interface StageDef {
  id: StageId;
  name: string;
  badge: string;
  iconImg: string;
  coreMult: number;
  enemyHpMult: number;
  enemySpdMult: number;
  bgHex: number;
  fogHex: number;
  floorTintHex: number;
  floorEmissiveHex: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  sunHex: number;
  hazardDesc: string;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  hyperName: string;
  iconImg: string;
  hyperImg: string;
  pairPassive: PassiveId;
  color: number;
  hyperColor: number;
  baseDamage: number;
  hyperDamage: number;
  baseCooldown: number;
  hyperCooldown: number;
  baseCount: number;
  desc: string;
  hyperDesc: string;
}

export interface PassiveDef {
  id: PassiveId;
  name: string;
  iconImg: string;
  maxLv: number;
  pairWeapon?: WeaponId;
  desc: string;
}

export interface MechDef {
  id: MechId;
  name: string;
  role: string;
  portraitImg: string;
  startWeapon: WeaponId;
  overdriveName: string;
  overdriveDesc: string;
  hp: number;
  armor: number;
  speed: number;
  critBonus: number;
  dashCdMult: number;
  areaBonus: number;
  extraProj: number;
  dmgMult: number;
  xpMult: number;
  color: number;
  desc: string;
}

export const STAGES: StageDef[] = [
  {
    id: 'ruins',
    name: '霓虹废墟 · 第零区',
    badge: '标准战区 · 1.0x 💎',
    iconImg: './ui/stage_ruins.png',
    coreMult: 1.0,
    enemyHpMult: 1.0,
    enemySpdMult: 1.0,
    bgHex: 0x050814,
    fogHex: 0x050814,
    floorTintHex: 0xffffff,
    floorEmissiveHex: 0x38bdf8,
    hemiSkyHex: 0x7dd3fc,
    hemiGroundHex: 0x1e1b4b,
    sunHex: 0xffffff,
    hazardDesc: '高爆等离子桶链 · 周期空投【战术骇入信标】驻守开箱',
  },
  {
    id: 'foundry',
    name: '熔芯铸造厂 · 炼狱炉',
    badge: '地热喷发 · 1.35x 💎',
    iconImg: './ui/stage_foundry.png',
    coreMult: 1.35,
    enemyHpMult: 1.2,
    enemySpdMult: 1.06,
    bgHex: 0x160604,
    fogHex: 0x1a0704,
    floorTintHex: 0xffbfa3,
    floorEmissiveHex: 0xff5500,
    hemiSkyHex: 0xfdba74,
    hemiGroundHex: 0x3b0a06,
    sunHex: 0xffedd5,
    hazardDesc: '周期喷发【地热熔岩火柱】敌我不分，诱敌入火海瞬间融化！',
  },
  {
    id: 'cryo',
    name: '极寒量子中枢 · 零度核',
    badge: '高压超算 · 1.75x 💎',
    iconImg: './ui/stage_cryo.png',
    coreMult: 1.75,
    enemyHpMult: 1.42,
    enemySpdMult: 1.14,
    bgHex: 0x030d1c,
    fogHex: 0x041022,
    floorTintHex: 0xdbeafe,
    floorEmissiveHex: 0x67e8f9,
    hemiSkyHex: 0xa5f3fc,
    hemiGroundHex: 0x0f172a,
    sunHex: 0xe0f2fe,
    hazardDesc: '高难敌群提速 + 量子塔释放【极寒超导冰环】冻结敌群 55% 移速！',
  },
];

export interface DailyChallengeSpec {
  dateKey: string;
  seed: number;
  stageIdx: number;
  mechIdx: number;
  modifierTitle: string;
  bonusCores: number;
}

export function getDailyChallengeSpec(): DailyChallengeSpec {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const dateKey = `${yyyy}-${mm}-${dd}`;

  // Fixed FNV-1a 32-bit hash (roguelike skill: never use non-deterministic runtime hash)
  let h = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  const modifiers = ['狙击矩阵超频', '超导暴击狂潮', '重装机神压境'];
  return {
    dateKey,
    seed: u,
    stageIdx: u % STAGES.length,
    mechIdx: (u >>> 3) % 3,
    modifierTitle: modifiers[(u >>> 6) % modifiers.length],
    bonusCores: 90,
  };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  kunai: {
    id: 'kunai',
    name: '等离子脉冲刃',
    hyperName: '★ 幻影暴雨',
    iconImg: './ui/wpn_kunai.png',
    hyperImg: './ui/wpn_kunai_hyper.png',
    pairPassive: 'cooler',
    color: 0x22d3ee,
    hyperColor: 0x67e8f9,
    baseDamage: 20,
    hyperDamage: 36,
    baseCooldown: 0.62,
    hyperCooldown: 0.12,
    baseCount: 1,
    desc: '自动锁定最近敌机发射高穿透青色实体脉冲飞刃。每级提升伤害、数量或穿透。',
    hyperDesc: '取消装填！化作双螺旋青金光刃洪流倾泻，命中额外分裂次级折射飞刃！',
  },
  saw: {
    id: 'saw',
    name: '磁浮切割环',
    hyperName: '★ 绝对领域·日冕',
    iconImg: './ui/wpn_saw.png',
    hyperImg: './ui/wpn_saw_hyper.png',
    pairPassive: 'amp',
    color: 0xf43f5e,
    hyperColor: 0xfbbf24,
    baseDamage: 16,
    hyperDamage: 32,
    baseCooldown: 0.22,
    hyperCooldown: 0.14,
    baseCount: 2,
    desc: '机身周围高速旋转的八齿等离子圆锯，切割并强力击退贴脸机械群。',
    hyperDesc: '内外双层共 8 枚巨型日冕锯轮反向永动，形成无法近身的绞肉力场！',
  },
  arc: {
    id: 'arc',
    name: '特斯拉电弧炮',
    hyperName: '★ 雷神矩阵',
    iconImg: './ui/wpn_arc.png',
    hyperImg: './ui/wpn_arc_hyper.png',
    pairPassive: 'splitter',
    color: 0xa855f7,
    hyperColor: 0xe879f9,
    baseDamage: 24,
    hyperDamage: 52,
    baseCooldown: 1.28,
    hyperCooldown: 0.78,
    baseCount: 1,
    desc: '劈出高压闪电链在密集敌群间连续弹跳传导。',
    hyperDesc: '齐射苍白雷柱，弹跳上限飙升至 16 次，电毙目标原地引爆感电磁暴圈！',
  },
  laser: {
    id: 'laser',
    name: '高能激光横扫',
    hyperName: '★ 歼星棱镜',
    iconImg: './ui/wpn_laser.png',
    hyperImg: './ui/wpn_laser_hyper.png',
    pairPassive: 'capacitor',
    color: 0x38bdf8,
    hyperColor: 0xfde047,
    baseDamage: 38,
    hyperDamage: 64,
    baseCooldown: 2.2,
    hyperCooldown: 1.75,
    baseCount: 1,
    desc: '沿你的【移动朝向】扇形横扫宽幅流动电浆光束，走位转向即可指哪扫哪！',
    hyperDesc: '展开 360° 四向旋转虹光歼星十字斩，光束扫过之处爆发持续电浆震荡！',
  },
  gravity: {
    id: 'gravity',
    name: '纳米引力阱',
    hyperName: '★ 黑洞奇点',
    iconImg: './ui/wpn_gravity.png',
    hyperImg: './ui/wpn_gravity_hyper.png',
    pairPassive: 'magnet',
    color: 0xc084fc,
    hyperColor: 0xf472b6,
    baseDamage: 15,
    hyperDamage: 34,
    baseCooldown: 2.85,
    hyperCooldown: 2.05,
    baseCount: 1,
    desc: '向密集敌群投掷纳米引力奇点，强力牵引聚拢周围敌机并持续腐蚀，结束时坍缩爆破。',
    hyperDesc: '生成吞噬全场的超级黑洞视界！巨型漩涡死死锁住怪潮并引爆毁灭级奇点坍缩！',
  },
  orbital: {
    id: 'orbital',
    name: '轨道离子迫击',
    hyperName: '★ 天基审判',
    iconImg: './ui/wpn_orbital.png',
    hyperImg: './ui/wpn_orbital_hyper.png',
    pairPassive: 'thruster',
    color: 0xfbbf24,
    hyperColor: 0xfef08a,
    baseDamage: 68,
    hyperDamage: 145,
    baseCooldown: 2.4,
    hyperCooldown: 1.5,
    baseCount: 1,
    desc: '自动锁定高密度敌群绘制地面战术光圈，短暂充能后降下高伤轨道离子光柱轰炸。',
    hyperDesc: '天基卫星矩阵全功率齐射！连续锁定敌群降下多道贯穿天地的金色审判光柱与重型震荡波！',
  },
};

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  cooler: {
    id: 'cooler',
    name: '超频冷却器',
    iconImg: './ui/chip_cooler.png',
    maxLv: 5,
    pairWeapon: 'kunai',
    desc: '所有武器冷却时间缩短 -9%/级（配对进化：等离子脉冲刃 → ★幻影暴雨）',
  },
  amp: {
    id: 'amp',
    name: '引力增幅器',
    iconImg: './ui/chip_amp.png',
    maxLv: 5,
    pairWeapon: 'saw',
    desc: '攻击与爆炸覆盖范围 +14%/级（配对进化：磁浮切割环 → ★绝对领域·日冕）',
  },
  splitter: {
    id: 'splitter',
    name: '多核分裂器',
    iconImg: './ui/chip_splitter.png',
    maxLv: 3,
    pairWeapon: 'arc',
    desc: '所有武器投射物与光轮数量 +1/级（配对进化：特斯拉电弧炮 → ★雷神矩阵）',
  },
  capacitor: {
    id: 'capacitor',
    name: '高压电容',
    iconImg: './ui/chip_capacitor.png',
    maxLv: 5,
    pairWeapon: 'laser',
    desc: '全局基础伤害 +14%/级（配对进化：高能激光横扫 → ★歼星棱镜）',
  },
  magnet: {
    id: 'magnet',
    name: '纳米虹吸器',
    iconImg: './ui/chip_magnet.png',
    maxLv: 5,
    pairWeapon: 'gravity',
    desc: '数据晶体磁吸拾取半径 +30%/级，移速 +4%/级（配对进化：纳米引力阱 → ★黑洞奇点）',
  },
  thruster: {
    id: 'thruster',
    name: '狂暴推进器',
    iconImg: './ui/chip_thruster.png',
    maxLv: 5,
    pairWeapon: 'orbital',
    desc: '弹道速度与奇点持续时间 +15%/级，冲刺冷却 -5%/级（配对进化：轨道离子迫击 → ★天基审判）',
  },
  armor: {
    id: 'armor',
    name: '泰坦反应装甲',
    iconImg: './ui/chip_armor.png',
    maxLv: 5,
    desc: '最大生命 +25/级（同步回血），护甲 +6/级',
  },
};

export const MECHS: MechDef[] = [
  {
    id: 'striker',
    name: '零式·疾风 (STRIKER-0)',
    role: '高速游走 · 暴击刀波',
    portraitImg: './ui/mech_striker.png',
    startWeapon: 'kunai',
    overdriveName: '次元千本樱',
    overdriveDesc: '16 道穿透新月光刃环形风暴 + 2.2s 无敌超频',
    hp: 110,
    armor: 4,
    speed: 8.2,
    critBonus: 0.15,
    dashCdMult: 0.7,
    areaBonus: 0,
    extraProj: 0,
    dmgMult: 1.0,
    xpMult: 1.0,
    color: 0x22d3ee,
    desc: '暴击 +15%，冲刺冷却 -30%。超载必杀【次元千本樱】环形斩裂全屏敌群！',
  },
  {
    id: 'aegis',
    name: '泰坦·磁暴 (AEGIS-IV)',
    role: '重装碾压 · 战损狂暴',
    portraitImg: './ui/mech_aegis.png',
    startWeapon: 'saw',
    overdriveName: '地核崩裂炮',
    overdriveDesc: '全屏熔金核爆震荡清场 + 立即修复 35% 装甲',
    hp: 165,
    armor: 20,
    speed: 6.8,
    critBonus: 0.05,
    dashCdMult: 1.0,
    areaBonus: 0.22,
    extraProj: 0,
    dmgMult: 1.08,
    xpMult: 1.0,
    color: 0xf43f5e,
    desc: '高血高甲、范围 +22%，战损增伤。超载必杀【地核崩裂炮】全屏核爆并回血！',
  },
  {
    id: 'nexus',
    name: '蜂巢·矩阵 (NEXUS-9)',
    role: '弹幕倾泻 · 极速发育',
    portraitImg: './ui/mech_nexus.png',
    startWeapon: 'arc',
    overdriveName: '天穹浮游齐射',
    overdriveDesc: '12 道天基审判光柱锁敌轰顶 + 全图晶体真空磁吸',
    hp: 100,
    armor: 2,
    speed: 7.5,
    critBonus: 0.08,
    dashCdMult: 0.9,
    areaBonus: 0.05,
    extraProj: 1,
    dmgMult: 0.92,
    xpMult: 1.2,
    color: 0xa855f7,
    desc: '投射物 +1、经验 +20%。超载必杀【天穹浮游齐射】天降雷柱并吸空全图晶体！',
  },
];

export function xpForNextLevel(level: number): number {
  return Math.round(8 + 6 * (level - 1) + 1.35 * Math.pow(level - 1, 1.62));
}
