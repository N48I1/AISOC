import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getModelClient } from "./client.js";

function extractJSONObject(raw: string): unknown {
  let s = (raw || "").trim();
  s = s.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in LLM response: ${s.slice(0, 300)}`);
  }
  return JSON.parse(s.slice(start, end + 1));
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

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = getModelClient(model);
      const resp = await client.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      const json = extractJSONObject(String(resp.content ?? ""));
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        console.error(`[LLM Schema Error][${phase}] ${issues}`);
        return fallbackParsed.data;
      }
      return parsed.data;
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      const isRateLimit = msg.includes("429") || msg.includes("rate") || msg.includes("Rate");
      if (isRateLimit && attempt < maxAttempts) {
        const delay = attempt * 8000; // 8s, 16s
        console.warn(`[LLM][${phase}] rate-limited (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s…`);
        await sleep(delay);
        continue;
      }
      console.error(`[LLM Error][${phase}]`, msg.slice(0, 300));
      return fallbackParsed.data;
    }
  }
  return fallbackParsed.data;
}

