import { NextRequest, NextResponse } from "next/server";
import { computeAutoCleanPlan } from "@/lib/autoClean";
import { bulkDeleteTracks } from "@/lib/bulkDelete";
import { triggerDuplicateRecompute } from "@/lib/duplicateCompute";

export const dynamic = "force-dynamic";

/**
 * POST /api/duplicates/auto-clean — deletes every track except the one
 * "recommended" pick in each duplicate group that qualifies as risk-free:
 * an exact SHA256 hash match, or a fingerprint match at exactly 100%
 * similarity (every compared bit identical — not 95-99%). See
 * isAutoCleanEligible in src/lib/autoClean.ts for why this is a hard
 * boolean check, not a parameter a caller could loosen. Deletion itself
 * reuses bulkDeleteTracks — the same mechanism as POST
 * /api/tracks/bulk-delete — so concurrency, permission handling, and
 * partial-failure behavior are identical and defined in exactly one place.
 *
 * Body: { dryRun?: boolean }
 *   dryRun defaults to true — an empty/missing body only computes and
 *   returns the plan, it never deletes anything. Callers must pass
 *   { dryRun: false } explicitly to actually execute, which is the
 *   conservative default this endpoint's whole purpose calls for.
 *
 * dryRun response:  { dryRun: true, groupCount, tracks: [{id, fileSize}], bytesToFree }
 * execute response: { dryRun: false, groupCount, deleted, failed, bytesFreed }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false;

  const plan = await computeAutoCleanPlan();

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      groupCount: plan.groupCount,
      tracks: plan.tracks,
      bytesToFree: plan.bytesToFree,
    });
  }

  if (plan.tracks.length === 0) {
    return NextResponse.json({
      dryRun: false,
      groupCount: plan.groupCount,
      deleted: [],
      failed: [],
      bytesFreed: "0",
    });
  }

  const ids = plan.tracks.map((t) => t.id);
  const { deleted, failed } = await bulkDeleteTracks(ids);

  const sizeById = new Map(plan.tracks.map((t) => [t.id, t.fileSize ? BigInt(t.fileSize) : BigInt(0)]));
  const bytesFreed = deleted.reduce((sum, id) => sum + (sizeById.get(id) ?? BigInt(0)), BigInt(0));

  if (deleted.length > 0) {
    const recomputeResult = await triggerDuplicateRecompute();
    if ("error" in recomputeResult) {
      console.warn("[api/duplicates/auto-clean] duplicate recompute not triggered:", recomputeResult.error);
    }
  }

  return NextResponse.json({
    dryRun: false,
    groupCount: plan.groupCount,
    deleted,
    failed,
    bytesFreed: bytesFreed.toString(),
  });
}
