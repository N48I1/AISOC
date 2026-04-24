import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getModelClient, getBackupModelClient, getBackup2ModelClient } from "./client.js";

function extractJSONObject(raw: string): unknown {
  let s = (raw || "").trim();
  s = s.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in LLM response: ${s.slice(0, 300)}`);
  }
  let candidate = s.slice(start, end + 1);
  // Fix truncated decimals: "score": 85. → "score": 85.0
  candidate = candidate.replace(/(\d)\.(\s*[,}\]])/g, "$1.0$2");
  // Fix trailing commas before closing braces/brackets
  candidate = candidate.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(candidate);
}

interface CallStructuredParams<T> {
  phase: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  fallback: T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Module-level counters reset per orchestration run by resetLLMRunState().
let quotaExhaustedFlag = false;
let fallbackPhases: string[] = [];

export function resetLLMRunState() {
  quotaExhaustedFlag = false;
  fallbackPhases = [];
}

export function getLLMRunState() {
  return { quotaExhausted: quotaExhaustedFlag, fallbackPhases: [...fallbackPhases] };
}

function isDailyQuotaError(msg: string): boolean {
  return /free-models-per-day|credits to unlock|daily quota|per-day/i.test(msg);
}

export async function callStructuredLLM<T>({
  phase,
  model,
  systemPrompt,
  userPrompt,
  schema,
  fallback,
}: CallStructuredParams<T>): Promise<T> {
  const fallbackParsed = schema.safeParse(fallback);
  if (!fallbackParsed.success) {
    throw new Error(`[${phase}] invalid fallback schema`);
  }

  // Attempt order: primary → backup1 → backup2 → retry primary → fallback
  // If a key is not configured, skip it and continue to next.
  const clientGetters = [
    { label: "primary",  fn: () => getModelClient(model) },
    { label: "backup1",  fn: () => getBackupModelClient(model) },
    { label: "backup2",  fn: () => getBackup2ModelClient(model) },
    { label: "primary2", fn: () => getModelClient(model) },  // final retry on primary
  ];

  for (let i = 0; i < clientGetters.length; i++) {
    const { label, fn } = clientGetters[i];
    const client = fn();
    if (!client) {
      // Key not configured — skip silently
      continue;
    }

    try {
      const resp = await client.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      const json = extractJSONObject(String(resp.content ?? ""));
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        console.error(`[LLM Schema Error][${phase}] ${issues}`);
        fallbackPhases.push(phase);
        return fallbackParsed.data;
      }
      return parsed.data;
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      const isRateLimit = msg.includes("429") || /rate.?limit/i.test(msg);
      if (isDailyQuotaError(msg)) quotaExhaustedFlag = true;

      if (isRateLimit && i < clientGetters.length - 1) {
        const delay = (i + 1) * 2000;
        console.warn(`[LLM][${phase}] rate-limited on ${label} key, trying next in ${delay / 1000}s…`);
        await sleep(delay);
        continue;
      }
      console.error(`[LLM Error][${phase}][${label}]`, msg.slice(0, 300));
      fallbackPhases.push(phase);
      return fallbackParsed.data;
    }
  }

  fallbackPhases.push(phase);
  return fallbackParsed.data;
}
