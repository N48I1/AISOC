import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import type { DbClient } from "../../db/pool.js";
import {
  parseModelId,
  resolveProviders,
  PROVIDER_KIND_DEFAULTS,
  type LlmProvider,
  type ProviderKind,
} from "./llm-providers.js";

dotenv.config();

const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Server.ts wires the DB handle in at boot via setProviderDb(). Until it does,
// fall back to the legacy env-var keys so old deployments don't break. The
// provider snapshot itself lives in llm-providers.ts (refreshed asynchronously);
// _db here is just the "DB-backed mode is active" flag.
let _db: DbClient | null = null;

export function setProviderDb(db: DbClient) { _db = db; }

const cache = new Map<string, ChatOpenAI>();
const localClientCache = new Map<string, ChatOpenAI>();

let _localBaseUrl = "http://localhost:11434";

export function setLocalLLMBaseUrl(url: string) {
  _localBaseUrl = url.replace(/\/$/, "");
  localClientCache.clear();
  console.log(`[Agents] Local LLM base URL set to: ${_localBaseUrl}`);
}

export function getLocalLLMBaseUrl(): string { return _localBaseUrl; }

// Local-LLM auto-fallback (used when every external provider has failed).
// Pushed from server.ts at boot + on config save so llm.ts can read it without
// touching the DB directly.
let _localFallbackEnabled = false;
let _localFallbackModel   = "";
export function setLocalLLMFallback(enabled: boolean, model: string) {
  _localFallbackEnabled = !!enabled;
  _localFallbackModel   = (model || "").trim();
}
export function getLocalLLMFallback(): { enabled: boolean; model: string } {
  return { enabled: _localFallbackEnabled, model: _localFallbackModel };
}

export function isLocalModel(model: string): boolean { return model.startsWith("local::"); }
export function localModelName(model: string): string { return model.replace(/^local::/, ""); }

export function clearClientCache(): void { cache.clear(); }

function safeJson(s: string): Record<string, string> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

// Per-provider headers — OpenRouter wants Referer/Title, others don't care.
function headersFor(p: LlmProvider): Record<string, string> {
  const extra = p.headers_json ? safeJson(p.headers_json) : {};
  if (p.kind === "openrouter") {
    return { "HTTP-Referer": APP_URL, "X-Title": "BBS AISOC Platform", ...extra };
  }
  return extra;
}

function buildClient(p: LlmProvider, model: string): ChatOpenAI {
  const baseURL = (p.base_url || PROVIDER_KIND_DEFAULTS[p.kind].base_url).replace(/\/$/, "");
  return new ChatOpenAI({
    model,
    temperature: 0.1,
    maxRetries:  0,
    timeout:     30000,
    configuration: {
      apiKey: p.api_key || "missing-key",
      baseURL,
      defaultHeaders: headersFor(p),
    },
  });
}

function cacheKey(providerId: number, model: string): string { return `${providerId}::${model}`; }

export function getLocalModelClient(modelName: string, baseUrl?: string): ChatOpenAI {
  const url = (baseUrl || _localBaseUrl).replace(/\/$/, "");
  const key = `${url}::${modelName}`;
  if (!localClientCache.has(key)) {
    localClientCache.set(key, new ChatOpenAI({
      model:       modelName,
      temperature: 0.1,
      maxRetries:  0,
      timeout:     90000,
      modelKwargs: { response_format: { type: "json_object" } },
      configuration: { apiKey: "ollama", baseURL: `${url}/v1` },
    }));
  }
  return localClientCache.get(key)!;
}

export interface ResolvedClient { client: ChatOpenAI; provider: LlmProvider; }

// Returns the ordered list of (provider, client) pairs the LLM fallback chain
// should walk for this model. The model id may pin a specific provider id,
// a kind, or be a bare model name (legacy → openrouter only).
export function resolveClientsForModel(model: string): ResolvedClient[] {
  if (isLocalModel(model)) return [];

  if (!_db) return legacyEnvProviders(model);

  const parsed = parseModelId(model);
  const providers = resolveProviders(parsed);
  return providers.map(p => {
    const key = cacheKey(p.id, parsed.bare);
    if (!cache.has(key)) cache.set(key, buildClient(p, parsed.bare));
    return { client: cache.get(key)!, provider: p };
  });
}

function legacyEnvProviders(model: string): ResolvedClient[] {
  const candidates = [
    { id: -1, name: "env primary",   key: process.env.OPENROUTER_API_KEY         || "" },
    { id: -2, name: "env backup 1",  key: process.env.OPENROUTER_API_KEY_BACKUP  || "" },
    { id: -3, name: "env backup 2",  key: process.env.OPENROUTER_API_KEY_BACKUP2 || "" },
  ].filter(c => c.key);
  if (candidates.length === 0) {
    console.warn("[Agents] No LLM providers configured (DB empty + env vars unset). AI calls will fail.");
  }
  const bare = parseModelId(model).bare;
  return candidates.map((c, idx) => {
    const fake: LlmProvider = {
      id: c.id, name: c.name, kind: "openrouter" as ProviderKind,
      base_url: PROVIDER_KIND_DEFAULTS.openrouter.base_url, api_key: c.key,
      enabled: 1, priority: (idx + 1) * 10, headers_json: null,
      created_at: "", updated_at: "", last_test_at: null, last_test_ok: null, last_test_error: null,
    };
    const key = cacheKey(fake.id, bare);
    if (!cache.has(key)) cache.set(key, buildClient(fake, bare));
    return { client: cache.get(key)!, provider: fake };
  });
}

// Back-compat shim: returns the first resolved client. Old callers (none in
// the current tree after the llm.ts refactor) keep working.
export function getModelClient(model: string): ChatOpenAI {
  const r = resolveClientsForModel(model);
  if (r.length > 0) return r[0].client;
  return new ChatOpenAI({ model, configuration: { apiKey: "no-providers-configured", baseURL: "http://0.0.0.0" } });
}

// Test endpoint helper. Pings the provider with a tiny 1-token JSON
// completion. Returns ok/error + latency for the admin UI.
export async function testProvider(p: LlmProvider, model: string): Promise<{ ok: boolean; error?: string; latency_ms?: number }> {
  const t0 = Date.now();
  try {
    const client = buildClient(p, model);
    const resp = await client.invoke([
      { type: "system", content: "You respond with valid JSON only." },
      { type: "human",  content: 'Reply with exactly: {"ok":true}' },
    ] as any);
    const txt = String(resp.content ?? "");
    if (!txt) return { ok: false, error: "Empty response", latency_ms: Date.now() - t0 };
    return { ok: true, latency_ms: Date.now() - t0 };
  } catch (err: any) {
    return { ok: false, error: (err?.message || String(err)).slice(0, 300), latency_ms: Date.now() - t0 };
  }
}
