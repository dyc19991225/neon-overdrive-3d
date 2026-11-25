# 霓虹超载：机甲幸存者 (NEON OVERDRIVE) — Game Design Document

**Version:** 0.4 · **Updated:** 2026-11-25 · [Features](#feature-index) · [Decisions](#decisions) · [Change log](#change-log)

## Summary
玩家驾驶一台孤军深入赛博废墟的实验型战斗机甲，在全屏涌来的失控机械虫群与重装卫队包围中高速走位、自动倾泻霓虹弹幕。击碎敌群爆出满地发光数据晶体，磁吸升阶并在全息三选一中凑齐「主武器 + 核心芯片」合成毁天灭地的超武（Hyper Weapon）。单局浓缩为高密度 **12 分钟** `[ASSUMPTION]`，击败第 12 分钟降临的泰坦核心即宣告破关，机身归零则本局终结并结算局外机库改装点。

| 项目 | 设定 |
|---|---|
| 类型与视角 | 3D 动作肉鸽割草（Horde Survivor）· 固定 52° 斜俯视等轴感相机 `[ASSUMPTION]` |
| 目标玩家 | 喜爱《吸血鬼幸存者》《Brotato》《深岩银河：幸存者》高爽感构筑与满屏弹幕解压的玩家 |
| 平台与操作 | 桌面端浏览器即开即玩（支持键鼠 WASD + Space 冲刺 / 手柄左摇杆单手畅玩） |
| 单局时长 | 12 分钟极速爽局 `[ASSUMPTION]`（前 3 分钟成型，6 分钟合成首把超武，12 分钟终局决战） |
| 技术引擎 | `three.js` r187（Vite + TypeScript）· `InstancedMesh` 同屏千怪 + `UnrealBloomPass` + 零素材 WebAudio 合成音效 |
| 项目规模 | M1 核心可玩原型 → M2 完整 6 超武与 3 机甲构筑正式版 |
| 参考标杆 | 《Vampire Survivors》（武器+被动 1:1 超武进化）、《Brotato》（紧凑节奏与鲜明机体短板）、《几何战争》（高对比霓虹粒子爆裂） |

## Pillars
1. **3 秒上手，走位即输出。** 所有主武器全自动索敌开火；玩家全部注意力集中在穿插怪缝、诱导包围圈与精准使用唯一主动键「相位冲刺（Dash）」，绝不引入繁琐的手动瞄准或搓招负担。
2. **肉眼可见的质变进化（1+1 > 5）。** 升级绝不只给平庸的 `+3% 伤害`；每一把满级武器合成超武后必须彻底改变弹道形态与清屏视觉（如单发电磁苦无进化为全屏无限折射等离子飞刃）。
3. **千怪同屏依然刀刀到肉、稳 60 帧。** 割草不等于轻飘飘的纸片碰撞：每次暴击与精英击杀必须触发双时钟微顿帧、发光白闪、碎块飞溅、旋转震屏与合成器和弦爆鸣，同时严守同屏 1,200 敌机 < 16.6 ms 的帧率红线。
4. **高对比霓虹可读性优先于复杂建模。** 深黑蓝网格地面衬托高饱和敌我色相（玩家青绿/金、普通怪暗紫、危险预警亮红、掉落晶体电光蓝/品红），一眼看清安全走位通道。

## Core loop
```text
穿插走位自动清怪 → 冲刺吸取满地能量晶体 → 升级三选一凑配对 → 击杀精英开箱合成超武 → 迎战更狂暴的包围波次与泰坦 Boss
```
- **秒级循环（Seconds）：** 驾驶机甲走位拉扯怪群，触发 [武器库与超武合成](features/weapons-evolution/design.md) 自动倾泻火力，穿过危险区吃晶体触发磁吸连锁。
- **分钟循环（Minutes）：** 按 [怪潮波次曲线](features/horde-waves/design.md) 每分钟切换敌军编队（蜂群 → 自爆/护盾 → 环形包围网），每 2 分钟刷出精英卫队长掉落超武进化宝箱，第 4 / 8 / 12 分钟迎战阶段 Boss。
- **单局与局外（Session）：** 依托 [机甲角色构筑](features/mech-builds/design.md) 组合 6 武器槽 + 6 芯片槽冲刺 12 分钟通关；阵亡或通关保留局外「超导核心」用于解锁新机甲与基础天赋（待 M3 实现）。

## Feature index

| Feature | Status | Scope | Summary | Docs |
|---|---|---|---|---|
| Weapons & evolution | designed | MVP | 6 把赛博自动武器 + 6 枚被动芯片与 6 组 1:1 超武进化配方表 | [design](features/weapons-evolution/design.md) |
| Horde waves | designed | MVP | 12 分钟四阶段怪潮曲线、环形包围事件、3 台阶段 Boss 与同屏千怪预算 | [design](features/horde-waves/design.md) |
| Mech builds | designed | MVP | 3 台差异化初始机甲、三层属性修改器栈、先推后吸经验磁铁与三选一卡池 | [design](features/mech-builds/design.md) |
| Combat movement | idea | MVP | 斜俯视阻尼移动、带桑德斯坦残影的无敌相位冲刺（Dash）与碰撞受击保护帧 | — |
| Neon juice & audio | idea | MVP | `rawDt`/`scaledDt` 双时钟顿帧、`Trauma²` 震屏、Bloom 辉光碎裂与零 MP3 合成器音效 | — |
| HUD & telegraphs | idea | MVP | 地面红色冲锋/自爆几何预警圈、顶部波次/经验条、实时 DPS 统计与全息升级面板 | — |
| Meta hangar | idea | later | 局外机库永久天赋树、机甲解锁条件与每日 UTC 固定种子挑战榜 | — |

## Milestones
1. **M1 — 核心割草爽感原型（Prototype Fast）：** 落地 1 台全能机甲 + 3 把代表性武器（电弧链、环绕光刃、轨道轰炸）及其超武合成 + 前 6 分钟怪潮与 1 台 Boss + 完整磁吸升级、顿帧震屏与合成音效 · **验收标准：** 浏览器打开 30 秒内零教程玩懂核心循环，同屏 800+ 敌机稳定 60 FPS，6 分钟内能体验到至少 1 次超武质变清屏。
2. **M2 — 完整构筑正式版：** 补齐全部 6 组超武合成、3 台差异化机甲、完整 12 分钟波次与 3 台 Boss、地面危险预警圈与结算伤害占比面板 · **验收标准：** 3 台机甲各自拥有截然不同的通关流派，12 分钟终局同屏 1,200 敌机 `p95 < 16.67 ms`。
3. **M3 — 局外耐玩度扩展：** 加入局外机库改造树、成就解锁与每日种子挑战。

## Direction
- **视觉（赛博霓虹机甲）：** 纯几何程序化硬表面机甲与敌群（无需外部 `.glb` 贴图资产），暗色金属底色搭配高发光（Emissive）能量边线与 `UnrealBloomPass` 泛光；地面为无限滚动的全息坐标暗格与脉冲扫描线。
- **打击感与音效（Game Feel）：** 普通小怪受击触发 `45 ms` 纯白发光闪烁与弹簧击退，不频繁顿帧以免割草卡手；超武暴击、破盾与 Boss 斩杀触发 `50–90 ms` 双时钟顿帧 + `Trauma²` 相机微震 + 多声部 WebAudio 电子打击合成音（带主总线动态压缩防爆音）。

## Decisions

| ID | Date | Decision | Alternatives considered | Why | Affects |
|---|---|---|---|---|---|
| D-001 | 2026-11-25 | 采用 `three.js` r187 + `InstancedMesh` + 零外部资产程序化几何与 WebAudio | Godot 4.7 原生客户端；带重型 GLB 模型资源的 Web 方案 | 浏览器秒开试玩迭代最快，且 `InstancedMesh` 单次 Draw Call 即可渲染上千霓虹几何敌机，彻底规避模型加载与材质切换瓶颈 | [horde-waves](features/horde-waves/design.md) |
| D-002 | 2026-11-25 | 单局目标时长敲定为 12 分钟 + 主武器 Lv8 配 Lv1 芯片开箱进化 | 20–30 分钟长局；被动芯片亦需升满 Lv5 | 用户确认保持 12 分钟极速局与低挫败感合成门槛，确保第 5–6 分钟必爽超武 | [horde-waves](features/horde-waves/design.md), [weapons-evolution](features/weapons-evolution/design.md) |
| D-003 | 2026-11-25 | 唯一主动操作键定为「相位冲刺（Space）」，纯单手键盘全自动索敌 | 鼠标按住混合瞄准；双摇杆手动射击 | 用户确认采用纯单手键盘畅玩，激光横扫直接由机甲走位朝向引导，升级选卡支持 `[1][2][3]` | [mech-builds](features/mech-builds/design.md), [weapons-evolution](features/weapons-evolution/design.md) |
| D-004 | 2026-11-25 | M1 极速尝鲜版首发实装 4 把代表武器与 4 超武 + 3 台可选机甲 | 一次性全做 6 把武器 | 先以最快速度进浏览器实测割草手感与超武质变，纳米引力阱与轨道迫击留待 M2 扩展 | [weapons-evolution](features/weapons-evolution/design.md) |
| D-005 | 2026-11-25 | 按 P0→P1→P2 全量实装 6 超武、机甲脚下弧形血量/冲刺环、Boss 三连红毯预警、机库存档与 130 BPM 自适应电音 BGM | 仅维持 M1 四武器原型 | 一次性补齐正式版构筑深度、中心视野战斗可读性、Boss 极限闪避博弈与局外长线成长闭环 | [weapons-evolution](features/weapons-evolution/design.md), [horde-waves](features/horde-waves/design.md), [mech-builds](features/mech-builds/design.md) |

## Open questions
- **待试玩反馈确认：**
  1. **全 6 超武与多巴胺道具联动节奏：** 纳米引力阱聚怪配合轨道离子迫击 / 高能激光横扫的清屏爽感，以及打破等离子桶掉落【全屏磁铁 / 无限超载球】的爆率（`32%`）是否适中？
  2. **局外机库成长曲线：** 首局赠送 `60` 超导核心及单局核心掉落倍率是否需要调优？
- **技术风险与验证计划：** 已将全部范围伤害、闪电链、激光线段与自爆友伤全面迁移至 `gridHead`/`gridNext` 空间哈希邻域查询，并通过 Vite 分包隔离 `three-core` 与 `three-addons`。

## Change log
**0.4 (2026-11-25):** 实装三大 3D 灾害主题场景（霓虹废墟 / 熔芯铸造厂地热熔岩火柱 / 极寒量子中枢超导冰环）、地图战术信标占点骇入与狂猎挑战祭坛、3 台机甲专属 `[Q]`/触屏 `💥` 终极超载必杀技、第 5 类远程电浆狙击浮游炮敌机、每日 UTC 固定种子特遣挑战及完整移动端竖屏/横屏双主动触控适配。
**0.3 (2026-11-25):** 完成 P0→P1→P2 全量优化升级（记录 D-005）：补齐纳米引力阱/★黑洞奇点与轨道离子迫击/★天基审判共 6 套超武、3D 地面弧形血量/冲刺环与屏幕边缘追踪箭头、全屏磁铁与狂暴球掉落、Boss 三连地面红毯预警、结算武器 DPS 占比榜、带 `.bak` 备份链的机库存档、130 BPM 自适应电音 BGM 总线闪避及全空间哈希优化。
**0.2 (2026-11-25):** 确认 12 分钟局、纯键盘走位引导激光与 M1 四超武尝鲜范围（记录 D-004），完成 `three.js` r187 初版可玩原型落地。
**0.1 (2026-11-25):** 初版 GDD 起草，完成 [weapons-evolution](features/weapons-evolution/design.md)、[horde-waves](features/horde-waves/design.md)、[mech-builds](features/mech-builds/design.md) 三份核心数值设计并记录决策 D-001 至 D-003。
