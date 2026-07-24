import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { triggerDuplicateRecompute } from "@/lib/duplicateCompute";

export const dynamic = "force-dynamic";

/** GET /api/duplicates/recompute — status of the current/last recompute job, for polling. */
export async function GET() {
  const job = await prisma.duplicateComputeJob.findFirst({ orderBy: { startedAt: "desc" } });
  return NextResponse.json({ job });
}

/**
 * POST /api/duplicates/recompute — kicks off a duplicate-detection pass in
 * the background and returns immediately with a job id. Optional JSON body
 * can override the default thresholds (fuzzyThreshold, durationToleranceSeconds,
 * fingerprintSimilarityThreshold).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  const result = await triggerDuplicateRecompute(body ?? {});
  if ("error" in result) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json({ jobId: result.jobId, status: "running" }, { status: 202 });
}
