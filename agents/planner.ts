import { z } from "zod";
import { callStructuredLLM, type RunContext } from "./shared/llm.js";
import { DEFAULT_PLANNER_MODEL } from "./config.js";

export const WORKER_NAMES = ["intel", "knowledge", "correlation", "recall", "ioc_check"] as const;
export type WorkerName = (typeof WORKER_NAMES)[number];

export const COMPOSER_NAMES = ["ticketing", "response", "validation"] as const;
export type ComposerName = (typeof COMPOSER_NAMES)[number];

const PlanSchema = z.object({
  reasoning:        z.string().default(""),
  investigators:    z.array(z.object({
    worker:   z.enum(WORKER_NAMES),
    reason:   z.string().default(""),
    priority: z.number().default(1),
  })).default([]),
  composers_skip:   z.array(z.enum(COMPOSER_NAMES)).default([]),
  re_evaluate:      z.boolean().default(false),
  cost_budget:      z.number().min(1).max(10).default(6),
});

export type Plan = z.infer<typeof PlanSchema>;

interface PlanInput {
  alert:         any;
  triage:        any;
  recentAlerts:  any[];
  recallHits:    any[];
  iocHits:       any[];
  priorResults?: any;       // present on the reflection round
  reflection?:   boolean;
  ctx:           RunContext;
  model?:        string;
}

const SYSTEM_PROMPT = `You are the SOC Investigation Planner. Given a triaged alert,
decide which specialised investigators to dispatch in parallel and which composers to skip.
Be efficient — do NOT run workers that won't add real value for this specific alert.

WORKERS:
- intel        — Enriches IOCs with MITRE ATT&CK + MISP. Run when the alert has external IOCs (IPs/domains/hashes) or when classification matters.
- knowledge    — Retrieves a remediation playbook for the attack category. Skip for clear false positives.
- correlation  — Detects multi-stage campaigns within 72h. Run when there are ≥3 recent alerts OR shared IPs/agents.
- recall       — Finds semantically similar past incidents. Cheap, run when the alert isn't a clear known pattern.
- ioc_check    — Looks up IOCs in our internal observation history. Cheap, almost always run.

COMPOSERS (always run unless skipped):
- ticketing    — Drafts the incident ticket. Skip only for confirmed false positives.
- response     — Plans containment actions. Skip for FPs and trivial INFO-level events.
- validation   — Checks SLA + completeness. Always run unless the alert was auto-closed.

Respond ONLY with valid JSON:
{
  "reasoning": "<1-2 sentence assessment of the alert>",
  "investigators": [
    {"worker": "intel|knowledge|correlation|recall|ioc_check", "reason": "<why>", "priority": 1}
  ],
  "composers_skip": [],
  "re_evaluate": false,
  "cost_budget": 6
}

Rules:
- ioc_check is cheap and deterministic — include it unless triage extracted no IOCs.
- recall is cheap — include it for non-trivial alerts.
- Set re_evaluate=true only if recall/ioc_check might surface new context worth a 2nd planning round.
- For confirmed false positives (triage.is_false_positive=true and confidence>0.85), return an empty investigator list and skip ALL composers.`;

export async function planner(input: PlanInput): Promise<Plan> {
  const { ctx, ctx: { quotaExhausted } } = input;
  const model = input.model || DEFAULT_PLANNER_MODEL;

  // Compose user prompt
  const userPrompt = buildPrompt(input);

  // Conservative fallback: if planner fails, run the obvious workers.
  const triage = input.triage;
  const safeFallback: Plan = triage?.is_false_positive && triage?.false_positive_confidence > 0.85
    ? {
        reasoning: "Triage flagged high-confidence false positive — skipping all investigation.",
        investigators: [],
        composers_skip: ["ticketing", "response", "validation"] as ComposerName[],
        re_evaluate: false,
        cost_budget: 0,
      }
    : {
        reasoning: "Planner unavailable — defaulting to standard investigators.",
        investigators: [
          { worker: "ioc_check", reason: "default", priority: 1 },
          { worker: "intel",     reason: "default", priority: 1 },
          { worker: "knowledge", reason: "default", priority: 2 },
          { worker: "correlation", reason: "default", priority: 2 },
        ],
        composers_skip: [],
        re_evaluate: false,
        cost_budget: 6,
      };

  // Quota-exhausted: skip the planner LLM entirely, use conservative fallback minus
  // the heavy-weight intel/knowledge/correlation workers (planner-as-LLM unreachable).
  if (quotaExhausted) {
    return {
      reasoning: "OpenRouter quota exhausted — running deterministic-only workers.",
      investigators: [
        { worker: "ioc_check", reason: "deterministic, no LLM", priority: 1 },
        { worker: "recall",    reason: "deterministic, local embeddings only", priority: 2 },
      ],
      composers_skip: [],
      re_evaluate: false,
      cost_budget: 4,
    };
  }

  const plan = await callStructuredLLM<Plan>({
    phase:        "planner",
    model,
    schema:       PlanSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    fallback:     safeFallback,
    ctx,
  });

  // Hard guarantees: no duplicates, valid worker names only.
  const seen = new Set<string>();
  plan.investigators = plan.investigators.filter((i) => {
    if (seen.has(i.worker)) return false;
    seen.add(i.worker);
    return true;
  });

  return plan;
}

function buildPrompt(input: PlanInput): string {
  const triage = input.triage || {};
  const recallTeasers = (input.recallHits ?? []).slice(0, 3).map((h: any) =>
    `  • ${(h.similarity * 100).toFixed(0)}% similar past incident: ${h.summary?.slice(0, 100) || "(no summary)"}`
  ).join("\n");
  const iocTeasers = (input.iocHits ?? []).slice(0, 5).map((h: any) =>
    `  • ${h.value} (${h.type}) — seen ${h.alert_count}× score=${h.score}`
  ).join("\n");

  let priorBlock = "";
  if (input.reflection && input.priorResults) {
    priorBlock = `\n\nROUND 1 RESULTS — decide whether more investigation is needed:\n${
      JSON.stringify(input.priorResults, null, 2).slice(0, 3000)
    }\n\nIf nothing surprising, return an empty investigator list.`;
  }

  return `ALERT:
- ID: ${input.alert?.id}
- Description: ${input.alert?.description}
- Severity: ${input.alert?.severity}
- Source IP: ${input.alert?.source_ip || "—"} → Dest IP: ${input.alert?.dest_ip || "—"}
- Agent: ${input.alert?.agent_name || "—"}

TRIAGE RESULT:
- Risk score: ${triage.risk_score ?? "?"} / 100
- Attack category: ${triage.attack_category || "?"}
- Kill chain stage: ${triage.kill_chain_stage || "?"}
- False positive: ${triage.is_false_positive ? `YES (${Math.round((triage.false_positive_confidence ?? 0) * 100)}%)` : "no"}
- IOC counts: ips=${triage.iocs?.ips?.length ?? 0}, domains=${triage.iocs?.domains?.length ?? 0}, hashes=${triage.iocs?.hashes?.length ?? 0}, users=${triage.iocs?.users?.length ?? 0}

CONTEXT:
- Recent alerts in window: ${input.recentAlerts?.length ?? 0}
- Pre-flight semantic recall (top 3):
${recallTeasers || "  (none)"}
- Pre-flight IOC memory hits (top 5):
${iocTeasers || "  (none)"}${priorBlock}`;
}
