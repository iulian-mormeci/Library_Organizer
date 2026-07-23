/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOT using output: "standalone" — the same image also runs
  // src/scripts/cli-scan.ts via `npm run scan` (cron), which needs the
  // full node_modules tree (tsx, music-metadata, @prisma/client), not just
  // the trimmed server bundle Next would trace for the web app alone.
  experimental: {
    serverComponentsExternalPackages: ["music-metadata", "@prisma/client"],
  },
};

module.exports = nextConfig;
