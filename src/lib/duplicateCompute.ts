import type { Track } from "@prisma/client";
import { prisma } from "./db";
import { DedupOptions, DetectionLevel, DuplicateGroup, detectDuplicates } from "./dedup";

// Module-level guard: prevents two recomputes running concurrently against
// the same Node process (mirrors the scanInFlight guard in the scan route).
let computeInFlight = false;

export function isDuplicateRecomputeInFlight(): boolean {
  return computeInFlight;
}

/**
 * Runs the full detection pipeline and atomically replaces the persisted
 * DuplicateGroupResult rows with the new output. Always awaited to
 * completion by its caller — it's up to the caller whether that means
 * blocking a CLI script until it's done, or firing it off in the
 * background from an HTTP handler (see triggerDuplicateRecompute below).
 */
export async function computeAndPersistDuplicates(
  jobId: string,
  options: Partial<DedupOptions> = {},
): Promise<{ groupCount: number }> {
  try {
    const groups = await detectDuplicates(options);

    const operations = [
      prisma.duplicateGroupResult.deleteMany({}),
      ...(groups.length > 0
        ? [
            prisma.duplicateGroupResult.createMany({
              data: groups.map((g) => ({
                jobId,
                level: g.level,
                confidence: g.confidence,
                trackIds: g.tracks.map((t) => t.id),
              })),
            }),
          ]
        : []),
      prisma.duplicateComputeJob.update({
        where: { id: jobId },
        data: { status: "completed", finishedAt: new Date(), groupCount: groups.length },
      }),
    ];

    await prisma.$transaction(operations);

    return { groupCount: groups.length };
  } catch (err) {
    await prisma.duplicateComputeJob.update({
      where: { id: jobId },
      data: { status: "failed", finishedAt: new Date(), error: (err as Error).message },
    });
    throw err;
  }
}

/**
 * Creates a DuplicateComputeJob and kicks off the computation in the
 * background (fire-and-forget from the caller's perspective) — meant to be
 * called from an HTTP handler, which can return immediately with the job
 * id instead of blocking the response on the computation.
 */
export async function triggerDuplicateRecompute(
  options: Partial<DedupOptions> = {},
): Promise<{ jobId: string } | { error: string }> {
  if (computeInFlight) {
    return { error: "A duplicate recompute is already running" };
  }

  const job = await prisma.duplicateComputeJob.create({ data: { status: "running" } });
  computeInFlight = true;

  computeAndPersistDuplicates(job.id, options)
    .catch((err) => {
      console.error("[duplicateCompute] recompute failed:", err);
    })
    .finally(() => {
      computeInFlight = false;
    });

  return { jobId: job.id };
}

/**
 * Reads the most recently persisted duplicate groups — a plain DB read, no
 * computation. Shared by GET /api/duplicates and the /duplicates page
 * (server component) so both stay a fast read from the same source.
 */
export async function getPersistedDuplicateGroups(
  levelFilter?: DetectionLevel,
): Promise<{ computedAt: Date | null; groups: DuplicateGroup[] }> {
  const [lastCompletedJob, groupResults] = await Promise.all([
    prisma.duplicateComputeJob.findFirst({
      where: { status: "completed" },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.duplicateGroupResult.findMany({
      where: levelFilter ? { level: levelFilter } : undefined,
      orderBy: { computedAt: "desc" },
    }),
  ]);

  const allTrackIds = [...new Set(groupResults.flatMap((g) => g.trackIds))];
  const tracks = await prisma.track.findMany({ where: { id: { in: allTrackIds } } });
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const groups: DuplicateGroup[] = groupResults
    .map((g) => ({
      level: g.level as DetectionLevel,
      confidence: g.confidence,
      // A track referenced by a stale result may have been deleted (scan
      // cleanup, manual delete) since the last recompute.
      tracks: g.trackIds.map((id) => trackById.get(id)).filter((t): t is Track => t !== undefined),
    }))
    .filter((g) => g.tracks.length > 1);

  return { computedAt: lastCompletedJob?.finishedAt ?? null, groups };
}
