"use client";

import { useEffect } from "react";

// Next.js route-segment error boundary: catches any exception thrown while
// rendering /duplicates (or its client components) and shows this instead
// of the generic "Application error: a client-side exception has occurred".
export default function DuplicatesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[duplicates] unhandled render error:", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-red-900 bg-red-950/30 p-6">
      <h2 className="text-lg font-medium text-red-300">Couldn&apos;t display duplicates</h2>
      <p className="mt-2 text-sm text-red-200/80">
        An unexpected error occurred while loading the page.
        {error.message && <> Details: {error.message}</>}
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-md border border-red-700 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/40"
      >
        Retry
      </button>
    </div>
  );
}
