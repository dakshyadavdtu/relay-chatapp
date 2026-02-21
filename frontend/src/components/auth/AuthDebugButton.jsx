/**
 * DEV-only: "Why did I get logged out?" self-diagnostic.
 * Only active when VITE_ENABLE_DEV_TOOLS=true (default OFF).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Bug } from 'lucide-react';

const ENABLE_DEV_TOOLS = typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENABLE_DEV_TOOLS === 'true';

export function AuthDebugButton() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runDiagnostic = async () => {
    if (!ENABLE_DEV_TOOLS) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
      const res = await fetch(`${base}/api/dev/debug/auth`, { method: 'GET', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setResult(data);
    } catch (e) {
      const msg = e?.message || 'Request failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!ENABLE_DEV_TOOLS) return null;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={runDiagnostic}
        disabled={loading}
        className="gap-2 text-muted-foreground"
        aria-label="Run auth diagnostic"
      >
        <Bug className="w-4 h-4" />
        {loading ? 'Loading…' : 'Why did I get logged out?'}
      </Button>
      {(result || error) && (
        <pre
          className="text-xs p-3 rounded bg-muted/80 border border-border overflow-auto max-h-48 font-mono"
          role="status"
        >
          {error ? String(error) : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
