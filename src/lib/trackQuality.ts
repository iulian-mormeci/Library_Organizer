import type { Track } from "@prisma/client";

const LOSSLESS_FORMATS = new Set(["flac", "wav", "ape", "wv", "alac"]);

/**
 * Picks the track most likely worth keeping within a duplicate group:
 * lossless beats lossy, then higher bitrate, then larger file size as a
 * final tiebreaker (more data usually means less aggressive encoding).
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
    return bSize > aSize ? 1 : bSize < aSize ? -1 : 0;
  })[0];
}
