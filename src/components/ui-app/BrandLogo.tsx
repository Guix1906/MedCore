import { cn } from "@/lib/utils";

export type BrandSymbolVariant = "pulse" | "shimmer" | "float" | "static";
export type BrandSymbolSize = "small" | "normal" | "large" | "xl";

export interface BrandSymbolProps {
  className?: string;
  size?: BrandSymbolSize;
  animated?: boolean;
  variant?: BrandSymbolVariant;
  interactive?: boolean;
  showAura?: boolean;
}

/**
 * BrandSymbol — O Símbolo Clínico Exclusivo MedCore ("Logo P" / Ícone da Cruz Interligada).
 * Animado com pulso vital de batimento cardíaco, aura bio-luminescente e aceleração via GPU.
 */
export function BrandSymbol({
  className,
  size = "normal",
  animated = true,
  variant = "pulse",
  interactive = true,
  showAura = true,
}: BrandSymbolProps) {
  const sizeMap: Record<BrandSymbolSize, string> = {
    small: "h-7 w-7",
    normal: "h-9 w-9 md:h-10 md:w-10",
    large: "h-11 w-11 md:h-12 md:w-12",
    xl: "h-16 w-16 md:h-20 md:w-20",
  };

  const animClass =
    animated && variant === "pulse"
      ? "animate-medcore-pulse"
      : animated && variant === "float"
        ? "animate-medcore-float"
        : "";

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 select-none",
        interactive && "transition-transform duration-300 ease-out hover:scale-108 active:scale-95 cursor-pointer",
        className,
      )}
      title="MedCore Saúde"
    >
      {/* Halo de luz / Respiração bio-luminescente */}
      {animated && showAura && variant !== "static" && (
        <div
          aria-hidden="true"
          className="absolute -inset-1 rounded-full bg-gradient-to-tr from-blue-600/25 via-teal-400/30 to-emerald-400/20 blur-md pointer-events-none animate-medcore-aura"
        />
      )}

      {/* Símbolo em alta definição (transparência perfeita) */}
      <img
        src="/assets/medcore-symbol-transparent.png"
        onError={(e) => {
          // Fallback caso o asset transparente falhe
          e.currentTarget.src = "/assets/medcore-symbol.png";
        }}
        alt="MedCore"
        className={cn(
          "w-auto shrink-0 object-contain relative z-10",
          sizeMap[size],
          animClass,
        )}
      />

      {/* Feixe Shimmer de assepsia/vidro médico */}
      {animated && variant === "shimmer" && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-20 pointer-events-none overflow-hidden rounded-full"
        >
          <div className="absolute inset-0 -translate-x-full animate-medcore-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-12" />
        </div>
      )}
    </div>
  );
}

/**
 * BrandLogo — Logo completa do MedCore com Símbolo Clínico Animado + Wordmark.
 */
export function BrandLogo({
  className,
  size = "normal",
  animated = true,
  variant = "pulse",
  symbolOnly = false,
}: {
  className?: string;
  size?: "normal" | "large";
  animated?: boolean;
  variant?: BrandSymbolVariant;
  symbolOnly?: boolean;
}) {
  if (symbolOnly) {
    return <BrandSymbol className={className} size={size} animated={animated} variant={variant} />;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 select-none overflow-hidden h-11 shrink-0 group",
        className,
      )}
    >
      <BrandSymbol
        size={size}
        animated={animated}
        variant={variant}
        interactive={false}
        className="group-hover:scale-105 transition-transform duration-300"
      />
      <img
        src="/assets/medcore-wordmark-v3.png"
        alt="MedCore"
        className={cn(
          "w-auto shrink-0 -ml-5 brightness-75 contrast-125 object-contain",
          size === "large" ? "h-[84px] md:h-[96px]" : "h-[72px] md:h-[82px]",
        )}
      />
    </div>
  );
}
