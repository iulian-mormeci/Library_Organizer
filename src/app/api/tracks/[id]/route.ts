import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFileIfPossible } from "@/lib/deleteFile";

interface RouteParams {
  params: { id: string };
}

/**
 * DELETE /api/tracks/:id — removes the file from disk and its Track row.
 *
 * NOTE: the deployment guide mounts the music library read-only by default
 * (safety: this app should never be able to corrupt the source library from
 * a scan) via docker-compose.yml's LIBRARY_MOUNT_MODE (defaults to "ro").
 * That Docker-level bind mount flag is enforced independently of whatever
 * permissions the underlying NFS export actually has — a genuinely
 * read-write NFS mount will still appear read-only inside the container
 * until LIBRARY_MOUNT_MODE=rw is set and the container is recreated.
 *
 * Deletability is never pre-checked or cached (see deleteFileIfPossible):
 * every call attempts the real fs.unlink() and reacts to whatever it
 * returns, so this always reflects the current mount state. On a
 * read-only result we deliberately do NOT delete the DB row, so the UI
 * keeps reflecting reality instead of hiding a file that is still there.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const track = await prisma.track.findUnique({ where: { id: params.id } });

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const result = await deleteFileIfPossible(track.path);

  if (!result.ok) {
    if (result.reason === "read-only") {
      return NextResponse.json(
        {
          error:
            "Cannot delete: the mount is read-only inside the container. This is set by " +
            "LIBRARY_MOUNT_MODE in docker-compose.yml (defaults to \"ro\") independently of the " +
            "underlying NFS export's own permissions — set LIBRARY_MOUNT_MODE=rw and recreate the " +
            "container (docker compose up -d) to enable deletions.",
          code: result.code,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  await prisma.track.delete({ where: { id: track.id } });

  if (result.alreadyMissing) {
    return NextResponse.json({ deleted: true, note: "File was already missing on disk" });
  }
  return NextResponse.json({ deleted: true });
}
