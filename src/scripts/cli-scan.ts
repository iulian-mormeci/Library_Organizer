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

  const PERSIST_EVERY_N_FILES = 5;

  try {
    const result = await scanLibrary(libraryPath, async (progress) => {
      process.stdout.write(
        `\r[cli-scan] scanned ${progress.filesScanned}/${progress.filesFound} ` +
          `(added ${progress.filesAdded}, updated ${progress.filesUpdated}, failed ${progress.filesFailed})`,
      );

      const isFirst = progress.filesScanned === 0;
      const isLast = progress.filesScanned === progress.filesFound;
      if (!isFirst && !isLast && progress.filesScanned % PERSIST_EVERY_N_FILES !== 0) return;

      await prisma.scanJob.update({
        where: { id: job.id },
        data: {
          totalFiles: progress.filesFound,
          processedFiles: progress.filesScanned,
          currentFile: progress.currentFile,
        },
      });
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
        totalFiles: result.filesFound,
        processedFiles: result.filesScanned,
        currentFile: null,
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
