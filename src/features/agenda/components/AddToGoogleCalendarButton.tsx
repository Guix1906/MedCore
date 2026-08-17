import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";
import type { Activity } from "@/components/agenda/agenda-types";

/** Ícone oficial Google "G" (cores originais) — SVG inline, sem dependência extra. */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-4 w-4", className)} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.9 32.9 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C33.9 6.1 29.2 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8 20-20 0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C33.9 6.1 29.2 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.1 0 9.8-2 13.3-5.2l-6.1-5c-2 1.4-4.5 2.2-7.2 2.2-5.4 0-9.9-3.1-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.7-3.7 4.9l6.1 5C41.8 34.6 44 29.7 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

export function AddToGoogleCalendarButton({
  activity,
  variant = "icon",
  className,
}: {
  activity: Pick<Activity, "title" | "start" | "end" | "description" | "location" | "allDay">;
  variant?: "icon" | "full";
  className?: string;
}) {
  const url = buildGoogleCalendarUrl({
    title: activity.title,
    start: activity.start,
    end: activity.end ?? null,
    description: activity.description ?? null,
    location: activity.location ?? null,
    allDay: !!activity.allDay,
  });

  if (variant === "full") {
    return (
      <Button asChild variant="outline" className={cn("font-semibold", className)}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <GoogleGlyph className="mr-1.5" />
          Adicionar ao Google Calendar
        </a>
      </Button>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center justify-center h-7 w-7 rounded-full border border-border bg-background hover:bg-accent transition",
              className,
            )}
            aria-label="Adicionar ao Google Calendar"
          >
            <GoogleGlyph />
          </a>
        </TooltipTrigger>
        <TooltipContent>Adicionar ao Google Calendar</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
