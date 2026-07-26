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
  if (!date) return "never";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
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
        <h1 className="text-2xl font-semibold">Duplicates</h1>
        <p className="mt-1 text-sm text-slate-400">
          {computedAt === null
            ? "No duplicate scan has run yet. Start a scan from the dashboard (a recompute kicks off automatically once it finishes), or trigger a manual recompute."
            : groups.length === 0
              ? `No duplicates found (last computed: ${formatDate(computedAt)}).`
              : `${groups.length} duplicate groups found (last computed: ${formatDate(computedAt)}).`}
        </p>
      </section>

      <DuplicatesView initialGroups={clientGroups} />
    </div>
  );
}
