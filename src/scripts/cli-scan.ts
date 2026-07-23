/**
 * Standalone scan entry point — run directly with `npm run scan -- /music`
 * (or `tsx src/scripts/cli-scan.ts /music`), independent of the Next.js
 * server. Meant to be invoked from a cron job inside the container for
 * scheduled rescans, as well as for manual/test runs.
 */
import { prisma } from "../lib/db";
import { scanLibrary } from "../lib/scanner";

async function main() {
  const libraryPath = process.argv[2] ?? process.env.LIBRARY_PATH;

  if (!libraryPath) {
    console.error(
      "Usage: npm run scan -- <library-path>  (or set LIBRARY_PATH env var)",
    );
    process.exit(1);
  }

  console.log(`[cli-scan] starting scan of ${libraryPath}`);
  const startedAt = Date.now();

  const job = await prisma.scanJob.create({
    data: { libraryPath, status: "running" },
  });

  try {
    const result = await scanLibrary(libraryPath, (progress) => {
      process.stdout.write(
        `\r[cli-scan] scanned ${progress.filesScanned}/${progress.filesFound} ` +
          `(added ${progress.filesAdded}, updated ${progress.filesUpdated}, failed ${progress.filesFailed})`,
      );
    });

    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        filesFound: result.filesFound,
        filesScanned: result.filesScanned,
        filesAdded: result.filesAdded,
        filesUpdated: result.filesUpdated,
        filesFailed: result.filesFailed,
      },
    });

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n[cli-scan] done in ${elapsedSec}s:`, result);
  } catch (err) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "failed", finishedAt: new Date(), error: (err as Error).message },
    });
    console.error("\n[cli-scan] scan failed:", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
