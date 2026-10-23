window.__ModuleLoader__.load({
	id: "dsh-approval-alert",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		/**
		 * Frame-wide alert for pending approval / question / plan-review
		 * interactions. Registered into the additive `shell.overlay` client slot,
		 * so it never replaces shipped UI. Detection uses the root-scoped
		 * `useSessionStatus` standard hook (`pendingInteraction`), which is part
		 * of the documented slot props surface.
		 */

		const NS = "approval-alert";
		const ALERT_KINDS = new Set(["approval", "question", "plan-review"]);
		const PREFS_KEY = "dsh-approval-alert.prefs.v2";
		const DEFAULT_PREFS = {
			sound: true,
			notify: false,
			snoozeMs: 120000,
			repeatMs: 60000,
			repeatLimit: 15
		};

		const zh = {
			alertTitleApproval: "有操作等待你审批",
			alertTitleQuestion: "DSH 在等待你的回答",
			alertTitlePlan: "计划等待你确认",
			alertBodyApproval: "工具 {tool} 请求越权执行，已暂停等待确认。",
			alertBodyQuestion: "会话「{title}」里有一个问题等待回答。",
			alertBodyPlan: "会话「{title}」的计划等待确认。",
			systemApprovalTitle: "DSH：有操作等待审批",
			systemQuestionTitle: "DSH：在等待你的回答",
			systemPlanTitle: "DSH：计划等待确认",
			sessionMeta: "会话：{title}",
			untitledSession: "未命名会话",
			moreItems: "另外还有 {n} 项待处理",
			unknownTool: "未知工具",
			open: "前往会话",
			snooze: "稍后提醒",
			soundOn: "提示音已开（点击关闭）",
			soundOff: "提示音已关（点击开启）",
			notifyOn: "系统通知已开（点击关闭）",
			notifyOff: "系统通知已关（点击开启）"
		};

		const en = {
			alertTitleApproval: "An action is waiting for your approval",
			alertTitleQuestion: "DSH is waiting for your answer",
			alertTitlePlan: "A plan is waiting for your confirmation",
			alertBodyApproval: "Tool {tool} requests privileged execution and is paused for confirmation.",
			alertBodyQuestion: "Session \"{title}\" has a question waiting for an answer.",
			alertBodyPlan: "The plan in \"{title}\" is waiting for confirmation.",
			systemApprovalTitle: "DSH: an action needs approval",
			systemQuestionTitle: "DSH: waiting for your answer",
			systemPlanTitle: "DSH: a plan needs confirmation",
			sessionMeta: "Session: {title}",
			untitledSession: "Untitled session",
			moreItems: "plus {n} more pending item(s)",
			unknownTool: "unknown tool",
			open: "Open session",
			snooze: "Remind later",
			soundOn: "Sound is on (click to mute)",
			soundOff: "Sound is off (click to enable)",
			notifyOn: "Desktop notifications are on (click to disable)",
			notifyOff: "Desktop notifications are off (click to enable)"
		};

		function translateFallback(key, params) {
			const dict = Object.prototype.hasOwnProperty.call(zh, key) ? zh[key] : key;
			if (params === undefined || params === null || typeof params !== "object") return dict;
			let text = dict;
			for (const name of Object.keys(params)) text = text.split(`{${name}}`).join(String(params[name]));
			return text;
		}

		function readPrefs() {
			try {
				const raw = window.localStorage.getItem(PREFS_KEY);
				if (raw === null || raw === "") return { ...DEFAULT_PREFS };
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return { ...DEFAULT_PREFS };
				const merged = { ...DEFAULT_PREFS };
				for (const key of Object.keys(DEFAULT_PREFS)) {
					const value = parsed[key];
					if (typeof value === typeof DEFAULT_PREFS[key]) merged[key] = value;
				}
				return merged;
			} catch (error) {
				return { ...DEFAULT_PREFS };
			}
		}

		function writePrefs(next) {
			try {
				window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
			} catch (error) {
				// Preferences are best-effort only.
			}
		}

		let audioContext;
		function ensureAudioContext() {
			try {
				const Ctor = window.AudioContext || window.webkitAudioContext;
				if (typeof Ctor !== "function") return undefined;
				if (audioContext === undefined) audioContext = new Ctor();
				if (audioContext.state === "suspended") {
					const resumed = audioContext.resume();
					if (resumed !== undefined && typeof resumed.catch === "function") resumed.catch(() => {});
				}
				return audioContext;
			} catch (error) {
				return undefined;
			}
		}

		/** Three-note chime, synthesized so the package ships no audio asset. */
		function playChime() {
			const ac = ensureAudioContext();
			if (ac === undefined) return;
			try {
				const start = ac.currentTime + 0.01;
				const notes = [
					[880, 0],
					[1174.66, 0.18],
					[1567.98, 0.36]
				];
				for (const note of notes) {
					const frequency = note[0];
					const delay = note[1];
					const oscillator = ac.createOscillator();
					const gain = ac.createGain();
					oscillator.type = "sine";
					oscillator.frequency.setValueAtTime(frequency, start + delay);
					gain.gain.setValueAtTime(0.0001, start + delay);
					gain.gain.exponentialRampToValueAtTime(0.16, start + delay + 0.02);
					gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.5);
					oscillator.connect(gain);
					gain.connect(ac.destination);
					oscillator.start(start + delay);
					oscillator.stop(start + delay + 0.55);
				}
			} catch (error) {
				// Sound is optional; never let it break the alert.
			}
		}

		const liveNotifications = new Map();

		function closeNotification(key) {
			const notification = liveNotifications.get(key);
			if (notification === undefined) return;
			liveNotifications.delete(key);
			try {
				notification.close();
			} catch (error) {
				// Ignore close failures.
			}
		}

		/**
		 * Raise one OS-level notification (Electron renders it as a Windows toast;
		 * a normal browser shows its own native notification). Clicking it focuses
		 * the window and opens the affected session.
		 */
		function systemNotify(key, title, body, onClick) {
			try {
				const Ctor = window.Notification;
				if (typeof Ctor !== "function") return;
				const permission = Ctor.permission;
				if (permission === "default") {
					try {
						const requested = Ctor.requestPermission();
						if (requested !== undefined && typeof requested.catch === "function") requested.catch(() => {});
					} catch (error) {}
					return;
				}
				if (permission !== "granted") return;
				closeNotification(key);
				const notification = new Ctor(title, {
					body,
					tag: `dsh-approval-alert:${key}`,
					renotify: true,
					requireInteraction: true,
					silent: false
				});
				liveNotifications.set(key, notification);
				notification.onclick = () => {
					try {
						window.focus();
					} catch (error) {}
					try {
						onClick();
					} catch (error) {}
					closeNotification(key);
				};
				notification.onclose = () => {
					if (liveNotifications.get(key) === notification) liveNotifications.delete(key);
				};
				notification.onerror = () => {
					if (liveNotifications.get(key) === notification) liveNotifications.delete(key);
				};
			} catch (error) {
				// Native notifications are best-effort.
			}
		}

		function sessionTitleOf(sessions, sessionId) {
			try {
				const row = sessions && sessions.byId ? sessions.byId[sessionId] : undefined;
				if (row === undefined || row === null) return undefined;
				if (typeof row.title === "string" && row.title !== "") return row.title;
				if (typeof row.name === "string" && row.name !== "") return row.name;
			} catch (error) {}
			return undefined;
		}

		const wrapStyle = {
			position: "absolute",
			top: 10,
			left: 0,
			right: 0,
			display: "flex",
			justifyContent: "center",
			padding: "0 20px",
			boxSizing: "border-box",
			pointerEvents: "none",
			zIndex: 40
		};
		const cardStyle = {
			pointerEvents: "auto",
			width: "100%",
			maxWidth: 560,
			boxSizing: "border-box",
			display: "flex",
			flexDirection: "column",
			gap: 10,
			padding: "12px 14px",
			border: "1px solid var(--dsw-alias-state-warn-secondary, #e6a23c)",
			borderRadius: "var(--dsw-radius-xl, 14px)",
			background: "var(--dsw-alias-bg-base, #ffffff)",
			boxShadow: "var(--dsw-shadow-lv2, 0 12px 32px rgba(0, 0, 0, 0.18))",
			color: "var(--dsw-alias-label-primary, #1f2328)",
			fontFamily: "inherit"
		};
		const headStyle = { display: "flex", alignItems: "flex-start", gap: 10 };
		const dotStyle = {
			flex: "0 0 auto",
			width: 10,
			height: 10,
			marginTop: 6,
			borderRadius: 999,
			background: "var(--dsw-alias-state-warn-primary, #e6a23c)",
			boxShadow: "0 0 0 4px var(--dsw-alias-state-warn-tertiary, rgba(230, 162, 60, 0.18))"
		};
		const textStyle = { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 };
		const titleStyle = { fontSize: 15, fontWeight: 600, lineHeight: "22px" };
		const detailStyle = { fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-secondary, #4d5560)", wordBreak: "break-word" };
		const metaStyle = { fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-tertiary, #80868f)", wordBreak: "break-word" };
		const actionsStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" };
		const togglesStyle = { display: "flex", alignItems: "center", gap: 6 };
		const buttonsStyle = { display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" };
		const chipStyle = {
			border: "1px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.12))",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary, #4d5560)",
			borderRadius: 999,
			padding: "2px 9px",
			fontSize: 12,
			lineHeight: "18px",
			cursor: "pointer",
			fontFamily: "inherit"
		};
		const ghostButtonStyle = {
			border: "1px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.12))",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary, #4d5560)",
			borderRadius: 8,
			padding: "5px 12px",
			fontSize: 13,
			lineHeight: "18px",
			cursor: "pointer",
			fontFamily: "inherit"
		};
		const primaryButtonStyle = {
			border: "1px solid transparent",
			background: "var(--dsw-alias-state-warn-primary, #e6a23c)",
			color: "#ffffff",
			borderRadius: 8,
			padding: "5px 14px",
			fontSize: 13,
			lineHeight: "18px",
			fontWeight: 600,
			cursor: "pointer",
			fontFamily: "inherit"
		};

		function systemTitleOf(t, item) {
			if (item.kind === "approval") return t("systemApprovalTitle");
			if (item.kind === "plan-review") return t("systemPlanTitle");
			return t("systemQuestionTitle");
		}

		function systemBodyOf(t, item) {
			if (item.kind === "approval") return t("alertBodyApproval", { tool: item.toolName === "" ? t("unknownTool") : item.toolName });
			return t(item.kind === "plan-review" ? "alertBodyPlan" : "alertBodyQuestion", {
				title: item.sessionTitle === undefined ? t("untitledSession") : item.sessionTitle
			});
		}

		function ApprovalAlertEntry(props) {
			const t = typeof props.t === "function" ? props.t : translateFallback;
			// Both hooks are root-slot standard props; keep the alert inert (never
			// throwing) when a future DSH version stops providing one of them.
			const sessionStatusHook = typeof props.useSessionStatus === "function" ? props.useSessionStatus : undefined;
			const sessionsHook = typeof props.useSessions === "function" ? props.useSessions : undefined;
			let statuses;
			let sessions;
			try {
				statuses = sessionStatusHook === undefined ? undefined : sessionStatusHook((snapshot) => snapshot);
			} catch (error) {
				statuses = undefined;
			}
			try {
				sessions = sessionsHook === undefined ? undefined : sessionsHook((snapshot) => snapshot);
			} catch (error) {
				sessions = undefined;
			}
			const openSession = typeof props.openSession === "function" ? props.openSession : () => {};
			const prefsState = react.useState(readPrefs);
			const prefs = prefsState[0];
			const setPrefs = prefsState[1];
			const snoozeState = react.useState(0);
			const snoozeUntil = snoozeState[0];
			const setSnoozeUntil = snoozeState[1];
			const tickState = react.useState(0);
			const forceTick = tickState[1];
			const alerted = react.useRef(new Set());
			const repeatCount = react.useRef(0);
			const lastRepeatAt = react.useRef(0);

			const items = [];
			try {
				if (statuses !== undefined && typeof statuses.forEach === "function") statuses.forEach((status, sessionId) => {
					const pending = status && status.pendingInteraction;
					if (pending === undefined || pending === null) return;
					if (!ALERT_KINDS.has(pending.kind)) return;
					if (pending.answerable === false) return;
					const key = typeof pending.key === "string" && pending.key !== "" ? pending.key : `${String(pending.kind)}:${String(sessionId)}`;
					items.push({
						key,
						sessionId,
						kind: pending.kind,
						toolName: typeof pending.toolName === "string" ? pending.toolName : "",
						sessionTitle: sessionTitleOf(sessions, sessionId)
					});
				});
			} catch (error) {}

			items.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
			const itemsKey = items.map((item) => item.key).join("|");
			const now = Date.now();
			const snoozed = snoozeUntil > now;
			const visible = snoozed ? [] : items;
			const visibleKey = visible.map((item) => item.key).join("|");

			// Alert once per newly-visible pending request.
			react.useEffect(() => {
				if (visible.length === 0) return;
				const fresh = visible.filter((item) => !alerted.current.has(item.key));
				for (const item of visible) alerted.current.add(item.key);
				repeatCount.current = 0;
				lastRepeatAt.current = 0;
				if (fresh.length === 0) return;
				const first = fresh[0];
				const current = readPrefs();
				if (current.sound) playChime();
				if (current.notify) systemNotify(first.key, systemTitleOf(t, first), systemBodyOf(t, first), () => openSession(first.sessionId));
			}, [visibleKey]);

			// Keep reminding while the page stays hidden (minimized / other virtual desktop).
			react.useEffect(() => {
				if (visible.length === 0) return undefined;
				const timer = window.setInterval(() => {
					try {
						if (!document.hidden) return;
					} catch (error) {
						return;
					}
					const current = readPrefs();
					if (!current.sound) return;
					if (repeatCount.current >= current.repeatLimit) return;
					const at = Date.now();
					if (lastRepeatAt.current !== 0 && at - lastRepeatAt.current < current.repeatMs) return;
					lastRepeatAt.current = at;
					repeatCount.current += 1;
					playChime();
				}, 10000);
				return () => window.clearInterval(timer);
			}, [visibleKey]);

			// Re-render when the snooze window ends so the alert comes back.
			react.useEffect(() => {
				const remaining = snoozeUntil - Date.now();
				if (remaining <= 0) return undefined;
				const timer = window.setTimeout(() => forceTick((value) => value + 1), remaining);
				return () => window.clearTimeout(timer);
			}, [snoozeUntil]);

			// Close OS notifications whose request already settled.
			react.useEffect(() => {
				for (const key of Array.from(liveNotifications.keys())) {
					if (!items.some((item) => item.key === key)) closeNotification(key);
				}
			});

			if (visible.length === 0) return null;

			const first = visible[0];
			const title = t(first.kind === "approval" ? "alertTitleApproval" : first.kind === "plan-review" ? "alertTitlePlan" : "alertTitleQuestion");
			const detail = first.kind === "approval"
				? t("alertBodyApproval", { tool: first.toolName === "" ? t("unknownTool") : first.toolName })
				: t(first.kind === "plan-review" ? "alertBodyPlan" : "alertBodyQuestion", {
					title: first.sessionTitle === undefined ? t("untitledSession") : first.sessionTitle
				});
			const meta = t("sessionMeta", { title: first.sessionTitle === undefined ? t("untitledSession") : first.sessionTitle });
			const more = visible.length > 1 ? t("moreItems", { n: visible.length - 1 }) : "";

			const togglePref = (name) => {
				const next = { ...readPrefs() };
				next[name] = !next[name];
				writePrefs(next);
				setPrefs(next);
				if (name === "sound" && next.sound) playChime();
			};
			const snooze = () => {
				for (const item of visible) alerted.current.delete(item.key);
				setSnoozeUntil(Date.now() + readPrefs().snoozeMs);
			};
			const openFirst = () => {
				try {
					openSession(first.sessionId);
				} catch (error) {}
				for (const item of visible) alerted.current.delete(item.key);
				setSnoozeUntil(Date.now() + readPrefs().snoozeMs);
			};

			return react.createElement("div", { style: wrapStyle, "data-dsh-approval-alert": "1" },
				react.createElement("div", {
					style: cardStyle,
					role: "alertdialog",
					"aria-live": "assertive",
					"aria-label": title
				},
				react.createElement("div", { style: headStyle },
					react.createElement("div", { style: dotStyle, "aria-hidden": "true" }),
					react.createElement("div", { style: textStyle },
						react.createElement("div", { style: titleStyle }, more === "" ? title : `${title}（+${String(visible.length - 1)}）`),
						react.createElement("div", { style: detailStyle }, detail),
						react.createElement("div", { style: metaStyle }, meta)
					)
				),
				react.createElement("div", { style: actionsStyle },
					react.createElement("div", { style: togglesStyle },
						react.createElement("button", {
							type: "button",
							style: chipStyle,
							title: prefs.sound ? t("soundOn") : t("soundOff"),
							"aria-label": prefs.sound ? t("soundOn") : t("soundOff"),
							onClick: () => togglePref("sound")
						}, prefs.sound ? "🔔" : "🔕"),
						react.createElement("button", {
							type: "button",
							style: chipStyle,
							title: prefs.notify ? t("notifyOn") : t("notifyOff"),
							"aria-label": prefs.notify ? t("notifyOn") : t("notifyOff"),
							onClick: () => togglePref("notify")
						}, prefs.notify ? "通知开" : "通知关")
					),
					react.createElement("div", { style: buttonsStyle },
						react.createElement("button", { type: "button", style: ghostButtonStyle, onClick: snooze }, t("snooze")),
						react.createElement("button", { type: "button", style: primaryButtonStyle, onClick: openFirst }, t("open"))
					)
				)
			)
		);
		}

		function openSessionInWorkspace(ctx, sessionId) {
			try {
				const workspace = ctx.get("uiWorkspace");
				if (workspace !== undefined && workspace !== null && typeof workspace.openSession === "function") {
					workspace.openSession(sessionId);
				}
			} catch (error) {
				try {
					console.warn("[approval-alert] could not open session", sessionId, error);
				} catch (loggingError) {}
			}
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			try {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "approval-alert: dictionaries");
			} catch (error) {
				// Without dictionaries the fallback translator still speaks Chinese.
			}

			// Browsers start an AudioContext suspended until a user gesture; unlock it
			// once on the first gesture so a later approval can actually chime.
			const unlock = () => {
				ensureAudioContext();
				try {
					document.removeEventListener("keydown", unlock, true);
					document.removeEventListener("pointerdown", unlock, true);
				} catch (error) {}
			};
			try {
				document.addEventListener("keydown", unlock, true);
				document.addEventListener("pointerdown", unlock, true);
			} catch (error) {}

			ctx.effect(() => () => {
				try {
					document.removeEventListener("keydown", unlock, true);
					document.removeEventListener("pointerdown", unlock, true);
				} catch (error) {}
			}, "approval-alert: audio unlock listener");

			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "approval-alert",
				order: 900,
				locale: NS,
				inject: () => ({
					openSession: (sessionId) => openSessionInWorkspace(ctx, sessionId)
				})
			}, ApprovalAlertEntry));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
