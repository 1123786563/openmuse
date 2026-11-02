import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * T07.06 (#596, original task P17): the enterprise CopilotKit surface.
 *
 * `/api/copilotkit/*` keeps the fixed CopilotKit SDK wire/method/SSE; the
 * server runtime fixes actor, Run, scope and payer from the authority's online
 * admission, and EVERY new model dispatch / tool action asks the authority
 * again — the request gate's first check is never extended over the stream. A
 * revocation mid-stream ends the stream with the refusal's MobileBffError code
 * and no later dispatch starts.
 *
 * Why processes: `bun test` cannot load this server's CopilotKit runtime graph
 * in this checkout (a CJS dependency requires an async ESM module), while the
 * runtime OpenMuse really deploys — node + tsx — can. So the test drives real
 * processes over real seams: one `createApp` HTTP server for the admission
 * gate, and one agent host per enterprise app running the SAME `AgentService`,
 * scoped execution adapters, `ConversationAgent` and
 * `AdmittedConversationAgent` that `createApp` builds. In front of them, two
 * stand-ins speak the real wire contracts: the OpenBot authority (admission
 * routes + registered BFF credential) and the model provider (OpenAI
 * Responses). The CopilotKit Intelligence platform is not available here, so
 * the HTTP run route is exercised up to its admission gate; the run seam below
 * is the same adapter that route hands the runtime.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OPENMUSE_ROOT = join(HERE, "../../..");
const FIXTURE = join(HERE, "enterprise-copilotkit.fixture.ts");
const TSX = join(OPENMUSE_ROOT, "node_modules/.bin/tsx");

const ACME = { tenantId: "tenant-acme", workspaceId: "ws-acme-ops" } as const;
const GLOBEX = { tenantId: "tenant-globex", workspaceId: "ws-globex-ops" } as const;
const HANDLE = "handle-enterprise-1";
const BFF_CREDENTIAL = `Basic ${Buffer.from("bff-service:bff-service-secret").toString("base64")}`;

interface AdmissionCall {
  handle: string;
  selector: { tenantId: string; workspaceId: string };
  operation: string;
}

/**
 * The OpenBot authority stand-in: the real wire contract of
 * POST /api/enterprise/mobile/session/authorize (T05.13), one online decision
 * per action, scripted refusals for the revocation cases.
 */
class AuthorityFixture {
  private server: Server | undefined;
  readonly calls: AdmissionCall[] = [];
  private refusal: string | null = null;
  refuseFrom: number | undefined;
  origin = "";

  async start(): Promise<void> {
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const reply = (status: number, payload: object) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (request.method !== "POST" || request.url !== "/api/enterprise/mobile/session/authorize")
        return reply(404, { error: "Not found" });
      // The registered BFF service credential, as createOpenbotAuthority sends it.
      if (request.headers.authorization !== BFF_CREDENTIAL)
        return reply(401, { error: "Request refused.", code: "BFF_CREDENTIAL_INVALID" });
      let payload: {
        handle?: unknown;
        selectors?: { tenantId?: unknown; workspaceId?: unknown };
        operation?: unknown;
      };
      try {
        payload = JSON.parse(body) as typeof payload;
      } catch {
        return reply(400, { error: "Request refused.", code: "INVALID_REQUEST" });
      }
      const tenantId = String(payload.selectors?.tenantId ?? "");
      const workspaceId = String(payload.selectors?.workspaceId ?? "");
      const operation = String(payload.operation ?? "");
      if (!tenantId || !workspaceId || !operation)
        return reply(400, { error: "Request refused.", code: "INVALID_REQUEST" });
      if (this.refusal) return reply(401, { error: "Request refused.", code: this.refusal });
      this.calls.push({
        handle: String(payload.handle ?? ""),
        selector: { tenantId, workspaceId },
        operation,
      });
      if (this.refuseFrom !== undefined && this.calls.length >= this.refuseFrom) {
        this.refusal = "SESSION_REVOKED";
        return reply(401, { error: "Request refused.", code: "SESSION_REVOKED" });
      }
      const acme = tenantId === ACME.tenantId;
      return reply(200, {
        actor: {
          userId: acme ? "user-1" : "user-2",
          principalId: acme ? "principal-1" : "principal-2",
          identityGeneration: 1,
        },
        scope: { tenantId, workspaceId, capabilities: ["copilotkit.invoke"] },
        admissionId: randomUUID(),
        operation,
        resourceId: null,
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no authority port");
    this.server = server;
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  reset(): void {
    this.calls.length = 0;
    this.refusal = null;
    this.refuseFrom = undefined;
  }
}

interface ModelCall {
  name: string;
  arguments: object;
}

/** The OpenAI Responses-protocol provider the model adapter really calls. */
class ModelProvider {
  private server: Server | undefined;
  private bodies: string[] = [];
  baseUrl = "";
  accept: (index: number) => ModelCall | undefined = () => undefined;

  get requests(): string[] {
    return this.bodies;
  }

  async start(): Promise<void> {
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const index = this.bodies.length;
      this.bodies.push(body);
      const call = this.accept(index);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (type: string, value: object) =>
        response.write(`data: ${JSON.stringify({ type, ...value })}\n\n`);
      const base = { id: `response-${index}`, created_at: 1000, model: "fixture" };
      emit("response.created", { response: { ...base, status: "in_progress" } });
      const item = call && {
        id: `item-${index}`,
        type: "function_call",
        call_id: `call-${index}`,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      };
      if (item) {
        emit("response.output_item.added", { output_index: 0, item: { ...item, arguments: "" } });
        emit("response.function_call_arguments.delta", {
          item_id: item.id,
          output_index: 0,
          delta: item.arguments,
        });
        emit("response.output_item.done", {
          output_index: 0,
          item: { ...item, status: "completed" },
        });
      }
      emit("response.completed", {
        response: {
          ...base,
          status: "completed",
          output: item ? [{ ...item, status: "completed" }] : [],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      });
      response.end("data: [DONE]\n\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no model port");
    this.server = server;
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  reset(): void {
    this.bodies = [];
    this.accept = () => undefined;
  }
}

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

interface TaskRecord {
  owner: string;
  id: string;
  title: string;
}

interface RunResult {
  events: StreamEvent[];
  tasks: TaskRecord[];
}

interface RunRequest {
  handle?: string;
  selector: { tenantId: string; workspaceId: string };
  threadId: string;
  forged: Record<string, string>;
}

const authority = new AuthorityFixture();
const model = new ModelProvider();
const children: ChildProcess[] = [];
const directories: string[] = [];
let env: NodeJS.ProcessEnv;

function spawnFixture(args: string[]): ChildProcess {
  const child = spawn(TSX, [FIXTURE, ...args], {
    env,
    // Its own process group: tsx starts the real node process, and the group
    // kill at the end takes both down.
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

/** One enterprise app's run host, speaking line-delimited JSON on stdin. */
class AgentHost {
  private pending:
    | { stream: StreamEvent[]; tasks: TaskRecord[]; resolve: (failure: string | null) => void }
    | undefined;

  private constructor(private readonly child: ChildProcess) {}

  static async start(): Promise<AgentHost> {
    const directory = await mkdtemp(join(tmpdir(), "openmuse-cp-agent-"));
    directories.push(directory);
    const host = new AgentHost(spawnFixture(["agent", directory, authority.origin]));
    createInterface({ input: host.child.stdout as NodeJS.ReadableStream }).on("line", (line) => {
      if (!host.pending) return;
      if (line.startsWith("EVENT ")) {
        host.pending.stream.push(JSON.parse(line.slice(6)) as StreamEvent);
        return;
      }
      if (line.startsWith("TASKS ")) {
        // Mutate the array the run() promise already holds.
        host.pending.tasks.push(...(JSON.parse(line.slice(6)) as TaskRecord[]));
        return;
      }
      const { resolve } = host.pending;
      host.pending = undefined;
      resolve(line === "DONE" ? null : line);
    });
    host.child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    // The host is ready as soon as its stdin is reading; the first run pays
    // the module load, bounded by the test timeout.
    return host;
  }

  run(request: RunRequest): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      const stream: StreamEvent[] = [];
      const tasks: TaskRecord[] = [];
      const entry = {
        stream,
        tasks,
        resolve: (failure: string | null) =>
          failure ? reject(new Error(failure)) : resolve({ events: stream, tasks }),
      };
      this.pending = entry;
      this.child.stdin?.write(
        `${JSON.stringify({
          handle: request.handle ?? HANDLE,
          selector: request.selector,
          threadId: request.threadId,
          context: [
            { description: "Client-claimed identity", value: JSON.stringify(request.forged) },
          ],
          state: { actor: request.forged.actor, payer: request.forged.payer },
          forwardedProps: request.forged,
        })}\n`,
      );
    });
  }
}

/** One `createApp` HTTP server (guard and session routes). */
class ServeHost {
  port = 0;
  private constructor(private readonly child: ChildProcess) {}
  static async start(mode: "enterprise" | "standalone"): Promise<ServeHost> {
    const directory = await mkdtemp(join(tmpdir(), `openmuse-cp-${mode}-`));
    directories.push(directory);
    const host = new ServeHost(spawnFixture(["serve", directory, authority.origin, mode]));
    let output = "";
    host.port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 120_000);
      host.child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /READY (\d+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      host.child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      host.child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited early (${code}): ${output}`));
      });
    });
    return host;
  }
}

/** The server-fixed identity the runtime handed to the model, if any. */
function serverContextFromPrompt(body: string): Record<string, unknown> | undefined {
  let payload: { instructions?: unknown };
  try {
    payload = JSON.parse(body) as { instructions?: unknown };
  } catch {
    return undefined;
  }
  const text = typeof payload.instructions === "string" ? payload.instructions : "";
  const marker = "Server-fixed run identity (actor, run, scope, payer):\n";
  const start = text.indexOf(marker);
  if (start < 0) return undefined;
  const rest = text.slice(start + marker.length);
  const end = rest.indexOf("\n");
  const json = end < 0 ? rest : rest.slice(0, end);
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function serverContext(tenant: { tenantId: string; workspaceId: string }) {
  const acme = tenant.tenantId === ACME.tenantId;
  const principal = acme ? "principal-1" : "principal-2";
  return {
    owner: `enterprise:${tenant.tenantId}:${tenant.workspaceId}:${principal}`,
    userId: acme ? "user-1" : "user-2",
    principalId: principal,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    payer: `company:${tenant.tenantId}`,
  };
}

const forgedAcme = {
  actor: "attacker",
  company: "tenant-forged",
  team: "ws-forged",
  payer: "personal:attacker",
};

let acme: AgentHost;
let globex: AgentHost;
let fixtures: Promise<void> | undefined;
function ensureFixtures(): Promise<void> {
  fixtures ??= (async () => {
    await authority.start();
    await model.start();
    env = {
      ...process.env,
      OPENAI_BASE_URL: model.baseUrl,
      OPENAI_API_KEY: "local-test-fixture",
      DO_NOT_TRACK: "1",
      COPILOTKIT_TELEMETRY_DISABLED: "true",
    };
    delete env.OPENAI_CHAT_COMPLETIONS;
    acme = await AgentHost.start();
    globex = await AgentHost.start();
  })();
  return fixtures;
}

after(async () => {
  for (const child of children) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null ? Promise.resolve() : once(child, "exit").then(() => undefined),
    ),
  );
  await authority.stop();
  await model.stop();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

describe("T07.06 enterprise CopilotKit stream and run admission", () => {
  test("copilotkit_stream_uses_server_scope_and_payer", { timeout: 180_000 }, async () => {
    await ensureFixtures();
    authority.reset();
    model.reset();
    model.accept = (index) =>
      index === 0
        ? { name: "delegate_task", arguments: { prompt: "Summarize my inbox" } }
        : undefined;

    const { events, tasks } = await acme.run({
      selector: ACME,
      threadId: "thread-acme",
      forged: forgedAcme,
    });
    const types = events.map((event) => event.type);
    assert.ok(types.includes("RUN_STARTED"));
    assert.ok(types.includes("RUN_FINISHED"));
    assert.ok(!types.includes("RUN_ERROR"));

    // The runtime handed the model the SERVER-fixed identity — the admitted
    // context, not anything the client body claimed.
    assert.equal(model.requests.length, 2);
    const runContext = serverContextFromPrompt(model.requests[1] as string);
    assert.ok(runContext, "the model must receive the server-fixed run context");
    for (const [key, value] of Object.entries(serverContext(ACME)))
      assert.equal(runContext?.[key], value);
    assert.equal(typeof runContext?.runId, "string");
    for (const body of model.requests) {
      assert.ok(!body.includes("tenant-forged"));
      assert.ok(!body.includes("personal:attacker"));
    }

    // The tool action wrote the run's durable record under the admitted
    // company/principal namespace — not under a standalone "local-user" owner.
    const results = events.filter((event) => event.type === "TOOL_CALL_RESULT");
    assert.equal(results.length, 1);
    assert.match(String(results[0]?.content), /"id"/);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.owner, "enterprise:tenant-acme:ws-acme-ops:principal-1");
    assert.match(tasks[0]?.title ?? "", /Summarize my inbox/);

    // Every admission the stream performed was online, for this company, for
    // the authority's one frozen run operation, through the real client.
    assert.ok(authority.calls.length >= 3);
    for (const call of authority.calls) {
      assert.equal(call.operation, "copilotkit.invoke");
      assert.deepEqual(call.selector, { ...ACME });
      assert.equal(call.handle, HANDLE);
    }
  });

  test("revocation_during_stream_blocks_next_model_or_tool", { timeout: 180_000 }, async () => {
    await ensureFixtures();
    authority.reset();
    model.reset();
    model.accept = (index) =>
      index === 0
        ? { name: "delegate_task", arguments: { prompt: "Summarize my inbox" } }
        : undefined;
    // Admissions so far: the stream identity bootstrap, then the first model
    // dispatch. The tool action must be refused.
    authority.refuseFrom = 3;

    const { events, tasks } = await acme.run({
      selector: ACME,
      threadId: "thread-revoked",
      forged: forgedAcme,
    });
    const errors = events.filter((event) => event.type === "RUN_ERROR");
    assert.equal(errors.length, 1);
    const refusal = JSON.parse(String(errors[0]?.message)) as { error: string; code: string };
    assert.equal(refusal.code, "SESSION_REVOKED");
    assert.equal(refusal.error, "Request refused.");
    assert.ok(!events.map((event) => event.type).includes("RUN_FINISHED"));

    // The refused tool action never ran, and no later dispatch started.
    const laterDispatches = model.requests.length - 1;
    assert.equal(laterDispatches, 0);
    assert.deepEqual(
      events.filter((event) => event.type === "TOOL_CALL_RESULT"),
      [],
    );
    assert.deepEqual(tasks, []);
    // The refusal was an online decision, not a cached one: the refused
    // action's admission call is the third one, and it was answered by the
    // authority, not by anything the BFF remembered.
    assert.equal(authority.calls.length, 3);
    assert.equal(authority.calls.at(-1)?.operation, "copilotkit.invoke");
  });

  test("revocation_before_first_model_dispatch_never_calls_the_model", {
    timeout: 180_000,
  }, async () => {
    await ensureFixtures();
    authority.reset();
    model.reset();
    // The stream identity bootstrap passes; the first model dispatch is
    // refused before the adapter is ever called.
    authority.refuseFrom = 2;

    const { events } = await acme.run({
      selector: ACME,
      threadId: "thread-revoked-early",
      forged: forgedAcme,
    });
    const errors = events.filter((event) => event.type === "RUN_ERROR");
    assert.equal(errors.length, 1);
    assert.equal(
      (JSON.parse(String(errors[0]?.message)) as { code: string }).code,
      "SESSION_REVOKED",
    );
    assert.equal(model.requests.length, 0);
  });

  test("two_enterprise_apps_keep_their_own_actor_scope_and_payer", {
    timeout: 180_000,
  }, async () => {
    await ensureFixtures();
    authority.reset();
    model.reset();

    const [acmeResult, globexResult] = await Promise.all([
      acme.run({
        selector: ACME,
        threadId: "thread-acme-2",
        forged: { ...forgedAcme, company: GLOBEX.tenantId },
      }),
      globex.run({
        selector: GLOBEX,
        threadId: "thread-globex-2",
        forged: { ...forgedAcme, company: ACME.tenantId },
      }),
    ]);
    assert.ok(acmeResult.events.some((event) => event.type === "RUN_FINISHED"));
    assert.ok(globexResult.events.some((event) => event.type === "RUN_FINISHED"));

    // Each app admitted only its own company and fed its model only its own
    // server-fixed context; neither carried the other's identity.
    for (const call of authority.calls) {
      const isAcme = call.selector.tenantId === ACME.tenantId;
      assert.deepEqual(call.selector, isAcme ? { ...ACME } : { ...GLOBEX });
    }
    const acmeBodies = model.requests.filter((body) => body.includes(ACME.tenantId));
    const globexBodies = model.requests.filter((body) => body.includes(GLOBEX.tenantId));
    assert.ok(acmeBodies.length > 0);
    assert.ok(globexBodies.length > 0);
    for (const body of acmeBodies) {
      const context = serverContextFromPrompt(body);
      assert.equal(context?.tenantId, ACME.tenantId);
      assert.equal(context?.payer, "company:tenant-acme");
    }
    for (const body of globexBodies) {
      const context = serverContextFromPrompt(body);
      assert.equal(context?.tenantId, GLOBEX.tenantId);
      assert.equal(context?.payer, "company:tenant-globex");
    }
  });

  test("copilotkit_without_an_admitted_session_is_refused_before_the_stream", {
    timeout: 180_000,
  }, async () => {
    await ensureFixtures();
    const serve = await ServeHost.start("enterprise");
    const anonymous = await fetch(
      `http://127.0.0.1:${serve.port}/api/copilotkit/agent/default/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "thread-anonymous", runId: randomUUID(), messages: [] }),
      },
    );
    assert.equal(anonymous.status, 401);
    const body = (await anonymous.json()) as { error: string; code: string; requestId: string };
    assert.equal(body.error, "Request refused.");
    assert.equal(body.code, "SESSION_EXPIRED");
    assert.equal(typeof body.requestId, "string");
  });

  test("standalone_deployment_keeps_its_own_session_reader", { timeout: 180_000 }, async () => {
    await ensureFixtures();
    // No enterprise config, no authority, no gate: the same route answers the
    // standalone owner flow and never consults an authority.
    const serve = await ServeHost.start("standalone");
    const session = await fetch(`http://127.0.0.1:${serve.port}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(session.status, 200);
    const { token } = (await session.json()) as { token: string };
    const info = await fetch(`http://127.0.0.1:${serve.port}/api/copilotkit/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(info.status, 200);
  });
});
