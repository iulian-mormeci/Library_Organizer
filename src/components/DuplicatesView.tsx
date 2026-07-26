"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DetectionLevel } from "@/lib/dedup";
import { formatBytes } from "@/lib/format";
import { DuplicateTrackRow, ClientTrack } from "./DuplicateTrackRow";

export interface ClientGroup {
  level: DetectionLevel;
  confidence: number;
  bestTrackId: string;
  tracks: ClientTrack[];
}

interface DeleteSummary {
  deletedCount: number;
  failed: Array<{ id: string; error: string }>;
  bytesFreed?: string;
}

interface AutoCleanPreview {
  groupCount: number;
  tracks: Array<{ id: string; fileSize: string | null }>;
  bytesToFree: string;
}

// The "confidence" number means something different per level (it's always
// exactly 1 for exact-hash — a hash either matches or it doesn't, there's
// no gradation — but it's a Hamming similarity for fingerprint and
// 1-minus-normalized-Levenshtein for fuzzy-metadata, both of which can
// legitimately read 99-100% for files that are NOT byte-identical, e.g. the
// same recording losslessly re-encoded with different tags). Labeling all
// three as a generic "confidence X%" made a fingerprint match look exactly
// as authoritative as an actual hash match, which mattered a lot once
// auto-clean started also touching fingerprint groups — but only the ones
// at exactly 100%, never 95-99%.
//
// This mirrors isAutoCleanEligible in src/lib/autoClean.ts (which is the
// actual authority — this is UI-only) as a plain literal comparison rather
// than an import: dedup.ts pulls in the Prisma client, which can't be part
// of a client component's bundle.
function isAutoCleanEligibleClient(group: ClientGroup): boolean {
  return group.level === "exact-hash" || (group.level === "fingerprint" && group.confidence === 1);
}

function groupLabel(group: ClientGroup): string {
  if (group.level === "exact-hash") return "Identical byte-for-byte";
  if (group.level === "fingerprint") {
    return group.confidence === 1 ? "Identical audio (fingerprint 100%)" : "Same audio — similar fingerprint";
  }
  return "Likely duplicate — similar metadata";
}

function groupStyle(group: ClientGroup): string {
  if (isAutoCleanEligibleClient(group)) return "bg-emerald-500/20 text-emerald-300";
  if (group.level === "fingerprint") return "bg-sky-500/20 text-sky-300";
  return "bg-amber-500/20 text-amber-300";
}

function levelMetricLabel(group: ClientGroup): string {
  switch (group.level) {
    case "exact-hash":
      return "matching SHA256 hash — exact copy, zero ambiguity";
    case "fingerprint":
      return group.confidence === 1
        ? "audio similarity: 100% — no perceptible difference detected"
        : `audio similarity (fingerprint): ${(group.confidence * 100).toFixed(0)}%`;
    case "fuzzy-metadata":
      return `text similarity (artist/title): ${(group.confidence * 100).toFixed(0)}%`;
  }
}

// Client-side chunking is what makes "120/300 processed" progress possible
// from an endpoint whose contract is a plain synchronous summary response
// (no persisted job to poll, unlike the scan feature) — each chunk is one
// POST to bulk-delete, and the server applies its own bounded concurrency
// (5 workers) within each chunk. Auto-clean reuses this exact same path
// once its own preview has been confirmed, instead of duplicating it.
const BULK_DELETE_BATCH_SIZE = 20;

export function DuplicatesView({ initialGroups }: { initialGroups: ClientGroup[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [lastResult, setLastResult] = useState<DeleteSummary | null>(null);

  const [autoCleanLoading, setAutoCleanLoading] = useState(false);
  const [autoCleanPreview, setAutoCleanPreview] = useState<AutoCleanPreview | null>(null);
  const [autoCleanMessage, setAutoCleanMessage] = useState<string | null>(null);

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

  /**
   * Shared by manual bulk-delete and auto-clean: chunks `ids` and posts
   * them to /api/tracks/bulk-delete sequentially, updating progress between
   * chunks, then folds the result into the shared groups/selection/summary
   * state. Returns the raw deleted/failed lists so a caller (auto-clean)
   * can compute its own bytes-freed total from them.
   */
  async function runBatchDelete(ids: string[]): Promise<{
    deletedAll: string[];
    failedAll: Array<{ id: string; error: string }>;
  }> {
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
        const message = (err as Error).message || "Couldn't reach the server";
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

    return { deletedAll, failedAll };
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected tracks? This action cannot be undone.`)) return;
    await runBatchDelete(ids);
  }

  async function loadAutoCleanPreview() {
    setAutoCleanLoading(true);
    setAutoCleanMessage(null);
    setAutoCleanPreview(null);
    try {
      const res = await fetch("/api/duplicates/auto-clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setAutoCleanMessage(data?.error ?? `Couldn't compute the preview (HTTP ${res.status})`);
        return;
      }
      if (data.tracks.length === 0) {
        setAutoCleanMessage(
          "No safe duplicates (matching hash or 100% identical audio) to delete right now.",
        );
        return;
      }
      setAutoCleanPreview(data);
    } catch (err) {
      setAutoCleanMessage((err as Error).message || "Couldn't reach the server");
    } finally {
      setAutoCleanLoading(false);
    }
  }

  async function confirmAutoClean() {
    if (!autoCleanPreview) return;
    const preview = autoCleanPreview;
    setAutoCleanPreview(null);

    const ids = preview.tracks.map((t) => t.id);
    const sizeById = new Map(preview.tracks.map((t) => [t.id, t.fileSize ? BigInt(t.fileSize) : BigInt(0)]));

    const { deletedAll } = await runBatchDelete(ids);

    const bytesFreed = deletedAll.reduce((sum, id) => sum + (sizeById.get(id) ?? BigInt(0)), BigInt(0));
    setLastResult((prev) => (prev ? { ...prev, bytesFreed: bytesFreed.toString() } : prev));
  }

  return (
    <div className="space-y-8 pb-24">
      <section className="rounded-lg border border-emerald-900 bg-emerald-950/20 p-5">
        <h2 className="text-lg font-medium text-emerald-100">Automatic duplicate cleanup</h2>
        <p className="mt-1 text-sm text-emerald-200/70">
          Automatically deletes duplicates that are identical byte-for-byte or have 100% identical audio
          (fingerprint), always keeping the best copy. 100% safe, no ambiguity: any group with less than
          100% similarity — even by a single percentage point, whether fingerprint or metadata — is never
          touched by this button and stays below for manual review.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={loadAutoCleanPreview}
            disabled={autoCleanLoading || deleting}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {autoCleanLoading ? "Computing preview…" : "Clean up duplicates automatically"}
          </button>
          {autoCleanMessage && <span className="text-sm text-emerald-200/70">{autoCleanMessage}</span>}
        </div>

        {autoCleanPreview && (
          <div className="mt-4 rounded-md border border-emerald-800 bg-emerald-950/40 p-4">
            <div className="text-sm text-emerald-100">
              <strong>{autoCleanPreview.groupCount}</strong> groups,{" "}
              <strong>{autoCleanPreview.tracks.length}</strong> tracks will be deleted,{" "}
              <strong>{formatBytes(autoCleanPreview.bytesToFree)}</strong> freed. The best copy of each
              group (lossless format &gt; bitrate &gt; file size) is always kept.
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={confirmAutoClean}
                disabled={deleting}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm and delete {autoCleanPreview.tracks.length} tracks
              </button>
              <button
                onClick={() => setAutoCleanPreview(null)}
                disabled={deleting}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

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
                <>
                  {lastResult.deletedCount} tracks deleted successfully
                  {lastResult.bytesFreed && <> — {formatBytes(lastResult.bytesFreed)} freed</>}.
                </>
              ) : (
                <>
                  {lastResult.deletedCount} deleted
                  {lastResult.bytesFreed && <> ({formatBytes(lastResult.bytesFreed)} freed)</>},{" "}
                  {lastResult.failed.length} failed.
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-300/90">
                    {lastResult.failed.slice(0, 10).map((f) => (
                      <li key={f.id} className="break-all">
                        {f.error}
                      </li>
                    ))}
                    {lastResult.failed.length > 10 && <li>… and {lastResult.failed.length - 10} more.</li>}
                  </ul>
                </>
              )}
            </div>
            <button
              onClick={() => setLastResult(null)}
              className="shrink-0 text-xs underline hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {groups.map((group, idx) => (
        <section key={idx} className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${groupStyle(group)}`}>
                {groupLabel(group)}
              </span>
              <span className="text-xs text-slate-500">{levelMetricLabel(group)}</span>
              {isAutoCleanEligibleClient(group) ? (
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  covered by automatic cleanup
                </span>
              ) : (
                <span className="rounded bg-slate-700/40 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                  needs manual review
                </span>
              )}
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
                  Select all except the recommended copy
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="w-8 pb-2 pr-2"></th>
                  <th className="pb-2 pr-4">Path</th>
                  <th className="pb-2 pr-4">Format</th>
                  <th className="pb-2 pr-4">Bitrate</th>
                  <th className="pb-2 pr-4">Size</th>
                  <th className="pb-2 pr-4">Duration</th>
                  <th className="pb-2 pr-4">Actions</th>
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

      {(selectedCount > 0 || deleting) && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-900/95 px-6 py-4 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-200">
              {deleting && progress
                ? `Deleting: ${progress.processed}/${progress.total}`
                : `${selectedCount} tracks selected`}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={deselectAll}
                disabled={deleting || selectedCount === 0}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Deselect all
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={deleting || selectedCount === 0}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting…" : `Delete selected (${selectedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
