import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.OPENROUTER_API_KEY || "";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

if (!API_KEY) {
  console.warn("[Agents] OPENROUTER_API_KEY not set — AI calls will fail.");
}

const clientCache = new Map<string, ChatOpenAI>();

export function getModelClient(model: string): ChatOpenAI {
  const cached = clientCache.get(model);
  if (cached) return cached;

  const client = new ChatOpenAI({
    model,
    temperature: 0.1,
    maxRetries: 3,
    timeout: 30000,
    configuration: {
      apiKey: API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": APP_URL,
        "X-Title": "Aegis SOC Platform",
      },
    },
  });

  clientCache.set(model, client);
  return client;
}

