"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ScanButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function startScan() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Errore durante l'avvio della scansione");
      } else {
        setMessage("Scansione avviata in background.");
        router.refresh();
      }
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={startScan}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Avvio in corso…" : "Avvia nuova scansione"}
      </button>
      {message && <span className="text-sm text-slate-400">{message}</span>}
    </div>
  );
}
