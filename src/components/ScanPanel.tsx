"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface ScanStatus {
  id: string;
  status: string;
  totalFiles: number | null;
  processedFiles: number;
  currentFile: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

interface RecentTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  filename: string;
  format: string | null;
  updatedAt: string;
}

const POLL_INTERVAL_MS = 1500;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ScanPanel({ initialStatus }: { initialStatus: ScanStatus | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<ScanStatus | null>(initialStatus);
  const [tracks, setTracks] = useState<RecentTrack[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const isRunning = status?.status === "running";

  // Poll status + recent tracks only while a scan is actually running.
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;

    async function poll() {
      try {
        const [statusJson, tracksJson] = await Promise.all([
          fetch("/api/scan/status").then((r) => r.json()),
          fetch("/api/scan/recent-tracks?limit=20").then((r) => r.json()),
        ]);
        if (cancelled) return;

        setTracks(tracksJson.tracks ?? []);
        setStatus(statusJson.job);

        if (statusJson.job?.status !== "running") {
          // Scan just finished: refresh the server-rendered stats/history below.
          router.refresh();
        }
      } catch {
        // Transient network hiccup — the next tick will retry.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isRunning, router]);

  // Elapsed time ticks locally from startedAt, independent of the poll cadence.
  useEffect(() => {
    if (!isRunning || !status?.startedAt) return;
    const startedAtMs = new Date(status.startedAt).getTime();
    const tick = () => setElapsedSeconds((Date.now() - startedAtMs) / 1000);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRunning, status?.startedAt]);

  async function startScan() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStartError(data.error ?? "Error starting the scan");
        return;
      }

      // Fetch status right away so the panel switches to "running" without
      // waiting for the first poll tick — also handles the edge case of a
      // library so small the scan finishes before we even get here.
      const statusJson = await fetch("/api/scan/status").then((r) => r.json());
      setStatus(statusJson.job);
      setTracks([]);
      if (statusJson.job?.status !== "running") {
        router.refresh();
      }
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (!isRunning) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={startScan}
          disabled={starting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start new scan"}
        </button>
        {startError && <span className="text-sm text-red-400">{startError}</span>}
      </div>
    );
  }

  const percent =
    status.totalFiles && status.totalFiles > 0
      ? Math.min(100, Math.round((status.processedFiles / status.totalFiles) * 100))
      : null;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            {status.totalFiles !== null
              ? `${status.processedFiles} / ${status.totalFiles} files`
              : `${status.processedFiles} files processed…`}
          </span>
          <span className="tabular-nums">{formatElapsed(elapsedSeconds)}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          {percent !== null ? (
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-500" />
          )}
        </div>
        {status.currentFile && (
          <div className="mt-1 truncate text-xs text-slate-500">Processing: {status.currentFile}</div>
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-300">Recently found</div>
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/50 p-2 text-sm">
          {tracks.length === 0 && (
            <li className="text-slate-500">Waiting for the first results…</li>
          )}
          {tracks.map((track) => (
            <li key={track.id} className="truncate">
              <span className="text-slate-100">{track.title ?? track.filename}</span>
              {track.artist && <span className="text-slate-500"> — {track.artist}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
