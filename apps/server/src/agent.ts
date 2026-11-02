import "./config.ts";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import {
  type AgentsFactory,
  type CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";
import { Observable } from "rxjs";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import { ConversationAgent } from "./engine/conversation.ts";
import type { AgentService } from "./engine/service.ts";
import {
  type EnterpriseActionGate,
  type EnterpriseRunContext,
  EnterpriseStreamRefusal,
  mobileBffError,
} from "./enterprise.ts";
import { createJevAdapter, type JevAdapter } from "./jev/adapter.ts";

export function agentConfigured(config: Config) {
  return (
    config.agentBackend === "sample" ||
    (config.agentBackend === "agui"
      ? Boolean(config.agentUrl)
      : Boolean(
          config.model &&
            (process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              process.env.GOOGLE_API_KEY),
        ))
  );
}

/**
 * T07.06 (#596): the enterprise half of the runtime adapter.
 *
 * The CopilotKit runtime still answers the fixed SDK wire/method/SSE; what an
 * enterprise deployment replaces is where a run's identity comes from. The
 * seam derives ONE server-fixed run context per request from the authority's
 * admitted answer and hands the runtime a gate the agent must pass before
 * every new model dispatch and every new tool action. Nothing in the AG-UI
 * body names the actor, company, team or payer.
 */
export interface EnterpriseRuntimeSeam {
  /** The per-request gate, built from the authority's online answer. */
  gateFor(request: Request): Promise<EnterpriseActionGate>;
}

/** Identity words a client body may carry; none of them is authority here. */
const CLIENT_IDENTITY_KEYS = new Set([
  "actor",
  "payer",
  "company",
  "tenant",
  "tenantId",
  "team",
  "workspaceId",
  "principal",
  "principalId",
  "userId",
  "owner",
]);

function withoutClientIdentity(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !CLIENT_IDENTITY_KEYS.has(key),
    ),
  );
}

/**
 * Replace the client's run identity with the server-fixed one.
 *
 * The AG-UI wire body keeps its shape; what changes is that the run's identity
 * is the admitted context only. Every client-claimed identity key is dropped
 * from `context`, `state` and `forwardedProps`, so nothing downstream can read
 * a body value as the actor, company, team or payer.
 */
export function withServerRunContext(
  input: RunAgentInput,
  context: EnterpriseRunContext,
): RunAgentInput {
  return {
    ...input,
    context: [
      {
        description: "Server-fixed run identity (actor, run, scope, payer)",
        value: JSON.stringify(context),
      },
    ],
    state: withoutClientIdentity(input.state) as RunAgentInput["state"],
    forwardedProps: withoutClientIdentity(input.forwardedProps) as RunAgentInput["forwardedProps"],
  };
}

/**
 * The agent the enterprise runtime actually runs: the real conversation agent
 * behind a per-action admission.
 *
 * - before the run's first model dispatch, one online `copilotkit.invoke`
 *   admission (the authority decides then, not at the earlier HTTP gate);
 * - every later model or tool action is admitted by the scoped execution
 *   adapters through the same gate;
 * - a refusal aborts the run, the stream emits the refusal's MobileBffError
 *   code as its terminal event, and no later dispatch starts;
 * - unsubscribing (client disconnect) tears the run down, so later actions
 *   cannot start either.
 */
export class AdmittedConversationAgent extends AbstractAgent {
  constructor(
    private readonly inner: ConversationAgent,
    private readonly gate: EnterpriseActionGate,
    private readonly onStreamClosed?: () => void,
  ) {
    super({ agentId: "default" });
  }
  clone(): AdmittedConversationAgent {
    return new AdmittedConversationAgent(this.inner.clone(), this.gate, this.onStreamClosed);
  }
  override run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let closed = false;
      let subscription: { unsubscribe(): void } | undefined;
      const finish = (code: string) => {
        if (closed) return;
        closed = true;
        subscriber.next({
          type: EventType.RUN_ERROR,
          message: JSON.stringify(mobileBffError(code)),
        } as BaseEvent);
        subscriber.complete();
      };
      const onRevoked = () => finish(this.gate.refusalCode() ?? "SESSION_REVOKED");
      this.gate.canceled.addEventListener("abort", onRevoked, { once: true });
      void (async () => {
        try {
          // The run's first model dispatch re-verifies online; the request
          // gate's admission is not extended over the whole stream.
          await this.gate.authorizeModel();
        } catch (error) {
          finish(
            error instanceof EnterpriseStreamRefusal
              ? error.code
              : (this.gate.refusalCode() ?? "AUTHORITY_UNAVAILABLE"),
          );
          return;
        }
        if (closed) return;
        const admitted = withServerRunContext(input, this.gate.context);
        subscription = this.inner.run(admitted).subscribe({
          next: (event) => {
            if (!closed) subscriber.next(event);
          },
          error: () => finish(this.gate.refusalCode() ?? "AUTHORITY_UNAVAILABLE"),
          complete: () => {
            if (closed) return;
            closed = true;
            subscriber.complete();
          },
        });
      })();
      return () => {
        closed = true;
        this.gate.canceled.removeEventListener("abort", onRevoked);
        this.onStreamClosed?.();
        subscription?.unsubscribe();
      };
    });
  }
}

export function makeRuntime(
  config: Config,
  service: AgentService,
  auth: Auth,
  intelligence: CopilotKitIntelligence,
  enterprise?: EnterpriseRuntimeSeam,
) {
  // Built on first use, then shared so live mode reuses one TypeSafe client across requests.
  let jevAdapter: JevAdapter | undefined;
  const sharedJevAdapter = () => (jevAdapter ??= createJevAdapter(config));
  const agents: AgentsFactory = async ({ request }) => {
    if (enterprise) {
      const gate = await enterprise.gateFor(request);
      // The scoped execution adapters find this gate by the admitted owner
      // namespace, so every tool action can admit online before it runs.
      service.enterpriseStreamStarted(gate);
      return {
        default: new AdmittedConversationAgent(
          new ConversationAgent(config, service, gate.context.owner, sharedJevAdapter()),
          gate,
          () => service.enterpriseStreamEnded(gate.context.owner),
        ),
      };
    }
    return {
      default:
        config.agentBackend === "sample"
          ? new ConversationAgent(
              config,
              service,
              await auth.owner(request.headers.get("authorization") ?? undefined),
              sharedJevAdapter(),
            )
          : config.agentBackend === "agui"
            ? new HttpAgent({
                url: config.agentUrl ?? "http://127.0.0.1:1/unconfigured",
                headers: config.agentToken ? { Authorization: `Bearer ${config.agentToken}` } : {},
              })
            : new ConversationAgent(
                config,
                service,
                await auth.owner(request.headers.get("authorization") ?? undefined),
                sharedJevAdapter(),
              ),
    };
  };
  const runtime = new CopilotRuntime({
    agents,
    intelligence,
    // The shared CopilotKit sink carries this tag onto existing PostHog events.
    telemetryProperties: { accessibility_title: "OpenMuse" },
    identifyUser: async (request) => {
      if (enterprise) {
        const gate = await enterprise.gateFor(request);
        return { id: gate.context.userId, name: "Enterprise user" };
      }
      return {
        id: await auth.owner(request.headers.get("authorization") ?? undefined),
        name: "OpenMuse user",
      };
    },
    generateThreadNames: false,
  });
  return createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });
}
