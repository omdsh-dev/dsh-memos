/**
 * dsh-memos — settings panel (client half).
 *
 * Rendered inside the web settings page (settings.section entry). Mirrors the
 * dsh-gonic settings form so every omdsh-dev panel reads as one family:
 * short plugin title → static storage note → labelled fields prefilled from
 * the saved config → one primary "save and test" action plus secondary
 * actions → ok/err feedback. Strings go through ctx.locale (en + zh).
 *
 * ModuleLoader classic script, plain React (createElement); src/ is
 * TypeScript, lib/ is tsc output.
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
		/** Body sent to POST /api/dsh-memos/config (omitted fields are kept). */
		interface ConfigPatch {
			serverUrl?: string;
			accessToken?: string;
			reset?: boolean;
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
				throw new MemosApiError(String(error instanceof Error ? error.message : error));
			}
			return readJson(response);
		}
		const api = {
			getConfig: () => request<ConfigView>("/api/dsh-memos/config"),
			setConfig: (patch: ConfigPatch) => request<ConfigView>("/api/dsh-memos/config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch)
			}),
			test: () => request<TestResult>("/api/dsh-memos/test", { method: "POST" }),
			preview: () => request<PreviewResult>("/api/dsh-memos/preview", { method: "POST" })
		};
		//#endregion

		//#region locale
		var DICT_EN: Record<string, string> = {
			"settings": "Memos",
			"loading": "Loading…",
			"form.note": "Credentials live on this machine in ~/.dsh/dsh-memos.json (mode 0600); the browser only holds them in memory. Agent tools and this panel share that config.",
			"form.serverUrl": "Server URL",
			"form.accessToken": "Access token",
			"form.tokenNew": "Create one in memos → Settings → Access Tokens",
			"form.tokenKeep": "leave blank to keep",
			"form.save": "Save and test",
			"form.saved": "Saved — connection OK.",
			"form.failed": "Connection failed",
			"form.incomplete": "Saved, but both the server URL and the access token are required.",
			"form.clear": "Clear",
			"form.cleared": "Configuration cleared.",
			"preview.button": "Preview recent",
			"preview.empty": "Loaded — no memos yet.",
			"preview.failed": "Preview failed",
			"error.read": "Could not read the configuration",
			"error.action": "Action failed",
			"unit.pinned": "pinned"
		};
		var DICT_ZH: Record<string, string> = {
			"settings": "Memos 笔记",
			"loading": "加载中…",
			"form.note": "凭据保存在本机 ~/.dsh/dsh-memos.json（权限 0600），浏览器只在内存中持有；agent 工具与设置面板共用这份配置。",
			"form.serverUrl": "服务器地址",
			"form.accessToken": "访问令牌",
			"form.tokenNew": "在 memos「设置 → Access Tokens」创建",
			"form.tokenKeep": "留空保持不变",
			"form.save": "保存并测试",
			"form.saved": "已保存——连接正常。",
			"form.failed": "连接失败",
			"form.incomplete": "已保存，但服务器地址和访问令牌都需要填写。",
			"form.clear": "清除配置",
			"form.cleared": "配置已清除。",
			"preview.button": "预览最近笔记",
			"preview.empty": "读取成功，当前没有笔记。",
			"preview.failed": "预览失败",
			"error.read": "读取配置失败",
			"error.action": "操作失败",
			"unit.pinned": "置顶"
		};
		// Module-level seat filled by apply.
		var t: (key: string) => string = function (key) { return key; };
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
			".dsm-field{display:flex;flex-direction:column;gap:4px}",
			".dsm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".dsm-input{width:100%;box-sizing:border-box;padding:6px 10px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}",
			".dsm-input:focus{border-color:var(--dsw-alias-brand-primary)}",
			".dsm-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
			".dsm-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px}",
			".dsm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dsm-btn[data-primary=\"1\"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}",
			".dsm-btn:disabled{opacity:.5;cursor:default}",
			".dsm-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}",
			".dsm-err{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:6px 4px}",
			".dsm-preview{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;display:flex;flex-direction:column;gap:6px}",
			".dsm-preview-item{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary)}",
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

		/** The settings panel component. */
		function MemosSettingsPanel() {
			const [view, setView] = React.useState<ConfigView | null>(null);
			const [serverUrl, setServerUrl] = React.useState("");
			const [accessToken, setAccessToken] = React.useState("");
			const [preview, setPreview] = React.useState<PreviewItem[] | null>(null);
			const [busy, setBusy] = React.useState(false);
			const [feedback, setFeedback] = React.useState<{ text: string; ok: boolean } | null>(null);

			/** Load the saved config and prefill the form (gonic does the same). */
			const load = React.useCallback(async () => {
				try {
					const next = await api.getConfig();
					setView(next);
					setServerUrl(next.serverUrl || "");
				} catch (error) {
					setFeedback({ text: t("error.read") + ": " + String(error instanceof Error ? error.message : error), ok: false });
				}
			}, []);
			React.useEffect(() => { void load(); }, [load]);

			/** Run one async panel action with busy/feedback bookkeeping. */
			const run = async (action: () => Promise<void>) => {
				setBusy(true);
				setFeedback(null);
				try {
					await action();
				} catch (error) {
					setFeedback({ text: String(error instanceof Error ? error.message : error), ok: false });
				} finally {
					setBusy(false);
				}
			};

			/**
			 * Save then test, like the gonic form: an incomplete config reports
			 * immediately, otherwise the connectivity probe decides ok/err.
			 * A blank token keeps the stored one (the host patches only what it
			 * receives).
			 */
			const save = () => run(async () => {
				const patch: ConfigPatch = { serverUrl: serverUrl.trim() };
				if (accessToken.trim()) patch.accessToken = accessToken.trim();
				const next = await api.setConfig(patch);
				setView(next);
				setServerUrl(next.serverUrl || "");
				if (!next.configured) {
					setFeedback({ text: t("form.incomplete"), ok: false });
					return;
				}
				const result = await api.test();
				if (result.ok) {
					setAccessToken("");
					setFeedback({ text: t("form.saved"), ok: true });
				} else {
					setFeedback({ text: t("form.failed") + ": " + result.message, ok: false });
				}
			});

			const clear = () => run(async () => {
				const next = await api.setConfig({ reset: true });
				setView(next);
				setServerUrl("");
				setAccessToken("");
				setPreview(null);
				setFeedback({ text: t("form.cleared"), ok: true });
			});

			const loadPreview = () => run(async () => {
				const result = await api.preview();
				if (!result.ok) {
					setPreview(null);
					setFeedback({ text: t("preview.failed") + ": " + (result.message ?? ""), ok: false });
					return;
				}
				const memos = Array.isArray(result.memos) ? result.memos : [];
				setPreview(memos);
				setFeedback(memos.length ? null : { text: t("preview.empty"), ok: true });
			});

			const configured = Boolean(view && view.configured);
			const tokenPlaceholder = configured && view !== null
				? view.masked + " · " + t("form.tokenKeep")
				: t("form.tokenNew");
			return h("div", { className: "dsm-form" },
				h("p", { className: "dsm-form-title" }, t("settings")),
				h("div", { className: "dsm-note" }, t("form.note")),
				h("div", { className: "dsm-field" },
					h("label", { className: "dsm-label" }, t("form.serverUrl")),
					h("input", {
						className: "dsm-input",
						placeholder: "https://memos.example.com",
						value: serverUrl,
						onChange: (event) => setServerUrl(event.target.value)
					})),
				h("div", { className: "dsm-field" },
					h("label", { className: "dsm-label" }, t("form.accessToken")),
					h("input", {
						className: "dsm-input",
						placeholder: tokenPlaceholder,
						value: accessToken,
						onChange: (event) => setAccessToken(event.target.value)
					})),
				h("div", { className: "dsm-actions" },
					h("button", { className: "dsm-btn", "data-primary": "1", onClick: save, disabled: busy },
						busy ? t("loading") : t("form.save")),
					h("button", { className: "dsm-btn", onClick: clear, disabled: busy || !configured }, t("form.clear")),
					h("button", { className: "dsm-btn", onClick: loadPreview, disabled: busy || !configured }, t("preview.button"))
				),
				feedback !== null && h("div", { className: feedback.ok ? "dsm-ok" : "dsm-err" }, feedback.text),
				preview !== null && h("div", { className: "dsm-preview" },
					preview.map((m) => h("div", { key: m.id, className: "dsm-preview-item" },
						h("span", { className: "dsm-preview-meta" },
							(m.createTime || "").slice(0, 10) + (m.pinned ? " · " + t("unit.pinned") : "")),
						(m.snippet || "").slice(0, 120) + (m.truncated ? "…" : "")
					))
				)
			);
		}

		/** Required services. */
		const inject = ["slots", "locale"];
		/** Minimal client context surface used by this panel. */
		interface ClientContext {
			slots: {
				inject(name: string, callback: () => unknown): unknown;
				register(definition: { name: string; id: string; order: number; label: () => string }, component: unknown): unknown;
			};
			locale: {
				register(plugin: string, locale: string, dict: Record<string, string>): unknown;
				bind(plugin: string): (key: string) => string;
			};
		}
		/**
		 * Register the locale dictionaries and the Memos settings page.
		 * @param ctx - client root context.
		 */
		function apply(ctx: ClientContext) {
			// Locale first, and in its own guard: a locale failure must never
			// cost us the settings panel (t falls back to the dict key).
			try {
				if (ctx.locale !== undefined) {
					ctx.locale.register("dsh-memos", "en", DICT_EN);
					ctx.locale.register("dsh-memos", "zh", DICT_ZH);
					ctx.locale.register("dsh-memos", "zh-CN", DICT_ZH);
					t = ctx.locale.bind("dsh-memos");
				}
			} catch (error) {
				console.warn("[dsh-memos] locale registration failed:", error);
			}
			try {
				ensureStyles();
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "memos",
					order: 301,
					label: () => t("settings")
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
