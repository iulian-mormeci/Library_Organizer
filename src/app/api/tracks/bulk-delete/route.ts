import { NextRequest, NextResponse } from "next/server";
import { bulkDeleteTracks } from "@/lib/bulkDelete";
import { triggerDuplicateRecompute } from "@/lib/duplicateCompute";

// Defensive cap for direct API use — the duplicates page itself chunks
// selections into much smaller batches before calling this endpoint.
const MAX_TRACK_IDS = 2000;

/**
 * POST /api/tracks/bulk-delete — deletes multiple tracks (file + DB row) in
 * one call. See src/lib/bulkDelete.ts for the actual deletion mechanics
 * (concurrency, permission handling, partial-failure behavior).
 *
 * Body: { trackIds: string[], recompute?: boolean }
 *   recompute defaults to true. The duplicates page calls this endpoint
 *   once per chunk of a large selection and only wants the (fast but not
 *   free) duplicate recompute triggered once, after the last chunk — so it
 *   passes recompute: false on every chunk but the final one.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const rawTrackIds: unknown = body?.trackIds;

  if (
    !Array.isArray(rawTrackIds) ||
    rawTrackIds.length === 0 ||
    !rawTrackIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "Body must be { trackIds: string[] } with at least one id" },
      { status: 400 },
    );
  }

  if (rawTrackIds.length > MAX_TRACK_IDS) {
    return NextResponse.json({ error: `Too many trackIds (max ${MAX_TRACK_IDS})` }, { status: 400 });
  }

  const trackIds: string[] = rawTrackIds;
  const shouldRecompute = body?.recompute !== false;

  const { deleted, failed } = await bulkDeleteTracks(trackIds);

  if (shouldRecompute && deleted.length > 0) {
    const recomputeResult = await triggerDuplicateRecompute();
    if ("error" in recomputeResult) {
      console.warn("[api/tracks/bulk-delete] duplicate recompute not triggered:", recomputeResult.error);
    }
  }

  return NextResponse.json({ deleted, failed });
}
