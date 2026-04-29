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

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function blobToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function float32ToBlob(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}
