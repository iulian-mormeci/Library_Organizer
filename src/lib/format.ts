/** `bytes` as a BigInt-serialized string (from a JSON API response). */
export function formatBytes(bytes: string | null | undefined): string {
  if (!bytes) return "—";
  const n = Number(bytes);
  if (n === 0) return "0 KB";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
