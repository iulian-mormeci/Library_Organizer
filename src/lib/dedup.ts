import type { Track } from "@prisma/client";
import { prisma } from "./db";

export type DetectionLevel = "exact-hash" | "fuzzy-metadata" | "fingerprint";

export interface DuplicateGroup {
  level: DetectionLevel;
  /** Similarity score in [0,1] that triggered the match (1 for exact hash). */
  confidence: number;
  tracks: Track[];
}

export interface DedupOptions {
  /** Max Levenshtein distance (0-1, normalized by string length) to consider two "artist - title" strings a fuzzy match. Lower = stricter. */
  fuzzyThreshold: number;
  /** Max allowed difference (seconds) between track durations to compare them at all. */
  durationToleranceSeconds: number;
  /** Min fraction of matching bits between two raw Chromaprint fingerprints to call them duplicates. */
  fingerprintSimilarityThreshold: number;
}

export const DEFAULT_DEDUP_OPTIONS: DedupOptions = {
  fuzzyThreshold: 0.15,
  durationToleranceSeconds: 2,
  fingerprintSimilarityThreshold: 0.95,
};

// ---------------------------------------------------------------------------
// Level 1: exact hash
// ---------------------------------------------------------------------------

export function findExactHashDuplicates(tracks: Track[]): DuplicateGroup[] {
  const byHash = new Map<string, Track[]>();

  for (const track of tracks) {
    if (!track.fileHash) continue;
    const bucket = byHash.get(track.fileHash);
    if (bucket) bucket.push(track);
    else byHash.set(track.fileHash, [track]);
  }

  const groups: DuplicateGroup[] = [];
  for (const bucket of byHash.values()) {
    if (bucket.length > 1) {
      groups.push({ level: "exact-hash", confidence: 1, tracks: bucket });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Level 2: fuzzy metadata (normalized "artist - title" + Levenshtein)
// ---------------------------------------------------------------------------

/** Lowercases, strips punctuation and common noise tokens like "feat."/"remaster". */
export function normalizeForComparison(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/\(feat\.?[^)]*\)/g, "")
    .replace(/\bfeat\.?\s+[^-]+/g, "")
    .replace(/\bft\.?\s+[^-]+/g, "")
    .replace(/\b(remaster(ed)?|deluxe|bonus track|single|album)\b.*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  let currRow = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    currRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[b.length];
}

/** Normalized distance in [0,1]: 0 = identical, 1 = completely different. */
function normalizedLevenshtein(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return levenshteinDistance(a, b) / maxLen;
}

function trackSignature(track: Track): string {
  return `${normalizeForComparison(track.artist)} - ${normalizeForComparison(track.title)}`;
}

export function findFuzzyMetadataDuplicates(
  tracks: Track[],
  options: Pick<DedupOptions, "fuzzyThreshold"> = DEFAULT_DEDUP_OPTIONS,
): DuplicateGroup[] {
  const candidates = tracks.filter((t) => t.artist && t.title);
  const visited = new Set<string>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (visited.has(a.id)) continue;

    const sigA = trackSignature(a);
    const bucket: Track[] = [a];
    let worstSimilarity = 1;

    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (visited.has(b.id)) continue;

      const sigB = trackSignature(b);
      const distance = normalizedLevenshtein(sigA, sigB);

      if (distance <= options.fuzzyThreshold) {
        bucket.push(b);
        visited.add(b.id);
        worstSimilarity = Math.min(worstSimilarity, 1 - distance);
      }
    }

    if (bucket.length > 1) {
      visited.add(a.id);
      groups.push({ level: "fuzzy-metadata", confidence: worstSimilarity, tracks: bucket });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Level 3: audio fingerprint (Chromaprint raw fingerprint, Hamming distance)
// ---------------------------------------------------------------------------

function parseFingerprint(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function popcount32(x: number): number {
  let v = x - ((x >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  v = (v + (v >> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >> 24;
}

/** Fraction of matching bits [0,1] between two raw Chromaprint fingerprints, aligned from the start. */
export function fingerprintSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let matchingBits = 0;
  for (let i = 0; i < len; i++) {
    const xor = (a[i] ^ b[i]) >>> 0;
    matchingBits += 32 - popcount32(xor);
  }
  return matchingBits / (len * 32);
}

export function findFingerprintDuplicates(
  tracks: Track[],
  options: Pick<
    DedupOptions,
    "durationToleranceSeconds" | "fingerprintSimilarityThreshold"
  > = DEFAULT_DEDUP_OPTIONS,
): DuplicateGroup[] {
  const candidates = tracks
    .map((t) => ({ track: t, fp: parseFingerprint(t.fingerprint) }))
    .filter((c): c is { track: Track; fp: number[] } => c.fp !== null && c.fp.length > 0);

  // Sort by duration so we only need to scan a local window for candidates
  // within tolerance, instead of an O(n^2) scan over the whole library.
  candidates.sort((a, b) => (a.track.durationSeconds ?? 0) - (b.track.durationSeconds ?? 0));

  const visited = new Set<string>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (visited.has(a.track.id)) continue;

    const bucket: Track[] = [a.track];
    let worstSimilarity = 1;
    const durationA = a.track.durationSeconds ?? 0;

    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      const durationB = b.track.durationSeconds ?? 0;

      if (durationB - durationA > options.durationToleranceSeconds) break; // sorted, no more candidates possible
      if (visited.has(b.track.id)) continue;
      if (Math.abs(durationB - durationA) > options.durationToleranceSeconds) continue;

      const similarity = fingerprintSimilarity(a.fp, b.fp);
      if (similarity >= options.fingerprintSimilarityThreshold) {
        bucket.push(b.track);
        visited.add(b.track.id);
        worstSimilarity = Math.min(worstSimilarity, similarity);
      }
    }

    if (bucket.length > 1) {
      visited.add(a.track.id);
      groups.push({ level: "fingerprint", confidence: worstSimilarity, tracks: bucket });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Combined, cascading detection
// ---------------------------------------------------------------------------

/**
 * Runs the three levels in increasing order of cost, cheapest/most-certain
 * first. Tracks already grouped by a cheaper/stronger level are excluded
 * from the more expensive levels below, so the same pair of files isn't
 * reported three times over.
 */
export async function detectDuplicates(
  options: Partial<DedupOptions> = {},
): Promise<DuplicateGroup[]> {
  const opts = { ...DEFAULT_DEDUP_OPTIONS, ...options };
  const allTracks = await prisma.track.findMany();

  const exactGroups = findExactHashDuplicates(allTracks);
  const matchedByExact = new Set(exactGroups.flatMap((g) => g.tracks.map((t) => t.id)));

  const remainingAfterExact = allTracks.filter((t) => !matchedByExact.has(t.id));
  const fuzzyGroups = findFuzzyMetadataDuplicates(remainingAfterExact, opts);
  const matchedByFuzzy = new Set(fuzzyGroups.flatMap((g) => g.tracks.map((t) => t.id)));

  const remainingAfterFuzzy = remainingAfterExact.filter((t) => !matchedByFuzzy.has(t.id));
  const fingerprintGroups = findFingerprintDuplicates(remainingAfterFuzzy, opts);

  return [...exactGroups, ...fuzzyGroups, ...fingerprintGroups];
}
