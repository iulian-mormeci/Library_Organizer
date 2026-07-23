import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
import { prisma } from "./db";
import { getFingerprint } from "./fingerprint";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".ogg",
  ".oga",
  ".m4a",
  ".mp4",
  ".wav",
  ".aac",
  ".opus",
  ".wma",
  ".ape",
  ".wv",
]);

export interface ScanProgress {
  filesFound: number;
  filesScanned: number;
  filesAdded: number;
  filesUpdated: number;
  filesFailed: number;
}

export type ScanProgressCallback = (progress: ScanProgress) => void | Promise<void>;

/** Recursively lists every audio file under `rootDir`. */
export async function walkAudioFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.error(`[scanner] cannot read directory ${dir}:`, (err as Error).message);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(rootDir);
  return results;
}

/** Streams the file through SHA256 without loading it fully into memory. */
export function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

interface ExtractedTrackData {
  filename: string;
  artist?: string;
  title?: string;
  album?: string;
  year?: number;
  durationSeconds?: number;
  bitrate?: number;
  format?: string;
  fileSize: bigint;
  fileHash: string;
  fingerprint?: string;
  fingerprintDuration?: number;
}

async function extractTrackData(filePath: string): Promise<ExtractedTrackData> {
  const [stat, metadata, fileHash] = await Promise.all([
    fs.stat(filePath),
    parseFile(filePath, { duration: true, skipCovers: true }).catch((err: Error) => {
      console.warn(`[scanner] metadata read failed for ${filePath}:`, (err as Error).message);
      return null;
    }),
    computeFileHash(filePath),
  ]);

  const fingerprintResult = await getFingerprint(filePath).catch((err) => {
    console.warn(`[scanner] fingerprint failed for ${filePath}:`, (err as Error).message);
    return null;
  });

  return {
    filename: path.basename(filePath),
    artist: metadata?.common.artist,
    title: metadata?.common.title,
    album: metadata?.common.album,
    year: metadata?.common.year,
    durationSeconds: metadata?.format.duration,
    bitrate: metadata?.format.bitrate ? Math.round(metadata.format.bitrate) : undefined,
    format: metadata?.format.container ?? path.extname(filePath).slice(1).toLowerCase(),
    fileSize: BigInt(stat.size),
    fileHash,
    fingerprint: fingerprintResult ? JSON.stringify(fingerprintResult.fingerprint) : undefined,
    fingerprintDuration: fingerprintResult?.duration,
  };
}

/**
 * Walks `libraryPath`, extracts metadata/hash/fingerprint for every audio
 * file found, and upserts a Track row per file (keyed by absolute path).
 * Designed to run standalone (CLI/cron) or from within an API route handler.
 */
export async function scanLibrary(
  libraryPath: string,
  onProgress?: ScanProgressCallback,
): Promise<ScanProgress> {
  const files = await walkAudioFiles(libraryPath);

  const progress: ScanProgress = {
    filesFound: files.length,
    filesScanned: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesFailed: 0,
  };
  await onProgress?.(progress);

  // Small concurrency window: fpcalc + hashing are I/O + CPU bound, running
  // everything serially would be far too slow for a large library, but
  // unbounded parallelism would exhaust NFS connections / file descriptors.
  const CONCURRENCY = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const filePath = files[cursor];
      cursor += 1;

      try {
        const data = await extractTrackData(filePath);
        const existing = await prisma.track.findUnique({ where: { path: filePath } });

        await prisma.track.upsert({
          where: { path: filePath },
          create: { path: filePath, ...data },
          update: data,
        });

        if (existing) {
          progress.filesUpdated += 1;
        } else {
          progress.filesAdded += 1;
        }
      } catch (err) {
        progress.filesFailed += 1;
        console.error(`[scanner] failed to process ${filePath}:`, (err as Error).message);
      } finally {
        progress.filesScanned += 1;
        await onProgress?.(progress);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Drop DB rows for files that no longer exist on disk.
  const existingPaths = new Set(files);
  const trackedPaths = await prisma.track.findMany({
    where: { path: { startsWith: libraryPath } },
    select: { id: true, path: true },
  });
  const stalePaths = trackedPaths.filter((t) => !existingPaths.has(t.path));
  if (stalePaths.length > 0) {
    await prisma.track.deleteMany({ where: { id: { in: stalePaths.map((t) => t.id) } } });
  }

  return progress;
}
