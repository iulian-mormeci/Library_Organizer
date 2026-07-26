"use client";

import { useState } from "react";
import { formatBytes } from "@/lib/format";

export interface ClientTrack {
  id: string;
  path: string;
  filename: string;
  artist: string | null;
  title: string | null;
  album: string | null;
  durationSeconds: number | null;
  bitrate: number | null;
  format: string | null;
  fileSize: string | null; // BigInt serialized as string
}

export function DuplicateTrackRow({
  track,
  isBest,
  selected,
  onToggleSelect,
  onDeleted,
}: {
  track: ClientTrack;
  isBest: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** Called once the single-file delete below succeeds — the parent owns removing this track from its group/selection state. */
  onDeleted: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm(`Permanently delete this file?\n${track.path}`)) return;
    setPending(true);
    setError(null);

    // Network failure (server unreachable, connection reset, etc.) — fetch()
    // itself rejects here, before there's any Response to inspect.
    let res: Response;
    try {
      res = await fetch(`/api/tracks/${track.id}`, { method: "DELETE" });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setPending(false);
      return;
    }

    // The body may not be valid JSON (e.g. a proxy/HTML error page for a
    // 502/504) — don't let a parse failure here throw past this handler.
    let data: { error?: string } = {};
    try {
      data = await res.json();
    } catch {
      // fall through, we still have res.ok / res.status to report on
    }

    if (!res.ok) {
      setError(data.error ?? `Delete failed (HTTP ${res.status})`);
      setPending(false);
      return;
    }

    onDeleted(track.id);
  }

  return (
    <tr className={`border-t border-slate-800 ${isBest ? "bg-emerald-950/30" : ""}`}>
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-emerald-600"
          aria-label={`Select ${track.filename}`}
        />
      </td>
      <td className="py-2 pr-4">
        {isBest && (
          <span className="mr-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
            recommended
          </span>
        )}
        <span className="break-all text-slate-300">{track.path}</span>
      </td>
      <td className="py-2 pr-4 uppercase text-slate-400">{track.format ?? "—"}</td>
      <td className="py-2 pr-4 text-slate-400">
        {track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : "—"}
      </td>
      <td className="py-2 pr-4 text-slate-400">{formatBytes(track.fileSize)}</td>
      <td className="py-2 pr-4 text-slate-400">
        {track.durationSeconds ? `${Math.round(track.durationSeconds)}s` : "—"}
      </td>
      <td className="py-2 pr-4">
        <button
          onClick={handleDelete}
          disabled={pending}
          className="rounded-md border border-red-800 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-900/40 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
        {error && <div className="mt-1 max-w-xs text-xs text-red-400">{error}</div>}
      </td>
    </tr>
  );
}
