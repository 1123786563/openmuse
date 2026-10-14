/**
 * Pure stream-resume seams for the OpenBot chat screen (C05). No React and no
 * SDK imports: the screen feeds what it observes into these seams, so §3's
 * render-each-event-once and reload-on-unstitchable-cursor contracts are
 * testable under node:test.
 *
 * Event identity is what the runtime actually provides (Task 0):
 * - @ag-ui/core dist/index.d.mts:48 BaseMessageSchema — persisted messages
 *   carry a stable `id`, so a replayed message re-arrives under the SAME id.
 * - @ag-ui/core dist/index.d.mts:7144 RunStartedEventSchema — run events carry
 *   `threadId` + `runId`; @copilotkit/core index.mjs readEventId — gateway
 *   events carry a durable id at `metadata.cpki_event_id`, which the SDK keeps
 *   as the per-thread `lastSeenEventId` cursor.
 * - @copilotkit/core index.d.mts:752-769 — on a SAME-thread churn reconnect
 *   the gateway resumes from that cursor and replays past-cursor events (the
 *   historical "duplicate cpki_event_id rows" amplification); a thread switch
 *   clears the cursor and forces a full historical replay.
 */

/** One renderable stream event, identified by the §3 triple. */
export type StreamEvent = {
  threadId: string;
  runId: string;
  eventId: string;
};

/**
 * Run scope for message-observing consumers: persisted message ids are unique
 * per thread (@ag-ui/core BaseMessageSchema), so the chat screen scopes every
 * transcript row to the thread rather than to whichever run happened to be
 * live when it arrived — a replay after reconnect must still dedupe even when
 * the run status has reset. Raw-event consumers (run-scoped ids) pass their
 * real runId instead.
 */
export const THREAD_RUN_SCOPE = "thread";

/** Composite render key: all three of (threadId, runId, eventId). */
const eventKey = (event: StreamEvent): string =>
  `${event.threadId}\u0000${event.runId}\u0000${event.eventId}`;

/** Pure §3 core: the events in `received` this screen has NOT rendered yet. */
export function dedupeByEventId(
  received: readonly StreamEvent[],
  rendered: readonly StreamEvent[],
): StreamEvent[] {
  return createRenderSet(rendered).applyBatch(received);
}

/** What the resume path decided; §3 names three, `fresh` is the first attach. */
export type ResumeDecision = "resume-from-cursor" | "reload-history" | "already-current" | "fresh";

/**
 * Decide how to absorb a re-attach's replay window:
 * - no cursor rendered yet → `fresh` (mount/restore: everything renders);
 * - window empty → `already-current` (gateway has nothing past the cursor);
 * - window contains the cursor → `resume-from-cursor`: the replay is anchored,
 *   the re-delivered overlap dedupes away, only the tail renders;
 * - window lacks the cursor → `reload-history`: the replay cannot be stitched
 *   onto what this instance rendered (gap or rebuilt ids), so the persisted
 *   thread reloads wholesale and the interruption chip shows.
 */
export function resumeStrategy(
  lastEventId: string | null,
  replayOffered: readonly StreamEvent[],
): ResumeDecision {
  if (lastEventId === null) return "fresh";
  if (replayOffered.length === 0) return "already-current";
  // ponytail: containment, not id ordering — opaque gateway ids are not
  // sortable, and a window that skips PAST the cursor hides missed events, so
  // only a window that anchors ON the cursor is stitchable.
  return replayOffered.some((event) => event.eventId === lastEventId)
    ? "resume-from-cursor"
    : "reload-history";
}

/** The interruption indicator is visible exactly on the reload-history path. */
export function interruptionVisible(decision: ResumeDecision): boolean {
  return decision === "reload-history";
}

/**
 * Mutable render-set model behind the screen's transcript: it records every
 * event rendered by this instance and hands back only newly-unseen events.
 * `reset` re-bases it on a reloaded persisted thread (reload-history path),
 * so late pre-reload batches render nothing (§3: never duplicates).
 */
export type RenderSet = {
  /** Record a batch; returns only its newly-unseen events, in order. */
  applyBatch(batch: readonly StreamEvent[]): StreamEvent[];
  /** Re-base on a reloaded thread's history (the reload-history decision). */
  reset(history: readonly StreamEvent[]): void;
  /** The last event this instance rendered — the resume cursor. Null when none. */
  lastEventId(): string | null;
  /** Rendered-event count, for tests. */
  size(): number;
};

export function createRenderSet(rendered: readonly StreamEvent[] = []): RenderSet {
  const keys = new Set<string>();
  let last: StreamEvent | null = null;
  const seed = (events: readonly StreamEvent[]) => {
    for (const event of events) {
      keys.add(eventKey(event));
      last = event;
    }
  };
  seed(rendered);
  return {
    applyBatch(batch) {
      const fresh: StreamEvent[] = [];
      for (const event of batch) {
        const key = eventKey(event);
        if (keys.has(key)) continue; // replayed overlap: rendered already
        keys.add(key);
        last = event;
        fresh.push(event);
      }
      return fresh;
    },
    reset(history) {
      keys.clear();
      last = null;
      seed(history);
    },
    lastEventId() {
      return last?.eventId ?? null;
    },
    size() {
      return keys.size;
    },
  };
}
