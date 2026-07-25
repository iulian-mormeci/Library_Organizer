import { DuplicateGroup } from "@/lib/dedup";
import { getPersistedDuplicateGroups } from "@/lib/duplicateCompute";
import { pickBestTrack } from "@/lib/trackQuality";
import { ClientTrack } from "@/components/DuplicateTrackRow";
import { DuplicatesView, ClientGroup } from "@/components/DuplicatesView";

export const dynamic = "force-dynamic";

function toClientTrack(track: DuplicateGroup["tracks"][number]): ClientTrack {
  return {
    id: track.id,
    path: track.path,
    filename: track.filename,
    artist: track.artist,
    title: track.title,
    album: track.album,
    durationSeconds: track.durationSeconds,
    bitrate: track.bitrate,
    format: track.format,
    fileSize: track.fileSize?.toString() ?? null,
  };
}

function formatDate(date: Date | null): string {
  if (!date) return "mai";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default async function DuplicatesPage() {
  const { computedAt, groups } = await getPersistedDuplicateGroups();

  const clientGroups: ClientGroup[] = groups.map((group) => {
    const best = pickBestTrack(group.tracks);
    return {
      level: group.level,
      confidence: group.confidence,
      bestTrackId: best.id,
      tracks: group.tracks.map(toClientTrack),
    };
  });

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Duplicati</h1>
        <p className="mt-1 text-sm text-slate-400">
          {computedAt === null
            ? "Nessun calcolo duplicati eseguito ancora. Avvia una scansione dalla dashboard (il ricalcolo parte automaticamente al termine), oppure lancia un ricalcolo manuale."
            : groups.length === 0
              ? `Nessun duplicato trovato (ultimo calcolo: ${formatDate(computedAt)}).`
              : `${groups.length} gruppi di duplicati trovati (ultimo calcolo: ${formatDate(computedAt)}).`}
        </p>
      </section>

      <DuplicatesView initialGroups={clientGroups} />
    </div>
  );
}
