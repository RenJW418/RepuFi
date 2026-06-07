/**
 * xAPI integration client — https://www.xapi.to
 *
 * Provides two capability groups RepuFi uses:
 *   1. Model calls (cheap/free models) — proves the project drives xAPI's LLM layer.
 *   2. Social publishing — one-click "share new pact" to bound social accounts
 *      (Twitter/X write) so a freshly created event gets max exposure.
 *
 * All calls hit the unified endpoint:
 *   POST https://action.xapi.to/v1/actions/execute
 *   header: XAPI-Key: <key>
 *   body:   { action_id, input }
 *
 * Key resolution: explicit opt → env XAPI_KEY → ~/.xapi/config.json
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const XAPI_ENDPOINT = "https://action.xapi.to/v1/actions/execute";

// Cheap/free models — effect doesn't matter, what matters is that we exercise
// xAPI's model layer. Tried in order; first success wins.
export const XAPI_CHEAP_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "qwen/qwen3-coder:free",
  "z-ai/glm-4.5-air:free",
  "openai/gpt-4o-mini",
];

export function resolveXapiKey(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.XAPI_KEY) return process.env.XAPI_KEY;
  try {
    const cfgPath = resolve(homedir(), ".xapi", "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { apiKey?: string };
    return cfg.apiKey;
  } catch {
    return undefined;
  }
}

interface XapiResult {
  success?: boolean;
  error?: { code: string; message: string };
  [k: string]: unknown;
}

async function callAction(
  actionId: string,
  input: Record<string, unknown>,
  key: string,
): Promise<XapiResult> {
  const resp = await fetch(XAPI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "XAPI-Key": key,
    },
    body: JSON.stringify({ action_id: actionId, input }),
  });
  const data = (await resp.json().catch(() => ({}))) as XapiResult;
  if (!resp.ok && !data.error) {
    return { success: false, error: { code: `HTTP_${resp.status}`, message: resp.statusText } };
  }
  return data;
}

export interface XapiChatResult {
  ok: boolean;
  text?: string;
  modelUsed?: string;
  error?: string;
}

/**
 * Chat completion via xAPI cheap models. Tries each model until one works.
 * Used by the Brain to draft a punchy social post for a new pact.
 */
export async function xapiChat(input: {
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  models?: string[];
  key?: string;
}): Promise<XapiChatResult> {
  const key = resolveXapiKey(input.key);
  if (!key) return { ok: false, error: "No xAPI key configured." };

  const models = input.models ?? XAPI_CHEAP_MODELS;
  let lastErr = "unknown";
  for (const model of models) {
    const res = await callAction(
      "ai.text.chat.fast",
      { messages: input.messages, model, max_tokens: input.maxTokens ?? 120 },
      key,
    );
    if (res.success !== false && !res.error) {
      // Response shape varies; try common fields.
      const text =
        (res.text as string) ??
        (res.output as string) ??
        ((res.choices as any)?.[0]?.message?.content as string) ??
        ((res.data as any)?.text as string) ??
        "";
      if (text) return { ok: true, text, modelUsed: model };
    } else {
      lastErr = res.error?.message ?? "call failed";
    }
  }
  return { ok: false, error: lastErr };
}

export interface XapiPublishResult {
  ok: boolean;
  tweetId?: string;
  url?: string;
  error?: string;
}

/**
 * Publish a tweet to the bound Twitter/X account via xAPI.
 * Requires an OAuth binding (Twitter Write) on the xAPI key.
 */
export async function xapiPublishTweet(input: {
  text: string;
  key?: string;
}): Promise<XapiPublishResult> {
  const key = resolveXapiKey(input.key);
  if (!key) return { ok: false, error: "No xAPI key configured." };

  const res = await callAction(
    "x.base_apitools_createTweet",
    { text: input.text },
    key,
  );
  if (res.success === false || res.error) {
    return { ok: false, error: res.error?.message ?? "publish failed" };
  }
  const tweetId =
    (res.tweetId as string) ??
    ((res.data as any)?.id as string) ??
    ((res.data as any)?.rest_id as string);
  return {
    ok: true,
    tweetId,
    url: tweetId ? `https://x.com/i/web/status/${tweetId}` : undefined,
  };
}

/**
 * Draft + publish a social post announcing a new pact.
 * 1. Brain drafts punchy copy via xAPI cheap model (falls back to template).
 * 2. Publishes to the bound X account.
 */
export async function announcePact(input: {
  title: string;
  tier: string;
  stake: string;
  marketUrl?: string;
  key?: string;
}): Promise<{ draft: string; publish: XapiPublishResult; modelUsed?: string }> {
  // Step 1: draft copy with a cheap model
  const chat = await xapiChat({
    messages: [
      {
        role: "system",
        content:
          "You write short, punchy crypto social posts (<=240 chars). " +
          "Add 2-3 relevant hashtags. No markdown.",
      },
      {
        role: "user",
        content:
          `Write a tweet announcing a new prediction market on RepuFi.\n` +
          `Title: ${input.title}\nTier: ${input.tier}\nStake: ${input.stake}\n` +
          (input.marketUrl ? `Link: ${input.marketUrl}` : ""),
      },
    ],
    key: input.key,
  });

  const draft = chat.ok && chat.text
    ? chat.text.trim()
    : `🎯 New on RepuFi: "${input.title}" (${input.tier}). ` +
      `${input.stake} staked — back Commit or Skeptic now. ` +
      `${input.marketUrl ?? ""} #RepuFi #Web3 #PredictionMarket`;

  // Step 2: publish
  const publish = await xapiPublishTweet({ text: draft, key: input.key });
  return { draft, publish, modelUsed: chat.modelUsed };
}
