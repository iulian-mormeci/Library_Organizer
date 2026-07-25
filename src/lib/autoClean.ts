import { getPersistedDuplicateGroups } from "./duplicateCompute";
import { pickBestTrack } from "./trackQuality";

export interface AutoCleanPlanTrack {
  id: string;
  fileSize: string | null; // BigInt serialized as string, for transport to the client
}

export interface AutoCleanPlan {
  groupCount: number;
  tracks: AutoCleanPlanTrack[];
  bytesToFree: string;
}

/**
 * Computes which tracks auto-clean would delete: only groups detected by
 * exact SHA256 hash match (level "exact-hash") — hard-coded here, not a
 * parameter, because that's the entire safety guarantee of this feature.
 * Groups from fuzzy-metadata or fingerprint matching must never appear in
 * this plan; a caller can't accidentally widen it by passing a different
 * level, because there's no way to ask for one.
 *
 * For each group, every track except the one src/lib/trackQuality.ts picks
 * as "best" is added to the plan — same heuristic used for the UI's
 * "consigliata" badge, now made fully deterministic (see pickBestTrack) so
 * a preview and the actual deletion that follows it always agree on which
 * track survives.
 */
export async function computeAutoCleanPlan(): Promise<AutoCleanPlan> {
  const { groups } = await getPersistedDuplicateGroups("exact-hash");

  const tracks: AutoCleanPlanTrack[] = [];
  let bytesToFree = BigInt(0);

  for (const group of groups) {
    if (group.tracks.length < 2) continue; // defensive: shouldn't happen, getPersistedDuplicateGroups already filters these out
    const keep = pickBestTrack(group.tracks);

    for (const track of group.tracks) {
      if (track.id === keep.id) continue;
      const size = track.fileSize ?? BigInt(0);
      tracks.push({ id: track.id, fileSize: track.fileSize?.toString() ?? null });
      bytesToFree += size;
    }
  }

  return { groupCount: groups.length, tracks, bytesToFree: bytesToFree.toString() };
}
