-- CreateTable
CREATE TABLE "DuplicateComputeJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "groupCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DuplicateComputeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateGroupResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "trackIds" TEXT[],
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateGroupResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DuplicateGroupResult_jobId_idx" ON "DuplicateGroupResult"("jobId");

