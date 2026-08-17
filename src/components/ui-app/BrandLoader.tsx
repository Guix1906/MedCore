interface BrandLoaderProps {
  size?: number;
  className?: string;
  label?: string;
  rotatingMessages?: boolean;
  showProgress?: boolean;
  messages?: string[];
}

/**
 * Neutral loading indicator (logo removed by user preference).
 * Renders a subtle spinner + optional label.
 */
export function BrandLoader({ size = 24, className, label }: BrandLoaderProps) {
  return (
    <div
      className={`inline-flex flex-col items-center justify-center gap-2 ${className ?? ""}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? "Carregando"}
    >
      <span
        aria-hidden
        className="inline-block animate-spin rounded-full border-2 border-muted border-t-primary"
        style={{ width: size, height: size }}
      />
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
    </div>
  );
}

export default BrandLoader;
