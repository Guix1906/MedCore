import { cn } from "@/utils/cn";

/**
 * Base skeleton primitive with premium horizontal shimmer.
 * Uses .pj-skeleton class defined in styles.css (respects prefers-reduced-motion).
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cn("pj-skeleton", className)} style={style} />;
}

/* -----------------------------------------------------------
   Page wrapper — fades content in gently
----------------------------------------------------------- */
export function SkeletonPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("pj-fade-in space-y-6", className)}>{children}</div>;
}

/* -----------------------------------------------------------
   Header / toolbar
----------------------------------------------------------- */
export function SkeletonPageHeader() {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Cards (stat / KPI grid)
----------------------------------------------------------- */
export function SkeletonKpiGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border bg-card p-5 space-y-3 pj-fade-in"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------
   Table
----------------------------------------------------------- */
export function SkeletonTable({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div
        className="grid gap-4 px-4 py-3 border-b bg-muted/40"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 w-24" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-4 px-4 py-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-4" style={{ width: `${60 + ((r + c) % 4) * 10}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   List (with avatar + two lines)
----------------------------------------------------------- */
export function SkeletonList({ items = 6 }: { items?: number }) {
  return (
    <div className="rounded-xl border bg-card divide-y">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------
   Kanban board (columns of cards)
----------------------------------------------------------- */
export function SkeletonKanban({
  columns = 4,
  cardsPerColumn = 4,
}: {
  columns?: number;
  cardsPerColumn?: number;
}) {
  return (
    <div
      className="grid gap-4 overflow-x-auto"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(260px,1fr))` }}
    >
      {Array.from({ length: columns }).map((_, c) => (
        <div key={c} className="rounded-xl border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: cardsPerColumn }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border bg-background p-3 space-y-2 pj-fade-in"
                style={{ animationDelay: `${(c * cardsPerColumn + i) * 30}ms` }}
              >
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-2/3" />
                <div className="flex justify-between items-center pt-1">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------
   Calendar (month grid)
----------------------------------------------------------- */
export function SkeletonCalendar() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={`h${i}`} className="h-4 mx-auto w-8" />
        ))}
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton
            key={i}
            className="aspect-square rounded-md pj-fade-in"
            style={{ animationDelay: `${i * 10}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Weekly agenda grid
----------------------------------------------------------- */
export function SkeletonAgendaGrid() {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid grid-cols-8 gap-2 mb-3">
        <div />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-8 gap-2">
        {Array.from({ length: 8 * 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 pj-fade-in" style={{ animationDelay: `${i * 6}ms` }} />
        ))}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Form
----------------------------------------------------------- */
export function SkeletonForm({ fields = 5 }: { fields?: number }) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4 max-w-2xl">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-10 w-28 rounded-md" />
        <Skeleton className="h-10 w-24 rounded-md" />
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Timeline
----------------------------------------------------------- */
export function SkeletonTimeline({ items = 5 }: { items?: number }) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="relative pl-6 border-l border-border/70 space-y-6">
        {Array.from({ length: items }).map((_, i) => (
          <div key={i} className="relative pj-fade-in" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full bg-muted" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Chart
----------------------------------------------------------- */
export function SkeletonChart({ height = 300 }: { height?: number }) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-end gap-2" style={{ height }}>
        {Array.from({ length: 14 }).map((_, i) => {
          const h = 30 + ((i * 37) % 65);
          return (
            <Skeleton
              key={i}
              className="flex-1 rounded-md pj-fade-in"
              style={{ height: `${h}%`, animationDelay: `${i * 30}ms` }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
   Upload drop-zone
----------------------------------------------------------- */
export function SkeletonUpload() {
  return (
    <div className="rounded-xl border border-dashed bg-card p-8 flex flex-col items-center gap-3">
      <Skeleton className="h-12 w-12 rounded-full" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-9 w-32 rounded-md mt-2" />
    </div>
  );
}
