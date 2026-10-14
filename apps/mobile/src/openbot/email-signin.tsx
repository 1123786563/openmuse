import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button, Card, colors, ErrorNotice, Field, s } from "../ui";
import { MIN_PASSWORD_LENGTH, signInWithEmail, signOut, signUpWithEmail } from "./auth";

/**
 * Email/password sign-in + sign-up form.
 *
 * Field rules (checked before submit): email non-empty and shaped
 * user@domain.tld; password at least 8 chars (matches the server's
 * minPasswordLength); sign-up additionally requires a name. Local validation
 * never sends a request; server errors arrive as mapped copy via auth.ts.
 */

const COPY = {
  phName: "怎么称呼你",
  phEmail: "user@example.com",
  phPassword: `至少 ${MIN_PASSWORD_LENGTH} 位`,
  signingIn: "正在登录…",
  signingUp: "正在注册…",
  signIn: "登录",
  signUp: "创建账号",
  toSignUp: "还没有账号？注册一个",
  toSignIn: "已有账号？直接登录",
  signOut: "退出登录",
  errEmailEmpty: "请输入邮箱地址。",
  errEmailShape: "邮箱格式不正确，应为 user@example.com。",
  errPasswordEmpty: "请输入密码。",
  errPasswordShort: `密码至少 ${MIN_PASSWORD_LENGTH} 位。`,
  errNameEmpty: "请输入昵称。",
  errSignInUnexpected: "登录失败，请稍后重试。",
  labelName: "昵称",
  labelEmail: "邮箱",
  labelPassword: "密码",
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(value: string): string | null {
  if (!value.trim()) return COPY.errEmailEmpty;
  if (!EMAIL_RE.test(value.trim())) return COPY.errEmailShape;
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return COPY.errPasswordEmpty;
  if (value.length < MIN_PASSWORD_LENGTH) return COPY.errPasswordShort;
  return null;
}

export function validateName(value: string): string | null {
  if (!value.trim()) return COPY.errNameEmpty;
  return null;
}

export function EmailSignInForm({
  onSignedIn,
}: {
  /** Sign-in (or sign-up + auto sign-in) succeeded; the parent loads the workspace next. */
  onSignedIn: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    name?: string;
  }>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);

  function validateAll(): boolean {
    const errors: typeof fieldErrors = {};
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    if (emailError) errors.email = emailError;
    if (passwordError) errors.password = passwordError;
    if (mode === "signup") {
      const nameError = validateName(name);
      if (nameError) errors.name = nameError;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit() {
    setServerError("");
    if (!validateAll()) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const result = await signInWithEmail(email.trim(), password);
        if (!result.ok) {
          setServerError(result.reason);
          return;
        }
      } else {
        const created = await signUpWithEmail(email.trim(), password, name.trim());
        if (!created.ok) {
          setServerError(created.reason);
          return;
        }
        // Sign-up establishes a session in Better Auth, but sign in explicitly
        // so the cookie is guaranteed before the gate re-checks /api/me.
        const signed = await signInWithEmail(email.trim(), password);
        if (!signed.ok) {
          setServerError(signed.reason);
          return;
        }
      }
      onSignedIn();
    } catch {
      // The catch path is the unusual failure (network-layer noise): raw
      // exception text never reaches the screen. A token-shape guard does not
      // suffice — RN/Web network errors routinely carry internal endpoints,
      // hostnames or full request URLs — so the copy is unconditionally
      // generic, the same sanitize policy as the Connections screen.
      setServerError(COPY.errSignInUnexpected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ width: "100%", gap: 12 }}>
      {busy ? (
        <View style={{ alignItems: "center", paddingVertical: 8 }}>
          <ActivityIndicator color={colors.blueDark} />
          <Text style={[s.small, { marginTop: 8 }]}>
            {mode === "signin" ? COPY.signingIn : COPY.signingUp}
          </Text>
        </View>
      ) : (
        <>
          <ErrorNotice error={serverError} />
          {mode === "signup" && (
            <Field
              label={COPY.labelName}
              value={name}
              onChangeText={(value) => {
                setName(value);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }}
              placeholder={COPY.phName}
            />
          )}
          {fieldErrors.name ? <FieldError text={fieldErrors.name} /> : null}
          <Field
            label={COPY.labelEmail}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder={COPY.phEmail}
          />
          {fieldErrors.email ? <FieldError text={fieldErrors.email} /> : null}
          <Field
            label={COPY.labelPassword}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (fieldErrors.password)
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            secureTextEntry
            placeholder={COPY.phPassword}
          />
          {fieldErrors.password ? <FieldError text={fieldErrors.password} /> : null}
          <Button primary disabled={busy} onPress={() => void submit()}>
            {mode === "signin" ? COPY.signIn : COPY.signUp}
          </Button>
          <Pressable
            onPress={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setServerError("");
              setFieldErrors({});
            }}
            style={{ alignItems: "center", paddingVertical: 4 }}
          >
            <Text style={[s.small, { color: colors.blueDark }]}>
              {mode === "signin" ? COPY.toSignUp : COPY.toSignIn}
            </Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

function FieldError({ text }: { text: string }) {
  return <Text style={{ color: colors.danger, fontSize: 12, marginTop: -6 }}>{text}</Text>;
}

/** Sign-out entry for the connected screen; clears the session then calls back. */
export function SignOutButton({ onSignedOut }: { onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      small
      busy={busy}
      onPress={() => {
        setBusy(true);
        void signOut()
          .catch(() => undefined)
          .finally(onSignedOut);
      }}
    >
      {COPY.signOut}
    </Button>
  );
}
