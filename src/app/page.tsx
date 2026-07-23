import { prisma } from "@/lib/db";
import { ScanPanel, ScanStatus } from "@/components/ScanPanel";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null): string {
  if (!date) return "mai";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: "bg-amber-500/20 text-amber-300",
    completed: "bg-emerald-500/20 text-emerald-300",
    failed: "bg-red-500/20 text-red-300",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-slate-700 text-slate-300"}`}>
      {status}
    </span>
  );
}

export default async function DashboardPage() {
  const [trackCount, lastJob, recentJobs] = await Promise.all([
    prisma.track.count(),
    prisma.scanJob.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.scanJob.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
  ]);

  const initialStatus: ScanStatus | null = lastJob
    ? {
        id: lastJob.id,
        status: lastJob.status,
        totalFiles: lastJob.totalFiles,
        processedFiles: lastJob.processedFiles,
        currentFile: lastJob.currentFile,
        startedAt: lastJob.startedAt.toISOString(),
        finishedAt: lastJob.finishedAt?.toISOString() ?? null,
        error: lastJob.error,
      }
    : null;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Stato della libreria musicale.</p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="text-sm text-slate-400">Tracce indicizzate</div>
          <div className="mt-1 text-3xl font-semibold">{trackCount.toLocaleString("it-IT")}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="text-sm text-slate-400">Ultima scansione</div>
          <div className="mt-1 text-lg font-medium">{formatDate(lastJob?.startedAt ?? null)}</div>
          {lastJob && (
            <div className="mt-1">
              <StatusBadge status={lastJob.status} />
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-medium">Scansione</h2>
        <p className="mt-1 text-sm text-slate-400">
          Avvia una scansione del percorso configurato in <code>LIBRARY_PATH</code>. Viene eseguita
          in background: puoi lasciare questa pagina e tornare più tardi, oppure seguirne
          l&apos;avanzamento qui in tempo reale.
        </p>
        <div className="mt-4">
          <ScanPanel initialStatus={initialStatus} />
        </div>
      </section>

      {recentJobs.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-medium">Scansioni recenti</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-2 pr-4">Avviata</th>
                  <th className="pb-2 pr-4">Stato</th>
                  <th className="pb-2 pr-4">Trovati</th>
                  <th className="pb-2 pr-4">Aggiunti</th>
                  <th className="pb-2 pr-4">Aggiornati</th>
                  <th className="pb-2 pr-4">Falliti</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id} className="border-t border-slate-800">
                    <td className="py-2 pr-4">{formatDate(job.startedAt)}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="py-2 pr-4">{job.filesFound}</td>
                    <td className="py-2 pr-4">{job.filesAdded}</td>
                    <td className="py-2 pr-4">{job.filesUpdated}</td>
                    <td className="py-2 pr-4">{job.filesFailed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
