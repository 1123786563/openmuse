import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  AgentIdentity,
  AgentMemory,
  AgentNotification,
} from "../../../../packages/domain/src/agent.ts";
import { createTaskSchema } from "../../../../packages/domain/src/agent.ts";
import { AppError } from "../errors.ts";
import type { AgentService } from "./service.ts";

const text = z.string().trim().min(1).max(4000);
const memorySchema = z.object({ text, source: z.string().trim().min(1).max(200).optional() });
const goalPatchSchema = z.object({
  status: z.enum(["active", "paused", "completed"]).optional(),
  milestones: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        done: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
});

export function agentRoutes(
  service: AgentService,
  options: { enterprise?: boolean } = {},
): Hono<{ Variables: { owner: string } }> {
  const app = new Hono<{ Variables: { owner: string } }>();
  /**
   * T07.06 (#596): an enterprise app's run routes consume only the owner the
   * admission gate put on the request. The request's own online admission
   * (the enterprise guard, per action) is what authorized this call; a route
   * reached with a standalone session in an enterprise app is refused rather
   * than silently reading a "local-user" namespace.
   */
  const runOwner = (c: Context) => {
    const owner = c.get("owner");
    if (typeof owner !== "string" || !owner) throw new AppError("Sign in to OpenMuse", 401);
    if (options.enterprise && !owner.startsWith("enterprise:"))
      throw new AppError("Enterprise session required", 401);
    return owner;
  };
  app.get("/", async (c) => c.json(await service.snapshot(runOwner(c))));
  app.post("/tasks", async (c) => {
    const { requestId, ...input } = createTaskSchema
      .extend({ requestId: z.string().min(1).max(200).optional() })
      .parse(await c.req.json());
    return c.json(await service.createTask(runOwner(c), input, requestId), 201);
  });
  app.get("/tasks/:id", async (c) => c.json(await service.detail(runOwner(c), c.req.param("id"))));
  app.post("/tasks/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "cancel", "retry"]) })
      .parse(await c.req.json());
    return c.json(await service.control(runOwner(c), c.req.param("id"), action));
  });
  app.post("/tasks/:id/input", async (c) => {
    const body = z
      .object({
        answer: z.string().trim().min(1).max(12000),
        fields: z
          .record(z.string().min(1).max(300), z.union([z.string().max(12000), z.boolean()]))
          .optional(),
      })
      .parse(await c.req.json());
    return c.json(await service.answer(runOwner(c), c.req.param("id"), body.answer, body.fields));
  });
  app.post("/goals", async (c) =>
    c.json(await service.createGoal(runOwner(c), await c.req.json()), 201),
  );
  app.post("/goals/:id", async (c) => {
    const body = goalPatchSchema.parse(await c.req.json());
    return c.json(await service.updateGoal(runOwner(c), c.req.param("id"), body));
  });
  app.post("/goals/:id/milestones/:milestoneId", async (c) => {
    const { done } = z.object({ done: z.boolean() }).parse(await c.req.json());
    return c.json(
      await service.setMilestoneDone(
        runOwner(c),
        c.req.param("id"),
        c.req.param("milestoneId"),
        done,
      ),
    );
  });
  app.post("/monitors", async (c) =>
    c.json(await service.createMonitor(runOwner(c), await c.req.json()), 201),
  );
  app.post("/monitors/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "stop", "check"]) })
      .parse(await c.req.json());
    return c.json(await service.controlMonitor(runOwner(c), c.req.param("id"), action));
  });
  app.post("/ideas/refresh", async (c) => c.json(await service.refreshIdeas(runOwner(c))));
  app.post("/ideas/:id", async (c) => {
    const body = z
      .object({
        action: z.enum(["accept", "dismiss"]),
        prompt: z.string().trim().min(1).max(12000).optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.decideIdea(runOwner(c), c.req.param("id"), body.action, body.prompt),
    );
  });
  app.post("/memories", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const memory: AgentMemory = {
      id: randomUUID(),
      text: body.text,
      source: body.source ?? "You",
      createdAt: new Date().toISOString(),
    };
    return c.json(await service.db.put(runOwner(c), "memories", memory), 201);
  });
  app.post("/memories/:id", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const memory = await service.db.compareAndSwap<AgentMemory>(
      runOwner(c),
      "memories",
      c.req.param("id"),
      {},
      body,
    );
    if (!memory) throw new AppError("Memory not found", 404);
    return c.json(memory);
  });
  app.post("/memories/:id/forget", async (c) => {
    if (!(await service.db.take(runOwner(c), "memories", c.req.param("id"))))
      throw new AppError("Memory not found", 404);
    return c.json({ ok: true });
  });
  app.post("/identity", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        tone: z.enum(["warm", "concise", "thoughtful"]),
        avatar: z.enum(["sky", "sand", "lilac"]).optional(),
        showChatUpdates: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const owner = runOwner(c);
    await service.ensure(owner);
    const identity = await service.db.compareAndSwap<AgentIdentity>(
      owner,
      "agent-settings",
      "identity",
      {},
      body,
    );
    if (!identity) throw new AppError("Agent identity changed; refresh and try again", 409);
    return c.json(identity);
  });
  app.get("/notifications", async (c) =>
    c.json(await service.db.list<AgentNotification>(runOwner(c), "notifications")),
  );
  app.post("/notifications/:id/read", async (c) => {
    const notification = await service.db.compareAndSwap<AgentNotification>(
      runOwner(c),
      "notifications",
      c.req.param("id"),
      {},
      { read: true },
    );
    if (!notification) throw new AppError("Notification not found", 404);
    return c.json(notification);
  });
  app.post("/sample-page", async (c) => {
    // The sample workspace is a standalone-only surface; enterprise never seeds it.
    if (options.enterprise || service.config.mode !== "sample")
      throw new AppError("Not found", 404);
    const body = z.object({ text: z.string().max(100000) }).parse(await c.req.json());
    await service.db.put(runOwner(c), "sample-pages", { id: "availability", text: body.text });
    return c.json({ ok: true });
  });
  return app;
}
