import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  size = "normal",
}: {
  className?: string;
  size?: "normal" | "large";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 select-none overflow-hidden h-11 shrink-0",
        className,
      )}
    >
      <img
        src="/assets/medcore-symbol.png"
        alt="MedCore"
        className={cn(
          "w-auto shrink-0 object-contain",
          size === "large" ? "h-11 md:h-12" : "h-9 md:h-10",
        )}
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
