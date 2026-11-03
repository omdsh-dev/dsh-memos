/**
 * dsh-memos — settings panel (client half).
 *
 * Rendered inside the web settings page (settings.section entry). Configuration
 * form (server URL / personal access token: save, test, clear) plus a small
 * read-back preview of the latest 5 memos. Hand-written ModuleLoader module,
 * plain React (createElement), inline styles only — no build step.
 */
window.__ModuleLoader__.load({
	id: "dsh-memos",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");
		var h = React.createElement;

		//#region api
		/** Error carrying the route's JSON error message. */
		class MemosApiError extends Error {
			constructor(message) {
				super(message);
				this.name = "MemosApiError";
			}
		}
		/** Parse a JSON response or throw a MemosApiError. */
		async function readJson(response) {
			let body;
			try {
				body = await response.json();
			} catch {
				throw new MemosApiError("HTTP " + response.status + ": invalid JSON response");
			}
			if (!response.ok) {
				throw new MemosApiError(typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : "HTTP " + response.status);
			}
			return body;
		}
		async function request(path, init) {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new MemosApiError("网络请求失败: " + String(error instanceof Error ? error.message : error));
			}
			return readJson(response);
		}
		const api = {
			getConfig: () => request("/api/dsh-memos/config"),
			setConfig: (patch) => request("/api/dsh-memos/config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch)
			}),
			test: () => request("/api/dsh-memos/test", { method: "POST" }),
			preview: () => request("/api/dsh-memos/preview", { method: "POST" })
		};
		//#endregion

		//#region styles
		const s = {
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				maxWidth: "560px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid rgba(128,128,128,0.3)",
				fontSize: "13px",
				color: "inherit"
			},
			title: { fontWeight: 600, fontSize: "13px", margin: 0 },
			status: { fontSize: "12px", opacity: 0.85 },
			statusWarn: { fontSize: "12px", opacity: 0.9, color: "#c9763a" },
			row: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
			input: {
				width: "100%",
				boxSizing: "border-box",
				padding: "5px 8px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				fontSize: "12px"
			},
			button: {
				padding: "4px 10px",
				borderRadius: "6px",
				cursor: "pointer",
				border: "1px solid rgba(128,128,128,0.4)",
				background: "rgba(128,128,128,0.14)",
				color: "inherit",
				fontSize: "12px"
			},
			msg: { fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all", opacity: 0.9 },
			preview: {
				fontSize: "12px",
				borderTop: "1px solid rgba(128,128,128,0.25)",
				paddingTop: "8px",
				display: "flex",
				flexDirection: "column",
				gap: "6px"
			},
			previewItem: { lineHeight: 1.5 },
			previewMeta: { opacity: 0.6, marginRight: "6px" }
		};
		//#endregion

		/** Status line for the current config view. */
		function statusText(view) {
			if (view === null) return "加载中…";
			if (!view.configured) return "未配置 — 在 memos 网页端「设置 → Access Tokens / 访问令牌」创建令牌后，连同服务器地址填到下方。";
			return "已配置（" + view.serverUrl + "，令牌 " + view.masked + "）· " + view.configPath;
		}

		/** The settings panel component. */
		function MemosSettingsPanel() {
			const [view, setView] = React.useState(null);
			const [serverUrl, setServerUrl] = React.useState("");
			const [accessToken, setAccessToken] = React.useState("");
			const [preview, setPreview] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [msg, setMsg] = React.useState("");

			const refresh = React.useCallback(async () => {
				try {
					setView(await api.getConfig());
				} catch (error) {
					setMsg("读取配置失败: " + String(error instanceof Error ? error.message : error));
				}
			}, []);
			React.useEffect(() => { refresh(); }, [refresh]);

			/** Run one async panel action with busy/message bookkeeping. */
			const run = async (action) => {
				setBusy(true);
				setMsg("");
				try {
					await action();
				} catch (error) {
					setMsg("操作失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};

			const save = () => run(async () => {
				const next = await api.setConfig({ serverUrl, accessToken });
				setView(next);
				setMsg(next.configured ? "配置已保存。" : "配置已保存（尚不完整：服务器地址和令牌都需要）。");
			});
			const clear = () => run(async () => {
				const next = await api.setConfig({ reset: true });
				setView(next);
				setServerUrl("");
				setAccessToken("");
				setPreview(null);
				setMsg("配置已清除。");
			});
			const test = () => run(async () => {
				const result = await api.test();
				setMsg((result.ok ? "[ok] " : "[failed] ") + result.message);
			});
			const loadPreview = () => run(async () => {
				const result = await api.preview();
				if (result.ok) {
					setPreview(Array.isArray(result.memos) ? result.memos : []);
					setMsg(result.memos && result.memos.length ? "" : "读取成功，当前没有笔记。");
				} else {
					setPreview(null);
					setMsg("[failed] " + result.message);
				}
			});

			const configured = Boolean(view && view.configured);
			return h("div", { style: s.card },
				h("p", { style: s.title }, "Memos 笔记（usememos 自托管 · 只读）"),
				h("div", { style: configured ? s.status : s.statusWarn }, statusText(view)),
				h("input", {
					style: s.input,
					placeholder: "memos 服务器地址（如 https://memos.example.com）",
					value: serverUrl,
					onChange: (event) => setServerUrl(event.target.value)
				}),
				h("input", {
					style: s.input,
					placeholder: "访问令牌 PAT（memos 设置 → Access Tokens 创建）",
					value: accessToken,
					onChange: (event) => setAccessToken(event.target.value)
				}),
				h("div", { style: s.row },
					h("button", { style: s.button, onClick: save, disabled: busy }, "保存配置"),
					h("button", { style: s.button, onClick: test, disabled: busy || !configured }, "测试连接"),
					h("button", { style: s.button, onClick: clear, disabled: busy || !configured }, "清除配置"),
					h("button", { style: s.button, onClick: loadPreview, disabled: busy || !configured }, "预览最近笔记")
				),
				preview !== null && h("div", { style: s.preview },
					preview.map((m) => h("div", { key: m.id, style: s.previewItem },
						h("span", { style: s.previewMeta }, (m.createTime || "").slice(0, 10) + (m.pinned ? " · 置顶" : "")),
						(m.snippet || "").slice(0, 120) + (m.truncated ? "…" : "")
					))
				),
				msg !== "" && h("div", { style: s.msg }, msg)
			);
		}

		/** Required services. */
		const inject = ["slots"];
		/**
		 * Register the Memos settings page.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "memos",
					order: 301,
					label: () => "Memos"
				}, MemosSettingsPanel));
			} catch (error) {
				console.warn("[dsh-memos] settings panel registration failed:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
