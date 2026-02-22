import { Component } from "react";
import { Button } from "@/components/ui/button";

/**
 * Catches runtime errors in child tree, shows fallback UI, logs to console.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    // #region agent log
    try {
      fetch("http://127.0.0.1:7440/ingest/34831ccd-0439-498b-bff5-78886fda482e", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8283cd" },
        body: JSON.stringify({
          sessionId: "8283cd",
          location: "ErrorBoundary.jsx:componentDidCatch",
          message: "ErrorBoundary caught",
          data: { errorMessage: String(error?.message), componentStack: String(errorInfo?.componentStack || "").slice(0, 500) },
          timestamp: Date.now(),
          hypothesisId: "H_catch",
        }),
      }).catch(() => {});
    } catch (_) {}
    // #endregion
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const Fallback = this.props.fallback;
      if (Fallback) {
        return <Fallback error={this.state.error} onRetry={this.handleRetry} />;
      }
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center gap-4 p-6 bg-muted/30 rounded-lg border border-border">
          <p className="text-sm font-medium text-destructive">Something went wrong</p>
          <p className="text-xs text-muted-foreground text-center max-w-md">{this.state.error?.message}</p>
          <Button variant="outline" size="sm" onClick={this.handleRetry}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
