/**
 * LexIA — Main Application Logic
 */

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  apiKey: localStorage.getItem('lexia_api_key') || '',
  currentQuery: '',
  history: JSON.parse(localStorage.getItem('lexia_history') || '[]'),
  lastQuery: '',
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const views = {
  home: document.getElementById('view-home'),
  search: document.getElementById('view-search'),
  sources: document.getElementById('view-sources'),
};

const heroSearchInput = document.getElementById('heroSearchInput');
const heroSearchBtn = document.getElementById('heroSearchBtn');
const sidebarSearchInput = document.getElementById('sidebarSearchInput');
const sidebarSearchBtn = document.getElementById('sidebarSearchBtn');

const resultsPlaceholder = document.getElementById('resultsPlaceholder');
const resultsContainer = document.getElementById('resultsContainer');
const loadingState = document.getElementById('loadingState');
const loadingStep = document.getElementById('loadingStep');
const errorState = document.getElementById('errorState');
const errorTitle = document.getElementById('errorTitle');
const errorMsg = document.getElementById('errorMsg');
const retryBtn = document.getElementById('retryBtn');

const queryRecap = document.getElementById('queryRecap');
const analysisBody = document.getElementById('analysisBody');
const copyAnalysisBtn = document.getElementById('copyAnalysisBtn');
const jurisprudenceCards = document.getElementById('jurisprudenceCards');
const historyList = document.getElementById('historyList');

const settingsBtn = document.getElementById('settingsBtn');
const apiModal = document.getElementById('apiModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const modalSave = document.getElementById('modalSave');

// ── Navigation ─────────────────────────────────────────────────────────────
function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.view === name);
  });
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    showView(link.dataset.view);
  });
});

// ── Source filter helpers ──────────────────────────────────────────────────
function getHeroSources() {
  return [...document.querySelectorAll('.hero-search .filter-chip input:checked')]
    .map(cb => cb.value);
}

function getSidebarSources() {
  return [...document.querySelectorAll('.sidebar-filter:checked')]
    .map(cb => cb.value);
}

// Toggle filter chip style on click
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('active', chip.querySelector('input').checked);
  });
});

// ── Search flow ────────────────────────────────────────────────────────────
function setLoadingState(step = 'Interrogation des sources juridiques') {
  resultsPlaceholder.classList.add('hidden');
  resultsContainer.classList.add('hidden');
  errorState.classList.add('hidden');
  loadingStep.textContent = step;
  loadingState.classList.remove('hidden');
}

function setErrorState(title, msg) {
  loadingState.classList.add('hidden');
  resultsContainer.classList.add('hidden');
  errorTitle.textContent = title;
  errorMsg.textContent = msg;
  errorState.classList.remove('hidden');
}

function setResultsState() {
  loadingState.classList.add('hidden');
  errorState.classList.add('hidden');
  resultsPlaceholder.classList.add('hidden');
  resultsContainer.classList.remove('hidden');
}

/**
 * Simple markdown-to-HTML renderer for the analysis body.
 * Handles: headings, bold, italic, blockquote, lists, inline code.
 */
function renderMarkdown(text) {
  return text
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Numbered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Bullet list items
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    // Paragraph breaks (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single line breaks
    .replace(/\n/g, '<br/>');
}

async function runSearch(query, sources) {
  if (!query.trim()) return;

  // If no API key, prompt
  if (!state.apiKey) {
    openModal();
    return;
  }

  state.currentQuery = query;
  state.lastQuery = query;

  // Switch to search view
  showView('search');
  sidebarSearchInput.value = query;

  setLoadingState('Analyse de la question juridique…');

  // Update history
  addToHistory(query);

  let fullText = '';

  // Show recap
  queryRecap.innerHTML = `<strong>Votre question :</strong> ${escapeHtml(query)}`;

  // Populate jurisprudence cards immediately (sample data)
  const cards = generateJurisprudenceExamples(query, sources);
  renderJurisprudenceCards(cards);

  // Start streaming
  streamLegalAnalysis(
    query,
    sources,
    state.apiKey,
    // onChunk
    (chunk) => {
      fullText += chunk;
      if (loadingState.classList.contains('hidden') === false) {
        // First chunk — transition to results
        setResultsState();
        analysisBody.innerHTML = '';
        analysisBody.classList.add('cursor-blink');
      }
      analysisBody.innerHTML = `<p>${renderMarkdown(fullText)}</p>`;
      analysisBody.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    // onDone
    () => {
      analysisBody.classList.remove('cursor-blink');
      analysisBody.innerHTML = `<p>${renderMarkdown(fullText)}</p>`;
      setResultsState();
    },
    // onError
    (err) => {
      setErrorState('Erreur lors de l\'analyse', err);
    }
  );
}

// ── Jurisprudence card rendering ───────────────────────────────────────────
function renderJurisprudenceCards(cards) {
  if (!cards.length) {
    document.getElementById('jurisprudenceSection').classList.add('hidden');
    return;
  }
  document.getElementById('jurisprudenceSection').classList.remove('hidden');
  jurisprudenceCards.innerHTML = cards.map(card => `
    <div class="juris-card">
      <span class="juris-card-source ${card.source}">${sourceLabel(card.source)}</span>
      <div class="juris-card-title">${escapeHtml(card.title)}</div>
      <div class="juris-card-date">${escapeHtml(card.ref)} · ${escapeHtml(card.date)}</div>
      <div class="juris-card-excerpt">${escapeHtml(card.excerpt)}</div>
      <div class="juris-card-tags">
        ${card.tags.map(t => `<span class="juris-tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

function sourceLabel(key) {
  return { cassation: 'Cour de cassation', conseil_etat: 'Conseil d\'État', cjue: 'CJUE' }[key] || key;
}

// ── History ────────────────────────────────────────────────────────────────
function addToHistory(query) {
  state.history = [query, ...state.history.filter(q => q !== query)].slice(0, 8);
  localStorage.setItem('lexia_history', JSON.stringify(state.history));
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    historyList.innerHTML = '<li class="history-empty">Aucune recherche récente</li>';
    return;
  }
  historyList.innerHTML = state.history.map(q => `
    <li class="history-item" title="${escapeHtml(q)}">${escapeHtml(truncate(q, 40))}</li>
  `).join('');
  historyList.querySelectorAll('.history-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      const query = state.history[i];
      sidebarSearchInput.value = query;
      runSearch(query, getSidebarSources());
    });
  });
}

// ── Event listeners ────────────────────────────────────────────────────────

// Hero search
heroSearchBtn.addEventListener('click', () => {
  runSearch(heroSearchInput.value, getHeroSources());
});
heroSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    runSearch(heroSearchInput.value, getHeroSources());
  }
});

// Sidebar search
sidebarSearchBtn.addEventListener('click', () => {
  runSearch(sidebarSearchInput.value, getSidebarSources());
});
sidebarSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    runSearch(sidebarSearchInput.value, getSidebarSources());
  }
});

// Example pills
document.querySelectorAll('.example-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const query = pill.dataset.query;
    heroSearchInput.value = query;
    runSearch(query, getHeroSources());
  });
});

// Retry
retryBtn.addEventListener('click', () => {
  if (state.lastQuery) {
    runSearch(state.lastQuery, getSidebarSources());
  }
});

// Copy analysis
copyAnalysisBtn.addEventListener('click', () => {
  const text = analysisBody.innerText;
  navigator.clipboard.writeText(text).then(() => {
    copyAnalysisBtn.title = 'Copié !';
    setTimeout(() => { copyAnalysisBtn.title = 'Copier l\'analyse'; }, 2000);
  });
});

// ── Modal / API Key ────────────────────────────────────────────────────────
function openModal() {
  apiKeyInput.value = state.apiKey;
  apiModal.classList.remove('hidden');
  setTimeout(() => apiKeyInput.focus(), 50);
}

function closeModal() {
  apiModal.classList.add('hidden');
}

settingsBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
apiModal.addEventListener('click', e => {
  if (e.target === apiModal) closeModal();
});

modalSave.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  state.apiKey = key;
  localStorage.setItem('lexia_api_key', key);
  closeModal();

  // If user was waiting to search, retry
  if (state.lastQuery && key) {
    runSearch(state.lastQuery, getSidebarSources());
  }
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') modalSave.click();
});

// ── Utilities ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ── Init ───────────────────────────────────────────────────────────────────
renderHistory();

// Prompt for API key on first load if absent
if (!state.apiKey) {
  // Show a gentle prompt in the hero area without blocking
  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:13px;color:#c9a84c;margin-top:12px;';
  hint.innerHTML = '⚙ <a href="#" id="configLink" style="color:inherit;text-decoration:underline">Configurez votre clé API Anthropic</a> pour commencer.';
  document.querySelector('.hero-examples').after(hint);
  document.getElementById('configLink').addEventListener('click', e => {
    e.preventDefault();
    openModal();
  });
}
