/**
 * T07.11 (#601): the one switch coordinator the enterprise app runs — the
 * selection change, the old interaction's teardown and the new scope's
 * publication as ONE deterministic sequence, shared by the real CopilotKit
 * stream and every MuseApi read.
 *
 * THE RULES ARE THE ISSUE'S OWN:
 * - 选择变更先停旧交互再校验/发布并清缓存：the OLD interaction (the live agent
 *   run and its tool actions) is stopped FIRST, while the OLD headers are
 *   still live; only then is the new pair validated server-side, published
 *   (the store's ONE generation advance, which drops the old scope's
 *   business entries wholesale) and the BFF-mounted stream rebuilt under the
 *   new pair. An order any other shape — validate first, or publish first —
 *   would leave a window where an old-scope run rides live new-scope
 *   headers, exactly the leak T03.06 closed on the web.
 * - App/MuseApi/CopilotKit/stream只用同一handle/验证selection：the caller
 *   injects the SAME handle and the SAME tenancy store the enterprise app
 *   built at handoff (T07.10); nothing here mints a session, invents a
 *   selection or reads active state — the stream mounts from validated
 *   facts only.
 * - 原后台Run范围不随UI切换：a refusal is a refusal — the store rolls back
 *   to the previous selection (the server never heard a switch), and no new
 *   stream is mounted. The background run the server owns keeps its own
 *   scope; only the UI's interaction is stopped.
 *
 * This module is pure coordinator logic with injected collaborators — the
 * runtime seams (`stopAgent`, `connectAgent`) as bare functions, the fetch
 * seam, the stream open seam — exactly like tenancy.ts/transport.ts inject
 * theirs, so its contract runs in CI with no runtime beneath it. The app
 * screens (App.tsx/chat.tsx/computer.tsx) consume it through these seams.
 */

import type { ScopeSelection, TenancyStore } from "./tenancy";
import { TENANT_HEADER, WORKSPACE_HEADER } from "./transport";

/** The BFF refusal a failed validation reads as; the transport's own typed shape. */
export class SelectionSwitchRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`The selection switch was refused (${status} ${code}).`);
    this.name = "SelectionSwitchRefused";
  }
}

/** The runtime seams this coordinator drives; the app injects CopilotKit's own. */
export interface SelectionStreamRuntime {
  /** Stop the old interaction while the old headers are still live (CopilotKit stopAgent). */
  readonly stopActiveInteraction: () => Promise<void>;
  /** Remount the BFF stream under the new pair (a fresh provider mount/connect). */
  readonly mountStream: (headers: Readonly<Record<string, string>>) => void;
}

/** The fetch seam validation rides; the app injects the same scoped fetch MuseApi uses. */
export type SelectionValidateFetch = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export interface SelectionSessionOptions {
  readonly store: TenancyStore;
  /** The enterprise session handle (EnterpriseSessionResponse.token) — the only credential. */
  readonly handle: string;
  readonly runtime: SelectionStreamRuntime;
  readonly fetchLike: SelectionValidateFetch;
}

/** The headers the BFF-mounted stream carries for one selection — the transport's pair plus the handle. */
export function streamHeaders(
  handle: string,
  selection: ScopeSelection,
): Readonly<Record<string, string>> {
  return {
    authorization: `Bearer ${handle}`,
    [TENANT_HEADER]: selection.tenantId,
    [WORKSPACE_HEADER]: selection.workspaceId,
  };
}

/** Whether a coordinator run may proceed: no switch while one is mid-flight. */
export type SwitchGate = { busy: boolean };

export function createSelectionSession(options: SelectionSessionOptions) {
  const { store, handle, runtime, fetchLike } = options;
  // One switch at a time: the gate is synchronous, so a double tap cannot
  // interleave two stop→validate→publish sequences.
  const gate: SwitchGate = { busy: false };

  const validate = async (selection: ScopeSelection): Promise<void> => {
    const response = await fetchLike("/api/enterprise/workspace-scope/validate-selection", {
      method: "POST",
      headers: {
        authorization: `Bearer ${handle}`,
        "content-type": "application/json",
        [TENANT_HEADER]: selection.tenantId,
        [WORKSPACE_HEADER]: selection.workspaceId,
      },
      body: JSON.stringify({
        tenantId: selection.tenantId,
        workspaceId: selection.workspaceId,
      }),
    });
    if (response.ok) return;
    let code = "SELECTION_REFUSED";
    try {
      const body = (await response.json()) as { code?: unknown };
      if (typeof body?.code === "string") code = body.code;
    } catch {
      // A body that is not the frozen MobileBffError keeps the generic code.
    }
    throw new SelectionSwitchRefused(response.status, code);
  };

  return {
    /**
     * THE switch: stop the old interaction → validate the new pair → publish
     * (one generation advance, the old scope's entries dropped wholesale) →
     * mount the stream under the new pair. A validation refusal rolls the
     * store back and mounts nothing.
     */
    async switchSelection(
      next: ScopeSelection,
    ): Promise<
      | { status: "switched"; selection: ScopeSelection }
      | { status: "no-op"; selection: ScopeSelection }
      | { status: "refused"; error: SelectionSwitchRefused }
    > {
      const scope = store.scope();
      if (scope.status !== "open") throw new Error("The scope source has not answered yet.");
      const previous = scope.selection;
      if (
        previous !== null &&
        previous.tenantId === next.tenantId &&
        previous.workspaceId === next.workspaceId
      )
        return { status: "no-op", selection: next };
      if (gate.busy) throw new Error("A selection switch is already in flight.");
      gate.busy = true;
      try {
        // 1. Stop the old interaction FIRST — while the old headers are still
        //    the live ones, so the stop rides the scope it was started under.
        await runtime.stopActiveInteraction();
        // 2. Validate the new pair server-side against the same handle. A
        //    refusal rolls everything back: the store never moved and no
        //    stream remounts (the server never heard a switch).
        await validate(next);
        // 3. Publish: ONE generation advance drops the old scope's business
        //    entries wholesale (the store's own removal discipline).
        await store.selectScope(next);
        // 4. Mount the BFF stream under the new pair + the same handle.
        runtime.mountStream(streamHeaders(handle, next));
        return { status: "switched", selection: next };
      } catch (error) {
        if (error instanceof SelectionSwitchRefused) {
          return { status: "refused", error };
        }
        throw error;
      } finally {
        gate.busy = false;
      }
    },

    /** The headers a remount carries for the CURRENT selection (the ready-state mount). */
    headersFor(selection: ScopeSelection): Readonly<Record<string, string>> {
      return streamHeaders(handle, selection);
    },
  };
}

export type SelectionSession = ReturnType<typeof createSelectionSession>;
