const { Router } = require('express');

const router = Router();

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

router.post('/search', async (req, res) => {
  const { query, domain, pageTitle } = req.body;

  if (!query || !domain) {
    return res.status(400).json({ error: 'query and domain are required' });
  }

  const prompt = `You are a SaaS settings navigation assistant.
The user is on: ${domain} (page: "${pageTitle || ''}")
They searched for: "${query}"

Give clear, step-by-step instructions on where to find this setting.
Be specific about which menus, tabs, and buttons to click.
If you are unsure about the exact location, say so clearly and suggest where else to look.
If the setting may not exist on this site, say that honestly.
Interfaces vary between users (different plans, regions, or UI versions), so note when something might be in a different spot.
Format as a numbered list. Keep each step concise (1 line).
Do not mention that you are an AI. Just give the steps directly.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      res.write(`data: ${JSON.stringify({ text: 'AI search failed (Gemini API error).' })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6).trim();
        if (!payload) continue;

        try {
          const parsed = JSON.parse(payload);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }
  } catch (err) {
    console.error('Search error:', err);
    res.write(`data: ${JSON.stringify({ text: 'Error: ' + err.message })}\n\n`);
  } finally {
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

module.exports = router;
