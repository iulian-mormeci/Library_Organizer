import { NextRequest, NextResponse } from "next/server";
import { checkLibraryWritable } from "@/lib/libraryWriteCheck";

export const dynamic = "force-dynamic";

/**
 * GET /api/library/write-check — diagnostic-only probe of whether the
 * library mount is currently writable (cached for a few seconds, see
 * src/lib/libraryWriteCheck.ts). Does NOT gate DELETE /api/tracks/:id,
 * which always live-tests the specific file being deleted instead.
 *
 * ?force=true bypasses the cache for an immediate recheck (e.g. right
 * after remounting rw and recreating the container).
 */
export async function GET(request: NextRequest) {
  const libraryPath = process.env.LIBRARY_PATH;
  if (!libraryPath) {
    return NextResponse.json({ error: "LIBRARY_PATH env var is not set" }, { status: 400 });
  }

  const force = request.nextUrl.searchParams.get("force") === "true";
  const result = await checkLibraryWritable(libraryPath, { force });

  return NextResponse.json({
    ...result,
    libraryPath,
    libraryMountMode: process.env.LIBRARY_MOUNT_MODE ?? null,
  });
}
