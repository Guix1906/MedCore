import {
  BrandLoader,
  EmptyState,
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui-app";
import { Button } from "@/components/ui/button";
import { safeRedirectPath } from "@/features/admin/permissions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { formatNotificationTime, groupByDay } from "@/lib/notification-groups";
import { cn } from "@/lib/utils";
import { notificationsService } from "@/services/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, Bell, Check, Clock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  category: string | null;
  action_url: string | null;
  read: boolean;
  archived: boolean;
  created_at: string;
};
type NotificationData = { source: "php" | "supabase"; items: Notification[] };
type Tab = "nao_lidas" | "todas" | "arquivadas";
const categories: Record<string, string> = {
  agenda: "Agenda",
  financeiro: "Financeiro",
  exame: "Exames",
  sistema: "Sistema",
};

export default function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("nao_lidas");
  const [busy, setBusy] = useState(false);
  const queryKey = ["notifications-center", user?.id];
  const query = useQuery({
    queryKey,
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<NotificationData> => {
      try {
        const items = await notificationsService.getNotifications();
        return {
          source: "php",
          items: items.map((item) => ({
            id: item.id,
            title: item.title,
            body: item.message,
            category: "sistema",
            action_url: null,
            read: item.read,
            archived: false,
            created_at: item.created_at,
          })),
        };
      } catch {
        const { data, error } = await supabase
          .from("notifications")
          .select("id,title,body,category,action_url,read,archived,created_at")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return { source: "supabase", items: data ?? [] };
      }
    },
  });
  useEffect(() => {
    if (query.data?.source !== "supabase") return;
    const channel = supabase
      .channel(`notification-center-${user?.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["notifications-center", user?.id] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [query.data?.source, queryClient, user?.id]);

  const items = query.data?.items ?? [];
  const unread = items.filter((item) => !item.read && !item.archived);
  const filtered = items.filter((item) =>
    tab === "arquivadas" ? item.archived : !item.archived && (tab !== "nao_lidas" || !item.read),
  );
  const groups = groupByDay(filtered);
  const tabs: SegmentedOption<Tab>[] = [
    { value: "nao_lidas", label: "Não lidas" },
    { value: "todas", label: "Todas" },
    ...(query.data?.source === "supabase"
      ? [{ value: "arquivadas" as const, label: "Arquivadas" }]
      : []),
  ];
  const update = async (ids: string[], action: "read" | "archive" | "snooze") => {
    if (!ids.length || !query.data) return;
    setBusy(true);
    try {
      if (query.data.source === "php") {
        if (action === "snooze")
          await notificationsService.snooze(ids[0], new Date(Date.now() + 3_600_000).toISOString());
        else if (action === "read") await notificationsService.markAsRead(ids);
        else throw new Error("Arquivamento indisponível nesta fonte.");
      } else {
        const payload =
          action === "archive"
            ? { archived: true, archived_at: new Date().toISOString() }
            : action === "snooze"
              ? { read: true, snoozed_until: new Date(Date.now() + 3_600_000).toISOString() }
              : { read: true };
        const { error } = await supabase.from("notifications").update(payload).in("id", ids);
        if (error) throw error;
      }
      await queryClient.invalidateQueries({ queryKey });
      toast.success(
        action === "archive"
          ? "Notificação arquivada"
          : action === "snooze"
            ? "Notificação adiada por 1 hora"
            : "Notificações marcadas como lidas",
      );
    } catch (error) {
      console.error("Não foi possível atualizar as notificações.", error);
      toast.error("Não foi possível atualizar a notificação. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Central de notificações">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <Bell size={18} className="text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">Notificações</h2>
          {unread.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">
              {unread.length}
              <span className="sr-only"> não lidas</span>
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label="Fechar notificações"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="px-4 pb-3">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={tabs}
          aria-label="Filtrar notificações"
          className="w-full"
        />
      </div>
      <div className="max-h-[min(440px,55dvh)] overflow-y-auto border-t border-hairline">
        {query.isPending ? (
          <div className="flex justify-center p-8">
            <BrandLoader label="Carregando notificações…" />
          </div>
        ) : query.error ? (
          <div role="alert" className="p-4 text-sm">
            <p>Não foi possível carregar as notificações.</p>
            <Button variant="link" onClick={() => void query.refetch()} className="mt-2 px-0">
              Tentar novamente
            </Button>
          </div>
        ) : !filtered.length ? (
          <EmptyState
            title="Nenhuma notificação"
            description="Novas atualizações aparecerão aqui."
            illustration={<Bell size={22} />}
            className="m-4 border-0 bg-transparent"
          />
        ) : (
          groups.map((group) => (
            <div key={group.id} role="group" aria-labelledby={`notifications-${group.id}`}>
              <h3
                id={`notifications-${group.id}`}
                className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground"
              >
                {group.label}
              </h3>
              <div className="divide-y divide-hairline">
                {group.items.map((item) => {
                  const url = safeRedirectPath(item.action_url);
                  const category = item.category
                    ? (categories[item.category] ?? item.category)
                    : null;
                  return (
                    <article
                      key={item.id}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          item.read ? "bg-transparent" : "bg-primary",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p
                            className={cn(
                              "min-w-0 break-words text-sm text-foreground",
                              !item.read && "font-semibold",
                            )}
                          >
                            {!item.read && <span className="sr-only">Não lida: </span>}
                            {item.title}
                          </p>
                          <time
                            dateTime={item.created_at}
                            className="shrink-0 pt-px text-xs tabular-nums text-muted-foreground"
                          >
                            {formatNotificationTime(item.created_at, group.id)}
                          </time>
                        </div>
                        {item.body && (
                          <p className="mt-0.5 break-words text-sm text-muted-foreground">
                            {item.body}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            {category && <span>{category}</span>}
                            {url && (
                              <Link
                                to={url}
                                onClick={() => {
                                  void update([item.id], "read");
                                  onClose();
                                }}
                                className="font-medium text-primary hover:underline"
                              >
                                Abrir
                              </Link>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {!item.read && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 rounded-full"
                                disabled={busy}
                                onClick={() => void update([item.id], "read")}
                                aria-label="Marcar como lida"
                                title="Marcar como lida"
                              >
                                <Check />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-full"
                              disabled={busy}
                              onClick={() => void update([item.id], "snooze")}
                              aria-label="Adiar por 1 hora"
                              title="Adiar por 1 hora"
                            >
                              <Clock />
                            </Button>
                            {!item.archived && query.data?.source === "supabase" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 rounded-full"
                                disabled={busy}
                                onClick={() => void update([item.id], "archive")}
                                aria-label="Arquivar"
                                title="Arquivar"
                              >
                                <Archive />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
      {unread.length > 0 && (
        <div className="border-t border-hairline px-4 py-2">
          <Button
            variant="link"
            disabled={busy}
            className="px-0"
            onClick={() =>
              void update(
                unread.map((item) => item.id),
                "read",
              )
            }
          >
            Marcar todas como lidas
          </Button>
        </div>
      )}
    </section>
  );
}
