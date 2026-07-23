-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "artist" TEXT,
    "title" TEXT,
    "album" TEXT,
    "year" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "bitrate" INTEGER,
    "format" TEXT,
    "fileSize" BIGINT,
    "fileHash" TEXT,
    "fingerprint" TEXT,
    "fingerprintDuration" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "libraryPath" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filesFound" INTEGER NOT NULL DEFAULT 0,
    "filesScanned" INTEGER NOT NULL DEFAULT 0,
    "filesAdded" INTEGER NOT NULL DEFAULT 0,
    "filesUpdated" INTEGER NOT NULL DEFAULT 0,
    "filesFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Track_path_key" ON "Track"("path");

-- CreateIndex
CREATE INDEX "Track_fileHash_idx" ON "Track"("fileHash");

-- CreateIndex
CREATE INDEX "Track_artist_title_idx" ON "Track"("artist", "title");

-- CreateIndex
CREATE INDEX "Track_durationSeconds_idx" ON "Track"("durationSeconds");

