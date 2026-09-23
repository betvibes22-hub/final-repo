/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['fluent-ffmpeg', '@ffmpeg-installer/ffmpeg', '@napi-rs/canvas'],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
