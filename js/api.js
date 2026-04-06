/**
 * Jurisia — API Integration
 * All requests are proxied through /api/chat (Vercel serverless function).
 * The Anthropic API key never reaches the browser.
 */

// All calls go through the server-side proxy — no direct Anthropic URL in the browser
const API_PROXY_URL = '/api/chat';

// Picks up model from config.js if loaded, otherwise uses the default
const MODEL = (window.JURISIA_CONFIG && window.JURISIA_CONFIG.MODEL)
  ? window.JURISIA_CONFIG.MODEL
  : 'claude-sonnet-4-6';

// ── System Prompts ────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS = {

  // Used for structured JSON search responses
  search: `Tu es un expert en droit français et européen (Cour de cassation, Conseil d'État, CJUE, Légifrance).
Tu DOIS répondre UNIQUEMENT avec du JSON valide, sans aucun texte avant ou après.
Ne fournis jamais de markdown, d'explication, ni de commentaire. Seulement du JSON pur.`,

  // Used for structured JSON contract analysis
  analysis_json: `Tu es un juriste senior spécialisé en droit des contrats français.
Tu DOIS répondre UNIQUEMENT avec du JSON valide, sans aucun texte avant ou après.
Ne fournis jamais de markdown, d'explication, ni de commentaire. Seulement du JSON pur.
Toutes les valeurs textuelles doivent être en français juridique professionnel.`,

  // Used for free-form streaming analysis (synthesis tab)
  analysis_stream: `Tu es Jurisia, un expert en analyse contractuelle juridique française et européenne travaillant pour un cabinet d'avocats d'affaires parisien de premier plan.

Tes domaines d'expertise :
- Droit des contrats (Code civil, Code de commerce)
- Droit du travail et droit social français
- Droit européen des affaires et RGPD
- Droit de la propriété intellectuelle
- Fusions-acquisitions et M&A

Lorsque tu analyses un document juridique :
1. Commence par un résumé exécutif de 3 paragraphes
2. Identifie les clauses à risque avec leur impact juridique
3. Cite la jurisprudence pertinente (Cass., CE, CJUE) avec dates et numéros
4. Formule des recommandations de négociation concrètes

Rédige en français juridique précis. Sois rigoureux, objectif, au service des intérêts du client.`,

  // Used for chat
  chat: `Tu es Jurisia, l'assistant juridique IA de référence pour cabinets d'avocats français.

Expertise :
- Droit civil, commercial, social, administratif, européen
- Code civil, Code de commerce, Code du travail, procédures civiles
- Jurisprudence : Cour de cassation, CJUE, CEDH, Conseil d'État

Règles :
- Réponds toujours en français juridique professionnel
- Structure avec titres et listes pour la lisibilité
- Cite systématiquement les textes de loi et la jurisprudence applicable
- Indique les incertitudes et recommande un spécialiste si nécessaire
- Conclus toujours par : (1) points clés, (2) prochaines étapes, (3) risques résiduels

Devise : précision, rigueur, efficacité au service de la justice.`,

  // Used for rédaction
  redaction: `Tu es un avocat rédacteur expert en droit français des affaires.
Tu rédiges des actes juridiques complets, formellement corrects et immédiatement utilisables.
Utilise le vocabulaire juridique français approprié, référence les textes de loi applicables.
Inclus toutes les clauses standard selon les usages du Barreau de Paris.
Rédige en français juridique formel.`,
};

// ── callApiJSON — non-streaming, returns parsed JSON object ──────────────────

/**
 * Calls the Anthropic API without streaming and returns a parsed JSON object.
 * The model is instructed via systemPrompt to return only valid JSON.
 *
 * @param {Array}  messages    - [{role, content}]
 * @param {string} systemPrompt
 * @param {string} apiKey
 * @returns {Promise<Object>}  Parsed JSON object
 * @throws {Error}             On API error or JSON parse failure
 */
async function callApiJSON(messages, systemPrompt, apiKey) {
  const response = await fetch(API_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    let msg = `Erreur API ${response.status}`;
    try {
      const err = await response.json();
      if (err.error?.message) msg = err.error.message;
      if (response.status === 401) msg = 'Clé API invalide. Vérifiez votre clé Anthropic dans les Paramètres.';
      if (response.status === 429) msg = 'Limite de requêtes atteinte. Patientez quelques secondes.';
    } catch (_) {}
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Extract the JSON object from the response (Claude sometimes adds a tiny prefix)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('La réponse de l\'IA ne contient pas de JSON valide. Réessayez.');
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (_) {
    throw new Error('JSON malformé dans la réponse. Réessayez.');
  }
}

// ── streamToElement — streams markdown to a DOM element ──────────────────────

/**
 * Streams a response from the Anthropic API to a target DOM element.
 * Renders markdown in real-time with a blinking cursor.
 */
async function streamToElement(messages, systemPrompt, apiKey, targetEl, onDone, onError) {
  let fullText = '';
  targetEl.innerHTML = '';

  const cursorEl = document.createElement('span');
  cursorEl.className = 'stream-cursor';
  cursorEl.textContent = '▋';

  try {
    const response = await fetch(API_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      let msg = `Erreur API ${response.status}`;
      try {
        const err = await response.json();
        if (err.error?.message) msg = err.error.message;
      } catch (_) {}
      throw new Error(msg);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(trimmed.slice(6));
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            fullText += evt.delta.text;
            targetEl.innerHTML = renderMarkdown(fullText);
            targetEl.appendChild(cursorEl);
            if (targetEl.parentElement) {
              targetEl.parentElement.scrollTop = targetEl.parentElement.scrollHeight;
            }
          }
        } catch (_) {}
      }
    }

    if (cursorEl.parentElement) cursorEl.remove();
    targetEl.innerHTML = renderMarkdown(fullText);
    onDone && onDone(fullText);

  } catch (err) {
    if (cursorEl.parentElement) cursorEl.remove();
    const isNetwork = err.message.includes('Failed to fetch') || err.message.includes('NetworkError');
    const msg = isNetwork ? 'Erreur réseau. Vérifiez votre connexion internet.' : err.message;
    targetEl.innerHTML = `<div class="stream-error">⚠ ${escapeHtml(msg)}</div>`;
    onError && onError(msg);
  }
}

// ── streamToCallback — streams, calls onChunk per delta ──────────────────────

/**
 * Streams a response, calling onChunk(chunk, fullText) for each text delta.
 */
async function streamToCallback(messages, systemPrompt, apiKey, onChunk, onDone, onError) {
  let fullText = '';

  try {
    const response = await fetch(API_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      let msg = `Erreur API ${response.status}`;
      try {
        const err = await response.json();
        if (err.error?.message) msg = err.error.message;
      } catch (_) {}
      throw new Error(msg);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(trimmed.slice(6));
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            fullText += evt.delta.text;
            onChunk && onChunk(evt.delta.text, fullText);
          }
        } catch (_) {}
      }
    }

    onDone && onDone(fullText);

  } catch (err) {
    const isNetwork = err.message.includes('Failed to fetch') || err.message.includes('NetworkError');
    const msg = isNetwork ? 'Erreur réseau. Vérifiez votre connexion.' : err.message;
    onError && onError(msg);
  }
}

// ── High-level helpers ────────────────────────────────────────────────────────

/**
 * Streams a document analysis (synthesis tab) to a DOM element.
 * For structured JSON data (clauses, score), use callApiJSON directly.
 */
async function analyzeDocumentStream(content, apiKey, targetEl, onDone, onError) {
  const prompt = `Analyse le document juridique suivant. Fournis un résumé exécutif complet avec identification des risques principaux, références jurisprudentielles et recommandations de négociation.

DOCUMENT :
${content.substring(0, 40000)}${content.length > 40000 ? '\n[Document tronqué]' : ''}`;

  await streamToElement(
    [{ role: 'user', content: prompt }],
    SYSTEM_PROMPTS.analysis_stream,
    apiKey,
    targetEl,
    onDone,
    onError,
  );
}

/**
 * Sends a chat message with optional document context. Streams response.
 */
async function sendChatMessage(messages, context, apiKey, onChunk, onDone, onError) {
  let systemPrompt = SYSTEM_PROMPTS.chat;
  if (context && context.content) {
    systemPrompt += `\n\n--- DOCUMENT EN CONTEXTE : "${escapeHtml(context.name)}" ---\n${context.content.substring(0, 10000)}${context.content.length > 10000 ? '\n[Tronqué]' : ''}`;
  }
  await streamToCallback(messages, systemPrompt, apiKey, onChunk, onDone, onError);
}

/**
 * Tests the API connection. Returns { ok, message }.
 */
async function testApiConnection(apiKey) {
  try {
    const response = await fetch(API_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Bonjour' }],
        stream: false,
      }),
    });
    if (response.ok) {
      return { ok: true, message: `Connexion réussie — ${MODEL} opérationnel` };
    }
    const data = await response.json().catch(() => ({}));
    return { ok: false, message: data.error?.message || `Erreur ${response.status}` };
  } catch (err) {
    return { ok: false, message: 'Erreur réseau : ' + err.message };
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="code-block"><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g,       '<em>$1</em>');

  // HR
  html = html.replace(/^---+$/gm, '<hr />');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/((?:^[*-] .+\n?)+)/gm, block => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^[*-] /, '').trim()}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, block => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^\d+\. /, '').trim()}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs
  html = html.split(/\n{2,}/).map(block => {
    const t = block.trim();
    if (!t) return '';
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br />')}</p>`;
  }).join('\n');

  return html;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatFileSize(bytes) {
  if (!bytes) return '0 o';
  const k = 1024, sizes = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
