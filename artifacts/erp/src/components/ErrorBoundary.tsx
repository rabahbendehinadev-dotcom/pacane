import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="text-center max-w-md p-6">
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <h2 className="text-xl font-semibold text-destructive mb-2">Une erreur s'est produite</h2>
            <p className="text-sm text-muted-foreground mb-6">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
            >
              Recharger
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface PageState {
  hasError: boolean;
  error?: Error;
}

export class PageErrorBoundary extends Component<Props, PageState> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): PageState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("PageErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-8">
          <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <RefreshCw className="h-6 w-6 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">La page n'a pas pu se charger</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            Un problème temporaire est survenu. Cliquez sur <strong>Réessayer</strong> pour recharger la page.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { this.setState({ hasError: false, error: undefined }); }}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Réessayer
            </button>
            <button
              onClick={() => { window.location.href = "/"; }}
              className="flex items-center gap-2 px-4 py-2 border rounded-md text-sm hover:bg-muted transition-colors"
            >
              <Home className="h-3.5 w-3.5" />
              Tableau de bord
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
