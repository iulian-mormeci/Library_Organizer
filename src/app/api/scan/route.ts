import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scanLibrary } from "@/lib/scanner";

// Module-level guard: prevents two scans running concurrently against the
// same Node process (e.g. a user double-clicking "scan" in the dashboard).
let scanInFlight = false;

/** GET /api/scan — status of the current/last scans, for the dashboard. */
export async function GET() {
  const jobs = await prisma.scanJob.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  return NextResponse.json({ scanInFlight, jobs });
}

/**
 * POST /api/scan — kicks off a library scan in the background and returns
 * immediately with a job id. The actual work runs after the response is
 * sent; progress/result is tracked via the ScanJob row and polled through
 * GET /api/scan.
 */
export async function POST(request: NextRequest) {
  if (scanInFlight) {
    return NextResponse.json({ error: "A scan is already running" }, { status: 409 });
  }

  let libraryPath = process.env.LIBRARY_PATH;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.path) libraryPath = body.path;
  } catch {
    // no body provided, fall back to env default
  }

  if (!libraryPath) {
    return NextResponse.json(
      { error: "No library path provided and LIBRARY_PATH env var is not set" },
      { status: 400 },
    );
  }

  const job = await prisma.scanJob.create({
    data: { libraryPath, status: "running" },
  });

  scanInFlight = true;

  // Fire-and-forget: intentionally not awaited so the HTTP request returns
  // immediately. Progress is persisted to the ScanJob row as it happens.
  runScanInBackground(job.id, libraryPath);

  return NextResponse.json({ jobId: job.id, status: "running" }, { status: 202 });
}

// Persisting progress on every single file would mean an extra DB
// round-trip per track, which adds up on large libraries. Every 5 files is
// frequent enough for the dashboard to feel live without slowing the scan.
const PERSIST_EVERY_N_FILES = 5;

async function runScanInBackground(jobId: string, libraryPath: string) {
  try {
    const result = await scanLibrary(libraryPath, async (progress) => {
      const isFirst = progress.filesScanned === 0;
      const isLast = progress.filesScanned === progress.filesFound;
      if (!isFirst && !isLast && progress.filesScanned % PERSIST_EVERY_N_FILES !== 0) return;

      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          filesFound: progress.filesFound,
          filesScanned: progress.filesScanned,
          filesAdded: progress.filesAdded,
          filesUpdated: progress.filesUpdated,
          filesFailed: progress.filesFailed,
          totalFiles: progress.filesFound,
          processedFiles: progress.filesScanned,
          currentFile: progress.currentFile,
        },
      });
    });

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        finishedAt: new Date(),
        filesFound: result.filesFound,
        filesScanned: result.filesScanned,
        filesAdded: result.filesAdded,
        filesUpdated: result.filesUpdated,
        filesFailed: result.filesFailed,
        totalFiles: result.filesFound,
        processedFiles: result.filesScanned,
        currentFile: null,
      },
    });
  } catch (err) {
    console.error("[api/scan] background scan failed:", err);
    await prisma.scanJob.update({
      where: { id: jobId },
      data: { status: "failed", finishedAt: new Date(), error: (err as Error).message },
    });
  } finally {
    scanInFlight = false;
  }
}
