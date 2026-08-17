import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/utils/cn";

type ConfirmOptions = {
  title?: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type Internal = ConfirmOptions & { resolve: (v: boolean) => void };

let opener: ((opts: Internal) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!opener) {
      // Fallback caso o host não esteja montado
      resolve(window.confirm(opts.description?.toString() ?? opts.title ?? "Confirmar?"));
      return;
    }
    opener({ ...opts, resolve });
  });
}

export function ConfirmDialogHost() {
  const [state, setState] = useState<Internal | null>(null);

  useEffect(() => {
    opener = (opts) => setState(opts);
    return () => {
      opener = null;
    };
  }, []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  const destructive = state?.destructive ?? true;

  return (
    <AlertDialog open={!!state} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title ?? "Tem certeza?"}</AlertDialogTitle>
          {state?.description && (
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {state?.cancelText ?? "Cancelar"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            className={cn(
              destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {state?.confirmText ?? "Excluir"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
