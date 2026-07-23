-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN     "currentFile" TEXT,
ADD COLUMN     "processedFiles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalFiles" INTEGER;

