import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Users,
  FileText,
  DollarSign,
  Package,
  LayoutDashboard,
  Settings,
  Menu,
  X,
  UserPlus,
  HelpCircle,
  Bell,
  LogOut,
  User,
  CalendarPlus,
  Wallet,
  Activity,
  Zap,
  Search,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, signOut } from "@/hooks/use-auth";
import { useSessionTimeout } from "@/hooks/use-session-timeout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotificationCenter from "./NotificationCenter";
import GlobalSearch from "./GlobalSearch";
import PageTransition from "./motion/PageTransition";
import Tooltip from "./motion/Tooltip";
import { ConfirmDialogHost } from "@/components/app/confirm-dialog";
import { dropdownVariants, EASE_OUT } from "@/lib/motion";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  shortcut?: string;
  children?: { to: string; label: string; icon?: typeof LayoutDashboard }[];
};
type NavSection = { label: string; items: NavItem[] };

const navSections: NavSection[] = [
  {
    label: "Visão geral",
    items: [
      {
        to: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        shortcut: "G D",
        children: [{ to: "/dashboard", label: "Dashboard" }],
      },
    ],
  },
  {
    label: "Atendimento",
    items: [
      {
        to: "/agenda",
        label: "Agenda",
        icon: Calendar,
        shortcut: "G A",
        children: [
          { to: "/agenda", label: "Agenda" },
          { to: "/visao-geral", label: "Visão geral" },
        ],
      },
      {
        to: "/pacientes",
        label: "Pacientes",
        icon: Users,
        shortcut: "G P",
        children: [{ to: "/pacientes", label: "Pacientes" }],
      },
      {
        to: "/acompanhamentos",
        label: "Acompanhamentos",
        icon: Activity,
        children: [{ to: "/acompanhamentos", label: "Acompanhamentos" }],
      },
      {
        to: "/prontuario",
        label: "Prontuário",
        icon: FileText,
        children: [{ to: "/prontuario", label: "Prontuário" }],
      },
    ],
  },

  {
    label: "Gestão",
    items: [
      {
        to: "/financeiro",
        label: "Financeiro",
        icon: DollarSign,
        shortcut: "G F",
        children: [{ to: "/financeiro", label: "Financeiro" }],
      },
      {
        to: "/estoque",
        label: "Estoque",
        icon: Package,
        children: [{ to: "/estoque", label: "Estoque" }],
      },
      {
        to: "/relatorios",
        label: "Relatórios",
        icon: BarChart3,
        shortcut: "G R",
        children: [{ to: "/relatorios", label: "Relatórios" }],
      },
    ],
  },
  {
    label: "Sistema",
    items: [
      {
        to: "/configuracoes",
        label: "Configurações",
        icon: Settings,
        children: [{ to: "/configuracoes", label: "Configurações" }],
      },
    ],
  },
];

const COLLAPSED = 56;
const EXPANDED = 232;

const PHONE_NUMBER = "5599984898934";
const WHATSAPP_URL =
  `https://wa.me/${PHONE_NUMBER}?text=` + encodeURIComponent("Olá! Entrando em contato via MedCore.");

export default function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  useSessionTimeout();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile, loading, isAuthenticated } = useAuth();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("medcore:sidebar-pinned") === "1";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("medcore:sidebar-pinned", pinned ? "1" : "0");
    } catch {
      /* ignore: localStorage indisponível */
    }
  }, [pinned]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<null | "novo" | "notif" | "perfil">(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [flyout, setFlyout] = useState<{ to: string } | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = (delay = 200) => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setFlyout(null);
    }, delay);
  };

  // Fechar flyouts ao mudar de página
  useEffect(() => {
    cancelClose();
    setFlyout(null);
  }, [pathname]);

  const menuRef = useRef<HTMLDivElement | null>(null);

  // Auth guard: redirect to /auth if not signed in
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate({ to: "/auth" });
    }
  }, [loading, isAuthenticated, navigate]);

  // Listener global para fechar o flyout imediatamente quando o mouse sai da região da sidebar
  useEffect(() => {
    if (!flyout) return;
    const handlePointerMove = (e: MouseEvent) => {
      // Se o cursor estiver à direita da área da sidebar + flyout (320px) ou acima do header (y < 60), fecha imediatamente
      if (e.clientX > 320 || e.clientY < 60) {
        cancelClose();
        setFlyout(null);
      }
    };
    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("mousemove", handlePointerMove);
  }, [flyout]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    const kh = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", kh);
    return () => window.removeEventListener("keydown", kh);
  }, []);

  // Notificações: cache por 2min + realtime
  const notifQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("read", false)
        .eq("archived", false);
      return count ?? 0;
    },
    staleTime: 2 * 60_000,
    gcTime: 5 * 60_000,
    enabled: isAuthenticated,
  });
  const unread = notifQuery.data ?? 0;

  useEffect(() => {
    if (!isAuthenticated) return;
    const ch = supabase
      .channel("appshell-notif-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        notifQuery.refetch();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isAuthenticated, notifQuery]);

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");
  const expanded = pinned;

  // Derived user display
  const displayName = profile?.full_name || user?.email?.split("@")[0] || "Usuário";
  const displayEmail = user?.email || "";
  const initials = (displayName.match(/\b\w/g) || []).slice(0, 2).join("").toUpperCase() || "US";

  const handleSignOut = async () => {
    setOpenMenu(null);
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/auth", replace: true });
  };

  // Show nothing while checking; redirect happens in effect above
  if (loading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center">
        <div className="text-[13px] text-[#6B7280]">Carregando…</div>
      </div>
    );
  }

  const SidebarInner = ({ expanded }: { expanded: boolean }) => (
    <>
      <nav
        className="flex-1 py-3 px-0 flex flex-col gap-1.5 overflow-y-auto"
        onMouseLeave={() => scheduleClose(100)}
      >
        {navSections
          .flatMap((section) => section.items)
          .map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <div
                key={item.to}
                onMouseEnter={() => {
                  if (!expanded) {
                    cancelClose();
                    setFlyout({ to: item.to });
                  }
                }}
              >
                <Link
                  to={item.to}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  preload="intent"
                  onClick={() => {
                    cancelClose();
                    setFlyout(null);
                    setMobileOpen(false);
                  }}
                  className="group relative flex items-center h-10 mx-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#6C4CF7]/40"
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-[#6C4CF7]" />
                  )}
                  <span
                    className={`relative flex items-center justify-center h-10 w-11 shrink-0 rounded-xl transition-all duration-150 ${
                      active ? "bg-[#F5F3FF]" : "group-hover:bg-[#F3F0FF]"
                    }`}
                  >
                    <Icon
                      size={20}
                      strokeWidth={1.8}
                      color={active ? "#6C4CF7" : "#8B95A7"}
                      className={!active ? "group-hover:!text-[#5B3DF5] transition-colors" : ""}
                    />
                  </span>
                  <span
                    className="relative ml-1 whitespace-nowrap text-[14px] font-medium transition-all duration-200 flex-1"
                    style={{
                      opacity: expanded ? 1 : 0,
                      transform: expanded ? "translateX(0)" : "translateX(-8px)",
                      color: active ? "#6C4CF7" : "#374151",
                      pointerEvents: expanded ? "auto" : "none",
                    }}
                  >
                    {item.label}
                  </span>
                </Link>
              </div>
            );
          })}
      </nav>

      <div className="h-16 px-2 border-t border-black/[0.06] flex items-center overflow-hidden">
        <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-[#10B981] to-[#059669] text-white flex items-center justify-center text-[13px] font-bold shadow-sm">
          {initials}
        </div>
        <div
          className="ml-3 min-w-0 transition-all duration-200"
          style={{
            opacity: expanded ? 1 : 0,
            transform: expanded ? "translateX(0)" : "translateX(-8px)",
          }}
        >
          <div className="text-[13px] font-semibold text-[#111827] truncate">{displayName}</div>
          <div className="text-[11px] text-[#6B7280] truncate">{displayEmail}</div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#F5F6F7] flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-[#6C4CF7] focus:text-white focus:text-[13px] focus:font-medium focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>
      <ConfirmDialogHost />
      {/* Full-width top header */}
      <header className="h-[64px] shrink-0 bg-white/80 backdrop-blur-xl border-b border-black/[0.06] flex items-center justify-between pr-4 md:pr-6 relative z-50 sticky top-0">
        <div className="flex items-center min-w-0">
          <div
            className="hidden md:flex items-center justify-center shrink-0"
            style={{ width: COLLAPSED, height: 64 }}
          >
            <Tooltip label={pinned ? "Recolher menu" : "Fixar menu"} placement="right">
              <button
                type="button"
                aria-label={pinned ? "Recolher menu" : "Fixar menu"}
                onClick={() => setPinned((p) => !p)}
                className="h-11 w-11 rounded-xl flex items-center justify-center hover:bg-[#F3F4F6] transition-colors"
                style={{ background: pinned ? "#F3F0FF" : undefined }}
              >
                <Menu size={22} strokeWidth={1.8} color={pinned ? "#6C4CF7" : "#374151"} />
              </button>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1 min-w-0">
            <img
              src="/assets/medcore-symbol.png"
              alt="MedCore"
              className="h-10 md:h-11 w-auto shrink-0"
            />
            <img
              src="/assets/medcore-wordmark-v3.png"
              alt="MedCore"
              className="h-[76px] md:h-[88px] w-auto shrink-0 -ml-5 brightness-75 contrast-125"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3" ref={menuRef}>
          <Tooltip label="Enviar WhatsApp">
            <motion.button
              type="button"
              aria-label="WhatsApp"
              onClick={() => window.open(WHATSAPP_URL, "_blank", "noopener,noreferrer")}
              className="h-10 w-10 rounded-[10px] flex items-center justify-center border cursor-pointer"
              style={{ transformOrigin: "center", willChange: "transform" }}
              animate={{
                scale: [1, 1.06, 1],
                boxShadow: [
                  "0 8px 24px rgba(255,80,100,0.08)",
                  "0 18px 40px rgba(255,80,100,0.16)",
                  "0 8px 24px rgba(255,80,100,0.08)",
                ],
                backgroundColor: ["#FFF5F5", "#FFF0F0", "#FFF5F5"],
                borderColor: [
                  "rgba(225,29,72,0.25)",
                  "rgba(225,29,72,0.40)",
                  "rgba(225,29,72,0.25)",
                ],
              }}
              transition={{ duration: 4, ease: "easeInOut", repeat: Infinity }}
            >
              <svg viewBox="0 0 32 32" width="20" height="20" fill="#E11D48" aria-hidden="true">
                <path d="M19.11 17.205c-.372 0-1.088 1.39-1.518 1.39a.63.63 0 0 1-.315-.1c-.802-.402-1.504-.817-2.163-1.447-.545-.516-1.146-1.29-1.46-1.963a.426.426 0 0 1-.073-.215c0-.33.99-.945.99-1.49 0-.143-.73-2.09-.832-2.335-.143-.372-.214-.487-.6-.487-.187 0-.36-.043-.53-.043-.302 0-.53.115-.746.315-.688.645-1.032 1.318-1.045 2.264v.114c-.014.99.396 1.977.87 2.834 1.135 2.06 2.786 3.71 4.848 4.848.858.473 1.845.887 2.834.87h.114c.946-.013 1.62-.358 2.264-1.046.2-.216.315-.444.315-.746 0-.17-.043-.344-.043-.53 0-.386-.114-.458-.487-.6-.244-.103-2.19-.832-2.335-.832zM16.12 4.667c-6.257 0-11.333 5.075-11.333 11.333 0 2.13.59 4.204 1.707 6.007L4.7 27.334l5.44-1.766a11.28 11.28 0 0 0 5.98 1.723h.005c6.252 0 11.333-5.077 11.333-11.334 0-3.03-1.18-5.878-3.323-8.021a11.28 11.28 0 0 0-8.015-3.269zm0 20.813h-.004a9.472 9.472 0 0 1-5.24-1.582l-.375-.223-3.887 1.26 1.28-3.783-.245-.39a9.454 9.454 0 0 1-1.44-5.031c0-5.234 4.265-9.498 9.514-9.498a9.436 9.436 0 0 1 6.712 2.784 9.436 9.436 0 0 1 2.78 6.72c0 5.235-4.264 9.5-9.514 9.5z" />
              </svg>
            </motion.button>
          </Tooltip>



          {/* Novo (dropdown) */}
          <div className="relative">
            <motion.button
              type="button"
              aria-label="Novo"
              onClick={() => setOpenMenu(openMenu === "novo" ? null : "novo")}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="h-9 w-9 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center"
            >
              <UserPlus size={19} strokeWidth={1.8} color="#374151" />
            </motion.button>
            <AnimatePresence>
              {openMenu === "novo" && (
                <motion.div
                  variants={dropdownVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  style={{ transformOrigin: "top right" }}
                  className="absolute right-0 top-11 z-50 w-56 rounded-xl bg-white border border-black/[0.06] shadow-xl overflow-hidden"
                >
                  <Link
                    to="/pacientes"
                    onClick={() => setOpenMenu(null)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13.5px] text-[#111827] hover:bg-[#F5F3FF] transition-colors"
                  >
                    <UserPlus size={16} className="text-[#6C4CF7]" /> Novo paciente
                  </Link>
                  <Link
                    to="/agenda"
                    search={{ taskId: undefined, deadlineId: undefined, eventId: undefined }}
                    onClick={() => setOpenMenu(null)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13.5px] text-[#111827] hover:bg-[#F5F3FF] transition-colors"
                  >
                    <CalendarPlus size={16} className="text-[#6C4CF7]" /> Novo agendamento
                  </Link>
                  <Link
                    to="/financeiro"
                    onClick={() => setOpenMenu(null)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13.5px] text-[#111827] hover:bg-[#F5F3FF] transition-colors"
                  >
                    <Wallet size={16} className="text-[#6C4CF7]" /> Novo lançamento
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            type="button"
            aria-label="Ajuda"
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            onClick={() =>
              toast.info("Central de ajuda", { description: "Em breve: tutoriais, FAQ e suporte." })
            }
            className="h-9 px-2.5 rounded-full hover:bg-[#F3F4F6] flex items-center gap-1.5"
          >
            <HelpCircle size={19} strokeWidth={1.8} color="#374151" />
            <span className="text-[13.5px] font-medium text-[#374151] hidden sm:inline">Ajuda</span>
          </motion.button>



          {/* Perfil */}
          <div className="relative">
            <motion.button
              type="button"
              aria-label="Perfil"
              onClick={() => setOpenMenu(openMenu === "perfil" ? null : "perfil")}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="h-9 w-9 rounded-full bg-[#10B981] text-white flex items-center justify-center text-[12px] font-bold overflow-hidden"
            >
              {initials}
            </motion.button>
            <AnimatePresence>
              {openMenu === "perfil" && (
                <motion.div
                  variants={dropdownVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  style={{ transformOrigin: "top right" }}
                  className="absolute right-0 top-11 z-50 w-56 rounded-xl bg-white border border-black/[0.06] shadow-xl overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-black/[0.06]">
                    <div className="text-[13px] font-semibold text-[#111827] truncate">
                      {displayName}
                    </div>
                    <div className="text-[11.5px] text-[#6B7280] truncate">{displayEmail}</div>
                  </div>
                  <Link
                    to="/configuracoes"
                    onClick={() => setOpenMenu(null)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13.5px] text-[#111827] hover:bg-[#F5F3FF] transition-colors"
                  >
                    <User size={16} className="text-[#6C4CF7]" /> Meu perfil
                  </Link>
                  <Link
                    to="/configuracoes"
                    onClick={() => setOpenMenu(null)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13.5px] text-[#111827] hover:bg-[#F5F3FF] transition-colors"
                  >
                    <Settings size={16} className="text-[#6C4CF7]" /> Configurações
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13.5px] text-[#DC2626] hover:bg-[#FEF2F2] border-t border-black/[0.06] transition-colors"
                  >
                    <LogOut size={16} /> Sair
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        {/* Desktop sidebar (below header) */}
        <div
          className="hidden md:block fixed left-0 z-40 transition-[width] duration-[280ms] ease-in-out"
          style={{ width: expanded ? EXPANDED : COLLAPSED, top: 64, bottom: 0 }}
          onMouseEnter={cancelClose}
          onMouseLeave={() => scheduleClose(100)}
        >
          <aside
            aria-label="Navegação principal"
            className="h-full bg-white border-r border-black/[0.06] flex flex-col transition-[width] duration-[280ms] ease-in-out overflow-hidden"
            style={{
              width: expanded ? EXPANDED : COLLAPSED,
              boxShadow: expanded && !pinned ? "0 20px 40px -20px rgba(0,0,0,0.12)" : "none",
            }}
          >
            <SidebarInner expanded={expanded} />
          </aside>
        </div>

        {/* Flyout panel lateral (Desktop) */}
        <AnimatePresence>
          {flyout && !expanded && (
            <motion.div
              key="sidebar-flyout-panel"
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40, transition: { duration: 0.15, ease: "easeIn" } }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: "left center" }}
              className="hidden md:flex fixed top-[64px] bottom-0 left-[56px] w-[256px] z-30 bg-white border-r border-black/[0.06] shadow-[16px_0_36px_-8px_rgba(0,0,0,0.08)] flex-col p-4 overflow-y-auto"
              onMouseEnter={cancelClose}
              onMouseLeave={() => scheduleClose(100)}
            >
              {(() => {
                const currentItem = navSections
                  .flatMap((s) => s.items)
                  .find((i) => i.to === flyout.to);
                if (!currentItem) return null;
                const options =
                  currentItem.children && currentItem.children.length > 0
                    ? currentItem.children
                    : [{ to: currentItem.to, label: currentItem.label }];

                return (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentItem.to}
                      initial={{ opacity: 0, x: -14 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="flex flex-col gap-2"
                    >
                      <div className="px-2 pt-1 pb-2 text-[15px] font-semibold text-[#111827] border-b border-black/[0.04]">
                        {currentItem.label}
                      </div>
                      <div className="flex flex-col gap-1.5 pt-1">
                        {options.map((child) => {
                          const childActive = isActive(child.to);
                          return (
                            <Link
                              key={child.to}
                              to={child.to}
                              preload="intent"
                              onClick={() => {
                                cancelClose();
                                setFlyout(null);
                                setMobileOpen(false);
                              }}
                              className={`flex items-center px-3.5 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150 ${
                                childActive
                                  ? "bg-[#F5F3FF] text-[#6C4CF7] font-medium"
                                  : "text-[#374151] hover:bg-[#F5F3FF]/70 hover:text-[#6C4CF7]"
                              }`}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile drawer */}
        <div className="md:hidden">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setMobileOpen(true)}
            className="fixed top-3 left-3 z-[60] h-10 w-10 rounded-xl bg-white border border-black/[0.06] shadow-sm flex items-center justify-center"
          >
            <Menu size={20} strokeWidth={1.8} color="#374151" />
          </button>
          <AnimatePresence>
            {mobileOpen && (
              <>
                <motion.div
                  key="mob-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
                  onClick={() => setMobileOpen(false)}
                />
                <motion.aside
                  key="mob-drawer"
                  initial={{ x: -EXPANDED }}
                  animate={{ x: 0 }}
                  exit={{ x: -EXPANDED }}
                  transition={{ duration: 0.32, ease: EASE_OUT }}
                  className="fixed inset-y-0 left-0 z-50 bg-white border-r border-black/[0.06] flex flex-col"
                  style={{ width: EXPANDED }}
                >
                  <button
                    type="button"
                    aria-label="Fechar menu"
                    onClick={() => setMobileOpen(false)}
                    className="absolute top-3 right-3 h-8 w-8 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center"
                  >
                    <X size={18} strokeWidth={1.8} color="#374151" />
                  </button>
                  <SidebarInner expanded={true} />
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </div>

        <main
          id="main-content"
          tabIndex={-1}
          onMouseEnter={() => {
            cancelClose();
            setFlyout(null);
          }}
          className={`flex-1 overflow-auto transition-[padding] duration-[280ms] outline-none ${pinned ? "md:pl-[232px]" : "md:pl-[56px]"}`}
        >
          <ErrorBoundary>
            <PageTransition>{children}</PageTransition>
          </ErrorBoundary>
        </main>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
