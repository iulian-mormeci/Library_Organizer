import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface RouteParams {
  params: { id: string };
}

/**
 * DELETE /api/tracks/:id — removes the file from disk and its Track row.
 *
 * NOTE: the deployment guide mounts the music library read-only via NFS by
 * design (safety: this app should never be able to corrupt the source
 * library from a scan). Physical deletion therefore requires the mount to
 * be switched to read-write (or a separate read-write NFS export) before
 * this endpoint can actually remove files — otherwise unlink fails with
 * EROFS/EACCES and we deliberately do NOT delete the DB row, so the UI
 * keeps reflecting reality instead of hiding a file that is still there.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const track = await prisma.track.findUnique({ where: { id: params.id } });

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  try {
    await fs.unlink(track.path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      // File already gone from disk; clean up the stale DB row.
      await prisma.track.delete({ where: { id: track.id } });
      return NextResponse.json({ deleted: true, note: "File was already missing on disk" });
    }

    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      return NextResponse.json(
        {
          error:
            "Cannot delete: the music library mount is read-only. Remount it read-write to enable deletions.",
          code,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  await prisma.track.delete({ where: { id: track.id } });
  return NextResponse.json({ deleted: true });
}
