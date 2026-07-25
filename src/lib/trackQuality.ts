import type { Track } from "@prisma/client";

const LOSSLESS_FORMATS = new Set(["flac", "wav", "ape", "wv", "alac"]);

/**
 * Picks the track most likely worth keeping within a duplicate group:
 * lossless beats lossy, then higher bitrate, then larger file size as a
 * tiebreaker (more data usually means less aggressive encoding). Exact-hash
 * duplicates (byte-identical files) will always tie on all three — for
 * those, and any other full tie, the shortest path wins as a final,
 * deterministic tiebreaker, so the result never depends on scan/array
 * ordering (important for auto-clean, which relies on this being stable
 * across the preview and the actual deletion).
 */
export function pickBestTrack(tracks: Track[]): Track {
  return [...tracks].sort((a, b) => {
    const aLossless = LOSSLESS_FORMATS.has((a.format ?? "").toLowerCase()) ? 1 : 0;
    const bLossless = LOSSLESS_FORMATS.has((b.format ?? "").toLowerCase()) ? 1 : 0;
    if (aLossless !== bLossless) return bLossless - aLossless;

    const bitrateDiff = (b.bitrate ?? 0) - (a.bitrate ?? 0);
    if (bitrateDiff !== 0) return bitrateDiff;

    const aSize = a.fileSize ?? BigInt(0);
    const bSize = b.fileSize ?? BigInt(0);
    if (aSize !== bSize) return bSize > aSize ? 1 : -1;

    return a.path.length - b.path.length;
  })[0];
}
