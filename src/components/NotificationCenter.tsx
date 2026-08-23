import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notificationsService } from "@/services/api";
import { Link } from "@tanstack/react-router";
import { Archive, Check, Clock, Bell as BellIcon } from "lucide-react";
import { toast } from "sonner";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  category: string | null;
  priority: string | null;
  action_url: string | null;
  read: boolean;
  archived: boolean;
  created_at: string;
};

const CAT_LABEL: Record<string, string> = {
  agenda: "Agenda",
  financeiro: "Financeiro",
  exame: "Exames",
  sistema: "Sistema",
};

const PRIORITY_DOT: Record<string, string> = {
  alta: "#EF4444",
  normal: "#6C4CF7",
  baixa: "#9CA3AF",
};

function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NotificationCenter({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"todas" | "nao_lidas" | "arquivadas">("nao_lidas");
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const phpNotifs = await notificationsService.getNotifications();
      if (phpNotifs && Array.isArray(phpNotifs) && phpNotifs.length > 0) {
        const formatted = phpNotifs.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.message,
          type: n.type,
          category: "sistema",
          priority: "normal",
          action_url: null,
          read: n.read,
          archived: false,
          created_at: n.created_at,
        }));
        setItems(formatted as Notif[]);
        setLoading(false);
        return;
      }
    } catch {}

    const { data, error } = await supabase
      .from("notifications")
      .select("id,title,body,type,category,priority,action_url,read,archived,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) setItems(data as Notif[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("notifications-center")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () =>
        load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const filtered = items.filter((n) => {
    if (tab === "nao_lidas") return !n.read && !n.archived;
    if (tab === "arquivadas") return n.archived;
    return !n.archived;
  });

  const unreadCount = items.filter((n) => !n.read && !n.archived).length;

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.read && !n.archived).map((n) => n.id);
    if (!ids.length) return;
    try {
      await notificationsService.markAsRead(ids);
    } catch {
      await supabase.from("notifications").update({ read: true }).in("id", ids);
    }
    setItems((prev) => prev.map((it) => ({ ...it, read: true })));
    toast.success("Todas marcadas como lidas");
  };

  const markRead = async (id: string) => {
    try {
      await notificationsService.markAsRead(id);
    } catch {
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    }
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, read: true } : it)));
  };
  const archive = async (id: string) => {
    await supabase
      .from("notifications")
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq("id", id);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, archived: true } : it)));
    toast.success("Notificação arquivada");
  };
  const snooze = async (id: string) => {
    const when = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    try {
      await notificationsService.snooze(id, when);
    } catch {
      await supabase.from("notifications").update({ snoozed_until: when, read: true }).eq("id", id);
    }
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, read: true } : it)));
    toast.success("Adiada por 1h");
  };

  return (
    <div className="absolute right-0 top-11 z-50 w-[380px] rounded-2xl bg-white border border-black/[0.06] shadow-2xl overflow-hidden animate-in fade-in">
      <div className="px-4 py-3 border-b border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BellIcon size={16} className="text-[#6C4CF7]" />
          <span className="text-[13.5px] font-semibold text-[#111827]">Notificações</span>
          {unreadCount > 0 && (
            <span className="ml-1 h-5 min-w-5 px-1.5 rounded-full bg-[#6C4CF7] text-white text-[11px] font-semibold flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={markAllRead}
          className="text-[12px] font-medium text-[#6C4CF7] hover:underline"
        >
          Marcar todas
        </button>
      </div>

      <div className="px-2 pt-2 flex items-center gap-1 border-b border-black/[0.04]">
        {(
          [
            ["nao_lidas", "Não lidas"],
            ["todas", "Todas"],
            ["arquivadas", "Arquivadas"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 h-8 rounded-lg text-[12.5px] font-medium transition-colors ${
              tab === k ? "bg-[#F3F0FF] text-[#6C4CF7]" : "text-[#6B7280] hover:bg-[#F9FAFB]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-[13px] text-[#6B7280]">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <BellIcon size={28} className="mx-auto text-[#D1D5DB] mb-2" />
            <div className="text-[13px] text-[#6B7280]">Nada por aqui</div>
          </div>
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              className={`group px-4 py-3 border-b border-black/[0.04] hover:bg-[#FAFAFB] transition-colors ${!n.read ? "bg-[#FBFAFF]" : ""}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                  style={{ background: PRIORITY_DOT[n.priority ?? "normal"] ?? "#6C4CF7" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] font-semibold text-[#111827] truncate">
                      {n.title}
                    </div>
                    {n.category && (
                      <span className="text-[10.5px] font-medium text-[#6C4CF7] bg-[#F3F0FF] px-1.5 py-0.5 rounded">
                        {CAT_LABEL[n.category] ?? n.category}
                      </span>
                    )}
                  </div>
                  {n.body && (
                    <div className="text-[12.5px] text-[#6B7280] mt-0.5 line-clamp-2">{n.body}</div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[11px] text-[#9CA3AF]">{timeAgo(n.created_at)}</span>
                    {n.action_url && (
                      <Link
                        to={n.action_url}
                        onClick={() => {
                          markRead(n.id);
                          onClose();
                        }}
                        className="text-[11.5px] font-medium text-[#6C4CF7] hover:underline"
                      >
                        Abrir
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!n.read && (
                    <button
                      onClick={() => markRead(n.id)}
                      title="Marcar como lida"
                      className="h-7 w-7 rounded-lg hover:bg-[#F3F0FF] flex items-center justify-center"
                    >
                      <Check size={14} className="text-[#6C4CF7]" />
                    </button>
                  )}
                  <button
                    onClick={() => snooze(n.id)}
                    title="Adiar 1h"
                    className="h-7 w-7 rounded-lg hover:bg-[#F3F0FF] flex items-center justify-center"
                  >
                    <Clock size={14} className="text-[#6B7280]" />
                  </button>
                  {!n.archived && (
                    <button
                      onClick={() => archive(n.id)}
                      title="Arquivar"
                      className="h-7 w-7 rounded-lg hover:bg-[#F3F0FF] flex items-center justify-center"
                    >
                      <Archive size={14} className="text-[#6B7280]" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
