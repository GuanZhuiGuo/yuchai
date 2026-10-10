---
name: 玉柴销售学习平台
description: 中文 H5 学员端的课程阅读、客户对话与证据复练界面
colors:
  primary: "#cf0b19"
  primary-deep: "#ac0713"
  ink: "#222421"
  muted: "#60675d"
  line: "#e6e7e2"
  paper: "#f6f6f2"
  soft: "#fcebee"
  success: "#24714e"
  caution: "#8d6518"
  white: "#ffffff"
  canvas: "#eae9e4"
  search-surface: "#eceedf"
  chat-background: "#f4f5f3"
  chat-ink: "#303b30"
  learner-surface: "#fcebed"
  learner-ink: "#4d2d31"
  input-surface: "#f8f9f6"
  weak-score: "#b88b3a"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "42px"
    fontWeight: 550
    lineHeight: 1.5
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "21px"
    fontWeight: 650
    lineHeight: 1.4
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.92
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.6
  action:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    fontWeight: 600
  score:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "60px"
    fontWeight: 550
    lineHeight: 1.1
    letterSpacing: "-0.04em"
rounded:
  progress: "4px"
  chip: "6px"
  filter: "8px"
  thumbnail: "10px"
  field: "11px"
  action: "12px"
  panel: "14px"
  container: "16px"
  dialog: "20px"
  frame: "28px"
spacing:
  tight: "8px"
  compact: "12px"
  standard: "16px"
  panel: "18px"
  page-inline: "22px"
  page-block: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    typography: "{typography.action}"
    rounded: "{rounded.action}"
    padding: "12px 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.white}"
    rounded: "{rounded.action}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.action}"
    padding: "12px 22px"
    height: "48px"
  button-subtle:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.primary}"
    typography: "{typography.action}"
    rounded: "{rounded.action}"
    padding: "12px 22px"
    height: "48px"
  input-search:
    backgroundColor: "{colors.search-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.field}"
    padding: "0 13px"
    height: "43px"
  chip-status:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "3px 8px"
  learning-panel:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.container}"
    padding: "18px"
  report-dimension:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.action}"
    padding: "15px 16px"
  course-media-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.thumbnail}"
    padding: "12px"
  chat-composer:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    padding: "10px 18px 15px"
  chat-input:
    backgroundColor: "{colors.input-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.filter}"
    padding: "11px"
  bottom-navigation:
    backgroundColor: "{colors.white}"
    typography: "{typography.label}"
    padding: "9px 8px 10px"
    height: "71px"
---

# Design System: 玉柴销售学习平台

## Overview

**Creative North Star: "工业培训任务单"**

界面采用玉柴红、石墨文字、暖白底和中文系统字体。首页以玉柴官方经销商参访照片呈现销售学习计划，课程以双列照片卡片组织，卡片同时显示视频、图文、自检和关联实战数量。阅读页保持白色正文区域，对话页采用浅色背景与文字输入框，客户实战按业务任务呈现，文字与语音属于同一实战的沟通方式。

手机呈现连续的学员界面；桌面在相同学员界面右侧显示“学方法、练实战、看见成长”汇报导航。视频、图文、自检、实战准备、客户对话、报告和复练沿用同一套标题、标签、进度条和操作样式。每门课程关联多个客户实战；OEM 默认文字输入，可主动选择语音；海外使用语音入口，文字标记待恢复。实战完成结果来自对应练习报告；75 分固定案例仅作报告阅读参考。

**Key Characteristics:**

- 玉柴品牌红用于主操作、当前状态和核心成绩。
- 中文正文以系统字体、较宽行距和短章节呈现。
- 课程以双列照片卡片组织，视频、图文和自检共用课程完成状态。
- 浅色对话页按场景显示可用输入通道和阻断状态，报告按总览、维度、细项、逐句点评与对话原文组织。
- 课程与实战是一对多关联，已发布和待配置任务分别标识。
- 学员报告、固定案例、合成语音与文字联调验证通过文字标签明确来源。

## Colors

主色负责品牌和行动，暖白与白色划分阅读层次，绿色和琥珀色表达状态。

### Primary

- **玉柴红**：主按钮、当前导航、知识要点及分数。
- **深玉柴红**：主按钮悬停状态。
- **浅红底**：示例或当前状态标签、选择态、次级强调按钮。

### Secondary

- **完成绿**：课程完成、准备就绪、合格说明及服务状态。
- **提示琥珀**：需关注的状态说明。
- **薄弱项金色**：未达到当前维度展示比例的进度条。

### Neutral

- **石墨文字**：主要标题、正文与操作文字。
- **灰绿辅助文字**：说明、课程摘要、时间与次级操作。
- **暖白页面**：学员页面背景。
- **纯白阅读面**：正文、学习准备、情景卡和报告容器。
- **淡灰分隔线**：卡片内信息、菜单、章节与固定导航边界。
- **暖灰桌面底**：桌面汇报画布。
- **浅灰对话底**：对话消息区域，客户消息使用白底与灰绿文字。
- **浅红学员消息**：学员消息使用浅红底与暗红文字，发送侧保留较小角。
- **浅色输入面**：多行文字作答区域。

**The Status Label Rule.** 状态颜色同时配有“已完成”“评估中”“文字待恢复”“示例报告”等文字；分数与数据来源分别呈现。

## Typography

**Display Font / Body Font:** 系统西文字体与 PingFang SC、Microsoft YaHei 中文回退，共用同一字体栈。

字体以普通和中等字重组织层级。正文优先移动阅读，数字成绩和进度使用等宽数字特性。

### Hierarchy

- **Display**：桌面汇报标题使用前置 display token；首页品牌学习计划标题为桌面框内 28px、手机 26px。
- **Headline**：通用小节标题使用 headline token；课程详情标题为桌面 23px、手机 22px，课件正文标题为 23px。
- **Title**：卡片标题和课程名称，双列课程卡片标题为 14px，行高为 1.65。
- **Body**：课件正文使用 body token；普通段落行高为 1.7，课程正文保持较宽行距。
- **Caption / Label**：摘要、课程形式、时间、来源与导航。辅助字号不用于承载长篇课程正文。
- **Score**：报告总分使用 score token，分母回到 15px；分数、计时和百分比采用 tabular-nums。

## Layout

桌面展示区最大宽度为 1040px，外侧横向内边距为 24px。两列分别为 460px 学员界面和自适应汇报导航，列距为 88px。学员框距离页面上下边缘各 32px，最小高度 680px、最大高度 1000px，并有自己的滚动区域。

宽度不超过 899px 时，汇报侧栏隐藏；学员界面最大宽度为 480px，取消外框圆角和阴影，转为自然页面滚动。常规内容区桌面框内为上下 24px、左右 22px，手机为上下 23px、左右 21px。宽度不超过 359px 时进一步收紧左右间距和标题字号。

页头高度为 68px。主导航采用四列，基础高度为 71px；手机导航固定在视口底部并计入安全区。阅读和对话页隐藏主导航；阅读页保留底部章节操作。页面主体为底部导航预留空间。

首页照片主视觉高为桌面 255px、手机 245px，圆角为 14px；照片上叠加从左至右的深色遮罩承载白色标题。课程卡片采用两列，列距 12px、行距 16px，封面高为桌面 108px、手机 105px；宽度不超过 359px 时卡片间距为 10px。实战卡片使用横向业务照片、角色、任务与状态组合。

课程详情以 16:9 原生视频播放器开头，下面排列视频进度、章节跳转、图文目录、自检和关联实战。章节和菜单采用一列分隔行。首页七阶段导航使用七等分列。报告维度纵向排列，展开后呈现证据、建议和对应课件入口。对话页采用纵向弹性布局：白色客户身份栏、可滚动消息区、白色作答区；手机作答区保留底部安全区。

## Elevation & Depth

学员页面主要通过白色与暖白色层叠表达内容层级。普通课程和实战卡片没有外投影，以照片、留白和细线组织内容。投影集中用于桌面外框和模态弹窗；选择态使用内描边。首页照片遮罩与课程视频标签用于保证文字可读，不能替代状态文字。

### Shadow Vocabulary

- **桌面框**（`0 22px 60px rgba(36,35,29,.12)`）：区分学员视图与汇报画布。
- **模态层**（`0 20px 60px #0003`）：对话框显示时使用，配合半透明遮罩。
- **次按钮描边**（`inset 0 0 0 1px var(--line)`）：白底次级操作的边界。
- **键盘焦点**（`3px solid #cf0b1966`，外偏移 3px）：按钮、链接、输入和可展开标题。

样式表的 `--shadow` 当前未被组件引用，不将其作为已应用的卡片投影。

## Shapes

小标签使用 chip 圆角，筛选使用 filter 圆角。按钮和报告维度采用 action 圆角，学习准备与情景卡采用 panel 或 container 圆角。对话框和桌面学员框使用更大的独立圆角。手机外框保持直角。

头像以圆形姓名首字呈现，不使用虚构客户照片。消息气泡在发送侧保留一个较小角，区分学员和客户。课程缩略图使用官方业务照片、视频时长和课程序号；实战照片用于业务情境，不代表虚构角色的真人肖像。

## Components

### Buttons

主操作为实底玉柴红，白字、中等字重，最小高度 48px。悬停进入深红，按下缩放为 0.985，变化时长 0.18s。次按钮为白底石墨字配内描边，悬停为浅灰；浅红按钮用于次级强调。禁用态透明度为 0.48，并改变光标。

### Chips

标签使用紧凑文字和浅色背景。示例与当前状态为浅红，完成状态为浅绿，需注意状态为浅琥珀。课程筛选为独立按钮，已选态使用浅红背景和中等字重，最小高度为 44px。

### Cards / Containers

首页续学面板、学习准备和情景卡在暖白底上使用纯白。内容内边距在 18px 至 20px；主要依靠留白与分隔组织，不叠加外阴影。报告维度采用原生 details/summary，展开区域由细线分隔证据和建议。

课程媒体卡片为白底、10px 圆角，封面与文字连续排列；正文内边距为桌面 12px、手机 11px。卡片显示学习形式、完成状态和关联实战数量，整体作为课程入口。实战卡片采用 12px 内边距、10px 圆角，封面与任务信息横向排列。

### Inputs / Fields

课程搜索为浅灰绿背景，左侧线性搜索图标；输入高度为 43px，左右内边距由外容器提供。输入有中文提示和 aria-label，光标为玉柴红；键盘焦点沿用全局焦点描边。

可用的文字作答使用浅色多行输入框，最小高度 69px、8px 圆角、11px 内边距，文字行高为 1.7。文字与语音按钮位于作答区上方，选中态为浅红；海外文字按钮禁用并配“文字待恢复”说明。朗读按钮位于右侧，默认关闭。发送和结束评估分别呈现。

### Navigation

底部导航分别指向学习任务、课程、实战和个人记录。线性 SVG 图标配文字，当前项为玉柴红并带 aria-current。阅读与对话页隐藏底部导航。课程目录中的每个章节整行可点击。手机隐藏桌面汇报导航。

### 课程阅读与要点自检

课程详情提供原生 MP4 播放器、字幕和可点击章节时间点。五门课程复用三段原创合成配音微课；不展示为真人授课视频。微课采用火山引擎豆包云舟合成配音，实际时长99.13、94.42、89.54秒；50段字幕与实际音频时长对齐。视频进度以正常播放的去重时间区间累计，章节跳转和重复观看不增加已观看比例，有效观看达到 90% 后记录视频完成。

图文页顶部显示当前章节与细进度条，白底正文下方提供上一页、下一页或自检操作。自检选项使用全宽浅色块；选中为浅红描边，正确为浅绿，错误反馈为浅琥珀。课程完成需完成视频、读完各页并通过自检，完成状态和实操成绩分别显示。学习进度保存在当前浏览器。

### 课程与实战关联

`courses[].practiceIds` 指向权威实战模型 `practices[]`；`practices[].courseIds` 保存反向关联。当前五门课各关联两至三个任务，共六项实战。关联关系用于推荐与跳转，不等同强制先修集合。

课程详情和实战中心均可直接进入已发布且服务可用的任务。视频观看、章节阅读、自检与课程完成状态只用于学习记录和推荐，不作为实战准入条件。准备页保留关联课程供学员自主复习；待独立配置场景及服务不可用状态继续限制启动。

已发布任务使用真实业务名称、客户角色和练习参数。OEM 标签为“已发布实战 · 文字 / 语音”，海外标签为“已发布实战 · 语音 · 文字待恢复”。界面按业务任务组织，后台 `dialogueMode` 保留原值用于接入。四项场景规划展示目标和角色，保持“待独立配置”状态，不提供真实开练。`scenarios` 为兼容数据，不再组织独立情景演示入口。

### 实战对话与报告证据

对话页使用浅灰底、白色客户身份栏和作答区。客户消息为白底灰绿字，学员消息为浅红底暗红字；圆形首字头像、计时、连接状态和错误提示表示会话状态。OEM 默认文字，语音由学员主动选择；海外默认语音，文字入口暂禁用。语音在开启时申请麦克风权限，朗读单独控制。减少运动偏好会关闭动画和过渡。

已发布实战对应 plan 47 / role 47 和 plan 49 / role 48，共用任务、准备、结束及报告路径；具体输入通道按目标计划的实测状态显示。计划 47 的浏览器记录 266 完成两轮文字对话与报告，评分 26 分；计划 49 的流式文字无响应，替代轮次通道因 TTS 配置错误由上游关闭，记录 267、268 均为 0 轮，不能作为文字考核可用证据。

报告采用“能力概览、评分依据、逐句复盘”三个阅读入口，沿用玉柴红、暖白和系统中文字体。总分使用72px数字，报告标题为23px；阅读入口粘在68px页头下方，定位留出140px。雷达下的维度行可进入评分依据，逐句记录使用连续时间线并区分学员与AI客户，原文与文字点评分层呈现。长总体评价先显示原文摘要，可展开阅读全文。

报告总览呈现本次总分、通过分、来源标签与结论。总分直接使用 `report_detail.final_score`，不按维度或细项重新计算。真实报告按 `evaluation_rule` 呈现维度得分、明确返回的分母、权重、评价依据和建议；记录 261 与 266 均为四维。维度 `0 / 0` 显示缺少有效分母，`0 / 10` 保留为真实零分；报告等待、字段缺失与有效零分使用不同状态文字。

维度下的细项保留实际 `reason`、`suggestion`、`related_text` 及是否计入规则。细项满分不明时不补分母、不推算扣分；未计入细项与普通计分项分别标识。引用原文与后台评价分开呈现，不把评价依据改写为学员原话。

逐句点评按 `turn_evaluations` 呈现角色、原文、`evaluation_level` 与文字 `evaluation`。证据跳转只按角色和完整原文精确匹配；未匹配时显示无法定位，重复原文列出候选位置。该区域不展示推算的逐句数字分、音频或发言时间戳。

固定拜访案例的 75 分报告仅作阅读参考，与任何实战完成结果分开。样例包含八维二十一项和九段对话节选，其中七项没有可定位节选，显示未提供节选状态。记录 261 显示合成语音验证标签，记录 266 显示文字联调验证标签，均不计入学员实操成绩。报告尚未有效返回时，界面显示等待、未结束或错误状态，并提供重试动作，不能转入固定样例替代真实结果。

## Do's and Don'ts

### Do:

- **Do** 延续现有中文系统字体、浅色阅读面和玉柴红主操作。
- **Do** 用双列照片卡片呈现课程，用可展开维度呈现证据与建议。
- **Do** 保留手机安全区、底部导航避让和阅读页独立操作区。
- **Do** 同时呈现来源标签与状态文字，保留真实报告的原始分值。
- **Do** 将维度与细项的评价、建议、引用原文和逐句文字点评分别呈现。
- **Do** 对重复原文列出定位候选，对缺少节选的细项显示明确状态。
- **Do** 使用当前品牌标识与官方业务照片，图标保持线性 SVG 风格。
- **Do** 在课程详情呈现视频、图文、自检和关联实战，保留媒体来源说明。
- **Do** 保持浅色对话面，分别呈现 OEM 默认文字和海外语音入口、文字待恢复状态。
- **Do** 按真实业务任务展示实战，并让当前课程关联的多个任务可辨识。

### Don't:

- **Don't** 将固定案例的 75 分展示为任何实战的实际成绩或失败回退。
- **Don't** 将合成语音验证记录 261 计入学员实操报告数量。
- **Don't** 将文字联调记录 266 的 26 分计入学员实际考核成绩。
- **Don't** 在海外文字通道完成上游修复与完整报告验证前宣称可用。
- **Don't** 在报告等待或请求失败时显示零分或通过结论。
- **Don't** 将模板八维二十一项替换进未确认的真实课程评分结构。
- **Don't** 用维度、权重或细项重新计算后台总分，或在细项满分不明时推算扣分。
- **Don't** 将 `0 / 0` 的缺数据状态显示为真实零分比例，或抹去 `0 / 10` 的有效零分。
- **Don't** 为逐句文字点评补造数字分、录音或时间戳，或在原文不匹配时生成证据跳转。
- **Don't** 用视频观看、章节阅读、自检或课程完成状态阻断已发布且服务可用的实战。
- **Don't** 把后台消息模式与实时语音协议划成不同业务实战分类。
- **Don't** 把桌面汇报导航移入手机学习主界面。
