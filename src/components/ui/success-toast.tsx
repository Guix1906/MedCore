import { toast } from "sonner";
import { CheckCircle2, Info, X } from "lucide-react";

const DURATION = 4000;

/** Aviso de sucesso: cartão branco, ícone verde, botão fechar e barra de tempo. */
export function showSuccessToast(
  title: string,
  description?: string,
  variant: "success" | "info" = "success",
) {
  const Icon = variant === "info" ? Info : CheckCircle2;
  toast.custom(
    (id) => (
      <div className="relative w-[356px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-start gap-3 p-4 pr-10">
          <Icon
            className={`mt-0.5 h-6 w-6 shrink-0 ${variant === "info" ? "text-primary" : "text-emerald-500"}`}
          />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">{title}</p>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => toast.dismiss(id)}
          aria-label="Fechar"
          className="absolute right-2.5 top-2.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div
          className={`absolute bottom-0 left-0 h-1 w-full origin-left ${variant === "info" ? "bg-primary/70" : "bg-emerald-400"}`}
          style={{ animation: `success-toast-progress ${DURATION}ms linear forwards` }}
        />
        <style>{`@keyframes success-toast-progress{from{transform:scaleX(1)}to{transform:scaleX(0)}}`}</style>
      </div>
    ),
    { duration: DURATION, unstyled: true },
  );
}
