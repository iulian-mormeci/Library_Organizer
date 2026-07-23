import { spawn } from "node:child_process";

export interface FpcalcResult {
  duration: number;
  fingerprint: number[];
}

const FPCALC_BIN = process.env.FPCALC_PATH ?? "fpcalc";
const FPCALC_TIMEOUT_MS = 60_000;

/**
 * Invokes `fpcalc -raw -json <file>` (Chromaprint CLI) and parses its
 * output. `-raw` is used instead of the default base64-compressed
 * fingerprint because it yields a plain array of 32-bit integers, which is
 * what dedup.ts needs for a direct Hamming-distance comparison between two
 * tracks — decompressing the default format would require reimplementing
 * Chromaprint's bitstream codec.
 */
export function getFingerprint(filePath: string): Promise<FpcalcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(FPCALC_BIN, ["-raw", "-json", filePath]);

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`fpcalc timed out after ${FPCALC_TIMEOUT_MS}ms for ${filePath}`));
    }, FPCALC_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn fpcalc (is chromaprint-tools installed?): ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`fpcalc exited with code ${code} for ${filePath}: ${stderr.trim()}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as { duration: number; fingerprint: string | number[] };
        const fingerprint = Array.isArray(parsed.fingerprint)
          ? parsed.fingerprint
          : parsed.fingerprint.split(",").map(Number);
        resolve({ duration: parsed.duration, fingerprint });
      } catch (err) {
        reject(new Error(`failed to parse fpcalc output for ${filePath}: ${(err as Error).message}`));
      }
    });
  });
}
