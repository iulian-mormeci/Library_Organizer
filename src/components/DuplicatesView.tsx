"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DetectionLevel } from "@/lib/dedup";
import { DuplicateTrackRow, ClientTrack } from "./DuplicateTrackRow";

export interface ClientGroup {
  level: DetectionLevel;
  confidence: number;
  bestTrackId: string;
  tracks: ClientTrack[];
}

interface BulkDeleteResult {
  deletedCount: number;
  failed: Array<{ id: string; error: string }>;
}

const LEVEL_LABELS: Record<DetectionLevel, string> = {
  "exact-hash": "Hash identico (copia byte-per-byte)",
  "fuzzy-metadata": "Metadati simili (artista/titolo)",
  fingerprint: "Fingerprint audio simile",
};

const LEVEL_STYLES: Record<DetectionLevel, string> = {
  "exact-hash": "bg-red-500/20 text-red-300",
  "fuzzy-metadata": "bg-amber-500/20 text-amber-300",
  fingerprint: "bg-sky-500/20 text-sky-300",
};

// Client-side chunking is what makes "120/300 elaborate" progress possible
// from an endpoint whose contract is a plain synchronous summary response
// (no persisted job to poll, unlike the scan feature) — each chunk is one
// POST to bulk-delete, and the server applies its own bounded concurrency
// (5 workers) within each chunk.
const BULK_DELETE_BATCH_SIZE = 20;

export function DuplicatesView({ initialGroups }: { initialGroups: ClientGroup[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [lastResult, setLastResult] = useState<BulkDeleteResult | null>(null);

  const selectedCount = selected.size;

  function toggleTrack(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllExceptBest(group: ClientGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const track of group.tracks) {
        if (track.id !== group.bestTrackId) next.add(track.id);
      }
      return next;
    });
  }

  function deselectAll() {
    setSelected(new Set());
  }

  function removeTracksFromView(ids: Set<string>) {
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, tracks: g.tracks.filter((t) => !ids.has(t.id)) }))
        .filter((g) => g.tracks.length > 1),
    );
    setSelected((prev) => {
      if (![...ids].some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  function handleSingleDeleted(id: string) {
    removeTracksFromView(new Set([id]));
    router.refresh();
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Eliminare ${ids.length} tracce selezionate? Questa azione non è reversibile.`)) return;

    setDeleting(true);
    setLastResult(null);
    setProgress({ processed: 0, total: ids.length });

    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += BULK_DELETE_BATCH_SIZE) {
      batches.push(ids.slice(i, i + BULK_DELETE_BATCH_SIZE));
    }

    const deletedAll: string[] = [];
    const failedAll: Array<{ id: string; error: string }> = [];
    let processedCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const isLastBatch = i === batches.length - 1;

      try {
        const res = await fetch("/api/tracks/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackIds: batch, recompute: isLastBatch }),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok || !data) {
          const message = data?.error ?? `HTTP ${res.status}`;
          for (const id of batch) failedAll.push({ id, error: message });
        } else {
          deletedAll.push(...data.deleted);
          for (const f of data.failed as Array<{ id: string; error: string }>) {
            failedAll.push({ id: f.id, error: f.error });
          }
        }
      } catch (err) {
        const message = (err as Error).message || "Impossibile contattare il server";
        for (const id of batch) failedAll.push({ id, error: message });
      }

      processedCount += batch.length;
      setProgress({ processed: processedCount, total: ids.length });
    }

    removeTracksFromView(new Set(deletedAll));
    setLastResult({ deletedCount: deletedAll.length, failed: failedAll });
    setProgress(null);
    setDeleting(false);
    router.refresh();
  }

  return (
    <div className="space-y-8 pb-24">
      {lastResult && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            lastResult.failed.length === 0
              ? "border-emerald-800 bg-emerald-950/30 text-emerald-200"
              : "border-amber-800 bg-amber-950/30 text-amber-200"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              {lastResult.failed.length === 0 ? (
                <>{lastResult.deletedCount} tracce eliminate con successo.</>
              ) : (
                <>
                  {lastResult.deletedCount} eliminate, {lastResult.failed.length} fallite.
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-300/90">
                    {lastResult.failed.slice(0, 10).map((f) => (
                      <li key={f.id} className="break-all">
                        {f.error}
                      </li>
                    ))}
                    {lastResult.failed.length > 10 && <li>… e altre {lastResult.failed.length - 10}.</li>}
                  </ul>
                </>
              )}
            </div>
            <button
              onClick={() => setLastResult(null)}
              className="shrink-0 text-xs underline hover:text-white"
            >
              Chiudi
            </button>
          </div>
        </div>
      )}

      {groups.map((group, idx) => (
        <section key={idx} className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEVEL_STYLES[group.level]}`}>
                {LEVEL_LABELS[group.level]}
              </span>
              <span className="text-xs text-slate-500">
                confidenza {(group.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-300">
                {group.tracks[0].artist ?? "?"} – {group.tracks[0].title ?? group.tracks[0].filename}
              </span>
              {group.tracks.length > 2 && (
                <button
                  onClick={() => selectAllExceptBest(group)}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Seleziona tutte tranne la consigliata
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="w-8 pb-2 pr-2"></th>
                  <th className="pb-2 pr-4">Percorso</th>
                  <th className="pb-2 pr-4">Formato</th>
                  <th className="pb-2 pr-4">Bitrate</th>
                  <th className="pb-2 pr-4">Dimensione</th>
                  <th className="pb-2 pr-4">Durata</th>
                  <th className="pb-2 pr-4">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {group.tracks.map((track) => (
                  <DuplicateTrackRow
                    key={track.id}
                    track={track}
                    isBest={track.id === group.bestTrackId}
                    selected={selected.has(track.id)}
                    onToggleSelect={() => toggleTrack(track.id)}
                    onDeleted={handleSingleDeleted}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {selectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-900/95 px-6 py-4 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-200">
              {deleting && progress
                ? `Eliminazione in corso: ${progress.processed}/${progress.total}`
                : `${selectedCount} tracce selezionate`}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={deselectAll}
                disabled={deleting}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Deseleziona tutto
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Eliminazione…" : `Elimina selezionate (${selectedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
