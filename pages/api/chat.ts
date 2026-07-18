import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, system } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' })
  }

  const allMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages,
  ]

  try {
    const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.KIMI_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        max_tokens: 512,
        temperature: 0.3,
        messages: allMessages,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Kimi error', response.status, err)
      return res.status(response.status).json({ error: err })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    return res.json({ text })
  } catch (err) {
    console.error('chat proxy error', err)
    return res.status(500).json({ error: (err as Error).message ?? 'Internal error' })
  }
}
