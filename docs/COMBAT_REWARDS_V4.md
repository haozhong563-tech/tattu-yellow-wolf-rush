# V4 · 塔塔参战与自动支援奖励

本轮把底部道具库存栏改为塔塔角色展示区。玩家通过引爆棋盘内的特殊核心获得支援，支援自动锁定目标并执行；底部展示区不再提供免费道具按钮。关卡仍为 8 × 9 棋盘、30 步，目标是收集 18 个黄色塔塔、18 个青色塔塔及击碎 18 块冰层。

当前文档记录本地实现与测试状态。公网发布及最终浏览器验收尚待补充，不能由这份说明推断线上已更新。

## 玩家如何触发

开局棋盘包含两个可直接体验的特殊核心：索引 `12` 的横向闪电（第 2 行第 5 列），以及索引 `51` 的爆炸核心（第 7 行第 4 列）。索引从 0 开始。点选核心后再点同一核心，消耗 1 步即可直接引爆；也可通过交换、连消或其他特效波及引爆。

特殊核心必须真正激活并被消除才发放支援。普通三连及刚刚生成但尚未引爆的核心不发奖励；同一个棋子被多条电弧重复命中，也只计一次。

| 实际引爆的核心 | 自动获得 | 当前攻击与强化规则 |
| --- | --- | --- |
| 横向／纵向闪电 | 雷霆重锤 `hammer` | 优先锁定冰层。奖励计数 1／2／3 时，分别精确打击 2／3／4 个不同格子。 |
| 爆炸核心 | 蜂群轰炸 `drone` | 自动选择冰层覆盖率高的 3 × 3 区域。计数 1 时轰炸 1 个区域；计数 2／3 时轰炸 2 个区域，并优先避免重复覆盖。 |
| 彩虹核心 | 时空裂隙 `rift` | 先播放并执行棋盘重排，再以优先覆盖冰层的中心清除完整十字。当前所有强化计数均为一次重排加一次十字清除。 |
| 玩家消除积满能量 | 塔塔觉醒 `overdrive` | 当前回合及支援结算后自动启动 15 秒点击即爆，无需点击底部按钮，觉醒点击不消耗步数。 |

同一批待结算奖励按类型合并，单类型计数上限为 3。支援攻击可以引爆棋盘中已有核心并正常计分、收集目标，但不会继续产生免费支援或给觉醒反复充能，避免奖励无限自触发。`rewardStats` 记录已经执行的合并奖励计数，不等于击中格数或爆炸次数。

## 角色、动画与命中反馈

新增 `public/v3/tata-ultimate-poses.png` 三姿态角色图集。`prepareUltimateTextures(scene)` 在运行时提取三个区域，移除亮绿色背景，并保留每个区域最大的连通角色轮廓，生成 `ultimate-0`、`ultimate-1`、`ultimate-2` 三张 384 × 640 透明纹理；原始图集保持不变。更换图集时须同步核对裁切区域及连通区域提取效果。

`HeroCinematic.play(type, count)` 把三种姿态用于预备、跃起蓄力与落击，并配合斜切入场面板、角色缩放位移、光环转动、放射线、技能名称及短促镜头震动。完整动作约 0.94 秒；「舒适动效」使用简化姿态与短淡出。这里是三姿态纹理加 Phaser 补间的角色演出，没有宣称使用连续骨骼动画或预渲染影片。

重锤、无人机和裂隙具有独立攻击路线。命中反馈由蓄力、飞行／挥击、接触瞬间爆闪、冲击环、碎片、电弧、烟尘与音效共同完成；视觉命中回调触发音频重击。主要流程是：

1. 玩家引爆特殊核心，播放一次塔塔切入演出及核心爆发，完成交换、连锁和下落。
2. 按已消除核心计算支援，依次自动选目标、播放支援攻击并结算棋盘。
3. 支援全部处理后先判断胜利；若尚未达标且能量满格，则自动觉醒；其余情况再判断步数耗尽。
4. 觉醒期间获得的支援先排队，15 秒结束并完成正在进行的消除后再执行，避免连续点击被演出反复打断。

单个玩家回合限制完整角色切入的重复播放，后续支援仍保留攻击效果。暂停会冻结场景演出和音频；重新开始通过 `runId` 使旧回合回调失效，避免旧下落或旧演出写回新棋盘。

## 音频

继续保留 10 段原创程序化电子编曲，每段 15 秒，128–174 BPM：雷霆起跑、霓虹追猎、晶能脉冲、超载重击、FPV 穿云、午夜电路、黄金燃点、星环跃迁、裂空极速、塔塔觉醒。它们是运行时合成的编曲，不是已采购或已授权的商业歌曲录音。

新增 `GameAudio` 接口：

| API | 使用时刻与返回值 |
| --- | --- |
| `cinematic(type)` | 获得支援／角色展示时播放短旋律，返回建议时长 `0.8` 秒。 |
| `rewardCharge(type)` | 攻击预备时播放低频抬升与风声；重锤／无人机／裂隙／觉醒分别返回 `0.46`／`0.68`／`0.58`／`0.72` 秒，供视觉时间设计参考。 |
| `rewardImpact(type, power = 1)` | 由视觉实际命中回调触发。强度限制为 `0.5–1.6`；包含对应金属裂响、立体声错峰轰炸、电弧低频下坠或觉醒重击。 |

类型为 `hammer`、`drone`、`rift`、`overdrive`；兼容 `bomb → drone`、`shuffle / nova → rift`、`rush → overdrive`。视觉模块以实际接触时刻触发重击，接口返回的预备时长不会自行安排震动。

音频需首次用户操作解锁。展示、蓄力和音乐启动／试听不触发新增重击震动；真正的 `rewardImpact()` 才触发对应的限频震动。设置允许分别关闭声音和震动。手机是否实际震动由硬件和浏览器支持决定，网页震动不等同于主机手柄的精细触觉反馈。

音频包含声部上限、单声部幅度限制、压缩与最终软峰值限制，并在重击时短暂压低音乐；暂停、重开和销毁清理相关音源及调度。

## 代码入口与验证

当前仍使用 Phaser 3.90.0。`play.html → game/main.mjs → game/scene.mjs` 是新游戏入口；`game/model.mjs` 处理三消快照，新增 `game/rewards.mjs` 的 `planRewards()` 和 `buildRewardTurn()` 处理奖励归属与自动选点，`game/cinematic.mjs` 处理三姿态演出，`game/effects.mjs` 的 `windup()`／`rewardAttack()` 处理攻击表现。旧 `app/` 工程与先前交付文档保留；涉及玩法冲突时以本 V4 说明及当前代码为准。

本轮自动测试报告为 38 项通过，包括 1000 个固定随机种子回合、150 次奖励执行、各类特殊组合、奖励去重与防递归、奖励先于胜负结算、末步满能量觉醒、觉醒结束时队列处理、暂停以及重开时旧回调失效。音频另有语法和模拟 AudioContext 检查，覆盖十段音乐、奖励 API、声部上限、静音／震动独立性及生命周期清理。

这些测试验证规则和状态衔接，不替代实际视觉、听感与触摸验收。本地浏览器已真实点击并看到塔塔切入、重锤落地和蜂群奖励，实测演出中暂停后数值保持不变、恢复后正常结算；觉醒期连续点击 32 次，步数保持 15 步，目标和得分正常增长，期间两类奖励进入队列。最终构建、公网与结算结果在下文发布验收中记录。未使用手机硬件验证震动，也未把程序化音乐接口检查等同于完整听感审听。

## 演出方向参考与完成边界

主流程已阅读下列官方介绍文章，参考的是其中描述与展示的战斗、粒子、空间切换及角色大招表现。没有把完整官方视频逐帧观看或完整音轨试听列为本轮已经完成的研究：

- [Returnal 官方介绍](https://www.playstation.com/en-us/editorial/everything-you-need-to-know-about-returnal/)：借鉴粒子与明亮弹道的层次、攻击反馈的音画配合；本作将其转化为棋盘局部电弧、冲击环和短促重击。
- [Ratchet & Clank: Rift Apart 官方技术介绍](https://www.playstation.com/en-gb/editorial/how-ps5-helped-make-ratchet-and-clank-rift-apart-possible/)：作为裂隙、空间切换与迅速进出画面的演出方向参考；本作实现为二维裂隙表现和可见的棋盘重排。
- [Final Fantasy XVI State of Play 官方介绍](https://blog.playstation.com/2023/04/13/state-of-play-debuts-25-minutes-of-all-new-final-fantasy-xvi-gameplay/)：借鉴角色力量展示与大型技能的演出节奏；本作实现为塔塔三姿态切入、蓄力和命中后的回场。

上述主机作品是演出方向与品质对标，不能将阅读介绍或实现若干相似反馈手段称为已经达到它们的 AAA 美术、实时渲染、角色动画、空间音频或主机触觉水准。本轮可核验的交付是自动支援玩法、三姿态塔塔演出和增强的二维命中反馈；最终观感以实际运行版本验收。

## 角色资产生成记录

本地最终回归：觉醒期 32 次真实点击后恢复暂停，待排队支援结算完成，页面显示三星通关，39,720 分，剩余 15 步，冰层 0，待奖励 0；页面错误／警告日志为空。另在大招切入中暂停并确认重开，新局恢复 30 步、0 分、18 冰层、0 奖励，旧动画标识全部清空，重新开始可正常操作。375 × 812 浏览器视口下页面宽度为 375，无横向溢出，棋盘外仅保留顶部暂停和帮助两个控制按钮。该视口测试不等于物理手机触控或震动实测。

最终图集：`public/v3/tata-ultimate-poses.png`（1536 × 1024）。以项目已有 `yellow-wolf-runner.png` 为形象参考生成，经目视检查后以原图副本入库，保留原参考和原始生成图。实际三姿态裁切以 `game/cinematic.mjs` 中的区域为准。以下为完整生成提示词：

```text
Use case: stylized-concept. Asset type: production sprite sheet for the existing TATTU TATA wolf match-3 game, three character attack key poses for a cinematic ultimate attack. Reference image is identity reference only: preserve this SAME yellow anthropomorphic wolf, white muzzle, black lightning brow markings, amber eyes, black goggles on forehead, black-and-yellow racing suit and boots, black tipped yellow tail. Make ONE landscape 1536x1024 sprite atlas laid out in EXACTLY THREE equal columns, one isolated full-body character centered inside each 512x1024 column with at least 45px clear margins. LEFT: crouched winding up, clenched fist drawn back, determined face and flexed knees, chest facing three-quarter right. MIDDLE: explosive airborne leap, right fist lifted high, knees drawn, ears and tail dynamic, fierce joyful fighting expression. RIGHT: grounded finishing slam, strong low superhero three-point landing with one giant gloved fist struck down, other arm stretched behind, gaze forward. Same proportions and outfit in all three, one continuous consistent 3D stylized polished game character sculpt, strongly readable silhouette, beautiful fur, gold rim lighting and detailed gloves. Flat perfectly uniform bright chroma green #00ff00 background across entire atlas, NO ground shadows, NO floor, NO panels, NO borders, NO energy VFX or props beyond character, no motion blur, no text or labels, no additional characters. All body parts including tails and boots fully inside their own columns, do not overlap. This is original TATA artwork, not a character from any other franchise. Use the supplied original TATA as strong identity anchor; chibi heroic but not generic fox.
```
