import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Copy, ExternalLink, Pencil, Search, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toAdminError } from "./admin-api";
import { extractLogoPalette } from "@/features/branding/extract-palette";
import {
  createClientUser,
  listClients,
  saveClient,
  saveClientBranding,
  setClientStatus,
  setClientUserPassword,
  slugify,
  updateClientUser,
  uploadClientLogo,
  type ClientBranding,
  type ClientData,
  type ClientRole,
  type ClientStatus,
  type ClientUser,
  type ClientUserStatus,
  type PlatformClient,
} from "./platform-api";

/**
 * Clientes da plataforma (cada cliente = uma empresa com dados separados). Só o administrador
 * da plataforma vê esta aba. Mostra dados cadastrais e usuários, nunca dados clínicos.
 */

const STATUS: Record<ClientStatus, { label: string; cls: string }> = {
  active: { label: "Ativo", cls: "bg-success/10 text-success" },
  paused: { label: "Pausado", cls: "bg-warning/15 text-warning" },
  cancelled: { label: "Cancelado", cls: "bg-destructive/10 text-destructive" },
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

type Dialogs =
  | { kind: "client"; client: PlatformClient | null }
  | { kind: "user"; client: PlatformClient }
  | { kind: "editUser"; client: PlatformClient; user: ClientUser }
  | { kind: "deleteUser"; client: PlatformClient; user: ClientUser }
  | { kind: "status"; client: PlatformClient; status: ClientStatus }
  | null;

export function ClientsTab() {
  const qc = useQueryClient();
  const clients = useQuery({ queryKey: ["platform-clients"], queryFn: listClients });
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialogs>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform-clients"] });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = clients.data ?? [];
    if (!q) return all;
    return all.filter((c) =>
      [c.name, c.legalName, c.document, c.contactName, c.email, ...c.users.map((u) => u.email)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [clients.data, search]);

  const counts = useMemo(() => {
    const all = clients.data ?? [];
    return {
      active: all.filter((c) => c.status === "active").length,
      paused: all.filter((c) => c.status === "paused").length,
      cancelled: all.filter((c) => c.status === "cancelled").length,
    };
  }, [clients.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <b className="text-foreground">{counts.active}</b> ativo(s) ·{" "}
          <b className="text-foreground">{counts.paused}</b> pausado(s) ·{" "}
          <b className="text-foreground">{counts.cancelled}</b> cancelado(s). Cada cliente tem os
          próprios dados, separados dos demais.
        </div>
        <Button onClick={() => setDialog({ kind: "client", client: null })}>
          <Building2 aria-hidden="true" /> Novo cliente
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar empresa, CNPJ, responsável ou e-mail…"
          className="pl-9"
        />
      </div>

      {clients.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando clientes…</p>
      ) : clients.error ? (
        <p role="alert" className="text-sm text-destructive">
          {toAdminError(clients.error).message}
        </p>
      ) : list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
      ) : (
        <div className="space-y-3">
          {list.map((c) => (
            <article key={c.id} className="rounded-xl border border-border bg-card p-4 shadow-2xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">{c.name}</h3>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS[c.status].cls}`}>
                      {STATUS[c.status].label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {[c.legalName, c.document && `CNPJ/CPF ${c.document}`].filter(Boolean).join(" · ") ||
                      "Sem razão social / documento"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[c.contactName, c.phone, c.email].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                  </p>
                  {(c.address || c.city) && (
                    <p className="text-sm text-muted-foreground">
                      {[c.address, [c.city, c.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {c.status !== "active" && c.statusReason && (
                    <p className="mt-1 text-xs text-warning">
                      {STATUS[c.status].label} em {fmtDate(c.statusChangedAt)}: {c.statusReason}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">Cliente desde {fmtDate(c.createdAt)}</p>
                  {c.branding.slug ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      <span className="text-muted-foreground">Login:</span>
                      <a
                        href={loginUrl(c.branding.slug)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {loginUrl(c.branding.slug)} <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(loginUrl(c.branding.slug))
                            .then(() => toast.success("Link copiado."))
                        }
                      >
                        <Copy aria-hidden="true" /> Copiar
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sem tela de login própria. Use “Editar” para definir logo, cores e link.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "client", client: c })}>
                    <Pencil aria-hidden="true" /> Editar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "user", client: c })}>
                    <UserPlus aria-hidden="true" /> Usuário
                  </Button>
                  {c.status === "active" ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDialog({ kind: "status", client: c, status: "paused" })}
                      >
                        Pausar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDialog({ kind: "status", client: c, status: "cancelled" })}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => setDialog({ kind: "status", client: c, status: "active" })}>
                      Reativar
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 border-t border-border-soft pt-2">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  Usuários ({c.users.length})
                </p>
                {c.users.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum usuário. Use “Usuário” para criar o acesso.</p>
                ) : (
                  <ul className="divide-y divide-border-soft text-sm">
                    {c.users.map((u) => (
                      <li key={u.memberId} className="flex flex-wrap items-center justify-between gap-2 py-1">
                        <div className="flex min-w-0 flex-wrap gap-x-2 text-foreground">
                          <span className="font-medium">{u.fullName}</span>
                          <span className="text-muted-foreground">{u.email}</span>
                          <span className="text-muted-foreground">· {u.role ?? "sem perfil"}</span>
                          <span className={u.status === "active" ? "text-muted-foreground" : "text-warning"}>
                            · {u.status === "active" ? "ativo" : u.status === "suspended" ? "suspenso" : u.status}
                          </span>
                          <span className="text-muted-foreground">
                            · {u.lastSignInAt ? `último acesso ${fmtDate(u.lastSignInAt)}` : "nunca acessou"}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDialog({ kind: "editUser", client: c, user: u })}
                          >
                            <Pencil aria-hidden="true" /> Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDialog({ kind: "deleteUser", client: c, user: u })}
                          >
                            <Trash2 aria-hidden="true" /> Excluir
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <ClientDialog
        open={dialog?.kind === "client"}
        client={dialog?.kind === "client" ? dialog.client : null}
        onClose={() => setDialog(null)}
        onDone={refresh}
      />
      {dialog?.kind === "user" && (
        <UserDialog client={dialog.client} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog?.kind === "editUser" && (
        <EditUserDialog
          client={dialog.client}
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
      {dialog?.kind === "deleteUser" && (
        <DeleteUserDialog
          client={dialog.client}
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
      {dialog?.kind === "status" && (
        <StatusChangeDialog
          client={dialog.client}
          status={dialog.status}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

const EMPTY: Required<ClientData> = {
  name: "",
  legal_name: "",
  document: "",
  contact_name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  notes: "",
};

function ClientDialog({
  open,
  client,
  onClose,
  onDone,
}: {
  open: boolean;
  client: PlatformClient | null;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        {open && <ClientForm key={client?.id ?? "novo"} client={client} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function ClientForm({
  client,
  onClose,
  onDone,
}: {
  client: PlatformClient | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isNew = !client;
  const [data, setData] = useState<Required<ClientData>>(() =>
    client
      ? {
          name: client.name,
          legal_name: client.legalName ?? "",
          document: client.document ?? "",
          contact_name: client.contactName ?? "",
          phone: client.phone ?? "",
          email: client.email ?? "",
          address: client.address ?? "",
          city: client.city ?? "",
          state: client.state ?? "",
          notes: client.notes ?? "",
        }
      : EMPTY,
  );
  const [brand, setBrand] = useState<ClientBranding>(() => ({ ...EMPTY_BRAND, ...client?.branding }));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoPreview = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : brand.logo_url), [logoFile, brand.logo_url]);
  useEffect(() => () => {
    if (logoFile) URL.revokeObjectURL(logoPreview);
  }, [logoFile, logoPreview]);
  const [user, setUser] = useState({ fullName: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ClientData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData({ ...data, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data.name.trim()) return toast.error("Informe o nome da empresa.");
    if (isNew) {
      if (!user.email.trim() || !user.fullName.trim()) return toast.error("Informe nome e e-mail do usuário.");
      if (user.password.length < 8) return toast.error("A senha deve ter no mínimo 8 caracteres.");
    }
    const slug = brand.slug.trim() || slugify(data.name);
    if (slug && !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug))
      return toast.error("Endereço do login: só letras minúsculas, números e hífen (3 a 50).");
    setBusy(true);
    try {
      const id = await saveClient(client?.id ?? null, data);
      const logo_url = logoFile ? await uploadClientLogo(id, logoFile) : brand.logo_url;
      await saveClientBranding(id, { ...brand, slug, logo_url });
      if (isNew) {
        const r = await createClientUser({ companyId: id, ...user });
        toast.success(`Cliente criado. Acesso: ${r.email}`, {
          description: [
            r.existingAccount
              ? "Este e-mail já tinha conta: ele entra com a senha que já usava."
              : "Entra com a senha definida, já como Proprietário da própria empresa.",
            removedNote(r.removedFrom),
          ]
            .filter(Boolean)
            .join(" "),
        });
      } else {
        toast.success("Dados do cliente salvos.");
      }
      onDone();
      onClose();
    } catch (err) {
      toast.error(toAdminError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof ClientData, label: string, ph = "", className = "") => (
    <div className={`space-y-1 ${className}`}>
      <Label htmlFor={`c-${k}`}>{label}</Label>
      <Input id={`c-${k}`} value={data[k]} onChange={set(k)} placeholder={ph} />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isNew ? "Novo cliente" : `Editar ${client?.name}`}</DialogTitle>
        <DialogDescription>
          {isNew
            ? "Cria a empresa com dados separados dos demais clientes e o primeiro acesso (Proprietário)."
            : "Dados cadastrais do cliente."}
        </DialogDescription>
      </DialogHeader>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground">Empresa</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("name", "Nome da empresa *", "Ex.: Clínica Senyor", "sm:col-span-2")}
          {field("legal_name", "Razão social")}
          {field("document", "CNPJ / CPF")}
          {field("contact_name", "Responsável")}
          {field("phone", "Telefone")}
          {field("email", "E-mail da empresa", "", "sm:col-span-2")}
          {field("address", "Endereço", "", "sm:col-span-2")}
          {field("city", "Cidade")}
          {field("state", "UF")}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="c-notes">Observações</Label>
            <Textarea id="c-notes" rows={2} value={data.notes} onChange={set("notes")} />
          </div>
        </div>
      </section>

      <BrandingSection
        brand={brand}
        setBrand={setBrand}
        slugHint={slugify(data.name)}
        logoPreview={logoPreview}
        onLogo={setLogoFile}
      />

      {isNew && (
        <section className="space-y-3 rounded-lg border border-border p-3">
          <h4 className="text-sm font-semibold text-foreground">Primeiro usuário (Proprietário)</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="u-name">Nome *</Label>
              <Input id="u-name" value={user.fullName} onChange={(e) => setUser({ ...user, fullName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-email">E-mail de acesso *</Label>
              <Input
                id="u-email"
                type="email"
                autoComplete="off"
                value={user.email}
                onChange={(e) => setUser({ ...user, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-pass">Senha (mín. 8) *</Label>
              <Input
                id="u-pass"
                type="password"
                autoComplete="new-password"
                value={user.password}
                onChange={(e) => setUser({ ...user, password: e.target.value })}
              />
            </div>
          </div>
        </section>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Voltar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Salvando…" : isNew ? "Criar cliente" : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

const EMPTY_BRAND: ClientBranding = {
  slug: "",
  logo_url: "",
  logo_white: true,
  primary: "#2c7f86",
  secondary: "#3f9ea3",
  tagline: "",
};

export function loginUrl(slug: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://meedcore.vercel.app";
  return `${origin}/${slug}`;
}

/** Logo, cores e frase da tela de login do cliente, com prévia do painel da marca. */
function BrandingSection({
  brand,
  setBrand,
  slugHint,
  logoPreview,
  onLogo,
}: {
  brand: ClientBranding;
  setBrand: React.Dispatch<React.SetStateAction<ClientBranding>>;
  slugHint: string;
  logoPreview: string;
  onLogo: (f: File | null) => void;
}) {
  const slug = brand.slug || slugHint;
  const color = (k: "primary" | "secondary", label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`b-${k}`}>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={label}
          value={brand[k] || "#2c7f86"}
          onChange={(e) => setBrand({ ...brand, [k]: e.target.value })}
          className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
        />
        <Input
          id={`b-${k}`}
          value={brand[k]}
          maxLength={7}
          onChange={(e) => setBrand({ ...brand, [k]: e.target.value.trim().toLowerCase() })}
          placeholder="#2c7f86"
        />
      </div>
    </div>
  );
  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold text-foreground">Identidade visual da tela de login</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="b-slug">Endereço do login</Label>
          <div className="flex items-center rounded-md border border-input pl-3 text-sm">
            <span className="shrink-0 text-muted-foreground">meedcore.vercel.app/</span>
            <input
              id="b-slug"
              value={brand.slug}
              placeholder={slugHint || "nomedaclinica"}
              onChange={(e) => setBrand({ ...brand, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              className="h-9 min-w-0 flex-1 bg-transparent pr-3 outline-none"
            />
          </div>
          <p className="text-xs text-muted-foreground">Em branco: usa o nome da empresa ({slugHint || "—"}).</p>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="b-logo">Logo (PNG, SVG, JPG ou WebP, até 2 MB)</Label>
          <Input
            id="b-logo"
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f && f.size > 2 * 1024 * 1024) {
                toast.error("A logo deve ter no máximo 2 MB.");
                e.target.value = "";
                return;
              }
              onLogo(f);
              if (!f) return;
              void extractLogoPalette(f)
                .then((p) => {
                  setBrand((b) => ({ ...b, primary: p.primary, secondary: p.secondary, logo_white: p.logoWhite }));
                  toast.success("Identidade visual detectada pela logo.", {
                    description: "Cores e estilo da logo aplicados. Ajuste abaixo se quiser.",
                  });
                })
                .catch(() => toast.error("Não consegui ler as cores da logo. Escolha as cores manualmente."));
            }}
          />
          <p className="text-xs text-muted-foreground">
            Ao enviar a logo, as cores e o estilo da tela são definidos automaticamente a partir dela.
          </p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={brand.logo_white}
              onChange={(e) => setBrand({ ...brand, logo_white: e.target.checked })}
              className="size-4 accent-primary"
            />
            A logo tem fundo transparente (PNG/SVG). Desmarque se ela tiver fundo branco (ex.: JPG): o
            sistema remove o fundo. Nos dois casos ela aparece em branco sobre o painel.
          </label>
        </div>
        {color("primary", "Cor principal")}
        {color("secondary", "Cor de destaque")}
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="b-tagline">Frase abaixo da logo</Label>
          <Input
            id="b-tagline"
            maxLength={200}
            value={brand.tagline}
            onChange={(e) => setBrand({ ...brand, tagline: e.target.value })}
            placeholder="Ex.: Cuidado com precisão, do primeiro atendimento ao acompanhamento."
          />
        </div>
      </div>
      {/* Prévia do painel da marca e do botão Entrar com as cores escolhidas */}
      <div
        className="flex flex-col items-center gap-3 rounded-xl p-5 text-center"
        style={{
          background: `linear-gradient(150deg, color-mix(in srgb, ${brand.primary || "#2c7f86"} 82%, black) 0%, ${brand.primary || "#2c7f86"} 55%, ${brand.secondary || brand.primary || "#3f9ea3"} 100%)`,
        }}
      >
        {logoPreview ? (
          <img
            src={logoPreview}
            alt="Prévia da logo"
            className="max-h-20 max-w-[70%] object-contain"
            style={
              brand.logo_white
                ? { filter: "brightness(0) invert(1)" }
                : { filter: "grayscale(1) invert(1) contrast(1.6) brightness(1.15)", mixBlendMode: "screen" }
            }
          />
        ) : (
          <span className="text-sm text-white/80">Sem logo: aparece a do consultório padrão</span>
        )}
        {brand.tagline && <p className="text-xs text-white/80">{brand.tagline}</p>}
        <span
          className="rounded-full px-6 py-2 text-sm font-semibold text-white shadow"
          style={{ background: `linear-gradient(135deg, ${brand.secondary || brand.primary} 0%, ${brand.primary} 100%)` }}
        >
          Entrar
        </span>
      </div>
      {slug && (
        <p className="text-xs text-muted-foreground">
          Link do cliente: <b className="text-foreground">{loginUrl(slug)}</b>
        </p>
      )}
    </section>
  );
}

function removedNote(names: string[]) {
  return names.length > 0 ? `Removido de: ${names.join(", ")}.` : "";
}

function UserDialog({
  client,
  onClose,
  onDone,
}: {
  client: PlatformClient;
  onClose: () => void;
  onDone: () => void;
}) {
  const [user, setUser] = useState({ fullName: "", email: "", password: "" });
  const [roleId, setRoleId] = useState(() => defaultRoleId(client.roles));
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.email.trim() || !user.fullName.trim()) return toast.error("Informe nome e e-mail.");
    if (user.password.length < 8) return toast.error("A senha deve ter no mínimo 8 caracteres.");
    setBusy(true);
    try {
      const r = await createClientUser({ companyId: client.id, ...user, roleId: roleId || null });
      toast.success(`Acesso criado: ${r.email}`, {
        description:
          [
            r.existingAccount ? "E-mail já tinha conta: entra com a senha que já usava." : "",
            removedNote(r.removedFrom),
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      });
      onDone();
      onClose();
    } catch (err) {
      toast.error(toAdminError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Novo usuário · {client.name}</DialogTitle>
            <DialogDescription>
              Acesso a {client.name}: vê somente os dados desta empresa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <RoleSelect id="nu-role" roles={client.roles} value={roleId} onChange={setRoleId} />
            <div className="space-y-1">
              <Label htmlFor="nu-name">Nome</Label>
              <Input id="nu-name" value={user.fullName} onChange={(e) => setUser({ ...user, fullName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nu-email">E-mail de acesso</Label>
              <Input
                id="nu-email"
                type="email"
                autoComplete="off"
                value={user.email}
                onChange={(e) => setUser({ ...user, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nu-pass">Senha (mín. 8)</Label>
              <Input
                id="nu-pass"
                type="password"
                autoComplete="new-password"
                value={user.password}
                onChange={(e) => setUser({ ...user, password: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Voltar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Criando…" : "Criar acesso"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function defaultRoleId(roles: ClientRole[]) {
  return (roles.find((r) => r.isOwner) ?? roles[0])?.id ?? "";
}

function RoleSelect({
  id,
  roles,
  value,
  onChange,
}: {
  id: string;
  roles: ClientRole[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Perfil de acesso</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Escolha o perfil" />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const USER_STATUS: { value: ClientUserStatus; label: string }[] = [
  { value: "active", label: "Ativo" },
  { value: "suspended", label: "Suspenso (sem acesso)" },
  { value: "removed", label: "Removido da empresa" },
];

function EditUserDialog({
  client,
  user,
  onClose,
  onDone,
}: {
  client: PlatformClient;
  user: ClientUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [roleId, setRoleId] = useState(user.roleId ?? defaultRoleId(client.roles));
  const [status, setStatus] = useState<ClientUserStatus>(
    user.status === "suspended" ? "suspended" : "active",
  );
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const needsReason = status !== "active";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsReason && reason.trim().length < 5) return toast.error("Informe o motivo (mínimo 5 caracteres).");
    setBusy(true);
    try {
      await updateClientUser({ memberId: user.memberId, fullName, roleId: roleId || null, status, reason });
      toast.success(
        status === "removed" ? `${user.fullName} removido de ${client.name}.` : "Usuário atualizado.",
      );
      onDone();
      onClose();
    } catch (err) {
      toast.error(toAdminError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (password.length < 8) return toast.error("A senha deve ter no mínimo 8 caracteres.");
    setBusy(true);
    try {
      await setClientUserPassword(user.memberId, password);
      toast.success(`Senha de ${user.email ?? user.fullName} redefinida.`);
      setPassword("");
    } catch (err) {
      toast.error(toAdminError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar usuário · {client.name}</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="eu-name">Nome</Label>
              <Input id="eu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <RoleSelect id="eu-role" roles={client.roles} value={roleId} onChange={setRoleId} />
            <div className="space-y-1">
              <Label htmlFor="eu-status">Situação</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ClientUserStatus)}>
                <SelectTrigger id="eu-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_STATUS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {user.status === "suspended" && user.statusReason && (
                <p className="text-xs text-warning">Suspenso: {user.statusReason}</p>
              )}
            </div>
            {needsReason && (
              <div className="space-y-1">
                <Label htmlFor="eu-reason">Motivo (obrigatório)</Label>
                <Textarea id="eu-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Voltar
            </Button>
            <Button type="submit" variant={status === "removed" ? "destructive" : "default"} disabled={busy}>
              {busy ? "Salvando…" : status === "removed" ? "Remover usuário" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>

        {!user.isPlatformAdmin && (
          <section className="space-y-2 border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-foreground">Redefinir senha</h4>
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="Nova senha (mín. 8)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => void changePassword()} disabled={busy}>
                Trocar senha
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A pessoa passa a entrar com a nova senha. Avise-a por um canal seguro.
            </p>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  client,
  user,
  onClose,
  onDone,
}: {
  client: PlatformClient;
  user: ClientUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateClientUser({
        memberId: user.memberId,
        fullName: "",
        roleId: user.roleId,
        status: "removed",
        reason: reason.trim().length >= 5 ? reason : "Excluído pela administração da plataforma",
      });
      toast.success(`${user.fullName} excluído de ${client.name}.`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(toAdminError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Excluir usuário · {client.name}</DialogTitle>
            <DialogDescription>
              <b>{user.fullName}</b> ({user.email}) perde o acesso a {client.name} na hora. Os
              registros que essa pessoa fez na clínica continuam guardados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="du-reason">Motivo (opcional)</Label>
            <Textarea id="du-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Excluindo…" : "Excluir usuário"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusChangeDialog({
  client,
  status,
  onClose,
  onDone,
}: {
  client: PlatformClient;
  status: ClientStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = {
    paused: {
      title: "Pausar cliente",
      text: "Todos os usuários deste cliente perdem o acesso em até um minuto. Os dados ficam guardados e voltam ao reativar.",
      action: "Pausar",
    },
    cancelled: {
      title: "Cancelar cliente",
      text: "Todos os usuários perdem o acesso. Os dados ficam guardados (não são apagados) e o cliente pode ser reativado.",
      action: "Cancelar cliente",
    },
    active: {
      title: "Reativar cliente",
      text: "Os usuários que estavam ativos antes da pausa voltam a acessar.",
      action: "Reativar",
    },
  }[status];
  const needsReason = status !== "active";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsReason && reason.trim().length < 5) return toast.error("Informe o motivo (mínimo 5 caracteres).");
    setBusy(true);
    try {
      await setClientStatus(client.id, status, reason);
      toast.success(`${client.name}: ${copy.action.toLowerCase()} concluído.`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(toAdminError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {copy.title} · {client.name}
            </DialogTitle>
            <DialogDescription>{copy.text}</DialogDescription>
          </DialogHeader>
          {needsReason && (
            <div className="space-y-1">
              <Label htmlFor="st-reason">Motivo (obrigatório)</Label>
              <Textarea id="st-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Voltar
            </Button>
            <Button type="submit" variant={status === "active" ? "default" : "destructive"} disabled={busy}>
              {busy ? "Salvando…" : copy.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
