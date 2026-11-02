import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { AdmittedConversationAgent } from "./agent.ts";
import { createApp, scopedExecution } from "./app.ts";
import { createAuth } from "./auth.ts";
import { ActionService } from "./actions.ts";
import { BrowserService } from "./browser.ts";
import { ComputerService } from "./computer.ts";
import type { Config } from "./config.ts";
import { createStore } from "./db.ts";
import { AgentService, EnterpriseRunAdmissions } from "./engine/service.ts";
import { ConversationAgent } from "./engine/conversation.ts";
import {
  createEnterpriseActionGate,
  createOpenbotAuthority,
  type EnterpriseScopeSelector,
} from "./enterprise.ts";
import { Files } from "./files.ts";
import { GoogleAuth } from "./google-auth.ts";
import { WorkspaceService } from "./workspace.ts";
import {
  SCOPED_COMPUTER_METHODS,
  SCOPED_FILES_METHODS,
  SCOPED_WORKSPACE_METHODS,
} from "./app.ts";

/*
 * T07.06 (#596): the fixture process behind enterprise-copilotkit.test.ts.
 *
 * `bun test` cannot load this server's CopilotKit runtime graph in this
 * checkout (a CJS dependency requires an async ESM module), while a plain
 * node/tsx process — the runtime OpenMuse actually deploys — can. The test
 * therefore drives REAL processes over the real seams:
 *
 *   serve <dataDir> <authorityOrigin> <enterprise|standalone>
 *     a real `createApp` instance over HTTP (guard / session routes);
 *
 *   agent <dataDir> <authorityOrigin>
 *     the REAL T07.06 run seam: the same `AgentService`, the same scoped
 *     execution adapters `createApp` builds (`scopedExecution`), the real
 *     `ConversationAgent`, the real `createOpenbotAuthority` client and the
 *     real {@link AdmittedConversationAgent} over line-delimited JSON on
 *     stdin — one stream per line, every AG-UI event echoed as `EVENT <json>`
 *     and a final `DONE`.
 *
 * Everything in front of the process (the OpenBot authority, the model
 * provider, the CopilotKit Intelligence platform) is a network peer; the
 * authority and the model are the test's real-wire stand-ins. The Intelligence
 * platform is not available to this fixture, so the CopilotKit HTTP run route
 * is exercised only up to its admission gate (the run seam below is the same
 * adapter that route hands the runtime).
 */

const [mode, dataDir, authorityOrigin = "", serverMode = "enterprise"] = process.argv.slice(2);
if (!mode || !dataDir) {
  console.error("usage: enterprise-copilotkit.fixture.ts <serve|agent> <dataDir> [authorityOrigin] [enterprise|standalone]");
  process.exit(2);
}
await mkdir(dataDir, { recursive: true, mode: 0o700 });

const base = {
  port: 0,
  host: "127.0.0.1",
  publicUrl: "http://127.0.0.1:0",
  dataDir,
  agentBackend: "model" as const,
  model: "openai/fixture",
  intelligenceApiKey: "test-cpsgzvtqnsgz-gcu",
  googleRedirectUri: "http://127.0.0.1:0/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
};

function enterpriseConfig(): Config {
  return {
    ...base,
    mode: "live",
    authMode: "enterprise",
    openbotAuthorityOrigin: authorityOrigin,
    openbotClientId: "openmuse-mobile",
    openbotBffServiceId: "bff-service",
    openbotBffServiceSecret: "bff-service-secret",
    encryptionKey: undefined,
  };
}

if (mode === "serve") {
  const config: Config =
    serverMode === "enterprise" ? enterpriseConfig() : { ...base, mode: "sample", agentBackend: "sample" };
  const db = await createStore({ dataDir: `${dataDir}/data` });
  const { app } = await createApp(db, config);
  const server = serve({ fetch: app.fetch, hostname: config.host, port: 0 }, (info) => {
    console.log(`READY ${info.port}`);
  });
  const shutdown = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
} else if (mode === "agent") {
  const config = enterpriseConfig();
  const db = await createStore({ dataDir: `${dataDir}/data` });
  const auth = await createAuth(db, config);
  const files = new Files(db, config, auth);
  const google = new GoogleAuth(db, config);
  const workspace = new WorkspaceService(db, config, files, google);
  const actions = new ActionService(db, {
    execute: (owner, input, connectionId, targetVersion) =>
      workspace.execute(owner, input, connectionId, targetVersion),
    prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
    connected: (owner) => workspace.connected(owner),
    connection: (owner) => workspace.connection(owner),
  });
  const browser = new BrowserService(db, config, auth, files);
  const computer = new ComputerService(db, config);
  const admissions = new EnterpriseRunAdmissions();
  // Exactly the scoped adapters createApp builds for an enterprise deployment.
  const agent = new AgentService(
    db,
    config,
    scopedExecution(workspace, admissions, "workspace", SCOPED_WORKSPACE_METHODS),
    scopedExecution(files, admissions, "files", SCOPED_FILES_METHODS),
    actions,
    browser,
    scopedExecution(computer, admissions, "computer", SCOPED_COMPUTER_METHODS),
    admissions,
  );
  const authority = createOpenbotAuthority(config);

  // Seed each admitted company's own namespace: the isolation the stream must
  // respect is visible in the tool result, not only in the prompt.
  const seeds = [
    {
      owner: "enterprise:tenant-acme:ws-acme-ops:principal-1",
      subject: "Acme board deck",
      from: "acme@example.com",
    },
    {
      owner: "enterprise:tenant-globex:ws-globex-ops:principal-2",
      subject: "Globex secret plan",
      from: "globex@example.com",
    },
  ];
  for (const seed of seeds)
    await db.put(seed.owner, "mail", {
      id: `mail-${seed.from}`,
      threadId: `thread-${seed.from}`,
      from: seed.from,
      sender: seed.subject.split(" ")[0] as string,
      to: [seed.from],
      subject: seed.subject,
      body: "Quarterly results",
      date: "2026-10-30T10:00:00.000Z",
      unread: true,
      label: "Work",
      attachments: [],
    });

  interface RunRequest {
    handle: string;
    selector: EnterpriseScopeSelector;
    threadId: string;
    runId?: string;
    context?: unknown;
    state?: unknown;
    forwardedProps?: unknown;
  }

  const run = async (request: RunRequest) => {
    // Durable records are per host; report only what THIS run wrote.
    const since = new Date().toISOString();
    const gate = await createEnterpriseActionGate(
      authority,
      request.handle,
      request.selector,
      request.runId ?? randomUUID(),
    );
    admissions.register(gate);
    const conversation = new ConversationAgent(config, agent, gate.context.owner);
    const stream = new AdmittedConversationAgent(conversation, gate, () =>
      admissions.release(gate.context.owner),
    );
    const input = {
      threadId: request.threadId,
      runId: request.runId ?? randomUUID(),
      messages: [{ id: randomUUID(), role: "user" as const, content: "Search my mail" }],
      tools: [],
      context: (request.context ?? []) as { description: string; value: string }[],
      state: (request.state ?? {}) as Record<string, unknown>,
      forwardedProps: (request.forwardedProps ?? {}) as Record<string, unknown>,
    };
    try {
      await new Promise<void>((resolve, reject) => {
        stream.run(input).subscribe({
          next: (event) => console.log(`EVENT ${JSON.stringify(event)}`),
          error: reject,
          complete: resolve,
        });
      });
      // The durable record the run's tool actions wrote is part of the
      // evidence: it must live under the admitted owner namespace.
      const tasks = await db.scan<{ id: string; title: string; createdAt?: string }>("tasks");
      console.log(
        `TASKS ${JSON.stringify(
          tasks
            .filter(({ value }) => value.createdAt === undefined || value.createdAt >= since)
            .map(({ owner, value }) => ({ owner, id: value.id, title: value.title })),
        )}`,
      );
      console.log("DONE");
    } catch (error) {
      console.log(`FAILED ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      admissions.release(gate.context.owner);
    }
  };

  const lines = createInterface({ input: process.stdin });
  let queue = Promise.resolve();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      try {
        await run(JSON.parse(line) as RunRequest);
      } catch (error) {
        console.log(`FAILED ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
  lines.on("close", async () => {
    await queue;
    await db.close();
    process.exit(0);
  });
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
