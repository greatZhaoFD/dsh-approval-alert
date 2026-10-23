# dsh-approval-alert

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that makes **pending approvals impossible to miss**: a frame-wide popup and a short chime whenever an approval, question, or plan review is waiting in any session. OS notifications are available behind a toggle but **off by default**.

It is a regular DSH profile plugin. It never patches `app.asar`, and it survives DSH desktop updates (the updater replaces the app, not `~/.dsh`).

## What it does

| `pendingInteraction.kind` | Situation | Alert |
|---|---|---|
| `approval` | a tool requests privileged execution | "An action is waiting for your approval" + tool name |
| `question` | `ask_user_question` waiting | "DSH is waiting for your answer" |
| `plan-review` | plan mode waiting | "A plan is waiting for your confirmation" |

- Top-center card with **Open session** / **Remind later**, plus instant sound / notification toggles.
- Three-note Web Audio chime (no audio asset); an optional renderer `Notification` (Windows toast; click opens the session).
- Alerts once per request; if the window stays hidden, repeats every 60 s (max 15).
- Every capability is feature-detected and fails soft: no slot → silent; no `Notification` → still popup + sound.

## Install

**On another computer (one step, after the repo is on GitHub):** open **Settings → Plugins → Install**, paste `https://github.com/<you>/dsh-approval-alert`, then fully restart DSH.

Locally you can also paste this directory's absolute path, or run `pwsh -File scripts\install.ps1` (copies the package into `~/.dsh/profiles/<profile>/node_modules` and appends an idempotent mount block).

> The npm name `dsh-approval-alert` is already taken by another plugin. Installing from a GitHub URL is unaffected; to publish to npm, rename the package (and the `window.__ModuleLoader__.load` id / patch row) to a unique name first.

Uninstall: disable it in the Plugin Manager, or run `pwsh -File scripts\uninstall.ps1`; restart DSH.

## Test without DSH

```powershell
node test\smoke.test.mjs
```

Simulates `window.__ModuleLoader__`, a minimal React, the client Cordis context and browser globals; asserts bundle id/wrapper, `shell.overlay` registration, per-kind copy, notification content, click-to-open, and the chime.

## Compatibility

Designed against DSH 0.2.1-rc.2. It depends only on public client extension points (`shell.overlay` list slot, root `useSessionStatus` hook with `pendingInteraction`, `uiWorkspace.openSession`, renderer `Notification`, `AudioContext`) and requires no `@deepseek-ai/*` runtime modules beyond the platform-provided `react` seed. After a DSH update, re-run the smoke test and the checklist in README.md (Chinese).

`engines.dsh` is intentionally omitted: semver pre-release matching would reject nightly versions such as `0.2.1-rc.2` for ordinary ranges and get the plugin silently disabled.

## License

[MIT](LICENSE)
