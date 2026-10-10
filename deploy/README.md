# 云端演示部署

目标服务器 `124.174.66.19`，通过 `jumpecs-lf` 跳板访问。门户应用目录为 `/opt/mia-portal/app`，入口名称为“玉柴培训中心”，应用路径为 `/yuchai-training/`。

## 应用和访问范围

- 玉柴服务独立运行在 `127.0.0.1:5317`；发布目录 `/opt/yuchai-learning-h5/releases/`，`current` 指向当前发布。
- Nginx 剥离 `/yuchai-training/` 前缀，回源 Host 固定为 `127.0.0.1:5317`，保留浏览器 Origin；玉柴 API 和 WebSocket 不进行门户登录校验，Host 与精确 Origin 保护保留。
- 无需登录即可浏览课程、视频、自检及参考报告，并进入已发布且服务可用的实战、读取历史和实际报告。课程进度不限制实战；其他门户功能继续执行原有认证规则。
- 固定演示项目 5、上游账号 1，尚未提供企业学员身份映射；不同浏览器访问不代表不同陪练学员。
- `/etc/yuchai-learning-h5.env` 保存接入凭证、`PORT` 和精确 `PUBLIC_ORIGIN`，权限为 `0600`。凭证不写入发布包、源码或前端。
- 麦克风需要 HTTPS。当前使用独立 Cloudflare 演示通道转发至 `127.0.0.1:5320`，开放玉柴培训页面、API 和 WebSocket；门户入口跳转至当前 HTTPS 域名。通道重启会更换域名，启动脚本同步精确来源与入口；不同域名的浏览器学习记录不迁移。正式部署需固定域名及证书。
- Let’s Encrypt IP 证书申请因 CA 访问 HTTP challenge 超时未成功，证书续期 timer 未启用。
- 云服务器出口 IPv4 实测为 `124.174.66.19`。2026-10-09 源站白名单放行后，云端成功读取计划 47、49。

## 发布顺序

1. 确认 SSH 可登录、实际门户/Nginx 配置和 Node 运行时；不覆盖旧部署快照。
2. 备份实际门户 `server.py`、Nginx 站点及已有玉柴服务配置。核对远端文件与补丁上下文，配置门户入口及玉柴公开访问路径，保留其他门户认证。
3. 上传无凭证发布包并校验 SHA-256；在新的 release 目录解包，执行 `npm ci --omit=dev`。
4. 安装 systemd 服务；若运行时路径与模板不同，调整 `ExecStart`。安全传入环境文件，并设置精确公网来源。
5. 安装门户 map/location snippet，先执行 `nginx -t`，再切换 `current`、启动玉柴服务、重启门户并 reload Nginx。检查失败时恢复备份。
6. 验证无登录状态下的门户入口、静态资源、视频 Range、健康与计划读取、实战 API 及 WebSocket；核对错误 Host/Origin 拒绝、内部检查路径不对公网开放、零进度实战入口和其他门户认证。

## 历史本地验证（旧登录访问模式）

2026-10-09：服务和前端语法检查通过；部署来源保护及符号链接启动测试 9 项通过，未调用上游。门户认证测试 4 项及内部检查的针对性验证通过。浏览器在本地子路径测试网关中加载页面、图片与模块，并在模拟 401 时显示可返回原实战页面的登录链接；原本机实战入口仍可用。

该验证未创建真实练习，也不代表云端已上线。发布前浏览器截图为 `evidence/deployment-prefix-local.png`。

## 历史云端验证（2026-10-09，旧登录访问模式）

门户新增“玉柴培训中心”卡片，`http://124.174.66.19/yuchai-training/` 跳转至 HTTPS 演示地址。应用、门户、Nginx 和独立 tunnel 均为 active。

10 项 gateway 访问检查通过：未登录 API/WS 返回 401，有效门户会话可读取 health 和计划 47、49，允许来源的空创建请求进入参数校验，错误来源返回 403；有效来源的 WS 进入本地练习权限检查，错误来源被拒；内部授权及其他后台路径返回 404。检查只使用临时门户会话，结束后删除，未创建真实考核。证据为 `evidence/cloud-access-checks.json`。

浏览器通过真实云端门户进入培训首页，课程视频播放超过 13 秒、无媒体错误，未完成课程时仍有实战入口。点击实战登录链接进入玉柴专用登录页，返回参数保留原实战 hash。截图为 `evidence/cloud-portal-yuchai-entry.png`、`evidence/cloud-home-https.png` 和 `evidence/cloud-course-video.png`。这些检查未验证云端真人麦克风、扬声器或新增考核的完整报告链路。

## 无登录访问验证

2026-10-09：云端公开访问配置已发布。10 项无 Cookie 的 gateway 检查通过：页面、health 和计划 47、49 返回 200；空创建请求进入参数校验；允许来源的 WebSocket 进入本地练习权限检查；错误来源仍被拒；旧登录链接返回培训中心；内部授权与其他后台路径保持 404。检查未创建门户会话或真实考核，证据为 `evidence/cloud-public-access-checks.json`。

浏览器从公开门户入口进入 HTTPS 平台，未登录且课程未完成时，OEM 实战显示可用的“开始实战考核”按钮，没有登录链接。证据为 `evidence/cloud-portal-yuchai-public-entry.png` 与 `evidence/cloud-public-practice-entry.png`。其他门户 `/manage` 仍跳转至原登录页。固定项目 5、上游账号 1 仅用于演示，企业学员身份映射仍需独立接入；该项未新增真实考核或验证真人语音全流程。

## 报告前端发布（2026-10-09）

报告页面提供能力雷达、评分原因与建议、相关原文定位及逐句文字点评。云端读取记录261、266，未创建新练习；仅替换前端文件，实战服务进程保持不变。发布清单共45个文件，5个公网资源与本地哈希一致。长总体评价可展开，0/0评分维度保留缺口。证据为 `evidence/report-presentation-validation.json`、`evidence/cloud-report-deployed-state.json` 和 `evidence/cloud-report-http-checks.json`。

## 实战计划配置与 H5 接入（2026-10-10）

项目 5 的六项独立实战已在后台发布：三分钟开场与需求探询（计划 71 / 角色 60）、竞品压价与经营价值（72 / 61）、供应商切换与风险保障（73 / 62）、多人审批与阶段推进（74 / 63）、客诉事实核查与续采沟通（75 / 64）、数据中心技术入围（76 / 65）。发布配置回读 168 项检查通过，账号 1 可见计划 47、49、71–76。新六项均为消息对话、日常练习、选修，关闭答案提示；该证据不验证真实作答、发声或评分准确性。记录见 `outputs/玉柴实战课程配置-20261010/evidence/final-published-plan-summary.json`。

本地 H5 配置为五门方法课、八项实战和十九个双向课程关联；学习进度不限制实战。六项新增任务标记已发布，写入真实计划/角色 ID 与文字输入标志。首页数量和平台说明读取任务模型，客诉与数据中心使用已有业务配图。服务端允许集合及无 Cookie 访问检查的预期集合均同步八个计划 ID。

报告接口采用逐层输出字段白名单，保留实际分数、原因、建议、原文引用和逐句评价，删除上游场景题意及评分基准。报告查询保留原有状态和错误行为，未增加新的考试条件。定向课程契约及报告测试共 13 项通过，应用与部署验证脚本语法检查通过；验证不连接真实上游或创建练习。证据见 `outputs/玉柴实战课程配置-20261010/evidence/h5-final-local-validation.json`。

服务端允许集合改变后需要重启独立的 `yuchai-learning-h5` 服务；重启前先结束进行中的实战，避免进程内会话记录丢失。无需重启 tunnel 或改变原公开入口与来源保护。

## 八项实战云端发布与抽样验证（2026-10-10）

用户确认可以重启后，发布包 `20261010T023547Z` 部署至 `/opt/yuchai-learning-h5/releases/20261010T023547Z/application`，切换 `current` 并重启玉柴服务。门户、Nginx 和演示通道保持原进程；实际切换前的 release 为 `20261010T022714Z/application`。发布包仅含服务端、依赖清单与公开资源，不含凭据和后台答案配置。证据目录为 `outputs/玉柴实战课程配置-20261010/evidence/`，发布清单与日志分别为 `release-manifest.json`、`cloud-release-log.txt`。

公开门户入口为 `http://124.174.66.19/yuchai-training/`，当前 HTTPS 演示地址为 `https://approx-insulation-boolean-buck.trycloudflare.com/yuchai-training/`。10 项无 Cookie 网关检查通过，9 项公网资源哈希、八项计划可见性与六项计划详情检查通过。云端准备页的两门推荐课程均为待学习，文字方式已选中，开始实战按钮可用。截图为 `admin-eight-published-final.png` 与 `cloud-demand-ready-unlearned.png`。

计划 72 / 角色 61 的合成文字练习 288 完成四轮文字往返、显式结束和报告读取，135 秒后观察到 evaluated。报告包含四个评分维度、四个话题和八条对话记录，四条学员发言有评价，提交原文可完整回读；隐藏 scenes 配置未公开。接口未调用麦克风，收到 22 帧 TTS 音频，无 TTS 错误；未验证扬声器播放、真人语音或听感。100 分为该合成对话的上游评分，不代表评分校准通过。证据为 `verify-new-practice-result.json` 和 `verify-new-practice-report.json`。

该对话观察到客户提前释放现金流信息，收紧规则后练习 289 的两轮信息释放复核通过。继续补充玉柴报价事实边界后，最终 168 项配置回读全部通过；独立练习 290 首轮明确未收到玉柴正式报价，不推断条款内容，第二轮仅在直接问资金约束后释放财务信息。289、290 均显式结束，未读取报告。证据为 `published-plan-validation-71-72-73-74-75-76.json`、`verify-price-release-result.json` 和 `verify-price-fact-boundary-result.json`。

上述实战抽样覆盖计划 72，其他五项验证了发布配置、可见性与 H5 关联，未逐项完成真实对话验收。六项新任务为消息模式；原计划 49 的实时模式文字输入仍待恢复。企业正式考试计次、身份隔离、认证与补考规则，以及评分标准和难度的专家校准，仍需另行确定。

## 运维命令

```sh
ssh -J jumpecs-lf root@124.174.66.19
```

```sh
systemctl status yuchai-learning-h5 --no-pager
systemctl status yuchai-training-tunnel --no-pager
cat /var/lib/yuchai-tunnel/public-url
curl --fail http://127.0.0.1:5317/api/health
nginx -t
```
