/**
 * dsh-memos — memos (usememos) read integration for DeepSeek Harness. Host half.
 *
 * Mounts the read-only memo tools (memos_search / memos_list / memos_get),
 * the credential tools (memos_config / memos_status), the /api/dsh-memos
 * route family the settings panel talks to, and a system-prompt announcement.
 * Credentials live in ~/.dsh/dsh-memos.json (mode 0600). Pure ESM, zero
 * runtime dependencies — no build step required.
 *
 * Targets the memos v0.x API (`/api/v1/...`, verified against v0.30.0):
 *   - GET /api/v1/memos?pageSize&pageToken&orderBy&filter   list + CEL filter
 *   - GET /api/v1/memos/{id}                                read one memo
 * Auth is a long-lived Personal Access Token (PAT), created in the memos web
 * UI (设置 → 偏好设置 → 访问令牌 / Access Tokens) and sent as
 * `Authorization: Bearer <token>`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Stable cordis plugin name. */
const name = "memos";
/** Services required before the memos surfaces can mount. */
const inject = ["tools", "systemPrompt", "webServer"];
/** Config file location (machine-wide, mode 0600). */
const CONFIG_FILE = path.join(homedir(), ".dsh", "dsh-memos.json");
/** Request timeout for a memos API call. */
const REQUEST_TIMEOUT_MS = 15e3;
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 151;
/** Route family. */
const MEMOS_API = {
	config: "/api/dsh-memos/config",
	test: "/api/dsh-memos/test",
	preview: "/api/dsh-memos/preview"
};
/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 64 * 1024;
/** Content preview length for list/search results (full text via memos_get). */
const PREVIEW_CHARS = 400;
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const MEMOS_GUIDANCE = "本机已安装 dsh-memos 插件（memos / usememos 自托管笔记只读集成）：配置一次服务器地址和访问令牌（PAT）后，可用 memos_search 按关键词/标签搜索笔记，memos_list 浏览最近笔记（支持分页），memos_get 读取单条完整内容。凭据存 ~/.dsh/dsh-memos.json（权限 0600），memos_config 配置或清除、memos_status 查看状态（不回显完整令牌）；也可以在 Web 设置页「Memos」面板中配置与测试。PAT 在 memos 网页端「设置 → Access Tokens / 访问令牌」创建。用户提到「memos / 我的笔记 / 便签 / 碎片笔记」并想查找内容时即指本插件，请据此协作。本插件只读：不提供写入、修改、删除能力。";

/** Mask a credential for display, keeping only the head and tail. */
function mask(value) {
	if (!value) return "";
	if (value.length <= 8) return value.slice(0, 2) + "****";
	return value.slice(0, 4) + "****" + value.slice(-4);
}

/** One text content block (the only render shape these tools emit). */
function text(value) {
	return [{ type: "text", text: value }];
}

/** Normalize a server base URL: trim, default to https, drop trailing slashes. */
function normalizeServerUrl(value) {
	let url = String(value || "").trim();
	if (!url) return "";
	if (!/^https?:\/\//i.test(url)) url = "https://" + url;
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("服务器地址不是合法 URL: " + url);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("服务器地址仅支持 http/https: " + url);
	}
	if (!parsed.hostname) throw new Error("服务器地址缺少主机名: " + url);
	return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, ""));
}

/** Escape a user string for embedding in a CEL double-quoted literal. */
function escapeCelString(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]+/g, " ");
}

/** Clamp an integer page-size-ish argument. */
function clampLimit(value, fallback, max) {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.min(Math.floor(n), max);
}

/** Extract the bare numeric/string id from a memo resource name. */
function memoId(memo) {
	const name = typeof memo?.name === "string" ? memo.name : "";
	return name.startsWith("memos/") ? name.slice("memos/".length) : name;
}

/** One-line summary of a memo for list/search results. */
function summarize(memo) {
	const content = typeof memo?.content === "string" ? memo.content : "";
	const snippet = typeof memo?.snippet === "string" && memo.snippet ? memo.snippet : content;
	const cut = snippet.length > PREVIEW_CHARS ? snippet.slice(0, PREVIEW_CHARS) + "…" : snippet;
	return {
		id: memoId(memo),
		snippet: cut,
		tags: Array.isArray(memo?.tags) ? memo.tags : [],
		pinned: memo?.pinned === true,
		visibility: typeof memo?.visibility === "string" ? memo.visibility : "",
		createTime: typeof memo?.createTime === "string" ? memo.createTime : "",
		updateTime: typeof memo?.updateTime === "string" ? memo.updateTime : "",
		truncated: snippet.length > PREVIEW_CHARS || content.length > cut.length
	};
}

/** Full detail of a memo for memos_get. */
function detail(memo) {
	const attachments = Array.isArray(memo?.attachments) ? memo.attachments : [];
	return {
		id: memoId(memo),
		content: typeof memo?.content === "string" ? memo.content : "",
		tags: Array.isArray(memo?.tags) ? memo.tags : [],
		pinned: memo?.pinned === true,
		visibility: typeof memo?.visibility === "string" ? memo.visibility : "",
		state: typeof memo?.state === "string" ? memo.state : "",
		createTime: typeof memo?.createTime === "string" ? memo.createTime : "",
		updateTime: typeof memo?.updateTime === "string" ? memo.updateTime : "",
		attachments: attachments.map((a) => ({
			filename: typeof a?.filename === "string" ? a.filename : "",
			type: typeof a?.type === "string" ? a.type : "",
			size: typeof a?.size === "string" ? a.size : ""
		}))
	};
}

/** Render a memo summary list as plain text for the conversation view. */
function renderList(title, memos, nextPageToken) {
	if (!memos.length) return title + "：没有匹配的笔记。";
	const lines = memos.map((m) => {
		const tagText = m.tags.length ? " #" + m.tags.join(" #") : "";
		const pin = m.pinned ? "📌 " : "";
		const time = m.createTime ? m.createTime.slice(0, 10) : "";
		return "- [" + m.id + "] " + pin + time + " " + m.snippet.replace(/\n+/g, " / ") + tagText;
	});
	const more = nextPageToken ? "\n（还有更多，传 pageToken 翻页）" : "";
	return title + "（" + memos.length + " 条" + (nextPageToken ? "，还有更多" : "") + "）：\n" + lines.join("\n") + more;
}

/**
 * Small credential store backed by ~/.dsh/dsh-memos.json.
 * Reads are lazy and cached; writes use mode 0600 so the PAT never leaks to
 * other local users.
 */
var MemosStore = class {
	config = null;
	async load() {
		if (this.config !== null) return this.config;
		try {
			const raw = await readFile(CONFIG_FILE, "utf8");
			const parsed = JSON.parse(raw);
			const record = typeof parsed === "object" && parsed !== null ? parsed : {};
			this.config = {
				serverUrl: normalizeServerUrl(record.serverUrl || "") || "",
				accessToken: typeof record.accessToken === "string" ? record.accessToken : ""
			};
		} catch (err) {
			this.config = { serverUrl: "", accessToken: "" };
		}
		return this.config;
	}
	async save(next) {
		this.config = next;
		await mkdir(path.dirname(CONFIG_FILE), { recursive: true });
		await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 384 });
	}
	/** Resolved { base, token } pair, or null when incompletely configured. */
	async credentials() {
		const cfg = await this.load();
		const base = (cfg.serverUrl || "").trim();
		const token = (cfg.accessToken || "").trim();
		if (!base || !token) return null;
		return { base, token };
	}
	/** Public view: configured flag, server URL, masked token, config path. */
	view() {
		const cfg = this.config ?? { serverUrl: "", accessToken: "" };
		const configured = Boolean((cfg.serverUrl || "").trim() && (cfg.accessToken || "").trim());
		return {
			configured,
			serverUrl: cfg.serverUrl || "",
			masked: configured ? mask(cfg.accessToken) : "",
			configPath: CONFIG_FILE
		};
	}
	/** Apply a set-config patch: strings replace, reset clears, undefined keeps. */
	async patch(args) {
		const cfg = await this.load();
		const next = { serverUrl: cfg.serverUrl, accessToken: cfg.accessToken };
		if (args && args.reset === true) {
			next.serverUrl = "";
			next.accessToken = "";
		}
		if (args && typeof args.serverUrl === "string") next.serverUrl = normalizeServerUrl(args.serverUrl);
		if (args && typeof args.accessToken === "string") next.accessToken = args.accessToken.trim();
		await this.save(next);
		return this.view();
	}
};

/** One memos API GET. Throws Error with a friendly message on failure. */
async function apiGet(store, apiPath, query) {
	const creds = await store.credentials();
	if (!creds) {
		throw new Error("尚未配置 memos：请在 Web 设置页「Memos」面板填写服务器地址和访问令牌（PAT），或使用 memos_config 工具（PAT 在 memos 网页端「设置 → Access Tokens」创建）。");
	}
	const url = new URL(creds.base + "/api/v1" + apiPath);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
		}
	}
	let res;
	try {
		res = await fetch(url, {
			method: "GET",
			headers: {
				Accept: "application/json",
				Authorization: "Bearer " + creds.token
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (err) {
		throw new Error("无法连接 memos 服务器（" + creds.base + "）: " + String(err instanceof Error ? err.message : err));
	}
	const body = await res.text();
	let parsed = null;
	try {
		parsed = JSON.parse(body);
	} catch (err) {}
	if (!res.ok) {
		const detailText = parsed && typeof parsed === "object" && typeof parsed.message === "string" ? parsed.message : body.slice(0, 200);
		if (res.status === 401 || res.status === 403) {
			throw new Error("memos 认证失败（HTTP " + res.status + "）：访问令牌无效、过期或已删除，请重新配置 PAT。" + (detailText ? " " + detailText : ""));
		}
		if (res.status === 404) throw new Error("memos 资源不存在（404）：" + apiPath);
		throw new Error("memos 请求失败（HTTP " + res.status + "）: " + detailText);
	}
	if (parsed === null || typeof parsed !== "object") {
		throw new Error("memos 返回了非 JSON 响应（HTTP " + res.status + "），请检查服务器地址是否正确指向 memos 实例。");
	}
	return parsed;
}

/** Connectivity + auth check used by the settings panel. */
async function testConnection(store) {
	const view = store.view();
	if (!view.configured) return { ok: false, message: "尚未配置服务器地址或访问令牌。" };
	const creds = await store.credentials();
	let version = "";
	try {
		const res = await fetch(creds.base + "/api/v1/instance/profile", {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		const profile = await res.json().catch(() => null);
		if (profile && typeof profile.version === "string") version = profile.version;
	} catch (err) {}
	// /api/v1/auth/me validates the PAT itself — ListMemos alone is not a valid
	// check because memos may answer anonymously (public memos only) instead of
	// returning 401 for a bad token.
	try {
		const me = await apiGet(store, "/auth/me");
		const user = me && typeof me.user === "object" && me.user ? me.user : {};
		const who = typeof user.username === "string" && user.username ? user.username : typeof user.name === "string" ? user.name : "";
		return {
			ok: true,
			message: "连接成功：实例版本 v" + (version || "未知") + "，令牌有效" + (who ? "，已认证为 " + who : "") + "。"
		};
	} catch (err) {
		const detailText = String(err instanceof Error ? err.message : err);
		const suffix = version ? "（服务器可达，版本 v" + version + "，问题出在令牌）" : "（服务器本身不可达，请检查地址）";
		return { ok: false, message: detailText + suffix };
	}
}

/** memos_search — keyword/tag search over the user's memos. */
function memosSearchTool(store) {
	return defineTool({
		name: "memos_search",
		description: "在用户的 memos（usememos 自托管笔记）中按关键词和/或标签搜索笔记。返回匹配笔记的摘要列表（id、摘要、标签、时间）；需要完整内容时用返回的 id 调用 memos_get。",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "搜索关键词（匹配笔记正文，如 \"路由协议\"）；留空字符串则仅按 tag 过滤"
			},
			tag: {
				type: "string",
				description: "可选：按标签过滤（如 \"ideas\"，不带 # 前缀）"
			},
			limit: {
				type: "number",
				description: "返回条数，默认 10，最大 50"
			},
			pageToken: {
				type: "string",
				description: "翻页令牌：上一次返回的 nextPageToken"
			},
			orderBy: {
				type: "string",
				description: "排序，默认 \"create_time desc\"（如 \"update_time desc\"、\"create_time asc\"）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					message: { type: "string", required: true },
					count: { type: "number" },
					memos: { type: "array" },
					nextPageToken: { type: "string" }
				}
			},
			render: (args, value) => {
				if (!value.ok) return text("[failed] " + value.message);
				const title = "memos 搜索 " + JSON.stringify(args.query ?? "") + (args.tag ? " #" + args.tag : "");
				return text(renderList(title, Array.isArray(value.memos) ? value.memos : [], value.nextPageToken));
			}
		},
		async execute(args) {
			const query = typeof args.query === "string" ? args.query.trim() : "";
			const tag = typeof args.tag === "string" ? args.tag.trim().replace(/^#+/, "") : "";
			if (!query && !tag) return { ok: false, message: "query 和 tag 至少提供一个" };
			const parts = [];
			if (query) parts.push('content.contains("' + escapeCelString(query) + '")');
			if (tag) parts.push('"' + escapeCelString(tag) + '" in tags');
			try {
				const data = await apiGet(store, "/memos", {
					pageSize: clampLimit(args.limit, 10, 50),
					pageToken: typeof args.pageToken === "string" ? args.pageToken : "",
					orderBy: typeof args.orderBy === "string" && args.orderBy.trim() ? args.orderBy.trim() : "create_time desc",
					filter: parts.join(" && ")
				});
				const memos = (Array.isArray(data.memos) ? data.memos : []).map(summarize);
				const nextPageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
				return {
					ok: true,
					message: "找到 " + memos.length + " 条笔记" + (nextPageToken ? "（还有更多）" : ""),
					count: memos.length,
					memos,
					nextPageToken
				};
			} catch (err) {
				return { ok: false, message: String(err instanceof Error ? err.message : err) };
			}
		}
	});
}

/** memos_list — browse the most recent memos with pagination. */
function memosListTool(store) {
	return defineTool({
		name: "memos_list",
		description: "列出用户 memos（usememos 自托管笔记）中最新的笔记，按时间倒序，支持分页。返回摘要列表（id、摘要、标签、时间）；需要完整内容时用返回的 id 调用 memos_get。",
		parameters: {
			limit: {
				type: "number",
				description: "返回条数，默认 20，最大 100"
			},
			pageToken: {
				type: "string",
				description: "翻页令牌：上一次返回的 nextPageToken"
			},
			orderBy: {
				type: "string",
				description: "排序，默认 \"create_time desc\"（如 \"update_time desc\"）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					message: { type: "string", required: true },
					count: { type: "number" },
					memos: { type: "array" },
					nextPageToken: { type: "string" }
				}
			},
			render: (_args, value) => {
				if (!value.ok) return text("[failed] " + value.message);
				return text(renderList("memos 最近笔记", Array.isArray(value.memos) ? value.memos : [], value.nextPageToken));
			}
		},
		async execute(args) {
			try {
				const data = await apiGet(store, "/memos", {
					pageSize: clampLimit(args.limit, 20, 100),
					pageToken: typeof args.pageToken === "string" ? args.pageToken : "",
					orderBy: typeof args.orderBy === "string" && args.orderBy.trim() ? args.orderBy.trim() : "create_time desc"
				});
				const memos = (Array.isArray(data.memos) ? data.memos : []).map(summarize);
				const nextPageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
				return {
					ok: true,
					message: "返回 " + memos.length + " 条笔记" + (nextPageToken ? "（还有更多，可传 pageToken 翻页）" : ""),
					count: memos.length,
					memos,
					nextPageToken
				};
			} catch (err) {
				return { ok: false, message: String(err instanceof Error ? err.message : err) };
			}
		}
	});
}

/** memos_get — read one memo in full. */
function memosGetTool(store) {
	return defineTool({
		name: "memos_get",
		description: "按 id 读取一条 memos 笔记的完整内容（含标签、附件清单、创建/更新时间）。id 来自 memos_search / memos_list 的返回（如 \"123\" 或 \"memos/123\"）。",
		parameters: {
			id: {
				type: "string",
				required: true,
				description: "笔记 id（数字或 memos/{id} 形式均可）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					message: { type: "string", required: true },
					memo: { type: "object" }
				}
			},
			render: (_args, value) => {
				if (!value.ok) return text("[failed] " + value.message);
				const m = value.memo ?? {};
				const head = "memos 笔记 #" + (m.id ?? "") + "（" + (m.createTime ?? "").slice(0, 16).replace("T", " ") + (m.pinned ? "，📌置顶" : "") + "）";
				const tags = Array.isArray(m.tags) && m.tags.length ? "\n标签：" + m.tags.map((t) => "#" + t).join(" ") : "";
				const atts = Array.isArray(m.attachments) && m.attachments.length ? "\n附件：" + m.attachments.map((a) => a.filename || a.type).join("、") : "";
				return text(head + "\n\n" + (m.content ?? "") + tags + atts);
			}
		},
		async execute(args) {
			const raw = typeof args.id === "string" ? args.id.trim() : "";
			const id = raw.startsWith("memos/") ? raw.slice("memos/".length) : raw;
			if (!id || !/^[\w-]+$/.test(id)) return { ok: false, message: "id 不合法: " + raw };
			try {
				const memo = await apiGet(store, "/memos/" + encodeURIComponent(id));
				return { ok: true, message: "已读取笔记 #" + memoId(memo), memo: detail(memo) };
			} catch (err) {
				return { ok: false, message: String(err instanceof Error ? err.message : err) };
			}
		}
	});
}

/** memos_config — set or clear server URL / PAT. */
function memosConfigTool(store) {
	return defineTool({
		name: "memos_config",
		description: "配置 memos 连接凭据：serverUrl（自托管 memos 实例地址，如 https://memos.example.com）和 accessToken（PAT，在 memos 网页端「设置 → Access Tokens」创建）。两者都需要。配置持久化到 ~/.dsh/dsh-memos.json（权限 0600）。传 reset: true 清除配置。",
		parameters: {
			serverUrl: {
				type: "string",
				description: "memos 实例地址（http/https，可省略协议头，默认补 https://）"
			},
			accessToken: {
				type: "string",
				description: "memos 访问令牌（PAT）"
			},
			reset: {
				type: "boolean",
				description: "设为 true 时清除已保存的配置"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					configured: { type: "boolean", required: true },
					serverUrl: { type: "string" },
					masked: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(value.configured === true
				? "已配置（" + (value.serverUrl ?? "") + "，令牌 " + (value.masked ?? "") + "），保存于 " + (value.configPath ?? "")
				: "尚未配置，请提供 serverUrl 和 accessToken"),
		},
		async execute(args) {
			return store.patch(args);
		}
	});
}

/** memos_status — show connection configuration state (never the full PAT). */
function memosStatusTool(store) {
	return defineTool({
		name: "memos_status",
		description: "查看 memos 插件连接状态：是否已配置、服务器地址、令牌掩码、配置文件路径。不会泄露完整令牌。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					configured: { type: "boolean", required: true },
					serverUrl: { type: "string" },
					masked: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(value.configured === true
				? "已配置（" + (value.serverUrl ?? "") + "，令牌 " + (value.masked ?? "") + "），保存于 " + (value.configPath ?? "")
				: "未配置"),
		},
		async execute() {
			await store.load();
			return store.view();
		}
	});
}

/** Loopback-only fence plus browser same-origin markers (mirrors dsh-flomo). */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > MAX_JSON_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}

/**
 * Build every /api/dsh-memos route (exact paths).
 * @param store - the credential store.
 * @returns the route list.
 */
function makeRoutes(store) {
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};
	return [
		{
			kind: "exact",
			path: MEMOS_API.config,
			handler: async (req, res) => {
				const method = req.method ?? "GET";
				if (method === "GET") {
					if (!guard(req, res, "GET")) return;
					await store.load();
					writeJson(res, 200, store.view());
					return;
				}
				if (method === "POST") {
					if (!guard(req, res, "POST")) return;
					const body = await readJsonBody(req);
					if (body === void 0) {
						writeJson(res, 400, { error: "invalid JSON body" });
						return;
					}
					try {
						writeJson(res, 200, await store.patch(body));
					} catch (error) {
						writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
					}
					return;
				}
				writeJson(res, 405, { error: `method not allowed: ${method}` });
			}
		},
		{
			kind: "exact",
			path: MEMOS_API.test,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				await store.load();
				writeJson(res, 200, await testConnection(store));
			}
		},
		{
			kind: "exact",
			path: MEMOS_API.preview,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					const data = await apiGet(store, "/memos", { pageSize: 5, orderBy: "create_time desc" });
					const memos = (Array.isArray(data.memos) ? data.memos : []).map(summarize);
					writeJson(res, 200, { ok: true, memos });
				} catch (err) {
					writeJson(res, 200, { ok: false, message: String(err instanceof Error ? err.message : err) });
				}
			}
		}
	];
}

/**
 * Mount the memos tools, routes, and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer.
 * @param config - plugin config from the composition row.
 */
function apply(ctx, config) {
	const announceToAgent = config?.announceToAgent !== false;
	const enabled = config?.enabled !== false;
	const store = new MemosStore();
	let disposeTools;
	let disposeRoutes;
	let disposeSection;
	const sync = () => {
		if (disposeTools !== void 0) {
			disposeTools();
			disposeTools = void 0;
		}
		if (disposeRoutes !== void 0) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		if (!enabled) return;
		const tools = [
			memosSearchTool(store),
			memosListTool(store),
			memosGetTool(store),
			memosConfigTool(store),
			memosStatusTool(store)
		];
		disposeTools = ctx.effect(() => {
			const disposers = tools.map((tool) => ctx.tools.register(tool));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-memos: tools");
		disposeRoutes = ctx.effect(() => {
			const disposers = makeRoutes(store).map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-memos: routes");
		if (announceToAgent) disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-memos",
			order: SECTION_ORDER,
			text: MEMOS_GUIDANCE
		});
	};
	sync();
}

export {
	MEMOS_API,
	MEMOS_GUIDANCE,
	MemosStore,
	apply,
	detail,
	inject,
	makeRoutes,
	memosConfigTool,
	memosGetTool,
	memosListTool,
	memosSearchTool,
	memosStatusTool,
	name,
	normalizeServerUrl,
	summarize,
	testConnection
};
