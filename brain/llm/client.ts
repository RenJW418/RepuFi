import { createMockLlm, type BrainLlm, type LlmRequest } from "./mock.js";

export function createLlmClient(options: { apiKey?: string; model?: string } = {}): BrainLlm {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return createMockLlm();
  }

  return {
    async completeStructured(request) {
      return callAnthropicJson({
        apiKey,
        model: options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
        request,
      });
    },
  };
}

async function callAnthropicJson(input: {
  apiKey: string;
  model: string;
  request: LlmRequest;
}): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content:
            "Return only compact JSON for this PACT Brain request: " +
            JSON.stringify(input.request),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = payload.content?.find((part) => part.type === "text")?.text;
  if (!text) {
    throw new Error("Anthropic response did not contain text JSON.");
  }

  return JSON.parse(text) as Record<string, unknown>;
}
