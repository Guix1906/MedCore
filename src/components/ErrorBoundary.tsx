import { Component, type ErrorInfo, type ReactNode } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log seguro sem expor credenciais ou stack traces sensíveis no console do cliente
    console.error("ErrorBoundary capturou uma exceção:", error.message, errorInfo.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] w-full flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-destructive/25 bg-card p-6 shadow-xl text-center">
            <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-2">
              Ocorreu um imprevisto de execução
            </h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              O sistema protegeu sua sessão com segurança. Nenhuma informação de paciente foi
              afetada. Por favor, recarregue a página ou tente novamente.
            </p>
            {this.state.error?.message && (
              <details className="mb-5 text-left text-xs bg-muted/40 p-2.5 rounded-xl border border-border">
                <summary className="cursor-pointer text-muted-foreground font-mono text-[11px] select-none hover:text-foreground">
                  Detalhes do imprevisto
                </summary>
                <p className="mt-1.5 font-mono text-destructive text-[11px] break-all leading-normal">
                  {this.state.error.message}
                </p>
              </details>
            )}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => this.setState({ hasError: false, error: undefined })}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-border bg-card text-foreground text-xs font-semibold hover:bg-muted transition-colors shadow-xs"
              >
                Tentar novamente
              </button>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors shadow-sm"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Recarregar Sistema
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
