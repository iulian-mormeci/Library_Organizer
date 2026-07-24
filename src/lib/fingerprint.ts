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

      // fpcalc can exit non-zero (e.g. code 3, "Error decoding audio frame")
      // on malformed trailing frames while still printing a complete, usable
      // JSON fingerprint for the rest of the file — so the exit code alone
      // isn't a reliable failure signal. Always try to parse stdout first
      // and only treat this as an error if that fails or yields no
      // fingerprint; a non-zero code alongside a valid fingerprint is just
      // logged as a warning.
      let parsed: { duration: number; fingerprint: string | number[] };
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(
          new Error(
            `fpcalc produced no valid JSON for ${filePath} (exit code ${code}): ${stderr.trim() || (err as Error).message}`,
          ),
        );
        return;
      }

      const fingerprint = Array.isArray(parsed.fingerprint)
        ? parsed.fingerprint
        : (parsed.fingerprint ?? "").split(",").filter(Boolean).map(Number);

      if (fingerprint.length === 0) {
        reject(
          new Error(`fpcalc returned an empty fingerprint for ${filePath} (exit code ${code}): ${stderr.trim()}`),
        );
        return;
      }

      if (code !== 0) {
        console.warn(
          `[fingerprint] fpcalc exited with code ${code} for ${filePath} but still produced a fingerprint; audio file may have decoding issues: ${stderr.trim()}`,
        );
      }

      resolve({ duration: parsed.duration, fingerprint });
    });
  });
}
