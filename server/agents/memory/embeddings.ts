import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { getLocalLLMBaseUrl } from "../shared/client.js";

const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

/**
 * Embed a string using Ollama's /api/embeddings endpoint.
 * Returns null if Ollama is unreachable or the model is not pulled —
 * this lets semantic memory degrade gracefully without crashing.
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  const baseUrl = getLocalLLMBaseUrl();
  const url     = new URL("/api/embeddings", baseUrl);
  const body    = JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) });
  const isHttps = url.protocol === "https:";
  const mod     = isHttps ? https : http;

  return new Promise((resolve) => {
    const req = mod.request({
      method:   "POST",
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Array.isArray(json.embedding)) return resolve(null);
          resolve(Float32Array.from(json.embedding));
        } catch { resolve(null); }
      });
    });
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

/**
 * Serialise an embedding into pgvector's text input format, e.g. "[0.12,-0.03,…]".
 * Postgres coerces this string to the column's `vector(768)` type on insert, and
 * pgvector computes cosine distance in SQL — so the old in-JS cosine scan and the
 * raw-Float32 BLOB (de)serialisers are no longer needed.
 */
export function toVectorLiteral(arr: Float32Array): string {
  return '[' + Array.from(arr).join(',') + ']';
}
