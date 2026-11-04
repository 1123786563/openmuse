import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  CalendarDays,
  Check,
  FolderOpen,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageCircle,
  MessagesSquare,
  Monitor,
  PanelsTopLeft,
  Plug,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import { API_URL, createStandaloneSession, MuseApi, mobileAuthConfig } from "./src/api";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ComputerEntry } from "./src/computer";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { Details } from "./src/details";
import { sessionCookie, signOut } from "./src/openbot/auth";
import { OpenBotCalendarScreen } from "./src/openbot/calendar";
import { applyArchived, applyRenamed, applyReopened } from "./src/openbot/channel-actions";
import { mergeCreated, sessionFor } from "./src/openbot/channel-state";
import { OpenBotChannelsScreen } from "./src/openbot/channels";
import { OpenBotChatScreen } from "./src/openbot/chat";
import { setOpenbotTransportDefaults } from "./src/openbot/client";
import {
  createCompanyAssuranceClient,
  getCompanyAssurance,
  setCompanyAssurance,
} from "./src/openbot/company-assurance";
import { OpenBotComputerScreen } from "./src/openbot/computer";
import { openbotUrl } from "./src/openbot/config";
import { OpenBotConnectionsScreen } from "./src/openbot/connections";
import { OpenBotFilesScreen } from "./src/openbot/files";
import { OpenBotGate } from "./src/openbot/gate";
import { clearPrivateState } from "./src/openbot/private-state";
import { OpenBotTasksScreen } from "./src/openbot/tasks";
import {
  createTenancyStore,
  readWorkspaceScopeListing,
  type ScopeSelection,
  type WorkspaceScopeCompany,
  type WorkspaceScopeListing,
  type WorkspaceScopeTeam,
} from "./src/openbot/tenancy";
import {
  createEnterpriseLogin,
  createScopedFetch,
  type EnterpriseLogin,
  EnterpriseLoginRefused,
  type EnterpriseSessionResponse,
  type MobileAuthConfig,
  type PendingLoginStorage,
  TENANT_HEADER,
  WORKSPACE_HEADER,
} from "./src/openbot/transport";
import type { OpenBotSession, OpenBotWorkspace } from "./src/openbot/types";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import { t } from "./src/strings";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import { Button, Card, colors, ErrorNotice, Field, IconButton, Mascot, s } from "./src/ui";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: t("navChat"), icon: MessageCircle },
  { id: "activity", label: t("navActivity"), icon: PanelsTopLeft },
  { id: "ideas", label: t("navIdeas"), icon: Lightbulb },
  { id: "goals", label: t("navGoals"), icon: SquareCheck },
  { id: "apps", label: t("navApps"), icon: Shapes },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: t("navActivity"), subtitle: t("subtitleActivity") },
  ideas: { title: t("navIdeas"), subtitle: t("subtitleIdeas") },
  goals: {
    title: t("navGoals"),
    subtitle: t("subtitleGoals"),
  },
  apps: {
    title: t("navApps"),
    subtitle: t("subtitleApps"),
  },
  connections: { title: t("navApps"), subtitle: t("subtitleConnections") },
  mail: { title: t("shortcutMail"), subtitle: t("subtitleMail") },
  calendar: { title: t("shortcutCalendar"), subtitle: t("subtitleCalendar") },
  browser: { title: t("navBrowser"), subtitle: t("subtitleBrowser") },
  files: { title: t("shortcutFiles"), subtitle: t("subtitleFiles") },
};
const web = Platform.OS === "web";

/*
 * Transport boot (I04): native has no cookie jar, so every OpenBot request
 * carries the session cookie from SecureStore explicitly. Web is unchanged
 * (browser cookie via credentials). Platform + cookie register at module
 * scope — child effects (the gate's first /api/me) run before a parent's
 * effect could. The 401 hook registers inside OpenBotApp instead: only there
 * can it flip the tree back to the sign-in gate.
 */
setOpenbotTransportDefaults({
  platform: web ? "web" : "native",
  getCookie: sessionCookie,
});

/**
 * The app's one entry choice, from deployment configuration (T07.10):
 * - enterprise: the explicit authority + OpenMuse BFF handoff below;
 * - standalone: the explicit legacy access-key flow;
 * - legacy (unset): the existing OpenBot-direct app, unchanged.
 */
export default function App() {
  let config: MobileAuthConfig;
  try {
    config = mobileAuthConfig();
  } catch (error) {
    return <MobileConfigError error={error instanceof Error ? error.message : String(error)} />;
  }
  if (config.mode === "enterprise") return <EnterpriseApp config={config} />;
  if (config.mode === "standalone") return <OpenMuseApp />;
  return <OpenBotApp />;
}

function MobileConfigError({ error }: { error: string }) {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <View style={{ width: "100%", maxWidth: 420, gap: 18, alignItems: "center" }}>
          <Mascot size={64} />
          <Text style={[s.title, { fontSize: 24, textAlign: "center" }]}>无法启动企业登录</Text>
          <Text style={[s.muted, { textAlign: "center" }]}>
            部署配置不完整：企业模式必须显式提供 OpenBot authority 与 OpenMuse BFF origin。
          </Text>
          <ErrorNotice error={error} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/*
 * T07.10 (#600): the real app's enterprise path.
 *
 * ONE tenancy store and ONE scoped transport carry the verified selection from
 * the moment a person picks a company/team; MuseApi, the workspace read and the
 * company-assurance client all ride that same store. The only credential is the
 * opaque session handle minted by the authority exchange — there is no
 * accessKey path here, and a failed login clears the identity instead of
 * falling back to the standalone supply.
 */
type EnterpriseStage =
  | { kind: "signed-out"; error?: string }
  | { kind: "completing" }
  | { kind: "choosing"; session: EnterpriseSessionResponse; listing: WorkspaceScopeListing }
  | {
      kind: "ready";
      session: EnterpriseSessionResponse;
      listing: WorkspaceScopeListing;
      selection: ScopeSelection;
      api: MuseApi;
      workspace: Workspace;
    };

function webPendingStorage(): PendingLoginStorage | undefined {
  if (Platform.OS !== "web") return undefined;
  try {
    if (typeof sessionStorage === "undefined") return undefined;
    return {
      getItem: (key) => sessionStorage.getItem(key),
      setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: (key) => sessionStorage.removeItem(key),
    };
  } catch {
    return undefined;
  }
}

function openSystemBrowser(url: string): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.location.assign(url);
    return;
  }
  void Linking.openURL(url);
}

function enterpriseErrorCopy(error: unknown): string {
  if (error instanceof EnterpriseLoginRefused) {
    if (error.code === "STATE_MISMATCH") return "登录回调校验失败（state 不匹配），请重新登录。";
    if (error.code === "REDIRECT_MISMATCH") return "登录回调地址与注册地址不一致，请重新登录。";
    if (error.code === "AUTHORITY_MISMATCH")
      return "登录返回的 authority 与部署配置不一致，已拒绝。";
    if (error.status === 401) return "登录会话已失效，请重新登录。";
    if (error.status === 503) return "authority 暂时不可用，请稍后重试。";
    return `登录失败（${error.code}），请重新登录。`;
  }
  return error instanceof Error ? error.message : String(error);
}

function EnterpriseApp({ config }: { config: MobileAuthConfig }) {
  const login = useRef<EnterpriseLogin | null>(null);
  if (login.current === null) {
    login.current = createEnterpriseLogin({
      config,
      fetchLike: (url, init) => fetch(url, init),
      storage: webPendingStorage(),
    });
  }
  const [stage, setStage] = useState<EnterpriseStage>({ kind: "signed-out" });
  const [working, setWorking] = useState(false);
  const choosing = useRef(false);
  // The same callback can arrive twice (getInitialURL plus the live URL event,
  // or a web reload while the effect is running); only the first may exchange.
  const completing = useRef(false);

  const complete = useCallback(
    async (callbackUrl: string) => {
      if (login.current === null) return;
      // A redeploy/refresh can land on the redirect URI itself; only a URL
      // that actually carries a code and state is a handoff callback.
      let callback: URL;
      try {
        callback = new URL(callbackUrl);
      } catch {
        return;
      }
      if (callback.searchParams.get("code") === null || callback.searchParams.get("state") === null)
        return;
      if (!callbackUrl.startsWith(config.redirectUri)) return;
      if (completing.current) return;
      completing.current = true;
      setWorking(true);
      try {
        const session = await login.current.complete(callbackUrl);
        const discovery = new MuseApi(session.token, { baseUrl: config.apiOrigin });
        const listing = await readWorkspaceScopeListing(() =>
          discovery.response("/api/enterprise/workspace-scope"),
        );
        if (listing.companies.length === 0) {
          setStage({ kind: "signed-out", error: "你的账号还没有可用的公司或团队，请联系管理员。" });
        } else {
          setStage({ kind: "choosing", session, listing });
        }
      } catch (error) {
        login.current.cancel();
        setCompanyAssurance(null);
        setStage({ kind: "signed-out", error: enterpriseErrorCopy(error) });
      } finally {
        completing.current = false;
        setWorking(false);
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.history.replaceState({}, "", window.location.pathname);
        }
      }
    },
    [config],
  );

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => void complete(url));
    void Linking.getInitialURL().then(
      (initial) => {
        if (initial) void complete(initial);
      },
      () => undefined,
    );
    if (Platform.OS === "web" && typeof window !== "undefined") {
      void complete(window.location.href);
    }
    return () => subscription.remove();
  }, [complete]);

  /*
   * The company-assurance callback (T07.12) rides this same app life. The
   * enterprise entry replaces OpenBotApp, so its listener cannot be the one
   * the live client relies on: an account change kills the flow and returns
   * to the enterprise sign-in rather than resuming the old scope.
   */
  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      if (!url.startsWith("openmuse://company-auth")) return;
      const assurance = getCompanyAssurance();
      if (!assurance) return;
      void assurance
        .completeCallback(url)
        .then((outcome) => {
          if (outcome.status !== "account-changed") return;
          setCompanyAssurance(null);
          setStage({ kind: "signed-out", error: "登录账号已变更，请重新登录。" });
        })
        .catch(() => undefined);
    };
    const subscription = Linking.addEventListener("url", onUrl);
    void Linking.getInitialURL().then(
      (initial) => {
        if (initial) onUrl({ url: initial });
      },
      () => undefined,
    );
    return () => subscription.remove();
  }, []);

  const begin = useCallback(() => {
    if (login.current === null) return;
    try {
      const pending = login.current.begin();
      setStage({ kind: "signed-out" });
      openSystemBrowser(pending.authorizeUrl);
    } catch (error) {
      setStage({ kind: "signed-out", error: enterpriseErrorCopy(error) });
    }
  }, []);

  const choose = useCallback(
    async (company: WorkspaceScopeCompany, team: WorkspaceScopeTeam) => {
      if (stage.kind !== "choosing" || choosing.current) return;
      choosing.current = true;
      const selection: ScopeSelection = {
        tenantId: company.tenantId,
        workspaceId: team.workspaceId,
      };
      setWorking(true);
      const store = createTenancyStore({
        userId: stage.session.user.id,
        storage: {
          getItem: () => null,
          setItem: () => undefined,
        },
      });
      await store.selectScope(selection);
      const scopedFetch = createScopedFetch({
        store,
        fetchLike: (path, init) => fetch(`${config.apiOrigin}${path}`, init),
      });
      const api = new MuseApi(stage.session.token, {
        fetchLike: scopedFetch,
        baseUrl: config.apiOrigin,
      });
      try {
        await api.request("/api/enterprise/workspace-scope/validate-selection", selection);
        const workspace = await api.request<Workspace>("/api/workspace");
        setCompanyAssurance(
          createCompanyAssuranceClient({
            store,
            fetchLike: scopedFetch,
            openBrowser: openSystemBrowser,
            handle: stage.session.token,
          }),
        );
        setStage({
          kind: "ready",
          session: stage.session,
          listing: stage.listing,
          selection,
          api,
          workspace,
        });
      } catch (error) {
        await store.selectScope(null);
        setCompanyAssurance(null);
        setStage({ kind: "signed-out", error: enterpriseErrorCopy(error) });
      } finally {
        choosing.current = false;
        setWorking(false);
      }
    },
    [config, stage],
  );

  if (stage.kind === "ready") {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <CopilotKitProvider
          runtimeUrl={`${config.apiOrigin}/api/copilotkit`}
          headers={{
            Authorization: `Bearer ${stage.session.token}`,
            [TENANT_HEADER]: stage.selection.tenantId,
            [WORKSPACE_HEADER]: stage.selection.workspaceId,
          }}
        >
          <WorkspaceApp
            token={stage.session.token}
            api={stage.api}
            initialWorkspace={stage.workspace}
          />
        </CopilotKitProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <View style={{ width: "100%", maxWidth: 460, gap: 20, alignItems: "center" }}>
          <Mascot size={72} />
          <Text style={{ fontSize: 30, color: colors.text, letterSpacing: -1, fontWeight: "500" }}>
            {t("welcomeTitle")}
          </Text>
          <Text style={[s.muted, { textAlign: "center" }]}>{t("welcomeSubtitle")}</Text>
          {stage.kind === "signed-out" && <ErrorNotice error={stage.error} />}
          {working || stage.kind === "completing" ? (
            <ActivityIndicator color={colors.blueDark} />
          ) : stage.kind === "choosing" ? (
            <Card style={{ width: "100%", gap: 14 }}>
              <Text style={[s.title, { fontSize: 18 }]}>选择公司团队</Text>
              <Text style={s.small}>范围来自你当前的企业成员资格；未选择任何默认范围。</Text>
              {stage.listing.companies.map((company) => (
                <View key={company.tenantId} style={{ gap: 8 }}>
                  <Text style={{ color: colors.text, fontWeight: "600" }}>{company.name}</Text>
                  {company.teams.length === 0 ? (
                    <Text style={s.small}>该公司的团队尚未开通，暂时无法进入工作区。</Text>
                  ) : (
                    company.teams.map((team) => (
                      <Pressable
                        key={team.workspaceId}
                        accessibilityRole="button"
                        accessibilityLabel={`${company.name} ${team.name}`}
                        onPress={() => void choose(company, team)}
                        style={({ pressed }) => ({
                          paddingVertical: 12,
                          paddingHorizontal: 14,
                          borderRadius: 14,
                          backgroundColor: pressed ? "#F0F1F2" : "#F8F8F8",
                          borderWidth: 1,
                          borderColor: "#EEEEEE",
                        })}
                      >
                        <Text style={{ color: colors.text }}>{team.name}</Text>
                      </Pressable>
                    ))
                  )}
                </View>
              ))}
            </Card>
          ) : (
            <Card style={{ width: "100%", gap: 14 }}>
              <Button primary onPress={begin}>
                使用 OpenBot 登录
              </Button>
              <Text style={s.small}>
                将在系统浏览器完成企业登录，再用一次性 PKCE 交接回到应用。
              </Text>
            </Card>
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function OpenBotApp() {
  const [entry, setEntry] = useState<{ workspace: OpenBotWorkspace; session: OpenBotSession }>();
  // errors.ts contract: authentication_required means "401, session gone, go
  // back to sign-in". Without this, a session that dies mid-use leaves every
  // screen on 401 loop (each answer re-triggering signOut) with no way back
  // to the gate but the manual sign-out button.
  useEffect(() => {
    setOpenbotTransportDefaults({
      onAuthExpired: () => {
        // Revoke first, then sweep (I07): the native clear must not delete
        // the SecureStore session while signOut still needs its cookie. The
        // sweep ends by dropping the entry so the whole tree remounts onto
        // the sign-in gate.
        void signOut()
          .then(() => clearPrivateState())
          .catch(() => undefined)
          .finally(() => setEntry(undefined));
      },
    });
  }, []);
  /*
   * T07.12 (#602): the company-assurance half. The client itself is built by
   * the enterprise session wiring once it has the handle and tenancy store
   * (T07.10 owns the handoff) and registered through
   * setCompanyAssurance; until then getCompanyAssurance() answers null and
   * every consumer keeps its legacy standalone contract — no invented
   * handle, no guessed session. The deep-link listener is registered for the
   * whole app life and routes a company-auth callback through the ONE live
   * flow: it re-validates the ORIGINAL intent's selection (never the
   * temporarily active one), and an account change kills the flow and clears
   * identity through the same sign-out sweep as a 401.
   */
  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      if (!url.startsWith("openmuse://company-auth")) return;
      const assurance = getCompanyAssurance();
      if (!assurance) return;
      void assurance
        .completeCallback(url)
        .then((outcome) => {
          if (outcome.status !== "account-changed") return;
          setCompanyAssurance(null);
          void signOut()
            .then(() => clearPrivateState())
            .catch(() => undefined)
            .finally(() => setEntry(undefined));
        })
        .catch(() => undefined);
    };
    const subscription = Linking.addEventListener("url", onUrl);
    void Linking.getInitialURL().then(
      (initial) => {
        if (initial) onUrl({ url: initial });
      },
      () => undefined,
    );
    return () => subscription.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {entry ? (
        <OpenBotConnected
          workspace={entry.workspace}
          session={entry.session}
          onSignOut={() => {
            // SignOutButton already revoked the server session; clear every
            // private key — web storage plus the native SecureStore registry
            // and PDF download cache (I07) — then drop the entry state so the
            // whole tree (workspace snapshot included) remounts fresh for the
            // next user. T07.12: the assurance sweep rides the same moment —
            // pending media tickets and the pending company challenge die
            // with the session, so nothing private survives it.
            getCompanyAssurance()?.signOut();
            setCompanyAssurance(null);
            void clearPrivateState().catch(() => undefined);
            setEntry(undefined);
          }}
        />
      ) : (
        <OpenBotGate onReady={setEntry} />
      )}
    </SafeAreaProvider>
  );
}

/**
 * Provider wiring for the OpenBot runtime (C01). Web rides the browser cookie
 * (credentials "include", no manual headers); native has no cookie jar, so the
 * session cookie is resolved once at mount and sent as an explicit Cookie
 * header. The provider key tracks cookie PRESENCE, never its value: a value
 * key would remount the runtime on every rotation for nothing, while a
 * presence flip (the only real auth change) remounts it deliberately.
 */
/** Provider auth wiring: web rides the browser cookie; native sends the session cookie by hand. */
function providerAuthProps(
  web: boolean,
  cookie: string | null | undefined,
): { credentials?: "include"; headers?: { Cookie: string } } {
  if (web) return { credentials: "include" };
  if (cookie) return { headers: { Cookie: cookie } };
  return {};
}

function OpenBotConnected({
  workspace,
  session,
  onSignOut,
}: {
  workspace: OpenBotWorkspace;
  session: OpenBotSession;
  onSignOut: () => void;
}) {
  // undefined = still reading SecureStore on native; the runtime does not mount
  // until the one read settles, so it never opens an anonymous connection first.
  const [cookie, setCookie] = useState<string | null | undefined>(web ? null : undefined);
  // T03: minimal Tasks entry — one toggle on the shell, real navigation is a later ticket.
  const [tasksOpen, setTasksOpen] = useState(false);
  // K02: the own private Bot's computer preview, beside the Tasks entry.
  const [computerOpen, setComputerOpen] = useState(false);
  // A03: minimal Calendar entry, same toggle pattern as the Tasks entry.
  const [calendarOpen, setCalendarOpen] = useState(false);
  // G06: Google account connections entry, same toggle pattern as the rest.
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  // F04: the owner's Files entry (list + authenticated download to cache).
  const [filesOpen, setFilesOpen] = useState(false);
  // C02: the shell owns the channel roster and the selection. The list starts
  // as the workspace read's server order; a created channel is merged in, and
  // switching re-keys the chat below so each channel's useAgent thread loads
  // independently.
  const [channels, setChannels] = useState(workspace.channels);
  const [selectedId, setSelectedId] = useState(session.channelId);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const selected = channels.find((channel) => channel.id === selectedId);
  const insets = useSafeAreaInsets();
  const anyOverlayOpen =
    channelsOpen || tasksOpen || calendarOpen || connectionsOpen || filesOpen || computerOpen;
  useEffect(() => {
    if (web) return;
    void sessionCookie().then(setCookie, () => setCookie(null));
  }, []);
  if (cookie === undefined) return null;
  return (
    <CopilotKitProvider
      key={cookie ? "session" : "anonymous"}
      runtimeUrl={`${openbotUrl}/api/copilotkit`}
      {...providerAuthProps(web, cookie)}
    >
      {/*
       * Entry strip in normal flow (not absolutely positioned): it owns its
       * safe-area top, never shares coordinates with the chat header or the
       * overlays' own headers, fits the narrowest screens, and hides entirely
       * while any overlay is open (each overlay keeps its own close button).
       */}
      {!anyOverlayOpen && (
        <View
          style={{
            paddingTop: insets.top + 6,
            paddingBottom: 2,
            paddingHorizontal: 8,
            flexDirection: "row",
            justifyContent: "flex-end",
            gap: 4,
          }}
        >
          <IconButton icon={MessagesSquare} label="频道" onPress={() => setChannelsOpen(true)} />
          <IconButton icon={SquareCheck} label="任务" onPress={() => setTasksOpen(true)} />
          <IconButton icon={CalendarDays} label="日历" onPress={() => setCalendarOpen(true)} />
          <IconButton icon={Plug} label="连接" onPress={() => setConnectionsOpen(true)} />
          <IconButton icon={FolderOpen} label="文件" onPress={() => setFilesOpen(true)} />
          <IconButton icon={Monitor} label="计算机" onPress={() => setComputerOpen(true)} />
        </View>
      )}
      {/*
       * Remount by key on channel switch (React's reset-state-with-a-key), the
       * same deliberate-remount pattern as the provider presence key above: a
       * new channelId tears the old useAgent down and connects the selected
       * channel's thread fresh, so histories can never bleed across channels.
       */}
      <OpenBotChatScreen
        key={selected ? selected.id : session.channelId}
        session={selected ? sessionFor(selected) : session}
        title={selected?.name}
        onSignOut={onSignOut}
      />
      {channelsOpen && (
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <OpenBotChannelsScreen
            channels={channels}
            currentId={selectedId}
            botId={session.botId}
            onSelect={(channel) => {
              setSelectedId(channel.id);
              setChannelsOpen(false);
            }}
            onCreated={(channel) => {
              setChannels((prev) => mergeCreated(prev, channel));
              setSelectedId(channel.id);
              setChannelsOpen(false);
            }}
            onRenamed={(channel) => setChannels((prev) => applyRenamed(prev, channel))}
            onArchived={(channelId) =>
              setChannels((prev) => applyArchived(prev, channelId, new Date().toISOString()))
            }
            onReopened={(channelId) => setChannels((prev) => applyReopened(prev, channelId))}
            onClose={() => setChannelsOpen(false)}
          />
        </View>
      )}
      {tasksOpen && (
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <OpenBotTasksScreen onClose={() => setTasksOpen(false)} />
        </View>
      )}
      {calendarOpen && (
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <OpenBotCalendarScreen onClose={() => setCalendarOpen(false)} />
        </View>
      )}
      {connectionsOpen && (
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <OpenBotConnectionsScreen onClose={() => setConnectionsOpen(false)} />
        </View>
      )}
      {filesOpen && (
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <OpenBotFilesScreen onClose={() => setFilesOpen(false)} />
        </View>
      )}
      {computerOpen && (
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <OpenBotComputerScreen botId={session.botId} onClose={() => setComputerOpen(false)} />
        </View>
      )}
    </CopilotKitProvider>
  );
}

function OpenMuseApp() {
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const connect = useCallback(async (key?: string) => {
    setBusy(true);
    setError("");
    try {
      const session = await createStandaloneSession(key);
      setToken(session.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void connect();
  }, [connect]);
  const api = useMemo(() => new MuseApi(token), [token]);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} api={api} />
        </CopilotKitProvider>
      ) : (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            <Mascot size={72} />
            <Text
              style={{ fontSize: 32, color: colors.text, letterSpacing: -1, fontWeight: "500" }}
            >
              {t("welcomeTitle")}
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>{t("welcomeSubtitle")}</Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Card style={{ width: "100%" }}>
                <ErrorNotice error={error} />
                <Field
                  label={t("accessKeyLabel")}
                  value={accessKey}
                  onChangeText={setAccessKey}
                  secureTextEntry
                  placeholder={t("phAccessKey")}
                />
                <Button primary onPress={() => void connect(accessKey || undefined)}>
                  {t("openWorkspace")}
                </Button>
                <Text style={[s.small, { marginTop: 15 }]}>
                  {t("localWorkspaceNote", { url: API_URL })}
                </Text>
              </Card>
            )}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({
  token,
  api,
  initialWorkspace,
}: {
  token: string;
  api: MuseApi;
  initialWorkspace?: Workspace;
}) {
  const [workspace, setWorkspace] = useState<Workspace | undefined>(initialWorkspace);
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    if (initialWorkspace) return;
    void refresh().catch((e) => setError(String(e)));
  }, [refresh, initialWorkspace]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch((e) => setError(String(e)));
    });
    return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>
              {t("calTryAgain")}
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>{t("openingWorkspace")}</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{ workspace, api, section, navigate, refresh, open, close, notify: setToast, ask }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={token}>
          <ThreadsProvider>
            <WorkspaceShell
              detail={detail}
              toast={toast}
              clearToast={() => setToast("")}
              error={error}
              prompt={prompt}
            />
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  const { workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || "OpenMuse";
  const status = activeTask
    ? activeTask.status === "waiting_approval"
      ? t("statusReadyReview", { title: activeTask.title })
      : activeTask.status === "waiting_input"
        ? t("statusNeedsInput", { title: activeTask.title })
        : activeTask.plan.find((step) => step.status === "running")?.title || activeTask.title
    : data?.tasks.some((task) => task.status === "queued")
      ? t("statusPickingUp")
      : t("statusHere");
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : AppsScreen;
  const utility = ["mail", "calendar", "browser", "files"].includes(section);
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
        <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View
            style={{
              height: desktop ? 146 : 122,
              paddingTop: desktop ? 14 : 2,
              marginHorizontal: 20,
            }}
          >
            <View style={{ position: "absolute", left: 0, top: 16 }}>
              <IconButton
                icon={Menu}
                label={t("openThreadsMenu")}
                onPress={() => setThreadsOpen(true)}
              />
            </View>
            <View pointerEvents="box-none" style={{ alignItems: "center", gap: 1 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("openAgentActivity", { name: agentName })}
                onPress={() => navigate("activity")}
                style={({ pressed }) => ({
                  alignItems: "center",
                  maxWidth: "70%",
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Mascot size={desktop ? 58 : 49} variant={data?.identity.avatar} />
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: colors.text,
                    letterSpacing: -0.4,
                  }}
                >
                  {agentName}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}
                >
                  {status}
                </Text>
              </Pressable>
              {section === "chat" && <ComputerEntry />}
            </View>
            <View style={{ position: "absolute", right: 0, top: 16 }}>
              <IconButton
                icon={Bell}
                label={t("notificationsBadge", { n: pending })}
                onPress={() => open({ type: "notifications" })}
              />
              {pending > 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 4,
                    position: "absolute",
                    top: 7,
                    right: 9,
                    backgroundColor: colors.blueDark,
                  }}
                />
              )}
            </View>
          </View>
          <View style={{ flex: 1, minHeight: 0 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: desktop ? 42 : 22, paddingBottom: 28 }}
                keyboardShouldPersistTaps="handled"
              >
                {utility && (
                  <Button
                    small
                    style={{ alignSelf: "flex-start", marginBottom: 18 }}
                    onPress={() => navigate("apps")}
                  >
                    {t("backToApps")}
                  </Button>
                )}
                <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                <ErrorNotice error={error} />
                <Screen />
              </ScrollView>
            )}
            <View
              style={{
                display: section === "chat" ? "flex" : "none",
                flex: 1,
                paddingHorizontal: desktop ? 42 : 17,
              }}
            >
              <AgentStatus />
              {richThreads ? (
                <>
                  <ErrorNotice error={threadsError} />
                  {threadsError ? (
                    <Button onPress={retryThreads}>{t("retryMainChat")}</Button>
                  ) : threadsLoading ? (
                    <ActivityIndicator color={colors.blueDark} />
                  ) : null}
                  {!threadsLoading && selection.id !== mainId && (
                    <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                      {t("sideChat")}
                    </Text>
                  )}
                  {visited.map((thread) => (
                    <View
                      key={thread.id}
                      style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                    >
                      <ChatScreen
                        thread={thread}
                        active={section === "chat" && selection.id === thread.id}
                        prompt={selection.id === thread.id ? prompt : undefined}
                      />
                    </View>
                  ))}
                </>
              ) : (
                <ChatScreen prompt={prompt} active={section === "chat"} />
              )}
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 10,
              paddingBottom: desktop ? 22 : 7,
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                width: "100%",
                maxWidth: 370,
                padding: 5,
                backgroundColor: "#FFF",
                borderRadius: 40,
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07,
                shadowRadius: 18,
                elevation: 3,
                borderWidth: 1,
                borderColor: "#F8F8F8",
              }}
            >
              {nav.map((item) => {
                const active = section === item.id || (item.id === "apps" && utility);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => navigate(item.id)}
                    style={{
                      flex: 1,
                      height: 47,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active ? "#F0F1F2" : "transparent",
                      borderRadius: 28,
                    }}
                  >
                    <item.icon size={23} strokeWidth={1.8} color={colors.text} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        {!!toast && (
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", bottom: 94, left: 20, right: 20, alignItems: "center" }}
          >
            <View
              style={[
                s.row,
                {
                  gap: 10,
                  padding: 14,
                  backgroundColor: colors.text,
                  borderRadius: 20,
                  maxWidth: 560,
                },
              ]}
            >
              <Check size={16} color={colors.blue} />
              <Text style={{ color: "#FFF", fontSize: 13, flexShrink: 1 }}>{toast}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("dismissToast")}
                onPress={clearToast}
              >
                <X size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
        {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
      </SafeAreaView>
    </>
  );
}
