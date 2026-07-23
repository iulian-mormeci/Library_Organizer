import { NextRequest, NextResponse } from "next/server";
import { detectDuplicates, DetectionLevel } from "@/lib/dedup";

const VALID_LEVELS: DetectionLevel[] = ["exact-hash", "fuzzy-metadata", "fingerprint"];

/**
 * GET /api/duplicates — computes duplicate groups at request time (no
 * persisted DuplicateGroup table: results always reflect the current DB
 * state and any tuning params passed as query string).
 *
 * Query params (all optional):
 *   level=exact-hash|fuzzy-metadata|fingerprint  (filter to one level)
 *   fuzzyThreshold=0..1
 *   durationTolerance=<seconds>
 *   fingerprintThreshold=0..1
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

  const fuzzyThreshold = parseFloatParam(params.get("fuzzyThreshold"));
  const durationToleranceSeconds = parseFloatParam(params.get("durationTolerance"));
  const fingerprintSimilarityThreshold = parseFloatParam(params.get("fingerprintThreshold"));

  const groups = await detectDuplicates({
    ...(fuzzyThreshold !== undefined && { fuzzyThreshold }),
    ...(durationToleranceSeconds !== undefined && { durationToleranceSeconds }),
    ...(fingerprintSimilarityThreshold !== undefined && { fingerprintSimilarityThreshold }),
  });

  const filtered = levelFilter ? groups.filter((g) => g.level === levelFilter) : groups;

  // Serialize BigInt fileSize fields (JSON.stringify chokes on BigInt).
  const payload = filtered.map((group) => ({
    level: group.level,
    confidence: group.confidence,
    tracks: group.tracks.map((t) => ({ ...t, fileSize: t.fileSize?.toString() ?? null })),
  }));

  return NextResponse.json({
    groupCount: payload.length,
    duplicateFileCount: payload.reduce((sum, g) => sum + g.tracks.length, 0),
    groups: payload,
  });
}

function parseFloatParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}
