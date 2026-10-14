import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, ErrorNotice, Mascot, s } from "../ui";
import { fetchMe, fetchWorkspace, openConversation, provisionOpenMuseBot } from "./api";
import { currentSession, signOut } from "./auth";
import { EmailSignInForm } from "./email-signin";
import { isAuthFailure, OpenBotError } from "./errors";
import {
  type EntrySequenceEvent,
  type EntrySequenceFailure,
  type EntrySequencePhase,
  type EntrySequenceState,
  entryPhaseReducer,
  entrySequenceReducer,
  type GateState,
  initialEntrySequence,
} from "./gate-state";
import { clearPrivateState, OPENBOT_SESSION_STORAGE_KEY } from "./private-state";
import { type OpenBotSession, type OpenBotWorkspace, openBotSessionSchema } from "./types";

export type {
  EntrySequenceEvent,
  EntrySequencePhase,
  EntrySequenceState,
  GateEvent,
  GatePhase,
  GateState,
} from "./gate-state";
export { entryPhaseReducer, entrySequenceReducer, initialEntrySequence } from "./gate-state";
export { OPENBOT_SESSION_STORAGE_KEY } from "./private-state";

const COPY = {
  checking: "正在检查登录状态…",
  provisioning: "正在准备你的专属 OpenMuse Bot…",
  loading: "正在打开你的 OpenBot 工作区…",
  conversation: "正在打开与 Bot 的对话…",
  loadStuck: "工作区暂时无法加载，你的登录仍然有效。",
  loadStuckFinal: "工作区没有加载出来，你的登录仍然有效。",
  retry: "重试",
  backToSignin: "返回登录页",
  welcomeTitle: "欢迎使用 OpenMuse。",
  welcomeSubtitle: "由 OpenBot 驱动。请使用你的 OpenBot 账号登录。",
  sessionNotLanded: "登录已受理但会话未能建立，请重试。",
} as const;

const STEP_COPY: Partial<Record<EntrySequencePhase, string>> = {
  provisioning: COPY.provisioning,
  workspace: COPY.loading,
  conversation: COPY.conversation,
  ready: COPY.loading,
};

/** The loading line: a failure's copy first, else the current step's. */
function loadingCopy(failure: EntrySequenceFailure | undefined, phase: EntrySequencePhase): string {
  if (!failure) return STEP_COPY[phase] ?? COPY.checking;
  return failure.retryable ? COPY.loadStuck : COPY.loadStuckFinal;
}

function readStoredSession(): OpenBotSession | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(OPENBOT_SESSION_STORAGE_KEY);
    const parsed = openBotSessionSchema.safeParse(raw ? JSON.parse(raw) : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function removeStoredSession(): void {
  try {
    if (typeof sessionStorage !== "undefined")
      sessionStorage.removeItem(OPENBOT_SESSION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; nothing persisted means nothing to remove.
  }
}

function persistSession(session: OpenBotSession): void {
  try {
    if (typeof sessionStorage !== "undefined")
      sessionStorage.setItem(OPENBOT_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable (private mode); the next entry just re-provisions.
  }
}

export interface OpenBotEntry {
  workspace: OpenBotWorkspace;
  session: OpenBotSession;
}

/**
 * OpenBot sign-in gate + private-Bot entry sequence:
 *
 *   check Better Auth session → /api/me verification → provision (or restore)
 *   the private OpenMuse Bot → /api/mobile/workspace → openConversation
 *
 * Email/password only for this ticket. A 401 anywhere clears the session and
 * the persisted entry and returns to the form; non-auth failures keep the
 * (still valid) session with a retry that restarts the sequence at provision.
 * Phase transitions run through the pure entryPhaseReducer (pre-auth) and
 * entrySequenceReducer (the provision→workspace→conversation machine).
 */
export function OpenBotGate({ onReady }: { onReady: (entry: OpenBotEntry) => void }) {
  const [state, setState] = useState<GateState>({ phase: "checking" });
  const [seq, setSeq] = useState<EntrySequenceState>(initialEntrySequence);
  const [notice, setNotice] = useState("");

  // One entry sequence at a time: the retry button fires load(), and two
  // interleaved runs would cross-apply events to the seq machine (and call
  // onReady twice).
  const running = useRef(false);
  const load = useCallback(
    async (justSignedIn = false) => {
      if (running.current) return;
      running.current = true;
      try {
        setState({ phase: "checking" });
        setSeq(initialEntrySequence);
        setNotice("");
        // Run the sequence machine on a local value so the async flow can read
        // each transition's result; setSeq mirrors it into the UI.
        let sequence = initialEntrySequence;
        const step = (event: EntrySequenceEvent) => {
          sequence = entrySequenceReducer(sequence, event);
          setSeq(sequence);
        };
        try {
          if (justSignedIn) {
            // A fresh sign-in starts from its own writes; no sweep runs here
            // (it would delete the jar sign-in just persisted). A previous
            // user's stored entry is instead dropped by the userId binding
            // below, so a clean start never depends on an upstream sweep.
          } else {
            const session = await currentSession();
            if (!session) {
              // Only a CONFIRMED no-session sweeps: currentSession throws on a
              // check failure (network/server), which lands in the retryable
              // catch below and keeps the still-valid local jar intact.
              // Everything private left on this device (native SecureStore
              // jar + PDF cache, web storage) belongs to a previous user —
              // sweep it now, before the sign-in form can establish a new one
              // (I07: each new sign-in starts from zero).
              await clearPrivateState().catch(() => undefined);
              setState((prev) => entryPhaseReducer(prev, { type: "no-local-session" }));
              return;
            }
          }
          // /api/me is the final arbiter of session validity: a stale local
          // session that the server rejects must clear out and re-sign-in.
          const me = await fetchMe();
          setState((prev) => entryPhaseReducer(prev, { type: "me-ok" }));

          // Entry sequence (I03): a stored session from a previous entry is
          // validated by the workspace read alone; a first entry provisions the
          // private Bot — ownership is the session's, never a name-based
          // lookup. The stored entry carries no intrinsic user binding, so it
          // is trusted only when it was persisted under the account /api/me
          // just confirmed: a previous user's leftover entry (e.g. a dead-end
          // exit that skipped the sweep) never seeds this one's entry.
          const stored = readStoredSession();
          const usable = stored && stored.userId === me.user.id ? stored : null;
          if (stored && !usable) removeStoredSession();
          step(usable ? { type: "stored", session: usable } : { type: "start" });
          let botId: string;
          if (usable) {
            botId = usable.botId;
          } else {
            const provisioned = await provisionOpenMuseBot();
            step({ type: "provision-ok", botId: provisioned.botId });
            botId = provisioned.botId;
          }
          const workspace = await fetchWorkspace();
          step({ type: "workspace-ok", agents: workspace.agents });
          // The machine may reject the workspace (workspace_inconsistent) and
          // drop the session: stop here so its error UI (non-retryable, with
          // the way back to sign-in) renders — onReady never fires and the
          // blocked session is never persisted for a later entry to reuse.
          if (sequence.phase === "error") return;
          let session = sequence.session;
          if (!session) {
            session = await openConversation(botId);
            step({ type: "conversation-ok", session });
          }
          // Bind the persisted entry to the account that just validated it.
          persistSession({ ...session, userId: me.user.id });
          onReady({ workspace, session });
        } catch (e) {
          if (isAuthFailure(e)) {
            // Revoke first, then sweep (I07): the native clear must not delete
            // the SecureStore session while signOut still needs its cookie.
            await signOut();
            await clearPrivateState().catch(() => undefined);
            setNotice(justSignedIn ? COPY.sessionNotLanded : "");
            setState((prev) => entryPhaseReducer(prev, { type: "auth-failed" }));
            return;
          }
          const failure = e instanceof OpenBotError ? e : null;
          setNotice(failure ? failure.message : String(e));
          setSeq((prev) =>
            entrySequenceReducer(prev, {
              type: "failed",
              code: failure?.code ?? "unknown",
              message: failure ? failure.message : String(e),
            }),
          );
        }
      } finally {
        running.current = false;
      }
    },
    [onReady],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "signin" || seq.phase === "signin") {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <View style={{ width: "100%", maxWidth: 420, gap: 20, alignItems: "center" }}>
          <Mascot size={72} />
          <Text style={{ fontSize: 30, color: colors.text, letterSpacing: -1, fontWeight: "500" }}>
            {COPY.welcomeTitle}
          </Text>
          <Text style={[s.muted, { textAlign: "center" }]}>{COPY.welcomeSubtitle}</Text>
          {/* The auth-failed notice (e.g. sessionNotLanded after a fresh
              sign-in) must be visible here, or the form gives no feedback. */}
          <ErrorNotice error={notice || undefined} />
          <EmailSignInForm onSignedIn={() => void load(true)} />
        </View>
      </SafeAreaView>
    );
  }

  const failure = seq.phase === "error" ? seq.failure : undefined;
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
      }}
    >
      <Mascot size={64} />
      <ActivityIndicator color={colors.blueDark} />
      <Text style={s.muted}>{loadingCopy(failure, seq.phase)}</Text>
      <ErrorNotice error={failure?.message ?? notice} />
      {failure?.retryable && (
        <Button small onPress={() => void load()}>
          {COPY.retry}
        </Button>
      )}
      {/* Every failure keeps an exit — a non-retryable one must not dead-end
          the screen on a spinner with no way back to sign-in. The exit must
          also not strand the (still valid) session and its stored entry: a
          later sign-in would re-read the stale entry and dead-end again, so
          revoke + sweep first — exactly what the auth-failed catch does. */}
      {failure && (
        <Pressable
          onPress={() => {
            void signOut()
              .catch(() => undefined)
              .then(() => clearPrivateState())
              .catch(() => undefined)
              .finally(() => {
                // A stale failure notice must not haunt the fresh sign-in form.
                setNotice("");
                setSeq(initialEntrySequence);
                setState({ phase: "signin" });
              });
          }}
        >
          <Text style={[s.small, { color: colors.blueDark }]}>{COPY.backToSignin}</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
