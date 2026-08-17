import { KIND_COLOR, type Activity } from "@/components/agenda/agenda-types";
import { cn } from "@/utils/cn";
import { SkeletonBlock } from "@/components/ui-app";
import { KindIcon } from "./KindIcon";
import { AddToGoogleCalendarButton } from "./AddToGoogleCalendarButton";

export function ListView({
  activities,
  loading,
  onActivityClick,
}: {
  activities: Activity[];
  loading: boolean;
  onActivityClick: (a: Activity) => void;
}) {
  if (loading)
    return (
      <div className="p-6">
        <SkeletonBlock />
      </div>
    );
  if (activities.length === 0)
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        Nenhuma atividade encontrada.
      </div>
    );
  const sorted = [...activities].sort((a, b) => a.start.getTime() - b.start.getTime());
  return (
    <div className="divide-y divide-border">
      {sorted.map((a) => {
        const c = KIND_COLOR[a.kind];
        return (
          <div
            key={a.id}
            className="w-full flex items-start gap-3 p-4 hover:bg-card transition-colors"
          >
            <button
              onClick={() => onActivityClick(a)}
              className="flex-1 flex items-start gap-3 text-left min-w-0"
            >
              <span className={cn("w-1 self-stretch rounded-full", c.bar)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <KindIcon kind={a.kind} className={cn("h-3.5 w-3.5", c.text)} />
                  <p className="font-medium text-foreground truncate">{a.title}</p>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", c.chip)}>
                    {c.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {a.start.toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {a.caseTitle && (
                    <span className="ml-2 text-muted-foreground">· {a.caseTitle}</span>
                  )}
                </p>
              </div>
            </button>
            <AddToGoogleCalendarButton activity={a} />
          </div>
        );
      })}
    </div>
  );
}
