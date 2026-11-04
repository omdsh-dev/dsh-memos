/**
 * dsh-memos — settings panel (client half).
 *
 * Rendered inside the web settings page (settings.section entry). Configuration
 * form (server URL / personal access token: save, test, clear) plus a small
 * read-back preview of the latest 5 memos. ModuleLoader classic script,
 * plain React (createElement), inline styles only; src/ is TypeScript, lib/
 * is tsc output.
 */

/** The ModuleLoader's CommonJS-style require; only react is used here. */
type ModuleRequire = (id: "react") => typeof import("react");

/** One ModuleLoader module definition (id + CommonJS-style factory). */
interface ModuleLoaderDefinition {
	id: string;
	factory: (require: ModuleRequire) => unknown;
}

interface Window {
	__ModuleLoader__: {
		load(definition: ModuleLoaderDefinition): void;
	};
}

window.__ModuleLoader__.load({
	id: "dsh-memos",
	factory: (require) => {
		var module = { exports: {} as Record<string, unknown> };
		var exports = module.exports;
		var React = require("react");
		var h = React.createElement;

		//#region api
		/** Error carrying the route's JSON error message. */
		class MemosApiError extends Error {
			constructor(message: string) {
				super(message);
				this.name = "MemosApiError";
			}
		}
		/** Config view returned by the host's /api/dsh-memos routes. */
		interface ConfigView {
			configured: boolean;
			serverUrl: string;
			masked: string;
			configPath: string;
		}
		/** Result of the /api/dsh-memos/test connectivity check. */
		interface TestResult {
			ok: boolean;
			message: string;
		}
		/** One memo summary row in the preview list (matches the host JSON). */
		interface PreviewItem {
			id: string;
			snippet: string;
			tags: string[];
			pinned: boolean;
			visibility: string;
			createTime: string;
			updateTime: string;
			truncated: boolean;
		}
		/** Result of the /api/dsh-memos/preview read-back. */
		interface PreviewResult {
			ok: boolean;
			message?: string;
			memos?: PreviewItem[];
		}
		/** Parse a JSON response or throw a MemosApiError. */
		async function readJson(response: Response): Promise<any> {
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
		async function request<T>(path: string, init?: RequestInit): Promise<T> {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new MemosApiError("网络请求失败: " + String(error instanceof Error ? error.message : error));
			}
			return readJson(response);
		}
		const api = {
			getConfig: () => request<ConfigView>("/api/dsh-memos/config"),
			setConfig: (patch: { serverUrl?: string; accessToken?: string; reset?: boolean }) => request<ConfigView>("/api/dsh-memos/config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch)
			}),
			test: () => request<TestResult>("/api/dsh-memos/test", { method: "POST" }),
			preview: () => request<PreviewResult>("/api/dsh-memos/preview", { method: "POST" })
		};
		//#endregion

		//#region styles
		/**
		 * One small stylesheet so :focus/:hover/:disabled work. Class names are
		 * plugin-scoped (.dsm-*) but every value mirrors dsh-gonic's .dsg-*
		 * form kit, so all settings panels read as one family. All colors come
		 * from the host's --dsw-alias-* layer (defined by dsh-client-ui-theme
		 * on body, light + dark) — they resolve with or without a skin plugin.
		 */
		const STYLE_ID = "dsm-styles";
		const STYLES = [
			".dsm-form{display:flex;flex-direction:column;gap:10px;max-width:420px;padding:16px}",
			".dsm-form-title{font-size:14px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}",
			".dsm-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}",
			".dsm-note-warn{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:1.6}",
			".dsm-field{display:flex;flex-direction:column;gap:4px}",
			".dsm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".dsm-input{width:100%;box-sizing:border-box;padding:6px 10px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}",
			".dsm-input:focus{border-color:var(--dsw-alias-brand-primary)}",
			".dsm-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px}",
			".dsm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dsm-btn[data-primary=\"1\"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}",
			".dsm-btn:disabled{opacity:.5;cursor:default}",
			".dsm-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}",
			".dsm-err{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:6px 4px}",
			".dsm-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
			".dsm-preview{font-size:12px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-primary)}",
			".dsm-preview-item{line-height:1.5}",
			".dsm-preview-meta{color:var(--dsw-alias-label-caption);margin-right:6px}"
		].join("\n");
		function ensureStyles(): void {
			if (document.getElementById(STYLE_ID)) return;
			const el = document.createElement("style");
			el.id = STYLE_ID;
			el.textContent = STYLES;
			document.head.appendChild(el);
		}
		//#endregion

		/** Status line for the current config view. */
		function statusText(view: ConfigView | null): string {
			if (view === null) return "加载中…";
			if (!view.configured) return "未配置 — 在 memos 网页端「设置 → Access Tokens / 访问令牌」创建令牌后，连同服务器地址填到下方。";
			return "已配置（" + view.serverUrl + "，令牌 " + view.masked + "）· " + view.configPath;
		}

		/** The settings panel component. */
		function MemosSettingsPanel() {
			const [view, setView] = React.useState<ConfigView | null>(null);
			const [serverUrl, setServerUrl] = React.useState("");
			const [accessToken, setAccessToken] = React.useState("");
			const [preview, setPreview] = React.useState<PreviewItem[] | null>(null);
			const [busy, setBusy] = React.useState(false);
			const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);

			const refresh = React.useCallback(async () => {
				try {
					setView(await api.getConfig());
				} catch (error) {
					setMsg({ text: "读取配置失败: " + String(error instanceof Error ? error.message : error), ok: false });
				}
			}, []);
			React.useEffect(() => { refresh(); }, [refresh]);

			/** Run one async panel action with busy/message bookkeeping. */
			const run = async (action: () => Promise<void>) => {
				setBusy(true);
				setMsg(null);
				try {
					await action();
				} catch (error) {
					setMsg({ text: "操作失败: " + String(error instanceof Error ? error.message : error), ok: false });
				} finally {
					setBusy(false);
				}
			};

			const save = () => run(async () => {
				const next = await api.setConfig({ serverUrl, accessToken });
				setView(next);
				setMsg(next.configured
					? { text: "配置已保存。", ok: true }
					: { text: "配置已保存（尚不完整：服务器地址和令牌都需要）。", ok: false });
			});
			const clear = () => run(async () => {
				const next = await api.setConfig({ reset: true });
				setView(next);
				setServerUrl("");
				setAccessToken("");
				setPreview(null);
				setMsg({ text: "配置已清除。", ok: true });
			});
			const test = () => run(async () => {
				const result = await api.test();
				setMsg({ text: result.message, ok: Boolean(result.ok) });
			});
			const loadPreview = () => run(async () => {
				const result = await api.preview();
				if (result.ok) {
					setPreview(Array.isArray(result.memos) ? result.memos : []);
					setMsg(result.memos && result.memos.length ? null : { text: "读取成功，当前没有笔记。", ok: true });
				} else {
					setPreview(null);
					setMsg({ text: result.message ?? "预览失败", ok: false });
				}
			});

			const configured = Boolean(view && view.configured);
			return h("div", { className: "dsm-form" },
				h("p", { className: "dsm-form-title" }, "Memos 笔记（usememos 自托管 · 只读）"),
				h("div", { className: configured ? "dsm-note" : "dsm-note-warn" }, statusText(view)),
				h("div", { className: "dsm-field" },
					h("label", { className: "dsm-label" }, "服务器地址"),
					h("input", {
						className: "dsm-input",
						placeholder: "https://memos.example.com",
						value: serverUrl,
						onChange: (event) => setServerUrl(event.target.value)
					})),
				h("div", { className: "dsm-field" },
					h("label", { className: "dsm-label" }, "访问令牌（PAT）"),
					h("input", {
						className: "dsm-input",
						placeholder: "memos 设置 → Access Tokens 创建",
						value: accessToken,
						onChange: (event) => setAccessToken(event.target.value)
					})),
				h("div", { className: "dsm-actions" },
					h("button", { className: "dsm-btn", "data-primary": "1", onClick: save, disabled: busy }, "保存配置"),
					h("button", { className: "dsm-btn", onClick: test, disabled: busy || !configured }, "测试连接"),
					h("button", { className: "dsm-btn", onClick: clear, disabled: busy || !configured }, "清除配置"),
					h("button", { className: "dsm-btn", onClick: loadPreview, disabled: busy || !configured }, "预览最近笔记")
				),
				msg !== null && h("div", { className: msg.ok ? "dsm-ok" : "dsm-err" }, msg.text),
				preview !== null && h("div", { className: "dsm-preview" },
					preview.map((m) => h("div", { key: m.id, className: "dsm-preview-item" },
						h("span", { className: "dsm-preview-meta" }, (m.createTime || "").slice(0, 10) + (m.pinned ? " · 置顶" : "")),
						(m.snippet || "").slice(0, 120) + (m.truncated ? "…" : "")
					))
				)
			);
		}

		/** Required services. */
		const inject = ["slots"];
		/** Minimal client context surface used by this panel (the slots service). */
		interface ClientContext {
			slots: {
				inject(name: string, callback: () => unknown): unknown;
				register(definition: { name: string; id: string; order: number; label: () => string }, component: unknown): unknown;
			};
		}
		/**
		 * Register the Memos settings page.
		 * @param ctx - client root context.
		 */
		function apply(ctx: ClientContext) {
			try {
				ensureStyles();
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
