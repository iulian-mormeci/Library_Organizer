import { NextRequest, NextResponse } from "next/server";
import { DetectionLevel } from "@/lib/dedup";
import { getPersistedDuplicateGroups } from "@/lib/duplicateCompute";

const VALID_LEVELS: DetectionLevel[] = ["exact-hash", "fuzzy-metadata", "fingerprint"];

/**
 * GET /api/duplicates — a pure read from the last persisted computation
 * (see src/lib/duplicateCompute.ts). Duplicate detection is too expensive
 * to run inside a request handler (pairwise comparisons over the whole
 * library block the event loop for minutes on a large collection), so this
 * endpoint never recomputes anything itself — trigger a recompute via
 * POST /api/duplicates/recompute instead.
 *
 * Query params:
 *   level=exact-hash|fuzzy-metadata|fingerprint  (filter to one level)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const levelFilter = params.get("level") as DetectionLevel | null;
  if (levelFilter && !VALID_LEVELS.includes(levelFilter)) {
    return NextResponse.json(
      { error: `Invalid level. Expected one of: ${VALID_LEVELS.join(", ")}` },
      { status: 400 },
    );
  }

  const { computedAt, groups } = await getPersistedDuplicateGroups(levelFilter ?? undefined);

  const payload = groups.map((group) => ({
    level: group.level,
    confidence: group.confidence,
    tracks: group.tracks.map((t) => ({ ...t, fileSize: t.fileSize?.toString() ?? null })),
  }));

  return NextResponse.json({
    computedAt,
    groupCount: payload.length,
    duplicateFileCount: payload.reduce((sum, g) => sum + g.tracks.length, 0),
    groups: payload,
  });
}
