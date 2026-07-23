/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["music-metadata", "@prisma/client"],
  },
};

module.exports = nextConfig;
