import fs from "node:fs/promises";

export type DeleteFileResult =
  | { ok: true; alreadyMissing: boolean }
  // EROFS: the filesystem/mount itself is read-only (matches a Docker :ro
  // bind mount, e.g. LIBRARY_MOUNT_MODE=ro).
  | { ok: false; reason: "read-only-mount"; code: string }
  // EACCES/EPERM: permission denied on this specific file/directory. This
  // can happen even on a genuinely read-write mount — e.g. an NFS export
  // with root_squash mapping the container's root to a restricted UID on
  // the server, or file ownership that doesn't match the container's UID.
  | { ok: false; reason: "permission-denied"; code: string }
  | { ok: false; reason: "other"; code?: string; message: string };

/**
 * Attempts to unlink `filePath` and classifies the outcome. This makes a
 * real fs.unlink() syscall every call — there is no pre-check, no cached
 * "is this mount read-only" flag computed once at startup. A mount that
 * changes from read-only to read-write (or vice versa) between two calls
 * is reflected immediately on the next call, because each call is its own
 * syscall against current kernel/mount state.
 */
export async function deleteFileIfPossible(filePath: string): Promise<DeleteFileResult> {
  try {
    await fs.unlink(filePath);
    return { ok: true, alreadyMissing: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return { ok: true, alreadyMissing: true };
    }

    if (code === "EROFS") {
      return { ok: false, reason: "read-only-mount", code };
    }

    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, reason: "permission-denied", code };
    }

    return { ok: false, reason: "other", code, message: (err as Error).message };
  }
}
