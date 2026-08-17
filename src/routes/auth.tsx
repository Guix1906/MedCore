import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  BarChart3,
  Users,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Cloud,
  Headphones,
  User,
  Loader2,
  CheckCircle2,
  Activity,
  HeartPulse,
  Stethoscope,
} from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "MedCore — Gestão Médica Inteligente & Premium" },
      {
        name: "description",
        content:
          "Gestão completa para clínicas premium que cuidam de pessoas. Acesse sua conta no MedCore.",
      },
      { property: "og:title", content: "MedCore — Gestão Médica Inteligente & Premium" },
      {
        property: "og:description",
        content: "Gestão completa para clínicas que cuidam de pessoas.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: AuthPage,
});

function MedCoreLogo({ size = "normal" }: { size?: "normal" | "large" }) {
  return (
    <div className="flex items-center gap-3 select-none bg-transparent group cursor-pointer">
      <div className="relative">
        <div className="absolute inset-0 rounded-2xl bg-[#00A8CC]/30 blur-md group-hover:bg-[#00A8CC]/50 transition-all duration-300 animate-pulse" />
        <img
          src="/assets/medcore-symbol-transparent.png"
          alt="MedCore Symbol"
          className={`relative z-10 bg-transparent object-contain transition-transform duration-300 group-hover:scale-110 ${
            size === "large" ? "h-14 sm:h-16 w-auto" : "h-10 sm:h-12 w-auto"
          }`}
        />
      </div>
      <div
        className={`font-extrabold tracking-tight font-sans bg-transparent ${
          size === "large" ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"
        }`}
      >
        <span className="text-[#0F172A] bg-transparent">Med</span>
        <span className="bg-gradient-to-r from-[#00A8CC] via-[#0284C7] to-[#2563EB] bg-clip-text text-transparent">
          Core
        </span>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
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

/** Ilustração médica discreta (Linha de ECG / Batimentos Cardíacos Animados + Estetoscópio em Vidro) */
function DiscreteMedicalIllustration() {
  return (
    <div className="relative w-full py-2 my-1 pointer-events-none select-none">
      <svg viewBox="0 0 500 80" className="w-full h-16 opacity-75" fill="none">
        <defs>
          <linearGradient id="ecg-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00A8CC" stopOpacity="0.1" />
            <stop offset="30%" stopColor="#00A8CC" stopOpacity="0.8" />
            <stop offset="70%" stopColor="#0284C7" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {/* Continuous Baseline Grid */}
        <line x1="0" y1="40" x2="500" y2="40" stroke="#0284C7" strokeOpacity="0.15" strokeDasharray="4 4" strokeWidth="1" />
        {/* ECG Heartbeat Path */}
        <motion.path
          d="M 0 40 L 100 40 L 115 25 L 125 55 L 140 10 L 155 65 L 170 35 L 180 40 L 300 40 L 315 25 L 325 55 L 340 10 L 355 65 L 370 35 L 380 40 L 500 40"
          stroke="url(#ecg-line-grad)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0.2, pathOffset: 0 }}
          animate={{ pathOffset: [0, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
      </svg>
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Email format validation helper
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bem-vindo de volta ao MedCore!");
        router.invalidate();
        navigate({ to: "/dashboard" });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Conta criada com sucesso! Verifique seu email para confirmar.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        toast.success("Instruções enviadas para o seu email!");
        setMode("signin");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(msg.includes("Invalid login") ? "Email ou senha inválidos" : msg);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleBusy(true);
    try {
      toast.info("Conectando ao Google...");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro no login com Google";
      if (
        msg.includes("not enabled") ||
        msg.includes("Unsupported provider") ||
        msg.includes("validation_failed")
      ) {
        toast.error(
          "O provedor Google ainda não foi habilitado no seu painel do Supabase (Authentication -> Providers -> Google). Use o login por email/senha.",
          { duration: 6000 }
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    /* Fundo com gradiente azul/branco elegante e limpo */
    <div className="h-screen max-h-screen relative w-full flex items-center justify-center p-3 sm:p-4 lg:p-6 overflow-hidden bg-gradient-to-br from-[#E0F2FE] via-[#F4F9FF] to-[#FFFFFF]">
      
      {/* Luzes Suaves de Fundo (Radiant Ambient Blue Glow Orbs) */}
      <div className="absolute -top-24 -right-24 w-[700px] h-[700px] bg-gradient-to-bl from-[#00A8CC]/25 via-sky-200/35 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 -left-32 w-[600px] h-[600px] bg-gradient-to-tr from-blue-200/40 via-indigo-100/25 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 right-1/4 w-[500px] h-[500px] bg-gradient-to-t from-cyan-100/40 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Símbolos Médicos Discretos Flutuantes no Fundo */}
      <motion.div
        animate={{ y: [0, -12, 0], rotate: [0, 6, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-10 right-14 text-sky-400/30 pointer-events-none select-none drop-shadow-sm"
      >
        <Stethoscope className="w-14 h-14" strokeWidth={1.5} />
      </motion.div>

      <motion.div
        animate={{ y: [0, 10, 0], rotate: [0, -4, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute top-28 right-40 text-blue-400/25 pointer-events-none select-none"
      >
        <Activity className="w-10 h-10" strokeWidth={1.5} />
      </motion.div>

      {/* Gradiente Vetorial Suave no Canto Inferior Esquerdo */}
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-0 left-0 w-[450px] sm:w-[580px] lg:w-[700px] pointer-events-none select-none z-0"
      >
        <svg viewBox="0 0 800 600" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
          <defs>
            <linearGradient id="glass-wave-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00A8CC" stopOpacity="0.85" />
              <stop offset="45%" stopColor="#0284C7" stopOpacity="0.65" />
              <stop offset="85%" stopColor="#3B82F6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="glass-line-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <path
            d="M -100 600 Q 150 420 320 490 T 700 380 Q 820 330 850 200 L 850 600 Z"
            fill="url(#glass-wave-grad)"
          />
          <path
            d="M -50 600 Q 180 440 340 500 T 720 390"
            stroke="url(#glass-line-grad)"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      </motion.div>

      {/* Main Container */}
      <div className="w-full max-w-[1140px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center relative z-10">
        
        {/* COLUNA ESQUERDA: Marca, Ilustração Médica Discreta & Cards de Benefícios em Vidro */}
        <motion.div
          initial={{ opacity: 0, x: -35 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="lg:col-span-6 space-y-5 pr-0 lg:pr-2"
        >
          
          {/* Logo & Headline */}
          <div>
            <MedCoreLogo size="large" />
            <p className="mt-3 text-base sm:text-[22px] text-[#334155] font-normal leading-snug tracking-tight">
              Gestão completa para clínicas
              <br />
              <span className="font-semibold bg-gradient-to-r from-[#00A8CC] to-[#0284C7] bg-clip-text text-transparent">
                que cuidam de pessoas com excelência.
              </span>
            </p>
          </div>

          {/* Ilustração médica discreta (Linha de batimentos ECG) */}
          <DiscreteMedicalIllustration />

          {/* 3 Cards de Vidro Translúcido (Glassmorphism) */}
          <div className="space-y-3 pt-1">
            
            {/* Benefício 1 */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              whileHover={{ scale: 1.02, x: 6 }}
              className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:shadow-[0_12px_35px_rgba(0,168,204,0.15)] hover:bg-white/75 transition-all group cursor-default"
            >
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-100/80 to-emerald-50 border border-emerald-200/60 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <ShieldCheck className="w-5 h-5 text-emerald-600" strokeWidth={2} />
              </div>
              <div>
                <h3 className="font-bold text-[#0F172A] text-sm sm:text-base group-hover:text-emerald-700 transition-colors">
                  Seguro e confiável
                </h3>
                <p className="text-slate-500 text-xs font-normal mt-0.5">
                  Conformidade total com a LGPD e criptografia médica avançada.
                </p>
              </div>
            </motion.div>

            {/* Benefício 2 */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.35 }}
              whileHover={{ scale: 1.02, x: 6 }}
              className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:shadow-[0_12px_35px_rgba(2,132,199,0.15)] hover:bg-white/75 transition-all group cursor-default"
            >
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-100/80 to-sky-50 border border-cyan-200/60 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <BarChart3 className="w-5 h-5 text-[#00A8CC]" strokeWidth={2} />
              </div>
              <div>
                <h3 className="font-bold text-[#0F172A] text-sm sm:text-base group-hover:text-[#00A8CC] transition-colors">
                  Gestão inteligente
                </h3>
                <p className="text-slate-500 text-xs font-normal mt-0.5">
                  Prontuários eletrônicos, agenda rápida e relatórios em tempo real.
                </p>
              </div>
            </motion.div>

            {/* Benefício 3 */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.5 }}
              whileHover={{ scale: 1.02, x: 6 }}
              className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:shadow-[0_12px_35px_rgba(59,130,246,0.15)] hover:bg-white/75 transition-all group cursor-default"
            >
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-100/80 to-indigo-50 border border-blue-200/60 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                <Users className="w-5 h-5 text-blue-600" strokeWidth={2} />
              </div>
              <div>
                <h3 className="font-bold text-[#0F172A] text-sm sm:text-base group-hover:text-blue-700 transition-colors">
                  Experiência simplificada
                </h3>
                <p className="text-slate-500 text-xs font-normal mt-0.5">
                  Fluxos otimizados para recepção, médicos e pacientes.
                </p>
              </div>
            </motion.div>

          </div>

        </motion.div>

        {/* COLUNA DIREITA: Card Translúcido com Blur (Glassmorphism Puro) */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.15, ease: "easeOut" }}
          className="lg:col-span-6 flex flex-col items-center lg:items-end w-full"
        >
          
          {/* Card Translúcido com Blur & Campos Arredondados */}
          <div className="w-full max-w-[440px] bg-white/75 backdrop-blur-3xl rounded-[32px] p-6 sm:p-8 shadow-[0_30px_80px_-15px_rgba(2,132,199,0.18)] border border-white/90 relative overflow-hidden">
            
            {/* Barra de Reflexo do Vidro no Topo */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#00A8CC] via-[#0284C7] to-[#3B82F6]" />

            {/* Símbolo do MedCore Centralizado com Halo Pulsante */}
            <div className="flex justify-center mb-3">
              <div className="relative group cursor-pointer">
                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#00A8CC] to-[#0284C7] opacity-40 blur-lg group-hover:opacity-75 transition-opacity duration-300 animate-pulse" />
                <div className="w-16 h-16 rounded-full bg-white/80 backdrop-blur-md ring-[8px] ring-cyan-100/50 flex items-center justify-center shadow-lg relative z-10 transition-transform group-hover:scale-105 duration-300">
                  <img
                    src="/assets/medcore-symbol-transparent.png"
                    alt="MedCore"
                    className="w-8 h-8 object-contain bg-transparent transition-transform group-hover:rotate-6 duration-300"
                  />
                </div>
              </div>
            </div>

            {/* Título & Subtítulo */}
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0F172A] text-center tracking-tight">
              {mode === "signin"
                ? "Acesse sua Clínica"
                : mode === "signup"
                ? "Criar Conta Premium"
                : "Recuperar Acesso"}
            </h2>
            <p className="text-xs text-slate-500 text-center mt-1 mb-5 font-medium">
              {mode === "signin"
                ? "Digite suas credenciais para acessar o painel"
                : mode === "signup"
                ? "Preencha os dados abaixo para cadastrar sua equipe"
                : "Informe seu email cadastrado para redefinir a senha"}
            </p>

            {/* Formulário com Campos Arredondados (Rounded Pill Inputs) */}
            <form onSubmit={submit} className="space-y-3.5">
              
              <AnimatePresence mode="wait">
                {mode === "signup" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 ml-1">
                      Nome completo
                    </label>
                    {/* Campo Arredondado em Formato de Pílula Glass */}
                    <div className="flex items-center bg-white/80 hover:bg-white border border-sky-100 rounded-2xl px-4 py-3 transition-all focus-within:border-[#00A8CC] focus-within:ring-4 focus-within:ring-[#00A8CC]/20 focus-within:bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                      <User className="w-4 h-4 text-sky-500 mr-2.5 shrink-0" />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        className="w-full bg-transparent text-xs sm:text-sm text-slate-800 placeholder-slate-400 outline-none font-medium"
                        placeholder="Dr. João Silva"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Campo Email Arredondado (Rounded Pill Input) */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 ml-1">
                  Email profissional
                </label>
                <div className="flex items-center bg-white/80 hover:bg-white border border-sky-100 focus-within:border-sky-300 rounded-2xl px-4 py-3 transition-all bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                  <Mail className="w-4 h-4 text-sky-500 mr-2.5 shrink-0" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-transparent text-xs sm:text-sm text-slate-800 placeholder-slate-400 outline-none font-medium"
                    placeholder="guigos191@gmail.com"
                  />
                  {isValidEmail && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="flex items-center gap-1 bg-emerald-50 text-emerald-600 px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ml-1.5 border border-emerald-200/60"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Válido</span>
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Campo Senha Arredondado (Rounded Pill Input) */}
              {mode !== "forgot" && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 ml-1">
                    Senha
                  </label>
                  <div className="flex items-center bg-white/80 hover:bg-white border border-sky-100 focus-within:border-sky-300 rounded-2xl px-4 py-3 transition-all bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <Lock className="w-4 h-4 text-sky-500 mr-2.5 shrink-0" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full bg-transparent text-xs sm:text-sm text-slate-800 placeholder-slate-400 outline-none font-medium focus:outline-none focus:ring-0"
                      placeholder="••••••••••••"
                    />
                    <button
                      type="button"
                      aria-label="Alternar visibilidade da senha"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowPassword((prev) => !prev);
                      }}
                      className="text-slate-400 hover:text-sky-600 ml-2 shrink-0 p-1.5 rounded-lg transition-colors cursor-pointer focus:outline-none select-none"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4 text-sky-600" />
                      ) : (
                        <Eye className="w-4 h-4 text-slate-500 hover:text-sky-600" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Opções de Lembrar-me / Esqueci Senha */}
              {mode === "signin" && (
                <div className="flex items-center justify-between pt-0.5 text-xs px-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 font-medium text-[11px] sm:text-xs hover:text-slate-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-3.5 h-3.5 rounded-md border-slate-300 text-[#00A8CC] focus:ring-[#00A8CC] accent-[#00A8CC] cursor-pointer"
                    />
                    Lembrar-me
                  </label>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-[#0284C7] font-semibold text-[11px] sm:text-xs hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0284C7]"
                  >
                    Esqueci minha senha
                  </button>
                </div>
              )}

              {/* Botão Entrar Arredondado (Pill Action Button) com Gradiente Azul */}
              <motion.button
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                type="submit"
                disabled={busy}
                className="w-full mt-4 bg-gradient-to-r from-[#00A8CC] via-[#0284C7] to-[#2563EB] hover:brightness-110 active:scale-[0.99] text-white font-bold text-xs sm:text-sm py-3 rounded-2xl shadow-lg shadow-[#0284C7]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer overflow-hidden relative group"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Conectando...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    <span>
                      {mode === "signin"
                        ? "Entrar na Clínica"
                        : mode === "signup"
                        ? "Criar Conta"
                        : "Enviar instruções"}
                    </span>
                  </>
                )}
              </motion.button>
            </form>

            {/* Divisor "ou" */}
            {mode === "signin" && (
              <>
                <div className="flex items-center my-4">
                  <div className="flex-1 h-[1px] bg-sky-200/60" />
                  <span className="px-3 text-xs text-slate-400 font-medium">ou</span>
                  <div className="flex-1 h-[1px] bg-sky-200/60" />
                </div>

                {/* Botão Entrar com Google Arredondado em Vidro */}
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  type="button"
                  disabled={busy || googleBusy}
                  onClick={handleGoogleSignIn}
                  className="w-full bg-white/90 hover:bg-white border border-sky-100 text-slate-700 font-semibold text-xs sm:text-sm py-2.5 rounded-2xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {googleBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                      <span>Conectando ao Google...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span>Entrar com Google</span>
                    </>
                  )}
                </motion.button>
              </>
            )}

            {/* Alternar Modo (Cadastre-se / Entrar) */}
            <p className="mt-4 sm:mt-5 text-center text-xs text-slate-500 font-medium">
              {mode === "signin" ? (
                <>
                  Sua clínica ainda não usa o MedCore?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className="text-[#0284C7] font-bold hover:underline"
                  >
                    Cadastre-se
                  </button>
                </>
              ) : (
                <>
                  Já tem uma conta cadastrada?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signin")}
                    className="text-[#0284C7] font-bold hover:underline"
                  >
                    Entrar
                  </button>
                </>
              )}
            </p>

          </div>

          {/* Rodapé Premium */}
          <div className="w-full max-w-[440px] text-center mt-3 sm:mt-4 text-[11px] sm:text-xs text-slate-400 font-medium tracking-tight">
            MedCore © 2026 — Gestão Inteligente para Clínicas Premium &nbsp;|&nbsp; v2.0.0
          </div>

        </motion.div>

      </div>
    </div>
  );
}




