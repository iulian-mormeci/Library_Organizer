import { prisma } from "./db";
import { deleteFileIfPossible } from "./deleteFile";

// Mirrors the worker-pool pattern in src/lib/scanner.ts: a shared cursor
// plus a fixed number of concurrent workers, instead of unbounded
// Promise.all (which could open hundreds of simultaneous NFS file
// operations) or a fully sequential loop (too slow for large batches).
const CONCURRENCY = 5;

export interface FailedDeletion {
  id: string;
  error: string;
  code?: string;
}

export interface BulkDeleteResult {
  deleted: string[];
  failed: FailedDeletion[];
}

/**
 * Deletes multiple tracks (file + DB row). A failure on one track never
 * aborts the rest — every id's outcome is reported individually. Shared by
 * POST /api/tracks/bulk-delete (arbitrary user selection) and
 * POST /api/duplicates/auto-clean (computes its own id list, then deletes
 * through this same path) so the deletion mechanics — concurrency,
 * permission handling, partial-failure behavior — exist in exactly one
 * place.
 */
export async function bulkDeleteTracks(trackIds: string[]): Promise<BulkDeleteResult> {
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

  return { deleted, failed };
}
