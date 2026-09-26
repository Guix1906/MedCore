import { cn } from "@/lib/utils";

export type BrandSymbolSize = "small" | "normal" | "large" | "xl";

export interface BrandSymbolProps {
  className?: string;
  size?: BrandSymbolSize;
  interactive?: boolean;
}

/**
 * BrandSymbol — Símbolo Clínico Exclusivo MedCore ("Logo P" / Cruz Interligada).
 * Design limpo, 100% transparente, sem fundos azuis ou borrões.
 * Movimento interativo fluido ao passar o mouse (hover micro-interaction).
 */
export function BrandSymbol({
  className,
  size = "normal",
  interactive = true,
}: BrandSymbolProps) {
  const sizeMap: Record<BrandSymbolSize, string> = {
    small: "h-7 w-7",
    normal: "h-9 w-9 md:h-10 md:w-10",
    large: "h-11 w-11 md:h-12 md:w-12",
    xl: "h-16 w-16 md:h-20 md:w-20",
  };

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 select-none bg-transparent",
        interactive &&
          "transition-transform duration-300 ease-out hover:scale-110 hover:-translate-y-0.5 active:scale-95 cursor-pointer",
        className,
      )}
      title="MedCore Saúde"
    >
      <img
        src="/assets/medcore-symbol-transparent.png"
        onError={(e) => {
          e.currentTarget.src = "/assets/medcore-symbol.png";
        }}
        alt="MedCore Símbolo"
        className={cn(
          "w-auto shrink-0 object-contain bg-transparent transition-transform duration-300",
          sizeMap[size],
        )}
      />
    </div>
  );
}

/**
 * BrandLogo — Identidade MedCore completa (Símbolo Clínico + Wordmark).
 * Fundo limpo, acompanhado da palavra MedCore, com animação refinada de hover no cursor.
 */
export function BrandLogo({
  className,
  size = "normal",
  symbolOnly = false,
}: {
  className?: string;
  size?: "normal" | "large";
  symbolOnly?: boolean;
}) {
  if (symbolOnly) {
    return <BrandSymbol className={className} size={size} />;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 select-none overflow-hidden h-11 shrink-0 group bg-transparent cursor-pointer",
        className,
      )}
    >
      <BrandSymbol
        size={size}
        interactive={false}
        className="group-hover:scale-110 group-hover:-translate-y-0.5 transition-transform duration-300 ease-out"
      />
      <img
        src="/assets/medcore-wordmark-v3.png"
        alt="MedCore"
        className={cn(
          "w-auto shrink-0 -ml-5 brightness-75 contrast-125 object-contain bg-transparent transition-all duration-300 group-hover:brightness-95",
          size === "large" ? "h-[84px] md:h-[96px]" : "h-[72px] md:h-[82px]",
        )}
      />
    </div>
  );
}
