import { pathToFileURL } from "node:url";

import { createGoalIntakeHttpServer } from "../agents/intake/server.js";

export function runGoalIntakeServer(input: { host?: string; port?: number } = {}): void {
  const host = input.host ?? process.env.BRAIN_HOST ?? "127.0.0.1";
  const port = input.port ?? Number(process.env.BRAIN_PORT ?? "8790");
  const server = createGoalIntakeHttpServer();

  server.listen(port, host, () => {
    console.log(
      JSON.stringify({
        service: "repufi-brain-intake",
        url: `http://${host}:${port}/api/intake/review`,
      }),
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGoalIntakeServer();
}
