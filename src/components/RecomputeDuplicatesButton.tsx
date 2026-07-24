"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface RecomputeJob {
  id: string;
  status: string;
  groupCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const POLL_INTERVAL_MS = 1500;

function formatDate(iso: string | null): string {
  if (!iso) return "mai";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function RecomputeDuplicatesButton({ initialJob }: { initialJob: RecomputeJob | null }) {
  const router = useRouter();
  const [job, setJob] = useState<RecomputeJob | null>(initialJob);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const isRunning = job?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;

    async function poll() {
      try {
        const json = await fetch("/api/duplicates/recompute").then((r) => r.json());
        if (cancelled) return;
        setJob(json.job);
        if (json.job?.status !== "running") {
          router.refresh();
        }
      } catch {
        // transient network hiccup, next tick retries
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isRunning, router]);

  async function startRecompute() {
    setStarting(true);
    setTriggerError(null);
    try {
      const res = await fetch("/api/duplicates/recompute", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTriggerError(data.error ?? `Impossibile avviare il ricalcolo (HTTP ${res.status})`);
        return;
      }
      setJob({
        id: data.jobId,
        status: "running",
        groupCount: job?.groupCount ?? 0,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });
    } catch {
      setTriggerError("Impossibile contattare il server. Controlla la connessione e riprova.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={startRecompute}
        disabled={starting || isRunning}
        className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? "Ricalcolo in corso…" : starting ? "Avvio…" : "Ricalcola duplicati"}
      </button>
      <span className="text-sm text-slate-400">
        {job?.status === "failed"
          ? `Ultimo ricalcolo fallito: ${job.error ?? "errore sconosciuto"}`
          : job
            ? `Ultimo calcolo: ${formatDate(job.finishedAt)} — ${job.groupCount} gruppi`
            : "Nessun calcolo eseguito ancora"}
      </span>
      {triggerError && <span className="text-sm text-red-400">{triggerError}</span>}
    </div>
  );
}
