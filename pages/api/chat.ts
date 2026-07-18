import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, system } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' })
  }

  // Env values can arrive with stray whitespace or a duplicated paste
  // (newline-separated) — an HTTP header value cannot contain whitespace, so a
  // raw `Bearer ${key}` then throws "invalid header value". Take the first
  // whitespace-delimited token: a single clean `sk-...` key.
  const apiKey = (process.env.KIMI_API_KEY ?? '').trim().split(/\s+/)[0]
  if (!apiKey) {
    console.error('KIMI_API_KEY missing or empty')
    return res.status(500).json({ error: 'Chat is not configured' })
  }

  const allMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages,
  ]

  try {
    const response = await fetch(`${process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.KIMI_MODEL ?? 'moonshot-v1-8k',
        max_tokens: 512,
        temperature: 0.3,
        messages: allMessages,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Kimi error', response.status, err)
      // Never echo the upstream body to the client — it can reflect our request
      // headers (including the API key). Log server-side only.
      return res.status(502).json({ error: 'Upstream chat error' })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    return res.json({ text })
  } catch (err) {
    // Generic message — the exception can embed the Authorization header value.
    console.error('chat proxy error', err)
    return res.status(500).json({ error: 'Chat request failed' })
  }
}
