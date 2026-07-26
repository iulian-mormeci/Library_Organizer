import type { DuplicateGroup } from "./dedup";
import { isExactFingerprintMatch } from "./dedup";
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
 * The entire safety guarantee of auto-clean lives here: a group qualifies
 * only if it's an exact SHA256 hash match, or a fingerprint match whose
 * *worst* pairwise similarity is exactly EXACT_FINGERPRINT_SIMILARITY (see
 * isExactFingerprintMatch in dedup.ts) — every track pair in the group is
 * audio-identical, not merely very similar. Anything below that, even a
 * single point under the maximum (99.x%), and any fuzzy-metadata group
 * regardless of its score, is excluded and stays manual-review-only. This
 * is a hard boolean check, not a configurable threshold — there is no
 * parameter here a caller could loosen.
 */
function isAutoCleanEligible(group: DuplicateGroup): boolean {
  return group.level === "exact-hash" || isExactFingerprintMatch(group);
}

/**
 * Computes which tracks auto-clean would delete. Fetches every persisted
 * group (no level filter at the query level, since eligibility spans two
 * levels — see isAutoCleanEligible) and keeps only the ones that qualify.
 *
 * For each qualifying group, every track except the one
 * src/lib/trackQuality.ts picks as "best" is added to the plan — same
 * heuristic used for the UI's "recommended" badge, made fully deterministic
 * (see pickBestTrack) so a preview and the actual deletion that follows it
 * always agree on which track survives.
 */
export async function computeAutoCleanPlan(): Promise<AutoCleanPlan> {
  const { groups: allGroups } = await getPersistedDuplicateGroups();
  const groups = allGroups.filter(isAutoCleanEligible);

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
