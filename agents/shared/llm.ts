import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  resolveClientsForModel,
  getLocalModelClient, isLocalModel, localModelName,
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

// ── Per-orchestration run context (replaces module-level globals) ───────────
export interface RunContext {
  traceId:         string;
  quotaExhausted:  boolean;
  fallbackPhases:  string[];
  agentLogs:       string[];
}

export function newRunContext(traceId?: string): RunContext {
  return {
    traceId:        traceId ?? (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())),
    quotaExhausted: false,
    fallbackPhases: [],
    agentLogs:      [],
  };
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
      const resp   = await client.invoke(messages);
      const json   = extractJSONObject(String(resp.content ?? ""));
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        console.error(`[LLM Schema Error][${phase}][local] ${issues}`);
        runCtx.fallbackPhases.push(phase);
        return fallbackParsed.data;
      }
      return parsed.data;
    } catch (err: any) {
      console.error(`[LLM Error][${phase}][local::${name}]`, err?.message?.slice(0, 200));
      runCtx.fallbackPhases.push(phase);
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
    console.error(`[LLM Error][${phase}] No providers configured for model "${model}"`);
    runCtx.fallbackPhases.push(phase);
    return fallbackParsed.data;
  }

  for (let i = 0; i < resolved.length; i++) {
    const { client, provider } = resolved[i];
    const label = `${provider.kind}#${provider.id}`;
    try {
      const resp   = await client.invoke(messages);
      const json   = extractJSONObject(String(resp.content ?? ""));
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        console.error(`[LLM Schema Error][${phase}][${label}] ${issues}`);
        runCtx.fallbackPhases.push(phase);
        return fallbackParsed.data;
      }
      return parsed.data;
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      const isRateLimit = msg.includes("429") || /rate.?limit/i.test(msg);
      if (isDailyQuotaError(msg)) runCtx.quotaExhausted = true;

      if (isRateLimit && i < resolved.length - 1) {
        const delay = (i + 1) * 2000;
        console.warn(`[LLM][${phase}] rate-limited on ${label}, trying next provider in ${delay / 1000}s…`);
        await sleep(delay);
        continue;
      }
      console.error(`[LLM Error][${phase}][${label}]`, msg.slice(0, 300));
      if (i < resolved.length - 1) continue;   // keep walking the chain on non-rate-limit errors too
      runCtx.fallbackPhases.push(phase);
      return fallbackParsed.data;
    }
  }

  runCtx.fallbackPhases.push(phase);
  return fallbackParsed.data;
}
