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

const clientCache         = new Map<string, ChatOpenAI>();
const backupClientCache   = new Map<string, ChatOpenAI>();
const backup2ClientCache  = new Map<string, ChatOpenAI>();

function makeClient(model: string, apiKey: string): ChatOpenAI {
  return new ChatOpenAI({
    model,
    temperature: 0.1,
    maxRetries: 0,
    timeout: 15000,
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

export function getModelClient(model: string): ChatOpenAI {
  if (!clientCache.has(model)) clientCache.set(model, makeClient(model, API_KEY));
  return clientCache.get(model)!;
}

export function getBackupModelClient(model: string): ChatOpenAI | null {
  if (!API_KEY_BACKUP) return null;
  if (!backupClientCache.has(model)) backupClientCache.set(model, makeClient(model, API_KEY_BACKUP));
  return backupClientCache.get(model)!;
}

export function getBackup2ModelClient(model: string): ChatOpenAI | null {
  if (!API_KEY_BACKUP2) return null;
  if (!backup2ClientCache.has(model)) backup2ClientCache.set(model, makeClient(model, API_KEY_BACKUP2));
  return backup2ClientCache.get(model)!;
}
