/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['fluent-ffmpeg', '@ffmpeg-installer/ffmpeg'],
  },
};

module.exports = nextConfig;
