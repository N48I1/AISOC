import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  resolveClientsForModel,
  getLocalModelClient, isLocalModel, localModelName, getLocalLLMFallback,
} from "./client.js";

function extractJSONObject(raw: string): unknown {
  let s = (raw || "").trim();
  s = s.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();

  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in LLM response: ${s.slice(0, 300)}`);
  }
  let c = s.slice(start, end + 1);

  c = c.replace(/("[^"\\]*(?:\\.[^"\\]*)*")|\/\/[^\n]*/g, (m, str) => str ?? "");
  c = c.replace(/("[^"\\]*(?:\\.[^"\\]*)*")|\/\*[\s\S]*?\*\//g, (m, str) => str ?? "");
  c = c.replace(/(\d)\.(\s*[,}\]])/g, "$1.0$2");
  c = c.replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(c);
  } catch {
    c = c.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
    return JSON.parse(c);
  }
}

const ENUM_VALUES: Record<string, string[]> = {
  severity_validation:   ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
  priority:              ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
  recommended_action:    ["MONITOR", "INVESTIGATE", "CONTAIN", "ESCALATE", "BLOCK", "IGNORE"],
  containment_priority:  ["IMMEDIATE", "HIGH", "MEDIUM", "LOW"],
  action_type:           ["BLOCK_IP", "ISOLATE_HOST", "DISABLE_USER", "RESET_PASSWORD", "QUARANTINE_FILE", "NOTIFY_TEAM", "FIREWALL_RULE", "OTHER"],
  action_priority:       ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
  sla_status:            ["SLA_MET", "SLA_AT_RISK", "SLA_BREACHED"],
  quality_gate:          ["PASS", "REVIEW", "FAIL"],
  recommendation:        ["CLOSE", "ESCALATE", "MONITOR", "INVESTIGATE_FURTHER"],
  threat_actor_type:     ["nation-state", "cybercriminal", "insider", "hacktivist", "unknown"],
};

const CONFIDENCE_KEYS = new Set(["confidence", "false_positive_confidence", "fp_confidence"]);

function normalizeByFallback(candidate: any, fallback: any): any {
  if (fallback == null || typeof fallback !== "object") return candidate;
  if (Array.isArray(fallback)) return Array.isArray(candidate) ? candidate : fallback;
  if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;

  const out: any = { ...candidate };
  for (const [key, fallbackValue] of Object.entries(fallback)) {
    const value = out[key];
    if (value === undefined || value === null) {
      if (fallbackValue !== undefined) out[key] = fallbackValue;
      continue;
    }

    if (ENUM_VALUES[key]) {
      const raw = String(value).trim();
      const normalized = raw.toUpperCase().replace(/[\s-]+/g, "_");
      const lowerMatch = ENUM_VALUES[key].find(v => v.toLowerCase() === raw.toLowerCase());
      out[key] = ENUM_VALUES[key].includes(normalized) ? normalized : lowerMatch || fallbackValue;
      continue;
    }

    if (CONFIDENCE_KEYS.has(key) && typeof value === "number") {
      out[key] = value > 1 ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value));
      continue;
    }

    if (typeof fallbackValue === "number" && typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : fallbackValue;
      continue;
    }

    if (typeof fallbackValue === "boolean" && typeof value === "string") {
      out[key] = /^(true|yes|1)$/i.test(value) ? true : /^(false|no|0)$/i.test(value) ? false : fallbackValue;
      continue;
    }

    if (typeof fallbackValue === "string" && typeof value !== "string") {
      out[key] = String(value ?? fallbackValue);
      continue;
    }

    if (Array.isArray(fallbackValue) && !Array.isArray(value)) {
      out[key] = fallbackValue;
      continue;
    }

    if (fallbackValue && typeof fallbackValue === "object" && value && typeof value === "object") {
      out[key] = normalizeByFallback(value, fallbackValue);
    }
  }
  return out;
}

function parseWithRepair<T>(phase: string, label: string, json: unknown, schema: z.ZodType<T>, fallback: T): { data?: T; error?: string; repaired?: boolean } {
  const parsed = schema.safeParse(json);
  if (parsed.success) return { data: parsed.data };

  const repairedJson = normalizeByFallback(json, fallback);
  const repaired = schema.safeParse(repairedJson);
  if (repaired.success) {
    console.warn(`[LLM Schema Repair][${phase}][${label}] normalized near-valid response`);
    return { data: repaired.data, repaired: true };
  }

  const issues = repaired.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { error: issues };
}

// ── Per-orchestration run context (replaces module-level globals) ───────────
export interface RunContext {
  traceId:         string;
  quotaExhausted:  boolean;
  fallbackPhases:  string[];
  agentLogs:       string[];
  // Machine-readable reason a phase fell back, keyed by phase. Surfaced in the
  // UI so operators see *why* an agent produced placeholder data (timeout, quota,
  // no providers, schema mismatch, …) instead of just "fallback".
  phaseErrors:     Record<string, string>;
}

export function newRunContext(traceId?: string): RunContext {
  return {
    traceId:        traceId ?? (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())),
    quotaExhausted: false,
    fallbackPhases: [],
    agentLogs:      [],
    phaseErrors:    {},
  };
}

// Record (last-write-wins) the reason a phase fell back to its placeholder.
function recordPhaseError(runCtx: RunContext, phase: string, reason: string) {
  runCtx.phaseErrors[phase] = reason;
}

// Default ctx for legacy callers that don't pass one (deprecated).
let _legacyCtx: RunContext = newRunContext("legacy");

export function resetLLMRunState() { _legacyCtx = newRunContext("legacy"); }
export function getLLMRunState() {
  return { quotaExhausted: _legacyCtx.quotaExhausted, fallbackPhases: [..._legacyCtx.fallbackPhases] };
}

interface CallStructuredParams<T> {
  phase:        string;
  model:        string;
  systemPrompt: string;
  userPrompt:   string;
  schema:       z.ZodType<T>;
  fallback:     T;
  ctx?:         RunContext;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isDailyQuotaError(msg: string): boolean {
  return /free-models-per-day|credits to unlock|daily quota|per-day/i.test(msg);
}

// ── Global LLM throttle ──────────────────────────────────────────────────────
// The orchestrator fires several agents in parallel. Free-tier providers
// (OpenRouter/Gemini) reject the resulting burst with 429s, and a single CPU
// Ollama instance times out under concurrent load. So we cap how many LLM
// requests run at once and space their starts, keeping us under per-minute
// rate limits. A single call is unaffected; only bursts are smoothed out.
const MAX_CONCURRENT_LLM = Number(process.env.LLM_MAX_CONCURRENCY || 2);
const MIN_CALL_SPACING_MS = Number(process.env.LLM_MIN_SPACING_MS || 700);
let _activeCalls = 0;
let _lastCallStart = 0;
const _waitQueue: Array<() => void> = [];

async function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (_activeCalls >= MAX_CONCURRENT_LLM) {
    await new Promise<void>((res) => _waitQueue.push(res));
  }
  _activeCalls++;
  // Space out call starts so a wave of agents doesn't hit the rate limit at once.
  const since = Date.now() - _lastCallStart;
  if (since < MIN_CALL_SPACING_MS) await sleep(MIN_CALL_SPACING_MS - since);
  _lastCallStart = Date.now();
  try {
    return await fn();
  } finally {
    _activeCalls--;
    const next = _waitQueue.shift();
    if (next) next();
  }
}

export async function callStructuredLLM<T>({
  phase, model, systemPrompt, userPrompt, schema, fallback, ctx,
}: CallStructuredParams<T>): Promise<T> {
  const runCtx = ctx ?? _legacyCtx;

  const fallbackParsed = schema.safeParse(fallback);
  if (!fallbackParsed.success) throw new Error(`[${phase}] invalid fallback schema`);

  const messages = [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)];

  // ── Local Ollama path ─────────────────────────────────────────────────────
  if (isLocalModel(model)) {
    const name = localModelName(model);
    console.log(`[LLM][${runCtx.traceId.slice(0,8)}][${phase}] local::${name}`);
    try {
      const client = getLocalModelClient(name);
      const resp   = await withLlmSlot(() => client.invoke(messages));
      const json   = extractJSONObject(String(resp.content ?? ""));
      const parsed = parseWithRepair(phase, "local", json, schema, fallbackParsed.data);
      if (!parsed.data) {
        const issues = parsed.error || "schema mismatch";
        console.error(`[LLM Schema Error][${phase}][local] ${issues}`);
        runCtx.fallbackPhases.push(phase);
        recordPhaseError(runCtx, phase, `schema_mismatch: ${issues.slice(0, 160)}`);
        return fallbackParsed.data;
      }
      return parsed.data;
    } catch (err: any) {
      const msg = (err?.message ?? String(err)).slice(0, 200);
      console.error(`[LLM Error][${phase}][local::${name}]`, msg);
      runCtx.fallbackPhases.push(phase);
      recordPhaseError(runCtx, phase, `local_error: ${msg}`);
      return fallbackParsed.data;
    }
  }

  // ── External provider path ───────────────────────────────────────────────
  // resolveClientsForModel walks the DB-backed provider registry in priority
  // order (or the env-var fallback if no registry is wired). Each entry is
  // tried in order; rate-limit errors fall through to the next provider with
  // a short backoff. Quota / hard failures short-circuit.
  const resolved = resolveClientsForModel(model);
  if (resolved.length === 0) {
    // No external provider for this model — record the reason but DON'T return:
    // fall through to the local Ollama fallback below so the phase can still
    // produce a real result instead of placeholder data.
    console.error(`[LLM Error][${phase}] No providers configured for model "${model}" — trying local fallback`);
    recordPhaseError(runCtx, phase, `no_providers: no LLM provider configured for "${model}"`);
  }

  for (let i = 0; i < resolved.length; i++) {
    const { client, provider } = resolved[i];
    const label = `${provider.kind}#${provider.id}`;
    try {
      const resp   = await withLlmSlot(() => client.invoke(messages));
      const json   = extractJSONObject(String(resp.content ?? ""));
      const parsed = parseWithRepair(phase, label, json, schema, fallbackParsed.data);
      if (!parsed.data) {
        const issues = parsed.error || "schema mismatch";
        console.error(`[LLM Schema Error][${phase}][${label}] ${issues}`);
        runCtx.fallbackPhases.push(phase);
        recordPhaseError(runCtx, phase, `schema_mismatch: ${issues.slice(0, 160)}`);
        return fallbackParsed.data;
      }
      return parsed.data;
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      const isRateLimit = msg.includes("429") || /rate.?limit/i.test(msg);
      const isQuota = isDailyQuotaError(msg);
      if (isQuota) runCtx.quotaExhausted = true;
      recordPhaseError(runCtx, phase, `${isQuota ? 'quota' : isRateLimit ? 'rate_limit' : 'provider_error'} (${label}): ${msg.slice(0, 160)}`);

      if (isRateLimit && i < resolved.length - 1) {
        const delay = (i + 1) * 2000;
        console.warn(`[LLM][${phase}] rate-limited on ${label}, trying next provider in ${delay / 1000}s…`);
        await sleep(delay);
        continue;
      }
      console.error(`[LLM Error][${phase}][${label}]`, msg.slice(0, 300));
      if (i < resolved.length - 1) continue;   // keep walking the chain on non-rate-limit errors too
      // All external providers exhausted — fall through to local fallback below.
      break;
    }
  }

  // ── Local LLM fallback (when every external provider has failed) ─────────
  // Triggers when local_llm_config.enabled = '1' AND a fallback_model is set.
  // This lets us keep auto-orchestrate working when the OpenRouter free tier
  // hits its daily cap.
  const localFb = getLocalLLMFallback();
  if (localFb.enabled && localFb.model) {
    console.warn(`[LLM][${phase}] All external providers failed — falling back to local::${localFb.model}`);
    try {
      const client = getLocalModelClient(localFb.model);
      const resp   = await withLlmSlot(() => client.invoke(messages));
      const json   = extractJSONObject(String(resp.content ?? ""));
      const parsed = parseWithRepair(phase, "local-fallback", json, schema, fallbackParsed.data);
      if (parsed.data) {
        runCtx.fallbackPhases.push(`${phase}:local-fallback`);
        // Recovered on the local model — the data is real, so drop the error reason.
        delete runCtx.phaseErrors[phase];
        return parsed.data;
      }
      const issues = parsed.error || "schema mismatch";
      console.error(`[LLM Schema Error][${phase}][local-fallback] ${issues}`);
      recordPhaseError(runCtx, phase, `local_fallback_failed: schema_mismatch ${issues.slice(0, 140)}`);
    } catch (err: any) {
      const msg = (err?.message ?? String(err)).slice(0, 200);
      console.error(`[LLM Error][${phase}][local-fallback]`, msg);
      recordPhaseError(runCtx, phase, `local_fallback_failed: ${msg}`);
    }
  }

  runCtx.fallbackPhases.push(phase);
  if (!runCtx.phaseErrors[phase]) recordPhaseError(runCtx, phase, 'provider_error: all providers failed');
  return fallbackParsed.data;
}
