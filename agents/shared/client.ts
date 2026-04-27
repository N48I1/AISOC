import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";

dotenv.config();

const API_KEY         = process.env.OPENROUTER_API_KEY         || "";
const API_KEY_BACKUP  = process.env.OPENROUTER_API_KEY_BACKUP  || "";
const API_KEY_BACKUP2 = process.env.OPENROUTER_API_KEY_BACKUP2 || "";
const APP_URL         = process.env.APP_URL || "http://localhost:3000";

if (!API_KEY) console.warn("[Agents] OPENROUTER_API_KEY not set — AI calls will fail.");
if (API_KEY_BACKUP)  console.log("[Agents] Backup key 1 loaded.");
if (API_KEY_BACKUP2) console.log("[Agents] Backup key 2 loaded.");

const clientCache        = new Map<string, ChatOpenAI>();
const backupClientCache  = new Map<string, ChatOpenAI>();
const backup2ClientCache = new Map<string, ChatOpenAI>();
const localClientCache   = new Map<string, ChatOpenAI>();

// Module-level Ollama base URL — updated by setLocalLLMBaseUrl() from server.ts
let _localBaseUrl = "http://localhost:11434";

export function setLocalLLMBaseUrl(url: string) {
  _localBaseUrl = url.replace(/\/$/, "");
  localClientCache.clear(); // invalidate cached clients when URL changes
  console.log(`[Agents] Local LLM base URL set to: ${_localBaseUrl}`);
}

export function getLocalLLMBaseUrl(): string {
  return _localBaseUrl;
}

/** Returns true if the model ID refers to a locally-hosted model (Ollama). */
export function isLocalModel(model: string): boolean {
  return model.startsWith("local::");
}

/** Strips the "local::" prefix to get the actual Ollama model name. */
export function localModelName(model: string): string {
  return model.replace(/^local::/, "");
}

function makeOpenRouterClient(model: string, apiKey: string): ChatOpenAI {
  return new ChatOpenAI({
    model,
    temperature: 0.1,
    maxRetries:  0,
    timeout:     15000,
    configuration: {
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": APP_URL,
        "X-Title": "BBS AISOC Platform",
      },
    },
  });
}

export function getLocalModelClient(modelName: string, baseUrl?: string): ChatOpenAI {
  const url    = (baseUrl || _localBaseUrl).replace(/\/$/, "");
  const cacheKey = `${url}::${modelName}`;
  if (!localClientCache.has(cacheKey)) {
    localClientCache.set(cacheKey, new ChatOpenAI({
      model:       modelName,
      temperature: 0.1,
      maxRetries:  0,
      timeout:     90000,
      // Force valid JSON output — Ollama's OpenAI-compatible API supports this
      modelKwargs: { response_format: { type: "json_object" } },
      configuration: {
        apiKey:  "ollama",
        baseURL: `${url}/v1`,
      },
    }));
  }
  return localClientCache.get(cacheKey)!;
}

export function getModelClient(model: string): ChatOpenAI {
  if (!clientCache.has(model)) clientCache.set(model, makeOpenRouterClient(model, API_KEY));
  return clientCache.get(model)!;
}

export function getBackupModelClient(model: string): ChatOpenAI | null {
  if (!API_KEY_BACKUP) return null;
  if (!backupClientCache.has(model)) backupClientCache.set(model, makeOpenRouterClient(model, API_KEY_BACKUP));
  return backupClientCache.get(model)!;
}

export function getBackup2ModelClient(model: string): ChatOpenAI | null {
  if (!API_KEY_BACKUP2) return null;
  if (!backup2ClientCache.has(model)) backup2ClientCache.set(model, makeOpenRouterClient(model, API_KEY_BACKUP2));
  return backup2ClientCache.get(model)!;
}
