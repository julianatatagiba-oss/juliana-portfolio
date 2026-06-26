const rateLimit = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

const BLOCKED_PHRASES = [
  'ignore previous instructions',
  'forget your instructions',
  'you are now',
  'act as',
  'pretend you are',
  'jailbreak',
  'ignore all',
  'new instructions',
  'system prompt',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = rateLimit.get(ip) || { count: 0, start: now };
  if (now - record.start > RATE_LIMIT_WINDOW) {
    record.count = 0;
    record.start = now;
  }
  record.count++;
  rateLimit.set(ip, record);
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { history, system } = req.body;

  if (!history || !history.length) {
    return res.status(400).json({ error: 'Missing message' });
  }

  const lastMessage = history[history.length - 1];
  const userText = (lastMessage?.content || '').trim();

  // Empty message validation
  if (!userText) {
    return res.status(400).json({ error: 'Missing message' });
  }

  // Minimum length / meaningful content validation
  if (userText.length < 3 || !/[a-zA-Z]/.test(userText)) {
    return res.status(200).json({ reply: "I didn't quite catch that. Could you ask me something about Juliana's experience or skills?" });
  }

  // Length validation
  if (userText.length > 500) {
    return res.status(400).json({ error: 'Message too long. Please keep your question brief.' });
  }

  // Content filter
  const lower = userText.toLowerCase();
  if (BLOCKED_PHRASES.some(phrase => lower.includes(phrase))) {
    return res.status(200).json({ reply: "I'm here to answer questions about Juliana's professional experience. How can I help you?" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: system || '',
        messages: history,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }

    const reply = data.content?.[0]?.text || '';
    console.log('[chat] Q:', userText.slice(0, 200));
    console.log('[chat] A:', reply.slice(0, 200));

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
