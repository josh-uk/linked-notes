"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("workspace_render_error", { error: error.name });
  }, [error]);

  return (
    <main className="fatal-error" role="alert" aria-labelledby="fatal-title">
      <AlertTriangle size={28} aria-hidden="true" />
      <h1 id="fatal-title">The workspace could not be displayed</h1>
      <p>
        Your local data has not been changed. Retry the view, or reload Linked
        Notes if the problem continues.
      </p>
      <div>
        <button type="button" onClick={reset}>
          <RotateCcw size={16} aria-hidden="true" /> Retry
        </button>
        <button type="button" onClick={() => window.location.reload()}>
          Reload application
        </button>
      </div>
    </main>
  );
}
