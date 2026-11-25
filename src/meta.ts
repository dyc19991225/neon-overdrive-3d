import { WEAPONS, type WeaponId } from './config';

// Versioned Persistent Save System (save-systems skill: integer version, .bak rotation, migrations)
export const SAVE_VERSION = 1;
const SAVE_KEY = 'neon_overdrive_save';
const BACKUP_KEY = 'neon_overdrive_save.bak';

export type HangarUpgradeId =
  | 'hull'
  | 'overcharge'
  | 'thrusters'
  | 'siphon'
  | 'tactical'
  | 'phoenix';

export interface HangarUpgradeDef {
  id: HangarUpgradeId;
  hotkey: string;
  name: string;
  maxLv: number;
  baseCost: number;
  costStep: number;
  shortBonus: string;
}

export const HANGAR_UPGRADES: HangarUpgradeDef[] = [
  {
    id: 'hull',
    hotkey: '4',
    name: '复合装甲镀层',
    maxLv: 5,
    baseCost: 25,
    costStep: 20,
    shortBonus: '+15 初始HP/级',
  },
  {
    id: 'overcharge',
    hotkey: '5',
    name: '超导火控核心',
    maxLv: 5,
    baseCost: 30,
    costStep: 25,
    shortBonus: '+6% 全局伤害/级',
  },
  {
    id: 'thrusters',
    hotkey: '6',
    name: '矢量推进喷口',
    maxLv: 5,
    baseCost: 25,
    costStep: 20,
    shortBonus: '+4% 初始移速/级',
  },
  {
    id: 'siphon',
    hotkey: '7',
    name: '广域磁吸阵列',
    maxLv: 4,
    baseCost: 25,
    costStep: 20,
    shortBonus: '+18% 磁吸范围/级',
  },
  {
    id: 'tactical',
    hotkey: '8',
    name: '战术重随芯片',
    maxLv: 3,
    baseCost: 35,
    costStep: 30,
    shortBonus: '+1 重随次数/级',
  },
  {
    id: 'phoenix',
    hotkey: '9',
    name: '涅槃协议核心',
    maxLv: 1,
    baseCost: 100,
    costStep: 0,
    shortBonus: '致命伤满能复活1次',
  },
];

export interface MetaSaveData {
  version: number;
  cores: number;
  totalRuns: number;
  totalKills: number;
  bestSurvivalSec: number;
  bgmVolume: number;
  sfxVolume: number;
  upgrades: Record<HangarUpgradeId, number>;
}

const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // Future v1 -> v2 schema migrations plug in here sequentially
};

function defaultSave(): MetaSaveData {
  return {
    version: SAVE_VERSION,
    cores: 60, // Starter grant so players can test Hangar customization immediately
    totalRuns: 0,
    totalKills: 0,
    bestSurvivalSec: 0,
    bgmVolume: 0.65,
    sfxVolume: 0.85,
    upgrades: {
      hull: 0,
      overcharge: 0,
      thrusters: 0,
      siphon: 0,
      tactical: 0,
      phoenix: 0,
    },
  };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeSave(rawObj: unknown): MetaSaveData | null {
  if (!rawObj || typeof rawObj !== 'object') return null;
  let data = { ...(rawObj as Record<string, unknown>) };
  let ver = typeof data.version === 'number' ? Math.floor(data.version) : 0;
  if (ver <= 0 || ver > SAVE_VERSION) return null;

  while (ver < SAVE_VERSION) {
    const step = MIGRATIONS[ver];
    if (!step) return null;
    data = step(data);
    ver = typeof data.version === 'number' ? Math.floor(data.version) : ver + 1;
  }

  const base = defaultSave();
  const rawUpg =
    data.upgrades && typeof data.upgrades === 'object'
      ? (data.upgrades as Record<string, unknown>)
      : {};
  const upgrades = { ...base.upgrades };
  for (const def of HANGAR_UPGRADES) {
    upgrades[def.id] = Math.floor(clampNum(rawUpg[def.id], 0, def.maxLv, 0));
  }

  return {
    version: SAVE_VERSION,
    cores: Math.floor(clampNum(data.cores, 0, 9999999, base.cores)),
    totalRuns: Math.floor(clampNum(data.totalRuns, 0, 999999, 0)),
    totalKills: Math.floor(clampNum(data.totalKills, 0, 99999999, 0)),
    bestSurvivalSec: Math.floor(clampNum(data.bestSurvivalSec, 0, 99999, 0)),
    bgmVolume: clampNum(data.bgmVolume, 0, 1, base.bgmVolume),
    sfxVolume: clampNum(data.sfxVolume, 0, 1, base.sfxVolume),
    upgrades,
  };
}

export function loadMetaSave(): MetaSaveData {
  try {
    const primaryRaw = window.localStorage.getItem(SAVE_KEY);
    if (primaryRaw) {
      const parsed = sanitizeSave(JSON.parse(primaryRaw));
      if (parsed) return parsed;
    }
  } catch {
    // Primary corrupted or unreadable; fall back to .bak
  }

  try {
    const backupRaw = window.localStorage.getItem(BACKUP_KEY);
    if (backupRaw) {
      const parsed = sanitizeSave(JSON.parse(backupRaw));
      if (parsed) {
        saveMetaSave(parsed);
        return parsed;
      }
    }
  } catch {
    // Both missing/corrupt; initialize clean default
  }

  const fresh = defaultSave();
  saveMetaSave(fresh);
  return fresh;
}

export function saveMetaSave(data: MetaSaveData): void {
  try {
    const prev = window.localStorage.getItem(SAVE_KEY);
    if (prev) {
      // Only rotate valid JSON into .bak so we never overwrite good backup with garbage
      try {
        if (sanitizeSave(JSON.parse(prev))) {
          window.localStorage.setItem(BACKUP_KEY, prev);
        }
      } catch {
        // Ignore invalid previous primary
      }
    }
    const payload = JSON.stringify({ ...data, version: SAVE_VERSION });
    window.localStorage.setItem(SAVE_KEY, payload);
  } catch {
    // Ignore storage quota / private-mode restrictions gracefully
  }
}

export function getUpgradeCost(def: HangarUpgradeDef, currentLv: number): number {
  return def.baseCost + currentLv * def.costStep;
}

export function getTotalRefundCores(save: MetaSaveData): number {
  let refund = 0;
  for (const def of HANGAR_UPGRADES) {
    const lv = save.upgrades[def.id] || 0;
    for (let i = 0; i < lv; i++) {
      refund += getUpgradeCost(def, i);
    }
  }
  return refund;
}

export function computeRunRewardCores(
  kills: number,
  runTimeSec: number,
  bossesDefeated: number,
  victory: boolean
): number {
  const fromKills = Math.floor(kills * 0.25);
  const fromTime = Math.floor((runTimeSec / 60) * 14);
  const fromBoss = bossesDefeated * 45;
  const clearBonus = victory ? 120 : 0;
  return Math.max(runTimeSec >= 8 ? 12 : 4, fromKills + fromTime + fromBoss + clearBonus);
}

// =========================================================================
// Per-Weapon Damage & DPS Breakdown Tracker (P1.2)
// =========================================================================
export interface WeaponDpsRow {
  id: WeaponId;
  name: string;
  icon: string;
  isHyper: boolean;
  totalDamage: number;
  sharePct: number;
  dps: number;
}

export class WeaponDpsTracker {
  private totals: Partial<Record<WeaponId, number>> = {};
  private acquiredAt: Partial<Record<WeaponId, number>> = {};
  private hyperFlags: Partial<Record<WeaponId, boolean>> = {};

  public reset(startWeapon: WeaponId): void {
    this.totals = { [startWeapon]: 0 };
    this.acquiredAt = { [startWeapon]: 0 };
    this.hyperFlags = {};
  }

  public onAcquire(id: WeaponId, runTime: number): void {
    if (this.acquiredAt[id] === undefined) {
      this.acquiredAt[id] = runTime;
      this.totals[id] = this.totals[id] || 0;
    }
  }

  public onHyper(id: WeaponId): void {
    this.hyperFlags[id] = true;
  }

  public record(id: WeaponId | undefined, amount: number, runTime: number): void {
    if (!id || amount <= 0) return;
    if (this.acquiredAt[id] === undefined) {
      this.acquiredAt[id] = runTime;
    }
    this.totals[id] = (this.totals[id] || 0) + amount;
  }

  public buildBreakdown(runTime: number): WeaponDpsRow[] {
    const ids = Object.keys(this.acquiredAt) as WeaponId[];
    let grandTotal = 0;
    for (const id of ids) {
      grandTotal += this.totals[id] || 0;
    }

    const rows: WeaponDpsRow[] = ids.map((id) => {
      const def = WEAPONS[id];
      const isHyper = !!this.hyperFlags[id];
      const dmg = Math.round(this.totals[id] || 0);
      const activeDur = Math.max(3, runTime - (this.acquiredAt[id] || 0));
      return {
        id,
        name: isHyper ? def.hyperName : def.name,
        icon: isHyper ? def.hyperImg : def.iconImg,
        isHyper,
        totalDamage: dmg,
        sharePct: grandTotal > 0 ? (dmg / grandTotal) * 100 : 0,
        dps: Math.round(dmg / activeDur),
      };
    });

    rows.sort((a, b) => b.totalDamage - a.totalDamage);
    return rows;
  }
}
