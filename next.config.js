/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/markets/:path*',
        destination: `${process.env.CANVAS_RAILWAY_URL}/api/markets/:path*`,
      },
      {
        source: '/api/agent/:path*',
        destination: `${process.env.CANVAS_RAILWAY_URL}/api/agent/:path*`,
      },
      {
        source: '/api/fan/:path*',
        destination: `${process.env.CANVAS_RAILWAY_URL}/api/fan/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
