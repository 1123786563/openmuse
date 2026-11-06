// WHAT THIS MODULE OWNS (and three-client-selection.test.ts pins through the
// pure coordinator in selection-stream-session.ts):
// - The provider's runtime address and headers are DERIVED, never hardcoded
//   at the mount site: the same `config.apiOrigin` the MuseApi uses, and the
//   same selection pair + handle spelling the coordinator's `streamHeaders`
//   produces, so there is one spelling of the pair between the REST half and
//   the CopilotKit half.
// - A switch is a provider-level event: the provider re-keys by the scope key
//   (company/team + generation) beside the coordinator's remount id, so the
//   old agent connection is torn down by unmount before the new scope's
//   provider mounts — an in-flight turn from the old scope cannot land on the
//   new scope's thread.
// - The stop→validate→publish→remount ORDER is owned by the pure coordinator
//   (`createSelectionSession`); this module only renders what it published.
//
// The background half (an original Run's server-side scope does not follow
// the UI switch) is the server's own scoping (T07.05/T07.17); the client here
// stops its OWN interactions and claims nothing about the Run's authority.
//
// Rerun: bun test apps/mobile/src/openbot/three-client-selection.test.ts

import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import type { ReactNode } from "react";
import { streamHeaders } from "./selection-stream-session";
import type { ScopeSelection, TenancyStore } from "./tenancy";
import type { MobileAuthConfig } from "./transport";

/**
 * The headers every CopilotKit request carries in enterprise mode — the SAME
 * derivation the switch coordinator's validation and remount steps use, so
 * the provider and the REST client cannot drift into two spellings.
 */
export function copilotKitHeaders(
  handle: string,
  selection: ScopeSelection | null,
): Readonly<Record<string, string>> {
  if (selection === null) return { authorization: `Bearer ${handle}` };
  return streamHeaders(handle, selection);
}

/** The provider's one runtime address: the enterprise BFF, from the deployment config. */
export function copilotKitRuntimeUrl(config: MobileAuthConfig): string {
  return `${config.apiOrigin}/api/copilotkit`;
}

/**
 * The whole switch, in the order T07.11 fixes: stop the live turn first (the
 * stop is a REQUEST against the old scope, awaited, and its refusal is not a
 * reason to keep the old turn alive on the client), then validate the new
 * pair, then move the store's selection so the generation advance refuses
 * every answer still in flight. The pure coordinator in
 * selection-stream-session.ts owns the order; this re-export is the seam
 * App.tsx drives with the store, the handle and the stop registry.
 */
export { createSelectionSession as switchSelection } from "./selection-stream-session";

export type CopilotKitEnterpriseProviderProps = {
  config: MobileAuthConfig;
  handle: string;
  store: TenancyStore;
  /** Bumped by the switch coordinator's mount step; the provider re-keys with it. */
  remountId?: number;
  children: ReactNode;
};

/**
 * The provider itself. The `key` is the store's scope key (company/team +
 * generation) beside the coordinator's remount id: React unmounts the old
 * provider instance on any switch, which tears the old agent's connection
 * down before the new scope's provider mounts. `headers` is read per request
 * from the store, so a provider that somehow outlives its scope answers under
 * the CURRENT selection, never its own stale one.
 */
export function CopilotKitEnterpriseProvider({
  config,
  handle,
  store,
  remountId = 0,
  children,
}: CopilotKitEnterpriseProviderProps) {
  const scope = store.scope();
  if (scope.status !== "open") {
    // The provider is mounted by the enterprise stage machine only after a
    // verified selection exists; a pending store here is a wiring defect, and
    // rendering an anonymous runtime connection is not a fallback it may take.
    throw new Error("The enterprise runtime requires a resolved scope.");
  }
  return (
    <CopilotKitProvider
      key={`${scope.key}#${remountId}`}
      runtimeUrl={copilotKitRuntimeUrl(config)}
      headers={() => {
        const current = store.scope();
        return copilotKitHeaders(handle, current.status === "open" ? current.selection : null);
      }}
    >
      {children}
    </CopilotKitProvider>
  );
}
