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
          <div className="max-w-md w-full rounded-2xl border border-red-200 bg-white p-6 shadow-xl text-center">
            <div className="h-12 w-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-2">
              Ocorreu um imprevisto de execução
            </h3>
            <p className="text-xs text-gray-600 mb-6 leading-relaxed">
              O sistema protegeu sua sessão com segurança. Nenhuma informação de paciente foi afetada. Por favor, recarregue a página.
            </p>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#8B47FF] text-white text-xs font-semibold hover:bg-[#7A36EE] transition-colors shadow-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Recarregar Sistema
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
