"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

function formatBytes(bytes: string | null): string {
  if (!bytes) return "—";
  const n = Number(bytes);
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DuplicateTrackRow({
  track,
  isBest,
}: {
  track: ClientTrack;
  isBest: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  async function handleDelete() {
    if (!confirm(`Eliminare definitivamente il file?\n${track.path}`)) return;
    setPending(true);
    setError(null);

    // Network failure (server unreachable, connection reset, etc.) — fetch()
    // itself rejects here, before there's any Response to inspect.
    let res: Response;
    try {
      res = await fetch(`/api/tracks/${track.id}`, { method: "DELETE" });
    } catch {
      setError("Impossibile contattare il server. Controlla la connessione e riprova.");
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
      setError(data.error ?? `Eliminazione fallita (HTTP ${res.status})`);
      setPending(false);
      return;
    }

    setDeleted(true);
    setPending(false);
    router.refresh();
  }

  if (deleted) {
    return (
      <tr className="border-t border-slate-800 opacity-40">
        <td colSpan={6} className="py-2 text-sm italic text-slate-500">
          Eliminato: {track.path}
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-t border-slate-800 ${isBest ? "bg-emerald-950/30" : ""}`}>
      <td className="py-2 pr-4">
        {isBest && (
          <span className="mr-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
            consigliata
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
          {pending ? "Eliminazione…" : "Elimina"}
        </button>
        {error && <div className="mt-1 max-w-xs text-xs text-red-400">{error}</div>}
      </td>
    </tr>
  );
}
