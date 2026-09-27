import { BrandSymbol } from "@/components/ui-app/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeRedirectPath } from "@/features/admin/permissions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { authService, getStoredToken } from "@/services/api";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  Eye,
  EyeOff,
  HeartPulse,
  Loader2,
  LockKeyhole,
  Mail,
  Salad,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

type AuthSearch = { redirect?: string; modo?: "convite" | "nova-senha" };
type AuthMode = "signin" | "signup" | "forgot" | "password";

// Ícones decorativos que flutuam em volta do logo da clínica (só atmosfera, sem texto).
const HERO_TILES: { icon: LucideIcon; slot: string; tile: string }[] = [
  {
    icon: CalendarCheck,
    slot: "-top-7 left-[7%] size-16 [animation-delay:380ms]",
    tile: "text-blue-600 [--tile-time:7.5s] dark:text-blue-300",
  },
  {
    icon: HeartPulse,
    slot: "top-[26%] -right-7 size-14 [animation-delay:480ms]",
    tile: "text-rose-600 [--tile-time:6.5s] [animation-delay:-2s] dark:text-rose-300",
  },
  {
    icon: Salad,
    slot: "-bottom-8 right-[12%] size-17 [animation-delay:580ms]",
    tile: "text-emerald-600 [--tile-time:8.5s] [animation-delay:-4s] dark:text-emerald-300",
  },
  {
    icon: Activity,
    slot: "bottom-[22%] -left-7 size-13 [animation-delay:680ms]",
    tile: "text-violet-600 [--tile-time:7s] [animation-delay:-1s] dark:text-violet-300",
  },
];

const FIELD_CLASS =
  "peer h-12 border-(--auth-field-line) bg-(--auth-field) pl-11 shadow-none hover:border-(--auth-field-line-hover) focus:bg-(--auth-field-focus)";
const FIELD_ICON_CLASS =
  "pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground transition-colors peer-focus:text-primary";

function readLinkError(): string | null {
  if (typeof window === "undefined" || !window.location.hash.includes("error")) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.get("error") && !params.get("error_code")) return null;
  return params.get("error_code") === "otp_expired"
    ? "Este link expirou ou já foi utilizado. Peça um novo convite ou solicite outro link de recuperação."
    : "Não foi possível validar o link. Solicite um novo e-mail.";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/Invalid login|invalid credentials|credenciais|senha incorreta/i.test(message))
    return "E-mail ou senha inválidos. Confira os dados e tente novamente.";
  if (/Email not confirmed/i.test(message))
    return "Confirme seu e-mail antes de entrar. Verifique também a pasta de spam.";
  if (/already registered|já cadastrad/i.test(message))
    return "Este e-mail já possui uma conta. Entre ou recupere sua senha.";
  if (/rate limit|too many/i.test(message))
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  if (/As senhas|A senha deve/i.test(message)) return message;
  return "Não foi possível concluir a solicitação. Verifique sua conexão e tente novamente.";
}

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    redirect: safeRedirectPath(search.redirect) ?? undefined,
    modo: search.modo === "convite" || search.modo === "nova-senha" ? search.modo : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Acesse sua conta • Dr. Jonatas Bandeira • MedCore" },
      {
        name: "description",
        content:
          "Agenda, prontuários e acompanhamentos clínicos do consultório Dr. Jonatas Bandeira.",
      },
    ],
    links: [
      {
        rel: "preload",
        as: "image",
        href: "/assets/dr-jonatas-bandeira-logo.png",
      },
    ],
  }),
  component: AuthPage,
});

function GoogleIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.39 7.37 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.99 0 12s.45 3.85 1.24 5.42l4.04-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.61 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function AuthPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const target = search.redirect ?? "/dashboard";
  const [mode, setMode] = useState<AuthMode>(search.modo ? "password" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const goToTarget = useCallback(() => router.history.push(target), [router, target]);

  useEffect(() => {
    let cancelled = false;
    if (!search.modo && getStoredToken()) {
      goToTarget();
      return;
    }
    const linkFailure = search.modo ? readLinkError() : null;
    if (linkFailure) setLinkError(linkFailure);
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Não foi possível verificar a sessão.", error);
          setFormError("Não foi possível verificar sua sessão. Tente novamente.");
          return;
        }
        if (search.modo) {
          if (data.session) {
            setSessionEmail(data.session.user.email ?? null);
            setLinkError(null);
          } else if (!linkFailure) {
            setLinkError("Link inválido ou expirado. Solicite um novo e-mail.");
          }
        } else if (data.session) goToTarget();
      })
      .catch((error: unknown) => {
        console.error("Não foi possível verificar a sessão.", error);
        if (!cancelled) setFormError("Não foi possível verificar sua sessão. Tente novamente.");
      });
    return () => {
      cancelled = true;
    };
  }, [search.modo, goToTarget]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && search.modo)) {
        setMode("password");
        setSessionEmail(session?.user.email ?? null);
        setLinkError(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [search.modo]);

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setFormError(null);
    setSuccessMessage(null);
    setShowPassword(false);
    setPassword("");
    setConfirmPassword("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        try {
          await authService.signIn(email.trim(), password, rememberMe);
        } catch {
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) throw error;
        }
        toast.success("Bem-vindo de volta ao MedCore!");
        await router.invalidate();
        goToTarget();
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
        try {
          await authService.signUp(email.trim(), password, fullName.trim());
        } catch {
          const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              emailRedirectTo: window.location.origin,
              data: { full_name: fullName.trim() },
            },
          });
          if (error) throw error;
          if (!data.session) {
            setSuccessMessage(
              "Cadastro recebido. Verifique seu e-mail para confirmar a conta antes de entrar.",
            );
            return;
          }
        }
        toast.success("Conta criada com sucesso!");
        await router.invalidate();
        goToTarget();
      } else if (mode === "password") {
        if (password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
        if (password !== confirmPassword) throw new Error("As senhas não conferem.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success(
          search.modo === "convite"
            ? "Senha definida. Bem-vindo(a) ao MedCore!"
            : "Senha atualizada com sucesso.",
        );
        await router.invalidate();
        goToTarget();
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth?modo=nova-senha`,
        });
        if (error) throw error;
        setSuccessMessage(
          "Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha. Verifique também a pasta de spam.",
        );
      }
    } catch (error) {
      console.error("Falha na autenticação.", error);
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleBusy(true);
    setFormError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${target}` },
      });
      if (error) throw error;
    } catch (error) {
      console.error("Falha no acesso com Google.", error);
      const message = error instanceof Error ? error.message : "";
      setFormError(
        /not enabled|Unsupported provider|validation_failed/i.test(message)
          ? "O acesso com Google não está disponível nesta clínica. Use seu e-mail e senha."
          : errorMessage(error),
      );
    } finally {
      setGoogleBusy(false);
    }
  };

  const titles: Record<AuthMode, string> = {
    signin: "Bem-vindo de volta",
    signup: "Crie sua conta",
    forgot: "Recupere seu acesso",
    password: search.modo === "convite" ? "Defina sua senha" : "Crie uma nova senha",
  };
  const descriptions: Record<AuthMode, string> = {
    signin: "Entre para acompanhar o dia a dia da sua clínica.",
    signup: "Preencha seus dados para começar no MedCore.",
    forgot: "Informe o e-mail da sua conta para receber as instruções.",
    password: sessionEmail
      ? `Conta: ${sessionEmail}`
      : "Use o link recebido por e-mail para continuar.",
  };

  return (
    <div className="auth-canvas grid min-h-dvh lg:grid-cols-2">
      <div className="auth-aurora" aria-hidden="true">
        <span className="auth-blob auth-blob--aqua" />
        <span className="auth-blob auth-blob--sky" />
        <span className="auth-blob auth-blob--rose" />
        <span className="auth-blob auth-blob--violet" />
        <span className="auth-blob auth-blob--indigo" />
      </div>
      <aside className="hidden min-w-0 items-center justify-center p-10 lg:flex xl:p-16">
        <div className="auth-stage w-full max-w-[34rem] 2xl:max-w-[38rem]">
          <div className="auth-plate auth-edge auth-rise">
            <img
              src="/assets/dr-jonatas-bandeira-logo.png"
              alt="Dr. Jonatas Bandeira - Nutrologia"
              draggable={false}
              className="relative w-[78%] select-none object-contain"
            />
          </div>
          {HERO_TILES.map(({ icon: Icon, slot, tile }) => (
            <span key={slot} aria-hidden="true" className={cn("auth-tile-slot auth-pop", slot)}>
              <span className={cn("auth-tile auth-edge", tile)}>
                <Icon strokeWidth={1.75} />
              </span>
            </span>
          ))}
        </div>
      </aside>
      <main className="flex min-w-0 flex-col items-center justify-center px-4 py-6 sm:px-8">
        <div className="auth-card auth-edge auth-rise w-full max-w-[440px] rounded-[28px] p-6 [animation-delay:120ms] sm:px-10 sm:py-9">
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src="/assets/dr-jonatas-bandeira-logo.png"
              alt="Dr. Jonatas Bandeira - Nutrologia"
              draggable={false}
              className="mb-5 h-20 w-auto max-w-full select-none object-contain lg:hidden"
            />
            <div className="auth-avatar mb-5 hidden place-items-center lg:grid">
              <BrandSymbol size="large" interactive={false} />
            </div>
            <div key={mode} className="auth-swap">
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-display">
                {titles[mode]}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {descriptions[mode]}
              </p>
            </div>
          </div>
          {mode === "password" && linkError && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-destructive/20 bg-(--auth-alert-danger) p-3 text-sm text-destructive"
            >
              {linkError}
            </div>
          )}
          {formError && (
            <div
              id="auth-error"
              role="alert"
              className="mb-5 rounded-xl border border-destructive/20 bg-(--auth-alert-danger) p-3 text-sm text-destructive"
            >
              {formError}
            </div>
          )}
          {successMessage && (
            <div
              role="status"
              className="mb-5 rounded-xl border border-success/20 bg-(--auth-alert-success) p-4 text-sm leading-relaxed text-success"
            >
              {successMessage}
            </div>
          )}
          <form
            onSubmit={submit}
            className="space-y-5"
            aria-busy={busy}
            aria-describedby={formError ? "auth-error" : undefined}
          >
            <fieldset disabled={busy || googleBusy} className="space-y-5 disabled:opacity-70">
              {mode === "signup" && (
                <div className="space-y-2">
                  <label htmlFor="full-name" className="text-sm font-medium">
                    Nome completo
                  </label>
                  <div className="relative">
                    <Input
                      id="full-name"
                      name="name"
                      autoComplete="name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      required
                      placeholder="Seu nome completo"
                      className={FIELD_CLASS}
                    />
                    <UserRound aria-hidden="true" className={FIELD_ICON_CLASS} />
                  </div>
                </div>
              )}
              {mode !== "password" && (
                <div className="space-y-2">
                  <label htmlFor="auth-email" className="text-sm font-medium">
                    E-mail
                  </label>
                  <div className="relative">
                    <Input
                      id="auth-email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      placeholder="seu@email.com"
                      className={FIELD_CLASS}
                    />
                    <Mail aria-hidden="true" className={FIELD_ICON_CLASS} />
                  </div>
                </div>
              )}
              {mode !== "forgot" && (
                <div className="space-y-2">
                  <label htmlFor="auth-password" className="text-sm font-medium">
                    {mode === "password" ? "Nova senha" : "Senha"}
                  </label>
                  <div className="relative">
                    <Input
                      id="auth-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={mode === "signin" ? undefined : 8}
                      placeholder="Digite sua senha"
                      className={cn(FIELD_CLASS, "pr-12")}
                      aria-describedby={mode !== "signin" ? "password-hint" : undefined}
                    />
                    <LockKeyhole aria-hidden="true" className={FIELD_ICON_CLASS} />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={showPassword}
                      className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {mode !== "signin" && (
                    <p id="password-hint" className="text-xs text-muted-foreground">
                      Use pelo menos 8 caracteres.
                    </p>
                  )}
                </div>
              )}
              {mode === "password" && (
                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-sm font-medium">
                    Confirmar senha
                  </label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                      minLength={8}
                      placeholder="Repita a nova senha"
                      className={FIELD_CLASS}
                    />
                    <LockKeyhole aria-hidden="true" className={FIELD_ICON_CLASS} />
                  </div>
                </div>
              )}
              {mode === "signin" && (
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className="size-4 accent-primary"
                    />
                    Lembrar-me
                  </label>
                  <button
                    type="button"
                    onClick={() => changeMode("forgot")}
                    className="font-medium text-primary hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>
              )}
              <Button
                type="submit"
                className="group h-12 w-full rounded-full bg-(image:--auth-cta) text-[15px] font-semibold shadow-(--auth-cta-shadow) hover:shadow-(--auth-cta-shadow-hover)"
                disabled={
                  busy || googleBusy || (mode === "password" && (!sessionEmail || !!linkError))
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                {busy
                  ? "Aguarde…"
                  : mode === "signin"
                    ? "Entrar"
                    : mode === "signup"
                      ? "Criar conta"
                      : mode === "password"
                        ? "Salvar senha"
                        : "Enviar instruções"}
                {!busy && (
                  <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                )}
              </Button>
            </fieldset>
          </form>
          {mode === "signin" && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-hairline" />
                ou continue com
                <span className="h-px flex-1 bg-hairline" />
              </div>
              <Button
                variant="outline"
                className="h-12 w-full rounded-full border-(--auth-field-line) bg-(--auth-soft) shadow-none hover:bg-(--auth-soft-hover)"
                disabled={busy || googleBusy}
                onClick={() => void handleGoogleSignIn()}
              >
                {googleBusy ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
                {googleBusy ? "Conectando…" : "Google"}
              </Button>
            </>
          )}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "password" ? (
              sessionEmail ? (
                search.modo === "convite" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={goToTarget}
                    className="font-medium text-primary hover:underline"
                  >
                    Definir a senha depois
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setLinkError(null);
                    changeMode("forgot");
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  Solicitar novo link
                </button>
              )
            ) : mode === "signin" ? (
              <>
                Ainda não tem uma conta?{" "}
                <button
                  type="button"
                  disabled={busy || googleBusy}
                  onClick={() => changeMode("signup")}
                  className="font-medium text-primary hover:underline"
                >
                  Cadastre-se
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => changeMode("signin")}
                className="font-medium text-primary hover:underline"
              >
                Voltar para o login
              </button>
            )}
          </div>
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-foreground/70">
          <BrandSymbol size="small" interactive={false} className="[&_img]:size-4" />
          <span>MedCore © {new Date().getFullYear()} · Consultório Dr. Jonatas Bandeira</span>
        </div>
      </main>
    </div>
  );
}
