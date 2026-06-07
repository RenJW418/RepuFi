import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { reviewGoalIntake, type GoalIntakeInput } from "./review.js";
import { announcePact, resolveXapiKey } from "../social/xapiClient.js";

const INTAKE_PATH = "/api/intake/review";
const ANNOUNCE_PATH = "/api/social/announce";
const XAPI_STATUS_PATH = "/api/xapi/status";

export function createGoalIntakeHttpServer(): Server {
  return createServer(async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    // Goal intake review
    if (request.url === INTAKE_PATH && request.method === "POST") {
      try {
        const input = parseGoalIntakeInput(await readJson(request));
        writeJson(response, 200, reviewGoalIntake(input));
      } catch (error) {
        writeJson(response, 400, {
          error: error instanceof Error ? error.message : "Invalid intake request",
        });
      }
      return;
    }

    // One-click social announce (draft via xAPI model + publish to bound X)
    if (request.url === ANNOUNCE_PATH && request.method === "POST") {
      try {
        const body = (await readJson(request)) as Record<string, unknown>;
        const title = String(body.title ?? "");
        const tier = String(body.tier ?? "");
        const stake = String(body.stake ?? "");
        const marketUrl = body.marketUrl ? String(body.marketUrl) : undefined;
        const key = body.key ? String(body.key) : undefined;
        if (!title) {
          writeJson(response, 400, { error: "Missing title." });
          return;
        }
        const result = await announcePact({ title, tier, stake, marketUrl, key });
        writeJson(response, 200, result);
      } catch (error) {
        writeJson(response, 500, {
          error: error instanceof Error ? error.message : "Announce failed",
        });
      }
      return;
    }

    // xAPI key presence check (frontend shows bound/unbound state)
    if (request.url === XAPI_STATUS_PATH && request.method === "GET") {
      const key = resolveXapiKey();
      writeJson(response, 200, {
        configured: Boolean(key),
        keyPreview: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
      });
      return;
    }

    writeJson(response, 404, { error: "Not found" });
  });
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function parseGoalIntakeInput(value: unknown): GoalIntakeInput {
  if (!value || typeof value !== "object") {
    throw new Error("Expected a JSON object.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.goal !== "string" ||
    typeof candidate.stakeEth !== "string" ||
    typeof candidate.scenarioId !== "string"
  ) {
    throw new Error("Expected goal, stakeEth, and scenarioId strings.");
  }
  return {
    goal: candidate.goal,
    stakeEth: candidate.stakeEth,
    scenarioId: candidate.scenarioId,
  };
}
