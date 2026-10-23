# dsh-approval-alert

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的**全局待办提醒**插件：当某个会话出现等待你审批 / 回答 / 确认计划时，在窗口顶部弹出醒目卡片并播放提示音（系统通知默认关闭，可一键开启；Windows 上是右下角 toast，点一下回到对应会话）。

不修改 DSH 本体（`app.asar`），是一个标准的 profile 插件包，DSH 升级后仍然存在。

```
┌─ 窗口顶部正中 ─────────────────────────────────────────────┐
│ ●  有操作等待你审批                                        │
│    工具 pwsh 请求越权执行，已暂停等待确认。                 │
│    会话：重构审批流程                        [🔔] [通知关]  │
│                              [稍后提醒]  [前往会话]        │
└────────────────────────────────────────────────────────────┘
        + 三音提示音（系统通知默认关闭，可在卡片上开启）
```

## 它解决什么问题

DSH 原生的审批提示只是**输入框上方的一张 composer 小卡片**。它没有声音、没有系统通知、没有任务栏提醒；而桌面端窗口关闭后是收进托盘继续运行。于是当你在别的屏幕、别的会话、或者最小化了窗口时，一个等待审批的操作可能挂很久才被发现，agent 就一直干等。

本插件监听客户端会话状态里的"待处理交互"（`pendingInteraction`），把提示提升为**全窗口浮层 + 声音**（系统通知可选），并在窗口不可见时周期性重复提醒。

## 效果

### 触发条件

| `kind` | 场景 | 卡片/通知文案 |
|---|---|---|
| `approval` | 工具请求越权执行（工作区外写入、沙箱升权等） | 「有操作等待你审批」+ 工具名 |
| `question` | `ask_user_question` 等待回答 | 「DSH 在等待你的回答」 |
| `plan-review` | 计划模式等待确认 | 「计划等待你确认」 |

同一个请求只提醒一次；请求被回答或取消后，卡片与通知自动消失。

### 交互

- **前往会话**：切换到该请求所属会话，并把浮层收起 2 分钟；到期仍未处理会重新弹出并再次提醒。
- **稍后提醒**：浮层收起 2 分钟，到期后重新弹出并提醒。
- **🔔 / 通知**：即时开关提示音 / 系统通知（系统通知默认关），偏好写入 `localStorage`。
- 窗口最小化或切到别的虚拟桌面（`document.hidden`）时，若请求仍在等待，每 60 秒重响一次，最多 15 次。

### 系统通知（默认关闭）

本插件默认**只弹顶部卡片 + 响提示音**，不弹系统通知。需要时可在卡片上点「通知开」临时开启（偏好存 localStorage），或在 `DEFAULT_PREFS` 里把 `notify` 改成 `true`。开启后通过渲染进程标准的 `Notification` API 弹出（Electron 桌面端显示为 Windows toast），点击通知会尝试聚焦窗口并直接打开对应会话。

## 安装

### 前置条件

- DSH 桌面端（或带 Web UI 的 profile 部署），已至少启动过一次，存在 `~/.dsh/profiles/<profile>/`（桌面端默认 `desktop`）。
- 桌面端安装插件后需要**完全退出再启动**：desktop profile 的 patch 不做 live 热更新。

### 方式一：插件管理器（推荐，官方通道）

1. 打开 **设置 → 插件 → 安装**；
2. 输入本目录的绝对路径（例如 `D:\...\dsh-approval-alert`）；
3. 结果提示 `restart-required` 属正常，**完全退出 DSH（含托盘图标）再启动**。

插件管理器会自己写 profile 的 `package.json` / `cordis.patch.yml`，并把包登记为受管理的 bundle（会出现在插件栏/插件列表里，可停用、卸载、升级）。

### 其他电脑一键安装

把本项目推到 GitHub 后，其他电脑只需要：

1. 打开 **设置 → 插件 → 安装**；
2. 粘贴仓库地址，例如 `https://github.com/greatZhaoFD/dsh-approval-alert`；
3. 按提示完全退出并重启 DSH。

> **注意包名**：npm 上 `dsh-approval-alert` 已被其他人占用（另一个同类插件），所以本项目不要用这个包名发布 npm；走 GitHub 地址安装不受影响。如果确实要发 npm（让其他人用包名一键安装），把 `package.json` 的 `name` 改成你自己作用域下的名字（例如 `@greatzhaofd/dsh-approval-alert`，同时把 `lib/client.js` 里 `window.__ModuleLoader__.load` 的 `id`、`cordis.patch.yml` 的 `name` 与测试里的 id 一起改掉），再 `npm publish --access public`；其他人安装时填包名即可。

### 方式二：本地脚本（等价安装，适合没有 UI 的场景）

```powershell
pwsh -File scripts\install.ps1
```

脚本会：

1. 复制本目录到 `%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-approval-alert`；
2. 备份 profile 的 `cordis.patch.yml`；
3. 在补丁末尾追加一段带标记的挂载块（卸载脚本按标记精确移除）：

```yaml
# >>> dsh-approval-alert (managed by scripts/install.ps1)
- insert:
    - id: approval-alert
      name: 'dsh-approval-alert'
# <<< dsh-approval-alert
```

两种方式**任选其一，不要同时使用**（会重复挂载，导致弹两张卡、响两次）。

### 安装位置

| 内容 | 位置 |
|---|---|
| 本仓库（源码，可上传 GitHub） | 你 clone / 拷贝这份项目的目录 |
| 装进 DSH 后的副本 | `%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-approval-alert` |
| 挂载记录（方式二） | `%USERPROFILE%\.dsh\profiles\<profile>\cordis.patch.yml` |
| 插件偏好 | 该 DSH 页面的 `localStorage`，键 `dsh-approval-alert.prefs.v2` |

> DSH 内置插件在安装目录的 `resources/app.asar` 里；profile 级插件（包括本插件和市场上的第三方插件）都在 `~/.dsh/profiles/<profile>/node_modules/` 下。

### 验证安装

```powershell
node test\smoke.test.mjs
```

这是项目自带的**无头冒烟测试**，不启动 DSH 也能验证客户端 bundle 的模块包装、slot 注册、三种提醒文案、系统通知内容、点击通知跳转会话、提示音触发等。安装到 DSH 后，触发一次审批（例如让 agent 在工作区外写文件）即可看到完整效果；也可以在「设置 → 插件」列表里确认出现「审批提醒 / Approval Alert」。

## 卸载

- 方式一安装：在「设置 → 插件」中停用/卸载；
- 方式二安装：`pwsh -File scripts\uninstall.ps1`；
- 之后完全退出并重启 DSH。

卸载后 DSH 恢复原状，不留副作用；`localStorage` 偏好会残留，可在 DevTools 里删除。

## 配置

默认值（`lib/client.js` 顶部 `DEFAULT_PREFS`，可在卡片上即时开关，或改代码后重新安装）：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sound` | `true` | 是否播放提示音 |
| `notify` | `false` | 是否弹系统通知（默认关，只留卡片 + 声音） |
| `snoozeMs` | `120000` | 「稍后提醒」/「前往会话」后收起多久 |
| `repeatMs` | `60000` | 窗口隐藏时重复提醒间隔 |
| `repeatLimit` | `15` | 窗口隐藏时最多重复次数 |

提示音是 Web Audio 实时合成的三音上行短铃（880 / 1174.66 / 1567.98 Hz），不需要音频文件；想换音色/音量改 `playChime()` 即可。

## 工作原理

```
DSH Host（Node，被 Electron 启动）
  └─ profile 插件树：dsh-approval-alert（宿主半 = 空操作 + 产物自检）
        └─ package.json 的 dsh.client → client-modules 组合出浏览器 bundle
Web 页面（Electron 渲染进程）
  └─ Cordis 客户端插件：lib/client.js
        ├─ ctx.slots.inject('shell.overlay')  → 注册全窗口浮层组件
        ├─ props.useSessionStatus(selector)   → 读取各会话 pendingInteraction
        ├─ Web Audio                          → 提示音
        └─ new Notification(...)              → 系统通知
```

- **检测**：`shell.overlay` 是 root scope 的 list slot，其标准 props 含 `useSessionStatus`（`Map<sessionId, { running, pendingInteraction, completionUnread }>`）。读取 `pendingInteraction.kind/answerable/toolName` 即可知道是否有待办；不依赖任何内部 store 或 DOM。
- **渲染**：注册一个 `id` 独特的 overlay 条目（附加式，不替换任何官方 UI）；浮层容器 `pointer-events: none`，只有卡片本身接收点击，不会挡住应用。
- **降级**：slot 不存在 → 静默不显示；hook 缺失 → 静默不提醒；`Notification` / `AudioContext` 不可用或权限不足 → 少一个能力，不抛错。
- **宿主半为什么是空的**：它只负责让包成为一个被 Loader 加载的条目。启动时它会检查 `lib/client.js` 是否存在——若声明了 `dsh.client` 却缺少客户端产物，`client-modules` 这个必需服务会在构造期抛错，可能导致 **DSH 无法启动**；让宿主半先失败（被 Loader 隔离）可以把这种最坏情况降级为"插件不加载"。

## 兼容性与 DSH 升级

依赖的都是客户端公开扩展面，没有引用任何 `@deepseek-ai/*` 内部模块（只 require 平台种子里的 `react`）：

| 依赖 | 变化时的表现 | 风险 |
|---|---|---|
| `dsh.client` 清单 + `exports["./client"]` + `window.__ModuleLoader__.load({id, factory})` | 客户端 bundle 加载失败，仅本插件不出现；设置→插件里可重试 | 中（构建产物格式；官方 skill 模板就是手写这个格式） |
| `shell.overlay` slot（list，root scope） | 注册不到 → 静默不弹窗 | 低（官方 slot 目录明确建议浮层放这里） |
| `useSessionStatus` + `pendingInteraction.kind/answerable/toolName` | 读不到待办 → 静默不提醒 | 低-中（slot 标准 props，核心组件同样用法） |
| `uiWorkspace.openSession(id)` | 「前往会话」无效，其余照常 | 低（访问前做存在性判断） |
| 渲染进程 `Notification` | 无系统通知，浮层 + 声音照常 | 低（市场插件 `@kenz1117/dsh-ui-usage-billing` 同样在用） |
| `AudioContext` | 无声音，浮层 + 通知照常 | 低（首次键鼠操作解锁，失败静默） |

关于版本声明：`package.json` **刻意不写 `engines.dsh`**。DSH 会在启动/安装前检查 `engines.dsh` 与 DSH peer 依赖，不满足时只静默禁用该行；但 semver 的 pre-release 规则会让 `>=0.2.0` 之类范围拒掉 `0.2.1-rc.2` 这类 nightly 版本，把"能跑"误判成"不兼容"。因此兼容信息只写在 `dsh.compatibility.dshReleases`（仅展示、不强制），真正的兼容判断交给升级后的冒烟测试。

### DSH 升级后检查清单（约 1 分钟）

1. 重启后触发一次审批，确认卡片 + 声音都在（系统通知默认关，需要时再开）；
2. 若没有：打开「设置 → 插件」，看插件列表是否报告客户端 bundle 加载失败（说明客户端模块格式变了，需要按新版重打 `lib/client.js`）；
3. 若插件加载正常但不弹窗：确认 `shell.overlay` slot 仍存在、`useSessionStatus` 的 `pendingInteraction` 仍有 `kind` 字段（对照 `@deepseek-ai/dsh-client-ui-layout`、`dsh-client-ui-approval` 的 `lib/client.js`）；
4. 都不行就停用/卸载并重启，退回原状，不影响 DSH 使用；
5. `node test\smoke.test.mjs` 可以先在本机验证 bundle 逻辑没坏，再动 DSH。

改造建议：若未来要兼容多个 DSH 版本，推荐把 `lib/client.js` 纳入正式构建（tsdown 等），由构建过程生成 `window.__ModuleLoader__.load` 包装，并在 CI 里跑本项目的 smoke test。

## 开发

### 目录结构

```
dsh-approval-alert/
├─ package.json          # DSH 清单：bundle patch / client manifest / 显示元数据
├─ cordis.patch.yml      # bundle 挂载补丁（id: approval-alert）
├─ lib/
│  ├─ index.js           # 宿主半：空操作 + 客户端产物自检
│  └─ client.js          # 浏览器半：浮层 / 提示音 / 系统通知（手写 ModuleLoader 格式）
├─ locale/
│  ├─ en.json            # 插件列表显示名/描述（英文）
│  └─ zh.json            # …中文
├─ icon.svg              # 插件列表图标
├─ scripts/
│  ├─ install.ps1        # 本地安装（复制 + 幂等挂载）
│  └─ uninstall.ps1      # 本地卸载
├─ test/
│  └─ smoke.test.mjs     # 无头冒烟测试（假 window/React/Notification/AudioContext）
├─ README.md / README.en.md
└─ LICENSE
```

### 运行测试

```powershell
node test\smoke.test.mjs
```

无需 DSH、浏览器或第三方依赖。

### 修改后如何生效

1. `node test\smoke.test.mjs` 先过；
2. 方式一安装的：重新在插件管理器里安装/更新本地目录；方式二安装的：重跑 `scripts\install.ps1`；
3. 完全退出并重启 DSH。

## 常见问题

- **没声音？** 先确认系统/DSH 没静音；Web Audio 需要页面有过一次键鼠操作（触发审批前必然有过）。Windows 通知音是否播放取决于系统设置。
- **两声？** 默认不会：系统通知默认关闭，只有提示音。若你手动开了系统通知，提示音可能与系统通知音叠加，点卡片「通知关」即可。
- **弹了两次 / 响两次？** 多半是同时用了插件管理器安装和脚本安装（重复挂载）。保留一种，卸载另一种后重启。
- **想只提醒审批、不要提问提醒？** 改 `lib/client.js` 顶部 `ALERT_KINDS`，只保留 `"approval"`。
- **macOS / Linux？** 全部逻辑走浏览器标准 API（Web Audio + Notification），理论上跨平台可用；未在非 Windows 环境实测。

## 已知限制

- 只覆盖"等待用户处理的交互"（审批/提问/计划确认）；普通任务完成通知不在范围内。
- 浮层渲染在页面内，**不能**强制窗口置顶或闪任务栏；窗口最小化时依赖提示音（可选系统通知）。
- 同一 DSH 打开多个浏览器页面时会各自提醒（每个页面一份渲染进程）。
- 提示音音量固定写在代码里，未做设置页。

## 备选方案（第三方现成插件）

如果不想维护自研插件，npm 上已有同类插件，需要自行实测：**`dsh-approval-alert`**（注意：这个名字已被第三方占用，作者 yangluoUp，功能包括审批/提问提醒、任务完成提醒、主机端原生通知，需要 `node-notifier` 依赖）、`dsh-notification-hook`（等待输入 + WinRT toast + 可选提示音）、`@lyhalal/dsh-notification-center`（审批事件 + 多音效 + 系统通知一站式）、`dsh-notify-bell` / `dsh-notification-sounds`（只补声音）。本项目对它们的取舍是：单文件客户端实现、无第三方依赖、默认轻量（只卡片 + 声音）、失败只降级、可一键卸载。

## License

[MIT](LICENSE)
