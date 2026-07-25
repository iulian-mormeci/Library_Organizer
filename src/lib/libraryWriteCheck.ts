import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface LibraryWriteCheckResult {
  writable: boolean;
  checkedAt: string;
  error?: string;
}

// Short TTL, not "computed once at startup": a check cached indefinitely is
// exactly the staleness trap this is meant to avoid (the mount can flip
// from ro to rw — or an NFS export's permissions can change — without the
// app restarting). This is a fast self-healing cache for a moderately
// expensive probe, not a source of truth.
const CACHE_TTL_MS = 15_000;

let cached: LibraryWriteCheckResult | null = null;
let cachedAt = 0;

/**
 * Diagnostic-only probe: attempts to create and remove a temp file directly
 * under the library root. This is NOT used to gate DELETE /api/tracks/:id —
 * that endpoint always tests the exact file being deleted live (see
 * deleteFileIfPossible in src/lib/deleteFile.ts), which is strictly more
 * correct than trusting a cached, whole-library-level probe: it can't go
 * stale, and it reflects the real target's actual permissions rather than a
 * proxy file's. This exists so the dashboard can show "is the library
 * writable at all" without waiting for a user to click delete on a real
 * track first.
 */
export async function checkLibraryWritable(
  libraryPath: string,
  { force = false }: { force?: boolean } = {},
): Promise<LibraryWriteCheckResult> {
  const now = Date.now();
  if (!force && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const probePath = path.join(libraryPath, `.music-dedup-write-check-${crypto.randomUUID()}`);
  let result: LibraryWriteCheckResult;

  try {
    await fs.writeFile(probePath, "");
    await fs.unlink(probePath);
    result = { writable: true, checkedAt: new Date().toISOString() };
  } catch (err) {
    result = {
      writable: false,
      checkedAt: new Date().toISOString(),
      error: (err as NodeJS.ErrnoException).code ?? (err as Error).message,
    };
  }

  cached = result;
  cachedAt = now;
  return result;
}
