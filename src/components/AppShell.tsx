import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfirmDialogHost } from "@/components/app/confirm-dialog";
import { BrandLoader } from "@/components/ui-app/BrandLoader";
import { BrandLogo } from "@/components/ui-app/BrandLogo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  BlockedAccessScreen,
  NoAccessScreen,
  PendingInvitationsBanner,
} from "@/features/admin/AccessScreens";
import { firstAllowedRoute, routeRuleFor } from "@/features/admin/permissions";
import { signOut, useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useSessionTimeout } from "@/hooks/use-session-timeout";
import { useTheme } from "@/hooks/use-theme";
import { clearRecentSearches, type SearchPage } from "@/lib/global-search";
import { isThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  ChartLine,
  DollarSign,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import GlobalSearch from "./GlobalSearch";
import NotificationCenter from "./NotificationCenter";
import PageTransition from "./motion/PageTransition";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; nested?: boolean };
const navSections: { label: string; items: NavItem[] }[] = [
  { label: "Início", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Atendimento",
    items: [
      { to: "/agenda", label: "Agenda", icon: Calendar },
      { to: "/visao-geral", label: "Indicadores da agenda", icon: ChartLine, nested: true },
      { to: "/pacientes", label: "Pacientes", icon: Users },
      { to: "/prontuario", label: "Prontuário", icon: FileText },
      { to: "/acompanhamentos", label: "Acompanhamentos", icon: Activity },
    ],
  },
  {
    label: "Gestão",
    items: [
      { to: "/financeiro", label: "Financeiro", icon: DollarSign },
      { to: "/estoque", label: "Estoque", icon: Package },
      { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
    ],
  },
  {
    label: "Sistema",
    items: [
      { to: "/configuracoes", label: "Configurações", icon: Settings },
      { to: "/admin", label: "Administração", icon: ShieldCheck },
    ],
  },
];

const WHATSAPP_URL =
  "https://wa.me/5599984898934?text=" + encodeURIComponent("Olá! Entrando em contato via MedCore.");

// Guardado entre montagens para não piscar "Ctrl K" ao trocar de página; a primeira
// renderização no cliente continua igual à do servidor.
let macPlatform: boolean | null = null;

export default function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  useSessionTimeout();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile, loading, isAuthenticated } = useAuth();
  const { access, can } = usePermissions();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [pinned, setPinned] = useState(true);
  const [sidebarReady, setSidebarReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isMac, setIsMac] = useState(() => macPlatform ?? false);

  useEffect(() => {
    try {
      setPinned(window.localStorage.getItem("medcore:sidebar-pinned") !== "0");
    } catch (error) {
      console.warn("Não foi possível recuperar a preferência do menu.", error);
    }
    setSidebarReady(true);
  }, []);

  useEffect(() => {
    if (!sidebarReady) return;
    try {
      window.localStorage.setItem("medcore:sidebar-pinned", pinned ? "1" : "0");
    } catch (error) {
      console.warn("Não foi possível guardar a preferência do menu.", error);
    }
  }, [pinned, sidebarReady]);

  useEffect(() => {
    macPlatform = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    setIsMac(macPlatform);
    const onScroll = () => setScrolled(window.scrollY > 2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const allowedPath = (to: string) => {
    if (access.mode === "loading" || access.mode === "blocked") return false;
    const rule = routeRuleFor(to);
    if (!rule) return true;
    if (access.mode === "legacy") return rule.path !== "/admin";
    return rule.any.some(can);
  };
  const currentRule = routeRuleFor(pathname);
  const routeAllowed = !currentRule || access.mode !== "active" || currentRule.any.some(can);
  const fallbackPath = access.mode === "active" ? firstAllowedRoute(can) : null;
  const redirectToFallback =
    access.mode === "active" && !routeAllowed && pathname === "/dashboard" && !!fallbackPath;
  const canNewPatient = can("patients.manage");
  const canNewAppointment = can("agenda.manage");
  const canNewEntry = can("finance.receive") || can("finance.pay");
  const searchPages: SearchPage[] = navSections.flatMap((section) =>
    section.items
      .filter((item) => allowedPath(item.to))
      .map(({ to, label, icon }) => ({ to, label, icon, section: section.label })),
  );

  useEffect(() => {
    if (redirectToFallback && fallbackPath) void navigate({ to: fallbackPath, replace: true });
  }, [redirectToFallback, fallbackPath, navigate]);

  useEffect(() => {
    if (!loading && !isAuthenticated) void navigate({ to: "/auth" });
  }, [loading, isAuthenticated, navigate]);

  useEffect(() => {
    setMobileOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const displayName: string = profile?.full_name || user?.email?.split("@")[0] || "Usuário";
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await queryClient.cancelQueries();
      await signOut();
      queryClient.clear();
      clearRecentSearches();
      toast.success("Sessão encerrada");
      await navigate({ to: "/auth", replace: true });
    } catch (error) {
      console.error("Não foi possível encerrar a sessão.", error);
      toast.error("Não foi possível sair. Tente novamente.");
    } finally {
      setSigningOut(false);
    }
  };

  const navigation = (expanded: boolean) => (
    <nav
      aria-label="Navegação principal"
      className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto py-4", expanded ? "px-3" : "px-2")}
    >
      {navSections.map((section) => {
        const items = section.items.filter((item) => allowedPath(item.to));
        if (!items.length) return null;
        return (
          <div key={section.label}>
            {expanded ? (
              <p className="mb-1 px-3 text-xs font-semibold text-muted-foreground">
                {section.label}
              </p>
            ) : (
              <div className="mx-2 mb-2 h-px bg-hairline" />
            )}
            <div className="space-y-0.5">
              {items.map(({ to, label, icon: Icon, nested }) => {
                const active = pathname === to || pathname.startsWith(to + "/");
                return (
                  <Link
                    key={to}
                    to={to}
                    preload="intent"
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    title={!expanded ? label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                      !expanded && "justify-center px-0",
                      expanded && nested && "ml-4",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground",
                    )}
                  >
                    <Icon
                      size={18}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      className={cn(
                        "shrink-0",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    />
                    {expanded && <span className="truncate">{label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  if (loading || !isAuthenticated) {
    return (
      <div className="app-canvas flex min-h-dvh items-center justify-center">
        <BrandLoader label="Carregando seu ambiente…" />
      </div>
    );
  }

  const shellStyle: CSSProperties & { "--app-sidebar-width": string } = {
    "--app-sidebar-width": pinned ? "240px" : "72px",
  };

  return (
    <div className="app-canvas min-h-dvh" style={shellStyle}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-(--z-alert) focus:rounded-full focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:text-primary-foreground"
      >
        Pular para o conteúdo
      </a>
      <ConfirmDialogHost />
      <header
        data-scrolled={scrolled ? "" : undefined}
        className="sticky top-0 z-(--z-header) flex h-16 items-center justify-between gap-2 border-b border-transparent bg-glass px-3 glass-blur transition-[border-color,box-shadow] duration-200 ease-(--ease-apple) data-[scrolled]:border-hairline data-[scrolled]:shadow-[0_10px_30px_-24px_rgb(29_29_31/0.45)] md:px-5"
      >
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="hidden rounded-full md:inline-flex"
            onClick={() => setPinned((value) => !value)}
            aria-label={pinned ? "Recolher menu" : "Expandir menu"}
            aria-expanded={pinned}
          >
            {pinned ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full md:hidden"
                aria-label="Abrir menu"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-[288px] flex-col gap-0 border-hairline bg-glass-strong p-0 glass-blur-strong"
            >
              <SheetHeader className="border-b border-hairline px-5 py-4 text-left">
                <SheetTitle>
                  <BrandLogo />
                </SheetTitle>
                <SheetDescription>Navegue pelo seu ambiente de trabalho.</SheetDescription>
              </SheetHeader>
              {navigation(true)}
            </SheetContent>
          </Sheet>
          <Link
            to={fallbackPath ?? "/dashboard"}
            aria-label="MedCore, início"
            className="flex items-center rounded-lg"
          >
            <BrandLogo />
          </Link>
          {title && (
            <span className="ml-1 hidden min-w-0 truncate border-l border-hairline pl-4 text-sm font-semibold text-foreground md:block">
              {title}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Buscar no sistema"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex size-10 items-center justify-center gap-2 rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground sm:w-48 sm:justify-start sm:border sm:border-hairline sm:bg-foreground/[0.04] sm:px-3.5 lg:w-72"
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="hidden flex-1 truncate text-left text-sm sm:inline">
              Buscar no sistema
            </span>
            <kbd className="kbd-chip hidden lg:inline-flex">{isMac ? "⌘ K" : "Ctrl K"}</kbd>
          </button>
          {(canNewPatient || canNewAppointment || canNewEntry) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden rounded-full sm:inline-flex"
                  aria-label="Ações rápidas"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-56">
                <DropdownMenuLabel>Ações rápidas</DropdownMenuLabel>
                {canNewPatient && (
                  <DropdownMenuItem asChild>
                    <Link to="/pacientes" search={{ novo: true }}>
                      <UserPlus />
                      Novo paciente
                    </Link>
                  </DropdownMenuItem>
                )}
                {canNewAppointment && (
                  <DropdownMenuItem asChild>
                    <Link to="/agenda" search={{ novo: "true" }}>
                      <Calendar />
                      Novo agendamento
                    </Link>
                  </DropdownMenuItem>
                )}
                {canNewEntry && (
                  <DropdownMenuItem asChild>
                    <Link to="/financeiro" search={{ novo: "true" }}>
                      <Wallet />
                      Novo lançamento
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="Notificações"
              >
                <Bell />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={12}
              className="w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-2xl p-0"
            >
              <NotificationCenter onClose={() => setNotificationsOpen(false)} />
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Conta de ${displayName}`}
                className="ml-1 flex size-10 items-center justify-center rounded-full border border-primary/15 bg-primary-soft text-sm font-semibold text-primary"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-64">
              <DropdownMenuLabel className="space-y-1 py-3">
                <p className="truncate text-sm">{displayName}</p>
                <p className="truncate text-xs font-normal text-muted-foreground">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {allowedPath("/configuracoes") && (
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes">
                    <Settings />
                    Configurações da clínica
                  </Link>
                </DropdownMenuItem>
              )}
              {allowedPath("/admin") && (
                <DropdownMenuItem asChild>
                  <Link to="/admin">
                    <ShieldCheck />
                    Usuários e permissões
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                  <MessageCircle />
                  Contato pelo WhatsApp
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="py-1 text-xs font-medium text-muted-foreground">
                Aparência
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={themePreference}
                onValueChange={(value) => {
                  if (isThemePreference(value)) setThemePreference(value);
                }}
              >
                <DropdownMenuRadioItem value="light">
                  <Sun />
                  Claro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon />
                  Escuro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <Monitor />
                  Automático
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={signingOut}
                onSelect={() => void handleSignOut()}
                className="text-destructive focus:text-destructive"
              >
                <LogOut />
                {signingOut ? "Saindo…" : "Sair da conta"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <aside
        className="fixed bottom-2.5 left-2.5 top-[74px] z-(--z-sidebar) hidden flex-col overflow-hidden rounded-2xl border border-hairline bg-glass shadow-(--glass-shadow) glass-blur transition-[width] duration-200 ease-(--ease-apple) md:flex"
        style={{ width: "calc(var(--app-sidebar-width) - 16px)" }}
      >
        {navigation(pinned)}
        <div
          className={cn(
            "flex min-h-16 items-center gap-3 border-t border-hairline p-3",
            !pinned && "justify-center px-2",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials}
          </span>
          {pinned && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {access.companyName ?? "Seu ambiente de trabalho"}
              </p>
            </div>
          )}
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className="app-main min-h-[calc(100dvh-64px)]">
        <ErrorBoundary>
          {access.mode === "loading" || redirectToFallback ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <BrandLoader label="Carregando permissões…" />
            </div>
          ) : access.mode === "blocked" ? (
            <BlockedAccessScreen access={access} onSignOut={handleSignOut} />
          ) : !routeAllowed ? (
            <NoAccessScreen
              moduleLabel={currentRule?.label ?? "este módulo"}
              fallbackPath={fallbackPath}
            />
          ) : (
            <>
              {access.mode === "active" && (
                <PendingInvitationsBanner invitations={access.invitations} />
              )}
              <PageTransition>{children}</PageTransition>
            </>
          )}
        </ErrorBoundary>
      </main>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} pages={searchPages} />
    </div>
  );
}
