/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Proxy each track's API to its backend. A rewrite is only emitted when its
    // target URL is actually configured — otherwise Next fails the build with an
    // "undefined/..." destination. When a target is missing the page's fetch just
    // 404s and the UI falls back to labelled sample data.
    const targets = [
      ['markets', process.env.CANVAS_MARKETS_URL || process.env.CANVAS_RAILWAY_URL],
      ['agent', process.env.CANVAS_AGENT_URL || process.env.CANVAS_RAILWAY_URL],
      ['fan', process.env.CANVAS_FAN_URL || process.env.CANVAS_RAILWAY_URL],
    ]
    return targets
      .filter(([, base]) => Boolean(base))
      .map(([svc, base]) => ({
        source: `/api/${svc}/:path*`,
        destination: `${base.replace(/\/$/, '')}/api/${svc}/:path*`,
      }))
  },
}

module.exports = nextConfig
