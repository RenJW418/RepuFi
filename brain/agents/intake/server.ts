import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { reviewGoalIntake, type GoalIntakeInput } from "./review.js";

const INTAKE_PATH = "/api/intake/review";

export function createGoalIntakeHttpServer(): Server {
  return createServer(async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.url !== INTAKE_PATH || request.method !== "POST") {
      writeJson(response, 404, { error: "Not found" });
      return;
    }

    try {
      const input = parseGoalIntakeInput(await readJson(request));
      writeJson(response, 200, reviewGoalIntake(input));
    } catch (error) {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid intake request",
      });
    }
  });
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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
