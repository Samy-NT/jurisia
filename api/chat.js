/**
 * Jurisia — Vercel Serverless Function
 * POST /api/chat
 *
 * Proxies requests to the Anthropic API using the server-side key.
 * Supports both streaming (SSE) and non-streaming responses.
 * The API key never reaches the browser.
 *
 * Body: { messages, system, max_tokens, stream }
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL     = 'claude-sonnet-4-6';

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' });
  }

  const { messages, system, max_tokens = 4096, stream = false, model } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

  const payload = {
    model:      model || DEFAULT_MODEL,
    max_tokens,
    messages,
    stream,
  };
  if (system) payload.system = system;

  // ── Streaming response ─────────────────────────────────────────────────────
  if (stream) {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_API_URL, {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-api-key':       apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      res.write(`data: ${JSON.stringify({ error: 'Network error reaching Anthropic.' })}\n\n`);
      return res.end();
    }

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({}));
      const msg = errData.error?.message || `Anthropic error ${upstream.status}`;
      res.write(`data: ${JSON.stringify({ error: msg, status: upstream.status })}\n\n`);
      return res.end();
    }

    // Pipe the SSE stream from Anthropic straight to the client
    const reader  = upstream.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } catch (_) {
      // Client disconnected — nothing to do
    }

    return res.end();
  }

  // ── Non-streaming response ─────────────────────────────────────────────────
  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    return res.status(502).json({ error: 'Network error reaching Anthropic.' });
  }

  // Forward Anthropic's status code + body
  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    let message = data.error?.message || `Anthropic error ${upstream.status}`;
    if (upstream.status === 401) message = 'Clé API invalide ou expirée.';
    if (upstream.status === 429) message = 'Limite de requêtes atteinte. Patientez quelques secondes.';
    return res.status(upstream.status).json({ error: message });
  }

  return res.status(200).json(data);
}
