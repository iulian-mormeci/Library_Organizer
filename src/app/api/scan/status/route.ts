import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// No dynamic APIs (headers/searchParams) are used here, so Next would
// otherwise try to statically prerender this route at build time — which
// hits the DB before any container/DB is running. Force it dynamic instead,
// same as GET /api/scan.
export const dynamic = "force-dynamic";

/**
 * GET /api/scan/status — live status of the current/most recent scan, for
 * the dashboard's polling progress panel. Always returns the latest job
 * regardless of status; the caller decides what to render based on
 * `status` ("running" vs "completed"/"failed") and stops polling once it's
 * no longer "running".
 */
export async function GET() {
  const job = await prisma.scanJob.findFirst({
    orderBy: { startedAt: "desc" },
  });

  if (!job) {
    return NextResponse.json({ job: null });
  }

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      totalFiles: job.totalFiles,
      processedFiles: job.processedFiles,
      currentFile: job.currentFile,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
    },
  });
}
