// LLM provider registry — DB-backed configuration for external LLM APIs.
// Replaces the env-var-only OpenRouter setup with a multi-provider model:
// admins can add Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible
// endpoint at runtime, and the agent fallback chain walks every enabled
// provider whose kind matches the requested model.

import type { DbClient } from '../../db/pool.js';

export type ProviderKind = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface LlmProvider {
  id: number;
  name: string;
  kind: ProviderKind;
  base_url: string;
  api_key: string;
  enabled: number;            // 0 | 1
  priority: number;           // lower = tried first
  headers_json: string | null;
  created_at: string;
  updated_at: string;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_error: string | null;
}

export const PROVIDER_KIND_DEFAULTS: Record<ProviderKind, { base_url: string; label: string }> = {
  openrouter: { base_url: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  openai:     { base_url: 'https://api.openai.com/v1',     label: 'OpenAI' },
  anthropic:  { base_url: 'https://api.anthropic.com/v1',  label: 'Anthropic' },
  gemini:     { base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', label: 'Google Gemini' },
  custom:     { base_url: '',                              label: 'Custom (OpenAI-compatible)' },
};

// Curated short-lists shown in the per-agent model dropdown. The admin can
// always type a custom model name if the one they want isn't here.
export const PROVIDER_MODEL_CATALOG: Record<ProviderKind, Array<{ id: string; label: string }>> = {
  openrouter: [
    { id: 'deepseek/deepseek-v4-flash',                label: 'DeepSeek V4 Flash' },
    { id: 'moonshotai/kimi-k2',                        label: 'Kimi K2' },
    { id: 'openai/gpt-oss-120b:free',                  label: 'GPT-OSS 120B (Free)' },
    { id: 'openai/gpt-oss-20b:free',                   label: 'GPT-OSS 20B (Free)' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free',    label: 'Llama 3.3 70B Instruct (Free)' },
    { id: 'meta-llama/llama-3.2-3b-instruct:free',     label: 'Llama 3.2 3B Instruct (Free)' },
    { id: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 Llama 405B (Free)' },
    { id: 'google/gemma-3-27b-it:free',                label: 'Gemma 3 27B IT (Free)' },
    { id: 'google/gemma-3-12b-it:free',                label: 'Gemma 3 12B IT (Free)' },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free',    label: 'Nemotron Super 120B (Free)' },
    { id: 'qwen/qwen3-coder:free',                     label: 'Qwen3 Coder (Free)' },
  ],
  openai: [
    { id: 'gpt-4o',          label: 'GPT-4o' },
    { id: 'gpt-4o-mini',     label: 'GPT-4o mini' },
    { id: 'gpt-4-turbo',     label: 'GPT-4 Turbo' },
    { id: 'o1-mini',         label: 'o1 mini' },
    { id: 'o1',              label: 'o1' },
    { id: 'gpt-3.5-turbo',   label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { id: 'claude-opus-4-7',          label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5',         label: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-latest',  label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-latest',     label: 'Claude 3 Opus' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash-Lite' },
    { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro' },
    { id: 'gemini-flash-latest',    label: 'Gemini Flash (latest)' },
    { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (latest)' },
  ],
  custom: [],
};

export async function ensureLlmProvidersTable(db: DbClient): Promise<void> {
  // db/schema.sql already creates this table on a fresh install; this stays as
  // an idempotent safety net (and to keep the registry self-contained).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 100,
      headers_json TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      last_test_at TIMESTAMP,
      last_test_ok INTEGER,
      last_test_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled ON llm_providers(enabled, priority);
  `);
}

// Seed the registry from the legacy OPENROUTER_API_KEY[_BACKUP[2]] env vars
// on first boot. Idempotent — only runs when the table is empty AND at least
// one of the env vars is set. Lets existing deployments upgrade without
// re-entering keys.
export async function seedProvidersFromEnv(db: DbClient): Promise<void> {
  const count: any = await db.prepare('SELECT COUNT(*) AS c FROM llm_providers').get();
  if (Number(count?.c) > 0) return;

  const env = (k: string) => (process.env[k] || '').trim();
  const candidates: Array<{ name: string; key: string }> = [
    { name: 'OpenRouter (primary)',  key: env('OPENROUTER_API_KEY') },
    { name: 'OpenRouter (backup 1)', key: env('OPENROUTER_API_KEY_BACKUP') },
    { name: 'OpenRouter (backup 2)', key: env('OPENROUTER_API_KEY_BACKUP2') },
  ];
  const ins = db.prepare(
    'INSERT INTO llm_providers (name, kind, base_url, api_key, enabled, priority) VALUES (?, ?, ?, ?, 1, ?)'
  );
  let priority = 10;
  for (const c of candidates) {
    if (!c.key) continue;
    await ins.run(c.name, 'openrouter', PROVIDER_KIND_DEFAULTS.openrouter.base_url, c.key, priority);
    priority += 10;
  }
}

// In-memory snapshot of the registry. The hot LLM path (resolveProviders, called
// from resolveClientsForModel on every model invocation) reads this synchronously
// so model resolution never has to await a query. It is refreshed asynchronously
// at boot and after any provider mutation.
let _cache: LlmProvider[] = [];

export function invalidateProviderCache(): void { _cache = []; }

/** Replace the in-memory provider snapshot. Call at boot and after mutations. */
export async function refreshProviderCache(db: DbClient): Promise<LlmProvider[]> {
  const rows = await db.prepare('SELECT * FROM llm_providers ORDER BY priority ASC, id ASC').all() as LlmProvider[];
  _cache = rows;
  return rows;
}

export async function listProviders(db: DbClient, opts: { includeDisabled?: boolean } = {}): Promise<LlmProvider[]> {
  const rows = await refreshProviderCache(db);   // keep the snapshot warm
  return opts.includeDisabled ? rows : rows.filter(r => r.enabled === 1);
}

export async function getProvider(db: DbClient, id: number): Promise<LlmProvider | null> {
  const row = await db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(id) as LlmProvider | undefined;
  return row || null;
}

// Mask all but the last 4 chars of an API key. Used in every list/get response
// so a stolen JWT can't grab the raw secret out of an admin endpoint.
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function publicShape(p: LlmProvider): Omit<LlmProvider, 'api_key'> & { api_key_mask: string; api_key_set: boolean } {
  const { api_key, ...rest } = p;
  return { ...rest, api_key_mask: maskApiKey(api_key), api_key_set: !!api_key };
}

// Parse a model string the agent supplied. Recognised forms:
//   "local::llama3.1"              → local Ollama
//   "<provider_id>::<model>"       → explicit provider pin
//   "<kind>::<model>"              → any enabled provider of that kind
//   "<bare_model>"                 → legacy: route to first openrouter
export interface ParsedModel {
  bare:       string;
  pinKind?:   ProviderKind;
  pinProviderId?: number;
  isLocal:    boolean;
}

export function parseModelId(model: string): ParsedModel {
  if (model.startsWith('local::')) return { bare: model.slice(7), isLocal: true };
  const idx = model.indexOf('::');
  if (idx === -1) return { bare: model, pinKind: 'openrouter', isLocal: false };
  const prefix = model.slice(0, idx);
  const rest   = model.slice(idx + 2);
  // Numeric prefix = explicit provider id pin
  if (/^\d+$/.test(prefix)) return { bare: rest, pinProviderId: Number(prefix), isLocal: false };
  if (['openrouter','openai','anthropic','gemini','custom'].includes(prefix)) {
    return { bare: rest, pinKind: prefix as ProviderKind, isLocal: false };
  }
  // Unknown prefix — treat the whole thing as a bare openrouter model
  return { bare: model, pinKind: 'openrouter', isLocal: false };
}

// Walk enabled providers in priority order. If pinned by id, only that
// provider is returned. If pinned by kind, only matching kinds. Otherwise
// any enabled provider is acceptable.
export function resolveProviders(parsed: ParsedModel): LlmProvider[] {
  const all = _cache.filter(r => r.enabled === 1);
  if (parsed.pinProviderId) return all.filter(p => p.id === parsed.pinProviderId);
  if (parsed.pinKind)       return all.filter(p => p.kind === parsed.pinKind);
  return all;
}
