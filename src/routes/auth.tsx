import { BrandSymbol } from "@/components/ui-app/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeRedirectPath } from "@/features/admin/permissions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAuthRouteCache } from "@/routes/_authenticated/route";
import { qk } from "@/lib/query-keys";
import { getSiteOrigin } from "@/services/site-origin";
import { clearUserScopedData } from "@/lib/clear-user-data";
import {
  DEFAULT_BRANDING,
  LAST_CLINIC_KEY,
  brandingStyle,
  type LoginBranding,
} from "@/features/branding/login-branding";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

export type AuthSearch ={ redirect?: string; modo?: "convite" | "nova-senha" };
type AuthMode = "signin" | "signup" | "forgot" | "password";


const FIELD_CLASS =
  "peer h-12 border-(--auth-field-line) bg-(--auth-field) pl-11 shadow-none hover:border-(--auth-field-line-hover) focus:bg-(--auth-field-focus) focus-visible:outline-none focus-visible:ring-0";
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
  validateSearch: validateAuthSearch,
  loader: async () => {
    try {
      const origin = await getSiteOrigin();
      return { origin };
    } catch {
      return { origin: "" };
    }
  },
  head: ({ loaderData }) => {
    const origin =
      loaderData?.origin ||
      (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "") ||
      (typeof process !== "undefined" && process.env?.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "") ||
      (typeof process !== "undefined" && process.env?.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "") ||
      "https://meedcore.vercel.app";

    const ogImage = `${origin.replace(/\/$/, "")}/og-image.png`;

    return {
      meta: [
        { title: "Acesse sua conta • Dr. Jonatas Bandeira • MedCore" },
        {
          name: "description",
          content:
            "Agenda, prontuários e acompanhamentos clínicos do consultório Dr. Jonatas Bandeira.",
        },
        { property: "og:site_name", content: "Dr. Jonatas Bandeira — Nutrologia" },
        { property: "og:title", content: "Dr. Jonatas Bandeira — Nutrologia" },
        {
          property: "og:description",
          content:
            "Agenda, prontuários e acompanhamentos clínicos do consultório Dr. Jonatas Bandeira.",
        },
        { property: "og:type", content: "website" },
        { property: "og:image", content: ogImage },
        { property: "og:image:secure_url", content: ogImage },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: "Logo Dr. Jonatas Bandeira — Nutrologia" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "Dr. Jonatas Bandeira — Nutrologia" },
        {
          name: "twitter:description",
          content:
            "Agenda, prontuários e acompanhamentos clínicos do consultório Dr. Jonatas Bandeira.",
        },
        { name: "twitter:image", content: ogImage },
      ],
      links: [
        {
          rel: "preload",
          as: "image",
          href: "/assets/dr-jonatas-bandeira-logo.png",
        },
        {
          rel: "image_src",
          href: ogImage,
        },
        {
          rel: "apple-touch-icon",
          href: "/apple-touch-icon.png",
        },
      ],
    };
  },
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
  const search = Route.useSearch();
  const router = useRouter();
  // Quem entrou pelo link de um cliente volta para a tela daquele cliente (ex.: ao sair).
  useEffect(() => {
    if (search.modo) return;
    let slug: string | null = null;
    try {
      slug = window.localStorage.getItem(LAST_CLINIC_KEY);
    } catch {
      return;
    }
    if (slug && /^[a-z0-9-]{3,50}$/.test(slug)) {
      const query = search.redirect ? `?redirect=${encodeURIComponent(search.redirect)}` : "";
      router.history.replace(`/${slug}${query}`);
    }
  }, [router, search.modo, search.redirect]);
  return <AuthScreen search={search} branding={DEFAULT_BRANDING} />;
}

export function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
  return {
    redirect: safeRedirectPath(search.redirect) ?? undefined,
    modo: search.modo === "convite" || search.modo === "nova-senha" ? search.modo : undefined,
  };
}

/** Logo do cliente; sem logo cadastrada, a do consultório Dr. Jonatas Bandeira. */
function ClinicLogo({
  branding,
  sizes,
  className,
  plate,
}: {
  branding: LoginBranding;
  sizes: string;
  className: string;
  plate?: boolean;
}) {
  if (branding.logoUrl) {
    return (
      <img
        src={branding.logoUrl}
        alt={branding.name}
        draggable={false}
        data-original={plate && !branding.logoWhite ? "" : undefined}
        className={className}
      />
    );
  }
  return (
    <img
      src="/assets/dr-jonatas-bandeira-logo@2x.png"
      srcSet="/assets/dr-jonatas-bandeira-logo.png 800w, /assets/dr-jonatas-bandeira-logo@2x.png 1600w, /assets/dr-jonatas-bandeira-logo@3x.png 2400w"
      sizes={sizes}
      alt={DEFAULT_BRANDING.name}
      draggable={false}
      className={className}
    />
  );
}

export function AuthScreen({ search, branding }: { search: AuthSearch; branding: LoginBranding }) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  // O painel da marca acompanha a altura do cartão de acesso (que muda conforme o modo).
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setCardHeight(card.offsetHeight));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
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
        } else if (data.session) {
          invalidateAuthRouteCache();
          queryClient.setQueryData(["auth", "session"], data.session);
          goToTarget();
        }
      })
      .catch((error: unknown) => {
        console.error("Não foi possível verificar a sessão.", error);
        if (!cancelled) setFormError("Não foi possível verificar sua sessão. Tente novamente.");
      });
    return () => {
      cancelled = true;
    };
  }, [search.modo, goToTarget, queryClient]);

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const emailEl = form.querySelector<HTMLInputElement>("#auth-email") ?? form.querySelector<HTMLInputElement>('input[type="email"]');
    const passwordEl = form.querySelector<HTMLInputElement>("#auth-password") ?? form.querySelector<HTMLInputElement>('input[type="password"]');
    const nameEl = form.querySelector<HTMLInputElement>("#full-name") ?? form.querySelector<HTMLInputElement>('input[name="name"]');

    const resolvedEmail = ((emailEl?.value || (formData.get("email") as string) || email) ?? "").trim().toLowerCase();
    const resolvedPassword = passwordEl?.value || (formData.get("password") as string) || password || "";
    const resolvedFullName = ((nameEl?.value || (formData.get("name") as string) || fullName) ?? "").trim();

    if (!resolvedEmail) {
      setFormError("Informe seu e-mail para continuar.");
      return;
    }

    if (mode !== "forgot" && !resolvedPassword) {
      setFormError("Informe sua senha para continuar.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { data: sbData, error } = await supabase.auth.signInWithPassword({
          email: resolvedEmail,
          password: resolvedPassword,
        });
        if (error) throw error;
        const authSession = sbData.session;
        invalidateAuthRouteCache();
        // Nada do usuário anterior (outra clínica) pode sobrar na memória desta sessão
        clearUserScopedData(queryClient);
        // Lembra a tela de login usada: quem entrou pelo link do cliente volta a ela ao sair;
        // quem entrou pelo login geral (/auth) não é mais redirecionado.
        try {
          if (branding.slug) window.localStorage.setItem(LAST_CLINIC_KEY, branding.slug);
          else window.localStorage.removeItem(LAST_CLINIC_KEY);
        } catch {
          /* navegador sem armazenamento */
        }
        if (authSession) {
          queryClient.setQueryData(["auth", "session"], authSession);
        }
        toast.success("Bem-vindo de volta ao MedCore!");
        await router.invalidate();
        goToTarget();
      } else if (mode === "signup") {
        if (resolvedPassword.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
        const { data, error } = await supabase.auth.signUp({
          email: resolvedEmail,
          password: resolvedPassword,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: resolvedFullName },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setSuccessMessage(
            "Cadastro recebido. Verifique seu e-mail para confirmar a conta antes de entrar.",
          );
          return;
        }
        invalidateAuthRouteCache();
        await queryClient.invalidateQueries({ queryKey: ["auth"] });
        toast.success("Conta criada com sucesso!");
        await router.invalidate();
        goToTarget();
      } else if (mode === "password") {
        if (resolvedPassword.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
        if (resolvedPassword !== confirmPassword) throw new Error("As senhas não conferem.");
        const { error } = await supabase.auth.updateUser({ password: resolvedPassword });
        if (error) throw error;
        invalidateAuthRouteCache();
        await queryClient.invalidateQueries({ queryKey: ["auth"] });
        toast.success(
          search.modo === "convite"
            ? "Senha definida. Bem-vindo(a) ao MedCore!"
            : "Senha atualizada com sucesso.",
        );
        await router.invalidate();
        goToTarget();
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(resolvedEmail, {
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
    <div
      className="auth-canvas grid min-h-dvh lg:grid-cols-2"
      data-brand={brandingStyle(branding) ? "" : undefined}
      style={brandingStyle(branding)}
    >
      <div className="aurora-container auth-aurora" aria-hidden="true">
        <div className="aurora-wave aurora-1" />
        <div className="aurora-wave aurora-2" />
        <div className="aurora-wave aurora-3" />
      </div>
      <aside className="hidden min-w-0 items-center justify-start p-8 lg:flex lg:order-2 lg:pl-6 lg:pr-16 xl:p-12 xl:pl-10 xl:pr-24 2xl:p-16 2xl:pl-14 2xl:pr-32">
        <div className="auth-stage w-full max-w-[36rem] xl:max-w-[40rem] 2xl:max-w-[44rem] flex items-center justify-center lg:-translate-x-4 xl:-translate-x-8 2xl:-translate-x-12">
          <div
            className="auth-plate auth-edge auth-rise w-full p-8 sm:p-10 md:p-12"
            style={cardHeight ? { height: cardHeight, aspectRatio: "auto" } : undefined}
          >
            <div className="relative flex flex-col items-center gap-6 text-center">
              <ClinicLogo
                branding={branding}
                plate
                sizes="(max-width: 1280px) 520px, 640px"
                className="auth-plate-logo max-h-[260px] w-[88%] max-w-[520px] select-none object-contain"
              />
              {branding.tagline && (
                <p className="max-w-[22rem] text-[15px] leading-relaxed text-white/80">
                  {branding.tagline}
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-col items-center justify-center px-4 pb-20 pt-8 sm:px-8 lg:order-1 lg:py-8">
        <div className="relative w-full max-w-[440px]">
        <div ref={cardRef} className="auth-card auth-edge auth-rise w-full max-w-[440px] rounded-[28px] p-6 [animation-delay:120ms] sm:px-10 sm:py-9">
          <div className="mb-6 flex flex-col items-center text-center">
            <ClinicLogo
              branding={branding}
              sizes="(max-width: 640px) 260px, 340px"
              className="mb-6 h-24 sm:h-28 w-auto max-w-[85%] select-none object-contain drop-shadow-sm lg:hidden"
            />
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
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck="false"
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
              <>O acesso é liberado pelo administrador da clínica. Recebeu um convite? Use o link do e-mail.</>
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
        {/* Rodapé fora do fluxo: o cartão fica centralizado na mesma linha do painel da marca. */}
        <div className="absolute left-0 right-0 top-full mt-6 flex items-center justify-center gap-2 text-center text-xs text-foreground/70">
          <BrandSymbol size="small" interactive={false} className="[&_img]:size-4" />
          <span>
            MedCore © {new Date().getFullYear()} ·{" "}
            {branding.slug ? branding.name : "Consultório Dr. Jonatas Bandeira"}
          </span>
        </div>
        </div>
      </main>
    </div>
  );
}
