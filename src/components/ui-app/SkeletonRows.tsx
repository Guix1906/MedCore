import { cn } from "@/utils/cn";

/**
 * Skeletons padronizados para telas de listagem.
 */
export function SkeletonRows({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("p-6 space-y-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-12 rounded bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("h-32 rounded bg-muted animate-pulse", className)} />;
}
