import { createMockLlm, type BrainLlm, type LlmRequest } from "./mock.js";

// System prompts for each task type — gives the LLM clear context and output contract
const SYSTEM_PROMPTS: Record<LlmRequest["task"], string> = {
  "compile-predicate": `You are a PACT Brain predicate compiler. Convert a natural-language commitment goal into a verifiable predicate.

Output compact JSON ONLY (no markdown, no explanation):
- For L2 tier: {"kind":"contract_deployed","target":"0x<40-hex-addr>","rationale":"<one sentence>"}
  target = a deterministic address derived from the goal (use keccak256-like logic, make it realistic)
- For L1 tier: {"kind":"habit_checkin","requiredDays":<number>,"cadence":"daily","rationale":"<one sentence>"}
  extract the number of days from the goal, default 30
- For L3 tier: {"kind":"policy_metric","metric":"<quoted goal>","sourcePolicy":"multi_source_public_records","rationale":"<one sentence>"}`,

  "validate-goal": `You are a PACT Brain goal validator. Assess whether a commitment goal is quantifiable and verifiable.

Output compact JSON ONLY:
{"valid":<true|false>,"reason":"<one sentence>","suggestions":["<if invalid, 1-3 concrete suggestions>"]}

A goal is VALID if it has: (1) a measurable quantity, (2) a clear deadline, (3) an objective evidence path.
A goal is INVALID if it is vague, lacks numbers, or has no verifiable evidence.`,

  "verify-habit": `You are a PACT Brain habit verifier. Evaluate check-in evidence for an L1 habit commitment.

Output compact JSON ONLY:
{"outcomeHint":"kept"|"breached","confidence":<0.0-1.0>,"reason":"<one sentence>"}`,

  "verify-policy": `You are a PACT Brain policy verifier. Evaluate multi-source evidence for an L3 public commitment.

Output compact JSON ONLY:
{"outcomeHint":"kept"|"breached","confidence":<0.0-1.0>,"citations":["<source1>","<source2>"],"reasoning":"<one sentence>"}`,

  "multi-agent-verdict": `You are one of several independent PACT Brain verifier agents. Evaluate the evidence and produce a verdict.
Be critical and independent — do not simply agree with other agents. Consider the evidence carefully.

Output compact JSON ONLY:
{"outcomeHint":"kept"|"breached","confidence":<0.0-1.0>,"reasoning":"<one concise sentence explaining your verdict>"}`,
};

export interface LlmClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function createLlmClient(options: LlmClientOptions = {}): BrainLlm {
  // Priority: explicit options → env vars → mock
  const apiKey =
    options.apiKey ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.XAPI_KEY;

  if (!apiKey) {
    return createMockLlm();
  }

  // Use mintapi.cn relay (already configured in settings.json) or xapi endpoint
  const baseUrl =
    options.baseUrl ??
    process.env.ANTHROPIC_BASE_URL ??
    "https://api.anthropic.com";

  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-haiku-4-5-20251001"; // cheapest capable model

  return {
    async completeStructured(request) {
      try {
        return await callAnthropicJson({ apiKey, baseUrl, model, request });
      } catch (err) {
        // Graceful fallback to mock on API errors (network, auth, quota)
        console.warn(
          `[llm/client] API call failed (${err instanceof Error ? err.message : String(err)}), falling back to mock.`,
        );
        return createMockLlm().completeStructured(request);
      }
    },
  };
}

async function callAnthropicJson(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  request: LlmRequest;
}): Promise<Record<string, unknown>> {
  const systemPrompt = SYSTEM_PROMPTS[input.request.task];
  const userContent = buildUserMessage(input.request);

  const endpoint = `${input.baseUrl.replace(/\/$/, "")}/v1/messages`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = payload.content?.find((p) => p.type === "text")?.text ?? "";

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
}

function buildUserMessage(request: LlmRequest): string {
  const parts: string[] = [`Goal: "${request.goal}"`, `Tier: ${request.tier}`];

  if (request.evidence) {
    parts.push(`Evidence: ${JSON.stringify(request.evidence)}`);
  } else {
    parts.push(`Evidence: (no specific evidence provided — use your best judgment based on the goal and tier)`);
  }

  if (request.agentId !== undefined) {
    parts.push(`You are Agent #${request.agentId}. Be independent in your assessment.`);
  }

  return parts.join("\n");
}

