export default function handler(req: any, res: any) {
  res.json({
    kimi_key: process.env.KIMI_API_KEY ? "present" : "missing",
    kimi_url: process.env.KIMI_BASE_URL ?? "missing",
    kimi_model: process.env.KIMI_MODEL ?? "missing",
    railway_url: process.env.CANVAS_RAILWAY_URL ?? "missing"
  })
}
