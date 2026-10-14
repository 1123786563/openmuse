# C02 — Create and switch Channels: Execution Report (Issue #15)

Plan: `docs/superpowers/plans/tickets/C02-channels.md` — executed exactly (Task 0 → RED → GREEN → checkpoint). No commits (per plan).

## Task 0: Facts (recorded, with citations)

OpenBot server checkout read READ-ONLY at `/Users/wuyongjun/trea/OpenBot` (its `app/server/worker` Bun workspace; the OpenMuse repo only carries the mobile client).

1. **POST /api/channels request/response shape** — handler `routes.post("/", requireUser, …)` at `server/src/channels/routes.ts:1093-1111` (plan cited 1096-1113; small line drift vs the plan's revision, same route):
   - **Request:** `{ agentIds: string[] }` parsed by `parseChannelInput` (`routes.ts:928-953`): must be a JSON object with a **non-empty array of non-empty, unique strings**; the server trims and sorts them. **There is no client-supplied name and no naming validation** — `channelName` (`routes.ts:253-259`) derives the name server-side from the agents' profile names (joined ", ", capped at 120 code points).
   - **How the private Bot is attached:** the caller puts its agentId in `agentIds`. The web app's single-Bot flow passes exactly `[agentId]` (`app/src/lib/channels/mutations.ts:11-25` `createChannelMutationOptions` sends `body: { agentIds }`; `app/src/lib/channels/start.ts:34-56` `useStartChannel.start` calls `createChannel.mutateAsync([agentId])`). Each id is validated per-caller via `profileStore.getWithin` (`routes.ts:286-292`); an inaccessible Bot → 404 "Agent not found." (`mapStoreError`, `routes.ts:1276-1280`).
   - **Created row:** `makeChannel` (`routes.ts:273-325`) returns `AgentChannel`; response **201 `{ channel: channelDto }`** = `{channel:{id,name,agentIds,threadId,active:true,lastMessageAt:null}}` (`channelDto`, `routes.ts:1251-1261`). `id = "channel_"+UUID`.
   - **threadId materializes AT CREATION, not on first conversation:** `makeChannel` mints `threadId = threadIdentity.mint()` (`routes.ts:292-294`) inside the create transaction. No "on first conversation" path exists.
   - **Web-app mirror (cited):** create → seed cache → navigate (`start.ts`). Mobile mirrors as: create → merge into roster → select (switch).
2. **Channel list order is server-owned:** `store.list` orders by `ROSTER_ORDER = [PINNED_RANK desc, RECENCY desc, channels.id desc]` (`routes.ts:164-168`, query `routes.ts:455-493`); the mobile-bff workspace read maps `channelStore.list(actor,{limit:100})` rows straight into `channels[]` with `id,name,agentIds,threadId,lastMessageAt` (`server/src/mobile-bff/workspace.ts:52,65-72`) — server order preserved end-to-end, so the client never re-sorts (`orderPassthrough` is that named seam).
3. **Keying approach (cited):** switching re-mounts the chat via React's reset-state-with-a-key (`https://react.dev/learn/preserving-and-resetting-state`), the same deliberate-remount pattern already used in-tree by the provider presence key at `apps/mobile/App.tsx` (`key={cookie ? "session" : "anonymous"}`).

No mismatch with the plan's failure-handling clause: POST /api/channels needs only `{agentIds}`, which the private-Bot flow has (the provisioned botId). No STOP condition hit.

## Changed files (+ shasum)

| File | Status | sha1 |
| --- | --- | --- |
| `apps/mobile/src/openbot/channel-state.ts` | new | f139771dd43802f9b70007d559004d3fe854d4e2 |
| `apps/mobile/src/openbot/channels.tsx` | new | b47290b31588a3619ebc72039db9e74d6ded0410 |
| `apps/mobile/test/openbot-channel-state.test.ts` | new | 6e6faca3a7c8559f094a0925022c8f312000de1e |
| `apps/mobile/src/openbot/api.ts` | modified (createChannel + createdChannelSchema) | 1d0f65d711fdbd172771f364427ef24f5ed2e6d7 |
| `apps/mobile/src/openbot/chat.tsx` | modified (optional `title` prop only; runtime wiring untouched) | 449d41b9b8d82e297b22191de75f9e3a6cac940e |
| `apps/mobile/App.tsx` | modified (OpenBotConnected: channel roster + selection, channels entry, re-keyed chat; Tasks entry unchanged) | 129b7bd19c095c2b27f6fffe83dea64128643534 |

Forbidden files untouched: config.ts, auth/client/gate/private-state, task-view/tasks (git status shows no delta beyond the owned set; App.tsx/package.json/pnpm-lock.yaml carried pre-existing uncommitted C01+ work from before this dispatch).

## Verification

- RED confirmed first: new test file failed (module/channel-state missing) → 542 pass / 1 fail.
- **`pnpm test`:** `ℹ tests 551 / ℹ pass 551 / ℹ fail 0` (10 new channel-state/api tests, incl. orderPassthrough no-re-sort proof with an unsorted fixture, selectedIdentity distinct-thread assertion, mergeCreated append/merge, createChannel wire shape + local refusal + 4xx codes).
- **`pnpm typecheck`** (root + `--dir apps/mobile`): clean.
- **`pnpm lint`** (biome): clean (format/import-order auto-fixed on the 6 changed files only; repo-wide check passes).
- **`pnpm build:web`** tail:
  ```
  › Files (2):
  index.html (1.21 kB)
  metadata.json (49 B)
  Exported: dist/web
  ```

## Acceptance vs S10 (deferred statement)

Per the plan's acceptance section and `2026-10-12-openmuse-openbot-acceptance-v4.md:26`, story **S10** ("U-A creates C1/C2, switches, renames C1, archives and reopens it; C1/C2 retain different Thread IDs") spans tickets C02+C03+C08+C09. C02's slice is proven at node:test level (distinct-thread assertion, per-channel re-keyed chat, server cursor order passthrough); **live browser evidence for S10 is deferred to the browser pass and to the rename (C03) / archive (C08/C09) tickets.**
