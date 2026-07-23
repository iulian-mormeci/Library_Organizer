import { detectDuplicates, DetectionLevel } from "@/lib/dedup";
import { pickBestTrack } from "@/lib/trackQuality";
import { DuplicateTrackRow, ClientTrack } from "@/components/DuplicateTrackRow";

export const dynamic = "force-dynamic";

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

function toClientTrack(track: Awaited<ReturnType<typeof detectDuplicates>>[number]["tracks"][number]): ClientTrack {
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

export default async function DuplicatesPage() {
  const groups = await detectDuplicates();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Duplicati</h1>
        <p className="mt-1 text-sm text-slate-400">
          {groups.length === 0
            ? "Nessun duplicato trovato."
            : `${groups.length} gruppi di duplicati trovati.`}
        </p>
      </section>

      {groups.map((group, idx) => {
        const best = pickBestTrack(group.tracks);
        return (
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
              <div className="text-sm text-slate-300">
                {group.tracks[0].artist ?? "?"} – {group.tracks[0].title ?? group.tracks[0].filename}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
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
                      track={toClientTrack(track)}
                      isBest={track.id === best.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
