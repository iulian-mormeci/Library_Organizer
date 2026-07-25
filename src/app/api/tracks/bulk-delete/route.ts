import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFileIfPossible } from "@/lib/deleteFile";
import { triggerDuplicateRecompute } from "@/lib/duplicateCompute";

// Mirrors the worker-pool pattern in src/lib/scanner.ts: a shared cursor
// plus a fixed number of concurrent workers, instead of unbounded
// Promise.all (which could open hundreds of simultaneous NFS file
// operations) or a fully sequential loop (too slow for large selections).
const CONCURRENCY = 5;

// Defensive cap for direct API use — the duplicates page itself chunks
// selections into much smaller batches before calling this endpoint.
const MAX_TRACK_IDS = 2000;

interface FailedDeletion {
  id: string;
  error: string;
  code?: string;
}

/**
 * POST /api/tracks/bulk-delete — deletes multiple tracks (file + DB row) in
 * one call. A failure on one track never aborts the rest of the batch: the
 * response always reports every id's outcome individually.
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

  const tracks = await prisma.track.findMany({ where: { id: { in: trackIds } } });
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const deleted: string[] = [];
  const failed: FailedDeletion[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < trackIds.length) {
      const id = trackIds[cursor];
      cursor += 1;

      const track = trackById.get(id);
      if (!track) {
        failed.push({ id, error: "Track not found" });
        continue;
      }

      const result = await deleteFileIfPossible(track.path);

      if (!result.ok) {
        const error =
          result.reason === "read-only-mount"
            ? "Mount read-only (EROFS) — set LIBRARY_MOUNT_MODE=rw"
            : result.reason === "permission-denied"
              ? "Permessi negati"
              : result.message;
        failed.push({ id, error, code: "code" in result ? result.code : undefined });
        continue;
      }

      await prisma.track.delete({ where: { id: track.id } });
      deleted.push(id);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (shouldRecompute && deleted.length > 0) {
    const recomputeResult = await triggerDuplicateRecompute();
    if ("error" in recomputeResult) {
      console.warn("[api/tracks/bulk-delete] duplicate recompute not triggered:", recomputeResult.error);
    }
  }

  return NextResponse.json({ deleted, failed });
}
