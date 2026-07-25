import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFileIfPossible } from "@/lib/deleteFile";

interface RouteParams {
  params: { id: string };
}

/**
 * DELETE /api/tracks/:id — removes the file from disk and its Track row.
 *
 * Deletability is never pre-checked or cached (see deleteFileIfPossible):
 * every call attempts the real fs.unlink() on THIS specific file and reacts
 * to whatever it returns, so this always reflects current reality — never a
 * stale flag. Two distinct failure modes get distinct explanations, because
 * "mount is read-only" (EROFS, a Docker-level LIBRARY_MOUNT_MODE=ro bind
 * mount flag) and "permission denied" (EACCES/EPERM, e.g. NFS
 * ownership/root_squash on an otherwise read-write mount) have different
 * fixes and are easy to conflate. See also GET /api/library/write-check for
 * a whole-library diagnostic probe (advisory only — it does not gate this
 * endpoint's decision).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const track = await prisma.track.findUnique({ where: { id: params.id } });

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const result = await deleteFileIfPossible(track.path);

  if (!result.ok) {
    if (result.reason === "read-only-mount") {
      return NextResponse.json(
        {
          error:
            "Cannot delete: the mount is read-only inside the container (EROFS). This is set by " +
            "LIBRARY_MOUNT_MODE in docker-compose.yml (currently \"" +
            (process.env.LIBRARY_MOUNT_MODE ?? "unset, defaults to ro") +
            "\" as seen by this process) — set LIBRARY_MOUNT_MODE=rw and recreate the container " +
            "(docker compose up -d) to enable deletions.",
          code: result.code,
        },
        { status: 403 },
      );
    }

    if (result.reason === "permission-denied") {
      return NextResponse.json(
        {
          error:
            `Cannot delete: permission denied on this file (${result.code}), even though the mount ` +
            "itself may be read-write. This usually means the NFS export's permissions/ownership " +
            "don't allow this container's user to write here (e.g. root_squash mapping root to a " +
            "restricted UID on the server) — check the export's UID/GID mapping on TrueNAS, not " +
            "just the mount's rw flag.",
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
