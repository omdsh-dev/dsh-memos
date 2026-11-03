/**
 * Smoke test for dsh-memos against a live memos instance — no real PAT needed:
 * we point the store at the instance with a fake token and verify the plugin
 * reaches the server and translates the 401 into a friendly error message.
 *
 * Usage: node scripts/smoke.mjs [serverUrl]
 */
import {
	MemosStore,
	memosConfigTool,
	memosGetTool,
	memosListTool,
	memosSearchTool,
	memosStatusTool,
	normalizeServerUrl,
	testConnection
} from "../lib/index.js";

const serverUrl = process.argv[2] || "https://memos.example.com";
let failures = 0;
const check = (label, cond, extra) => {
	console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra !== undefined ? "  →  " + extra : ""));
	if (!cond) failures++;
};

// 1. URL normalization
check("normalize bare host", normalizeServerUrl("memos.example.com/") === "https://memos.example.com", normalizeServerUrl("memos.example.com/"));
check("normalize keeps path", normalizeServerUrl("https://example.com/memos/") === "https://example.com/memos", normalizeServerUrl("https://example.com/memos/"));
check("normalize rejects junk", (() => { try { normalizeServerUrl("http://"); return false; } catch { return true; } })());

// 2. Store view / masking (in-memory only — no file writes)
const store = new MemosStore();
store.config = { serverUrl: normalizeServerUrl(serverUrl), accessToken: "fake-token-for-smoke-test" };
const view = store.view();
check("store view configured", view.configured === true && view.serverUrl === normalizeServerUrl(serverUrl), JSON.stringify(view));
check("token masked", view.masked.includes("****") && !view.masked.includes("fake-token-for-smoke"), view.masked);

// 3. Unconfigured path (fresh store, no config) — but only if no real config file exists
const emptyStore = new MemosStore();
emptyStore.config = { serverUrl: "", accessToken: "" };
const statusEmpty = await memosStatusTool(emptyStore).execute({});
check("status unconfigured", statusEmpty.configured === false);

// 4. Live instance: fake PAT. memos answers ListMemos anonymously (200, public
// memos only — 0 on this instance) instead of 401, so search/list succeed but
// see nothing; the *real* auth verdict comes from testConnection (/auth/me).
const search = await memosSearchTool(store).execute({ query: "test" });
check("search reaches server (anonymous view)", search.ok === true && search.count === 0, search.message);

const list = await memosListTool(store).execute({ limit: 5 });
check("list reaches server (anonymous view)", list.ok === true && list.count === 0, list.message);

const get = await memosGetTool(store).execute({ id: "1" });
check("get reaches server, 401/404 translated", get.ok === false && /401|认证|404/.test(get.message), get.message);

const conn = await testConnection(store);
check("testConnection rejects bad token", conn.ok === false && /认证|401/.test(conn.message), conn.message);

// 5. memos_config validation rejects garbage serverUrl
const badCfg = await memosConfigTool(emptyStore).execute({ serverUrl: "http://" }).catch((e) => ({ error: e.message }));
check("config rejects bad url", Boolean(badCfg.error), badCfg.error);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
