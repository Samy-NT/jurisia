/**
 * Jurisia — Application Logic
 * Modules: Navigation · Recherche · Analyse · Chat · Rédaction
 * Fully functional with Anthropic API + Demo mode
 */

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  // API key: priority order → localStorage → config.js → empty
  apiKey:   localStorage.getItem('jurisia_api_key')
            || (window.JURISIA_CONFIG && window.JURISIA_CONFIG.ANTHROPIC_API_KEY)
            || '',
  firmName: localStorage.getItem('jurisia_firm')   || 'Cabinet Dupont & Associés',
  lawyer:   localStorage.getItem('jurisia_lawyer') || 'Me. Sophie Martin',
  model:    localStorage.getItem('jurisia_model')  || 'claude-sonnet-4-20250514',
  demoMode: false,

  chatHistory:         [],
  chatContext:         null,   // { name, content } — document attached to chat
  currentFile:         null,
  lastAnalyseContent:  '',     // contract text used for analysis
  lastAnalyseData:     null,   // parsed JSON from last analysis
  isStreaming:         false,
  isWowDemo:           false,   // pre-calculated Meridian NDA demo (no API call needed)
};

let _analyseFirstVisit = true; // triggers wow-demo on first visit to analyse module

// ── DOM helpers ────────────────────────────────────────────────────────────────
const $    = id => document.getElementById(id);
const show = el => { if (el) { el.classList.remove('hidden'); } };
const hide = el => { if (el) { el.classList.add('hidden'); } };
const showFlex = el => { if (el) { el.classList.remove('hidden'); el.style.display = 'flex'; } };

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

const breadcrumbLabels = {
  recherche:  'Recherche juridique',
  analyse:    'Analyse de contrat',
  chat:       'Chat juridique',
  redaction:  'Rédaction assistée',
  dossiers:   'Dossiers',
  equipe:     'Équipe',
  rapports:   'Rapports',
  parametres: 'Paramètres API',
};

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = $(`view-${name}`);
  if (view) view.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (nav) nav.classList.add('active');
  if ($('breadcrumbCurrent')) $('breadcrumbCurrent').textContent = breadcrumbLabels[name] || name;

  // Wow demo: auto-load Meridian NDA on first visit to the analyse module
  if (name === 'analyse' && _analyseFirstVisit && !state.currentFile) {
    _analyseFirstVisit = false;
    setTimeout(loadNdaWowDemo, 350);
  }
}

document.querySelectorAll('.nav-item[data-view]').forEach(item => {
  item.addEventListener('click', () => showView(item.dataset.view));
});

// ══════════════════════════════════════════════════════════════════════════════
// API STATUS & MODAL
// ══════════════════════════════════════════════════════════════════════════════

function updateApiStatus() {
  const dot  = $('apiStatusDot');
  const text = $('apiStatusText');
  if (!dot || !text) return;
  if (state.demoMode) {
    dot.style.background = 'var(--risk-medium)';
    text.textContent     = 'Mode démo';
    $('apiStatusBtn') && $('apiStatusBtn').classList.add('connected');
  } else if (state.apiKey) {
    dot.style.background = 'var(--risk-low)';
    text.textContent     = 'API connectée';
    $('apiStatusBtn') && $('apiStatusBtn').classList.add('connected');
  } else {
    dot.style.background = 'var(--text-3)';
    text.textContent     = 'API non configurée';
    $('apiStatusBtn') && $('apiStatusBtn').classList.remove('connected');
  }
}

$('apiStatusBtn') && $('apiStatusBtn').addEventListener('click', openModal);

function openModal() {
  if ($('modalApiKey')) $('modalApiKey').value = state.apiKey;
  if ($('modalTestResult')) $('modalTestResult').style.display = 'none';
  show($('apiModal'));
  setTimeout(() => $('modalApiKey') && $('modalApiKey').focus(), 60);
}
function closeModal() { hide($('apiModal')); }

$('modalClose')  && $('modalClose').addEventListener('click', closeModal);
$('modalCancel') && $('modalCancel').addEventListener('click', closeModal);
$('apiModal')    && $('apiModal').addEventListener('click', e => {
  if (e.target === $('apiModal')) closeModal();
});

$('modalSaveBtn') && $('modalSaveBtn').addEventListener('click', () => {
  const key = ($('modalApiKey').value || '').trim();
  state.apiKey  = key;
  state.demoMode = false;
  localStorage.setItem('jurisia_api_key', key);
  updateApiStatus();
  closeModal();
  if ($('settingsApiKey')) $('settingsApiKey').value = key;
});

$('modalApiKey') && $('modalApiKey').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('modalSaveBtn').click();
});

$('modalTestBtn') && $('modalTestBtn').addEventListener('click', async () => {
  const key = ($('modalApiKey').value || '').trim();
  const btn = $('modalTestBtn');
  const res = $('modalTestResult');
  btn.disabled = true;
  btn.textContent = 'Test…';
  if (res) res.style.display = 'none';

  const result = await testApiConnection(key);
  if (res) {
    res.style.display = 'block';
    res.className = 'modal-test-result ' + (result.ok ? 'success' : 'error');
    res.textContent = (result.ok ? '✓ ' : '✗ ') + result.message;
  }
  btn.disabled = false;
  btn.textContent = 'Tester';
});

// Inject "Mode démo" button into modal footer via JS (no HTML change)
(function injectDemoButton() {
  const footer = document.querySelector('#apiModal .modal-footer');
  if (!footer) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost';
  btn.id = 'enableDemoBtn';
  btn.style.marginRight = 'auto';
  btn.innerHTML = '🎯 Mode démo';
  footer.insertBefore(btn, footer.firstChild);

  btn.addEventListener('click', () => {
    state.demoMode = true;
    state.apiKey   = '';
    updateApiStatus();
    closeModal();
    // Pre-load NDA demo into analyse
    loadNdaDemo();
  });
})();

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS VIEW
// ══════════════════════════════════════════════════════════════════════════════

function initSettings() {
  if ($('settingsApiKey')) $('settingsApiKey').value = state.apiKey;
  if ($('firmName'))       $('firmName').value       = state.firmName;
  if ($('lawyerName'))     $('lawyerName').value     = state.lawyer;
  if ($('modelSelect'))    $('modelSelect').value    = state.model;
}

$('toggleApiKey') && $('toggleApiKey').addEventListener('click', () => {
  const inp = $('settingsApiKey');
  if (!inp) return;
  inp.type = inp.type === 'text' ? 'password' : 'text';
  $('toggleApiKey').textContent = inp.type === 'text' ? 'Masquer' : 'Afficher';
});

$('saveApiKeyBtn') && $('saveApiKeyBtn').addEventListener('click', () => {
  const key = ($('settingsApiKey').value || '').trim();
  state.apiKey   = key;
  state.demoMode = false;
  localStorage.setItem('jurisia_api_key', key);
  updateApiStatus();
  $('saveApiKeyBtn').textContent = '✓ Enregistrée';
  setTimeout(() => { $('saveApiKeyBtn').textContent = 'Enregistrer la clé'; }, 2000);
});

$('testApiKeyBtn') && $('testApiKeyBtn').addEventListener('click', async () => {
  const key = ($('settingsApiKey').value || '').trim();
  const res = $('settingsTestResult');
  $('testApiKeyBtn').disabled = true;
  $('testApiKeyBtn').textContent = 'Test…';
  if (res) res.style.display = 'none';

  const result = await testApiConnection(key);
  if (res) {
    res.style.display = 'block';
    res.className = 'modal-test-result ' + (result.ok ? 'success' : 'error');
    res.textContent = (result.ok ? '✓ ' : '✗ ') + result.message;
  }
  $('testApiKeyBtn').disabled = false;
  $('testApiKeyBtn').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Tester la connexion`;
});

$('saveFirmBtn') && $('saveFirmBtn').addEventListener('click', () => {
  state.firmName = ($('firmName').value  || '').trim() || state.firmName;
  state.lawyer   = ($('lawyerName').value || '').trim() || state.lawyer;
  localStorage.setItem('jurisia_firm',   state.firmName);
  localStorage.setItem('jurisia_lawyer', state.lawyer);
  $('saveFirmBtn').textContent = '✓ Enregistré';
  setTimeout(() => { $('saveFirmBtn').textContent = 'Enregistrer'; }, 2000);
});

$('modelSelect') && $('modelSelect').addEventListener('change', () => {
  state.model = $('modelSelect').value;
  localStorage.setItem('jurisia_model', state.model);
});

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 1 — RECHERCHE JURISPRUDENTIELLE
// ══════════════════════════════════════════════════════════════════════════════

// Source chips toggle
document.querySelectorAll('.src-filter').forEach(cb => {
  const chip = cb.closest('.chip');
  if (!chip) return;
  chip.addEventListener('click', () => {
    setTimeout(() => chip.classList.toggle('active', cb.checked), 0);
  });
});

// Suggestion pills
document.querySelectorAll('.chip[data-query]').forEach(chip => {
  chip.addEventListener('click', () => {
    if ($('searchQuery')) $('searchQuery').value = chip.dataset.query;
    runSearch();
  });
});

$('searchBtn') && $('searchBtn').addEventListener('click', runSearch);
$('searchQuery') && $('searchQuery').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runSearch();
});

async function runSearch() {
  const query = ($('searchQuery').value || '').trim();
  if (!query) { $('searchQuery') && $('searchQuery').focus(); return; }

  if (!state.apiKey && !state.demoMode) { openModal(); return; }

  const sources = [...document.querySelectorAll('.src-filter:checked')].map(cb => cb.value);
  if (!sources.length) { alert('Sélectionnez au moins une source.'); return; }

  // UI: loading state
  hide($('searchResults'));
  hide($('searchPlaceholder'));
  showFlex($('searchLoading'));

  try {
    let data;

    if (state.demoMode) {
      await sleep(1200);
      data = buildDemoSearchResults(query, sources);
    } else {
      const prompt = buildSearchPrompt(query, sources);
      data = await callApiJSON(
        [{ role: 'user', content: prompt }],
        SYSTEM_PROMPTS.search,
        state.apiKey,
      );
    }

    hide($('searchLoading'));
    renderSearchResults(data, query);

  } catch (err) {
    hide($('searchLoading'));
    show($('searchResults'));
    $('searchResults').style.display = 'block';
    if ($('searchSynthesis')) $('searchSynthesis').innerHTML = `<div class="stream-error">⚠ ${escapeHtml(err.message)}</div>`;
    if ($('resultCards'))     $('resultCards').innerHTML = '';
    if ($('resultsCount'))    $('resultsCount').textContent = 'Erreur';
  }
}

function buildSearchPrompt(query, sources) {
  const srcNames = { cassation: 'Cour de cassation', conseil_etat: 'Conseil d\'État', cjue: 'CJUE', legifrance: 'Légifrance' };
  const selected = sources.map(s => srcNames[s] || s).join(', ');

  return `Question juridique : ${query}
Sources à consulter : ${selected}

Réponds UNIQUEMENT avec ce JSON (sans aucun texte avant ou après) :
{
  "synthese": "Paragraphe de synthèse de 3-4 phrases en français juridique précis, répondant directement à la question",
  "results": [
    {
      "title": "Nom court de la décision (ex: Cass. civ. 1re, 13 mars 2019)",
      "reference": "Numéro de pourvoi ou numéro d'affaire",
      "court": "Nom complet de la juridiction",
      "date": "Date complète",
      "source": "cassation ou conseil_etat ou cjue ou legifrance",
      "excerpt": "Principe ou attendu clé de la décision, 2-3 phrases",
      "risk_level": "critique ou élevé ou modéré ou faible",
      "confidence": 88
    }
  ],
  "points_cles": ["Point juridique clé 1", "Point juridique clé 2", "Point juridique clé 3"]
}

Génère 4 résultats pertinents basés sur la vraie jurisprudence française et européenne. Indique [incertain] dans le titre si tu n'es pas sûr d'une référence.`;
}

function renderSearchResults(data, query) {
  show($('searchResults'));
  $('searchResults').style.display = 'block';

  // Synthesis
  if ($('searchSynthesis')) {
    $('searchSynthesis').innerHTML = renderMarkdown(data.synthese || data.summary || '');
  }

  // Count
  const count = (data.results || data.resultats || []).length;
  if ($('resultsCount')) {
    $('resultsCount').textContent = `${count} décision${count > 1 ? 's' : ''} trouvée${count > 1 ? 's' : ''} · "${truncate(query, 60)}"`;
  }

  // Result cards — handle both "results" (new) and "resultats" (legacy) field names
  const results = data.results || data.resultats || [];
  if ($('resultCards')) {
    $('resultCards').innerHTML = results.map(r => {
      // Normalise field names between old and new format
      const title      = r.title  || r.titre  || '';
      const source     = r.source || 'cassation';
      const date       = r.date   || '';
      const ref        = r.reference || r.ref || '';
      const excerpt    = r.excerpt || r.extrait || '';
      const confidence = r.confidence || r.pertinence || 80;
      const riskLevel  = r.risk_level || '';

      return `
        <div class="result-card">
          <div class="result-header">
            <div class="result-title">${escapeHtml(title)}</div>
            <span class="badge badge-${source}">${sourceLabel(source)}</span>
          </div>
          <div class="result-meta">
            <span class="result-date">${escapeHtml(date)}</span>
            ${ref ? `<span class="result-date"> · ${escapeHtml(ref)}</span>` : ''}
            ${riskLevel ? `<span class="badge badge-${riskToBadge(riskLevel)}" style="font-size:10px;">${escapeHtml(riskLevel)}</span>` : ''}
          </div>
          <p class="result-excerpt">${escapeHtml(excerpt)}</p>
          <div class="result-footer">
            <div class="confidence-bar">
              <span>Pertinence</span>
              <div class="confidence-track">
                <div class="confidence-fill" style="width:${confidence}%"></div>
              </div>
              <span>${confidence}%</span>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="sendToChatWithQuery(${JSON.stringify(escapeHtml(title))})">
              Analyser en profondeur →
            </button>
          </div>
        </div>`;
    }).join('');
  }

  // Points clés
  if (data.points_cles && data.points_cles.length && $('searchSynthesis')) {
    const pts = data.points_cles.map(p => `<li>${escapeHtml(p)}</li>`).join('');
    $('searchSynthesis').innerHTML += `<div style="margin-top:16px;padding:12px 16px;background:var(--gold-pale);border:1px solid var(--border-gold);border-radius:var(--r-md);"><p style="font-size:12px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Points clés</p><ul style="padding-left:16px;list-style:disc;">${pts}</ul></div>`;
  }
}

$('copySearchBtn') && $('copySearchBtn').addEventListener('click', () => {
  const text = [
    $('searchSynthesis')?.innerText || '',
    $('resultCards')?.innerText     || '',
  ].join('\n\n');
  navigator.clipboard.writeText(text).then(() => {
    $('copySearchBtn').textContent = '✓ Copié';
    setTimeout(() => { $('copySearchBtn').innerHTML = SVG_COPY + ' Copier'; }, 2000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 2 — ANALYSE DE CONTRAT
// ══════════════════════════════════════════════════════════════════════════════

// ── Inject "Coller un contrat" UI into DOM via JS ────────────────────────────
(function injectPasteContractUI() {
  const uploadZoneEl = $('uploadZone');
  if (!uploadZoneEl || !uploadZoneEl.parentElement) return;

  // Paste button
  const pasteBtn = document.createElement('button');
  pasteBtn.id        = 'pasteContractBtn';
  pasteBtn.className = 'btn btn-outline btn-full';
  pasteBtn.style.marginTop = '8px';
  pasteBtn.innerHTML = '📋 Coller / saisir le texte du contrat';
  uploadZoneEl.after(pasteBtn);

  // Load NDA demo button
  const demoBtn = document.createElement('button');
  demoBtn.id        = 'loadNdaBtn';
  demoBtn.className = 'btn btn-ghost btn-full';
  demoBtn.style.cssText = 'margin-top:4px;font-size:12px;color:var(--text-3);';
  demoBtn.innerHTML = '📄 Charger le contrat de démo (NDA)';
  pasteBtn.after(demoBtn);

  // Paste area (hidden by default)
  const pasteArea = document.createElement('div');
  pasteArea.id = 'pasteContractArea';
  pasteArea.className = 'hidden';
  pasteArea.style.cssText = 'margin-top:8px;';
  pasteArea.innerHTML = `
    <textarea
      id="contractTextarea"
      class="input"
      placeholder="Collez ici le texte de votre contrat (PDF copié, Word, e-mail…)"
      rows="10"
      style="resize:vertical;font-size:13px;line-height:1.6;"
    ></textarea>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn btn-primary btn-sm" id="usePastedContract">Utiliser ce texte</button>
      <button class="btn btn-ghost btn-sm" id="cancelPasteContract">Annuler</button>
    </div>`;
  demoBtn.after(pasteArea);

  // Events
  pasteBtn.addEventListener('click', () => {
    const visible = !pasteArea.classList.contains('hidden');
    if (visible) { hide(pasteArea); } else { show(pasteArea); setTimeout(() => $('contractTextarea')?.focus(), 50); }
  });

  demoBtn.addEventListener('click', loadNdaDemo);

  $('usePastedContract') && document.addEventListener('click', e => {
    if (e.target && e.target.id === 'usePastedContract') {
      const text = ($('contractTextarea')?.value || '').trim();
      if (!text) { $('contractTextarea').style.borderColor = 'var(--risk-critical)'; return; }
      state.currentFile = { name: 'Contrat collé (texte)', size: text.length, content: text, pasted: true };
      if ($('fileName')) $('fileName').textContent = 'Contrat collé (texte)';
      if ($('fileSize'))  $('fileSize').textContent  = `${text.length} caractères`;
      showFlex($('fileInfo'));
      hide(pasteArea);
    }
  });

  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'cancelPasteContract') hide(pasteArea);
  });
})();

// ── File upload ──────────────────────────────────────────────────────────────
const uploadZone = $('uploadZone');
if (uploadZone) {
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]);
  });
}

$('fileInput') && $('fileInput').addEventListener('change', e => {
  if (e.target.files[0]) handleFileUpload(e.target.files[0]);
});

$('removeFile') && $('removeFile').addEventListener('click', () => {
  state.currentFile  = null;
  state.isWowDemo    = false;
  if ($('fileInput')) $('fileInput').value = '';
  hide($('fileInfo'));
  show($('analysePlaceholder'));
  hide($('analyseResults'));
  hide($('analyseLoading'));
  state.lastAnalyseContent = '';
  state.lastAnalyseData    = null;
  const b = $('wowDemoBadge'); if (b) b.remove();
  const r = $('resetToOwnContractBtn'); if (r) r.remove();
});

function handleFileUpload(file) {
  state.currentFile = file;
  if ($('fileName')) $('fileName').textContent = file.name;
  if ($('fileSize'))  $('fileSize').textContent  = formatFileSize(file.size);
  showFlex($('fileInfo'));
}

function loadNdaDemo() {
  _analyseFirstVisit = false; // prevent double-trigger
  showView('analyse');
  loadNdaWowDemo();
}

function loadNdaWowDemo() {
  const ndaContent = getMeridianNdaDemoContent();
  state.currentFile = { name: 'NDA_Meridian_Artefact.txt', size: ndaContent.length, content: ndaContent, pasted: true };
  state.isWowDemo   = true;
  if ($('fileName')) $('fileName').textContent = 'NDA_Meridian_Artefact.txt';
  if ($('fileSize'))  $('fileSize').textContent  = 'Démo · NDA Meridian Capital × Artefact Conseil';
  showFlex($('fileInfo'));
  // Auto-trigger analysis after 1.5 s — the wow moment
  setTimeout(() => runAnalysis(), 1500);
}

function loadDemoDoc(name) {
  const content = getGenericDemoContent(name);
  state.currentFile = { name, size: content.length, content, pasted: true };
  if ($('fileName')) $('fileName').textContent = name;
  if ($('fileSize'))  $('fileSize').textContent  = 'Document démo';
  showFlex($('fileInfo'));
}

// ── Run analysis ─────────────────────────────────────────────────────────────
$('analyzeBtn') && $('analyzeBtn').addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (!state.currentFile) {
    if (uploadZone) { uploadZone.style.borderColor = 'var(--risk-critical)'; setTimeout(() => uploadZone.style.borderColor = '', 1500); }
    return;
  }
  if (!state.apiKey && !state.demoMode && !state.isWowDemo) { openModal(); return; }

  const config = {
    clauses: $('optClauses')?.checked ?? true,
    risk:    $('optScore')?.checked   ?? true,
    juris:   $('optJuris')?.checked   ?? true,
    reco:    $('optReco')?.checked    ?? true,
    lang:    $('analysisLang')?.value  || 'fr',
  };

  // Loading UI
  hide($('analysePlaceholder'));
  hide($('analyseResults'));
  showFlex($('analyseLoading'));

  const steps = [
    'Lecture du document…',
    'Identification des clauses…',
    'Évaluation des risques…',
    'Recherche jurisprudentielle…',
    'Génération des recommandations…',
  ];
  let stepIdx = 0;
  const stepTimer = setInterval(() => {
    if (++stepIdx < steps.length && $('analyseLoadingStep')) {
      $('analyseLoadingStep').textContent = steps[stepIdx];
    }
  }, 1600);

  // Get document content
  let content = '';
  if (state.currentFile.content) {
    content = state.currentFile.content;       // pasted or pre-loaded
  } else if (state.currentFile.demo) {
    content = getGenericDemoContent(state.currentFile.name);
  } else {
    try { content = await readFileText(state.currentFile); }
    catch (_) { content = `[Fichier binaire : ${state.currentFile.name}]\n(Analyse basée sur le nom du fichier)`; }
  }
  state.lastAnalyseContent = content;

  try {
    let data;

    if (state.isWowDemo) {
      await sleep(900);
      data = getMeridianDemoAnalysis();
    } else if (state.demoMode) {
      await sleep(2200);
      data = buildDemoAnalysis(state.currentFile.name);
    } else {
      data = await callApiJSON(
        [{ role: 'user', content: buildAnalysisJsonPrompt(content, config) }],
        SYSTEM_PROMPTS.analysis_json,
        state.apiKey,
      );
    }

    clearInterval(stepTimer);
    state.lastAnalyseData = data;

    // Set contract as chat context so the chat module can use it
    state.chatContext = { name: state.currentFile.name, content };

    renderAnalysisResults(data, state.currentFile.name);

  } catch (err) {
    clearInterval(stepTimer);
    hide($('analyseLoading'));
    show($('analysePlaceholder'));
    if ($('analysePlaceholder')) {
      $('analysePlaceholder').innerHTML = `<div class="stream-error" style="max-width:400px;margin:0 auto;">⚠ ${escapeHtml(err.message)}</div>`;
    }
  }
}

function buildAnalysisJsonPrompt(content, config) {
  const opts = [];
  if (config.clauses) opts.push('clauses (tableau détaillé)');
  if (config.risk)    opts.push('score de risque global (0-100)');
  if (config.juris)   opts.push('jurisprudence pertinente');
  if (config.reco)    opts.push('recommandations de négociation');

  return `Analyse le contrat suivant et réponds UNIQUEMENT avec ce JSON (sans aucun texte avant ou après) :
{
  "global_score": 0,
  "risk_level": "faible|modéré|élevé|critique",
  "summary": "Résumé exécutif de 3 paragraphes en français juridique professionnel",
  "clauses": [
    {
      "title": "Nom de la clause",
      "article": "Numéro d'article si trouvé",
      "excerpt": "Extrait du texte de la clause (50 mots max)",
      "risk": "critical|high|medium|low",
      "recommendation": "Recommandation concrète et actionnelle",
      "legal_ref": "Référence légale applicable (ex: Art. 1231-5 C. civ.)"
    }
  ],
  "jurisprudence": [
    {
      "title": "Cass. civ. Xe, JJ mois AAAA",
      "reference": "n° XX-XX.XXX",
      "source": "cassation|conseil_etat|cjue",
      "date": "JJ mois AAAA",
      "excerpt": "Principe dégagé par l'arrêt"
    }
  ],
  "recommendations": ["Recommandation 1", "Recommandation 2", "Recommandation 3"]
}

Analyse demandée : ${opts.join(', ')}.
Identifie toutes les clauses présentes dans le document.

CONTRAT À ANALYSER :
${content.substring(0, 40000)}${content.length > 40000 ? '\n[Tronqué]' : ''}`;
}

function renderAnalysisResults(data, docName) {
  hide($('analyseLoading'));

  // Show results wrapper
  show($('analyseResults'));
  $('analyseResults').style.display = 'block';

  // Doc title & meta
  if ($('analyseDocTitle')) $('analyseDocTitle').textContent = docName;
  if ($('analyseDocMeta'))  $('analyseDocMeta').textContent  =
    `Analysé le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} · ${MODEL}`;

  // Risk score circle (animated)
  const score = Math.min(100, Math.max(0, parseInt(data.global_score) || 0));
  setRiskScore(score, data.risk_level);

  // Badges
  if ($('analyseBadges')) {
    const badgeCls = riskToBadge(data.risk_level || '');
    const label    = data.risk_level ? capitalise(data.risk_level) : riskScoreLabel(score);
    $('analyseBadges').innerHTML = `<span class="badge badge-${badgeCls}">Risque ${label}</span>`;
  }

  // Tab: Synthèse — render summary with fake-stream effect
  if ($('analyseStream') && data.summary) {
    fakeStream($('analyseStream'), data.summary);
  }

  // Tab: Clauses
  populateClausesTab(data.clauses || []);

  // Tab: Jurisprudence
  populateJurisTab(data.jurisprudence || []);

  // Tab: Recommandations
  populateRecoTab(data.recommendations || []);

  // Add "Discuter de ce contrat" button in synthesis tab if not already present
  injectChatContractButton();

  // Wow demo: inject DÉMO badge + "Analyser mon propre contrat" button
  if (state.isWowDemo) injectWowDemoUI();

  // Reset to first tab
  document.querySelectorAll('.analysis-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.analysis-tab-content').forEach(c => c.classList.remove('active'));
  const firstTab = document.querySelector('.analysis-tab');
  if (firstTab) firstTab.classList.add('active');
  const firstContent = $('tab-synthese');
  if (firstContent) firstContent.classList.add('active');
}

// Inject "Discuter de ce contrat dans le Chat" button below the stream
function injectChatContractButton() {
  const existing = $('goChatFromAnalyse');
  if (existing) return;
  const tab = $('tab-synthese');
  if (!tab) return;
  const btn = document.createElement('button');
  btn.id        = 'goChatFromAnalyse';
  btn.className = 'btn btn-outline btn-sm';
  btn.style.cssText = 'margin-top:16px;';
  btn.innerHTML = '💬 Discuter de ce contrat dans le Chat';
  btn.addEventListener('click', () => {
    if (state.lastAnalyseData && state.lastAnalyseContent) {
      // chatContext already set in runAnalysis
      showView('chat');
    }
  });
  tab.appendChild(btn);
}

// ── Wow-demo UI: DÉMO badge + reset button ────────────────────────────────────

function injectWowDemoUI() {
  // DÉMO badge — top-right of the analyse view header
  if (!$('wowDemoBadge')) {
    const viewHeader = document.querySelector('#view-analyse .view-header');
    if (viewHeader) {
      viewHeader.style.position = 'relative';
      const badge = document.createElement('div');
      badge.id = 'wowDemoBadge';
      badge.style.cssText = [
        'margin-left:auto',
        'padding:5px 14px',
        'background:var(--gold-pale)',
        'border:1px solid var(--border-gold)',
        'border-radius:20px',
        'font-size:11px',
        'font-weight:700',
        'color:var(--gold)',
        'letter-spacing:1px',
        'text-transform:uppercase',
        'white-space:nowrap',
        'align-self:center',
        'flex-shrink:0',
      ].join(';');
      badge.textContent = '✦ DÉMO';
      viewHeader.appendChild(badge);
    }
  }

  // "Analyser mon propre contrat" button — in the action column of the results header
  if (!$('resetToOwnContractBtn')) {
    const btnCol = document.querySelector('#analyseResults .analysis-results-header > div:last-child');
    if (btnCol) {
      const btn = document.createElement('button');
      btn.id        = 'resetToOwnContractBtn';
      btn.className = 'btn btn-outline btn-sm';
      btn.style.cssText = 'margin-top:4px;border-color:var(--gold);color:var(--gold);font-size:11px;';
      btn.innerHTML = '✏ Mon contrat';
      btn.addEventListener('click', resetToOwnContract);
      btnCol.appendChild(btn);
    }
  }
}

function resetToOwnContract() {
  state.isWowDemo   = false;
  state.currentFile = null;
  if ($('fileInput')) $('fileInput').value = '';
  hide($('fileInfo'));
  hide($('analyseResults'));
  show($('analysePlaceholder'));
  hide($('analyseLoading'));
  state.lastAnalyseContent = '';
  state.lastAnalyseData    = null;

  // Remove demo-specific UI
  const badge    = $('wowDemoBadge');           if (badge)    badge.remove();
  const resetBtn = $('resetToOwnContractBtn');  if (resetBtn) resetBtn.remove();
  const chatBtn  = $('goChatFromAnalyse');      if (chatBtn)  chatBtn.remove();

  // Open the paste area so the user can paste their own contract
  const pasteArea = $('pasteContractArea');
  if (pasteArea) { show(pasteArea); }
  setTimeout(() => $('contractTextarea')?.focus(), 150);
}

function setRiskScore(score, riskLevel) {
  const circle  = $('scoreCircle');
  const valueEl = $('scoreValue');
  if (!circle || !valueEl) return;

  let color;
  if (score >= 75)       color = 'var(--risk-critical)';
  else if (score >= 50)  color = 'var(--risk-high)';
  else if (score >= 30)  color = 'var(--risk-medium)';
  else                   color = 'var(--risk-low)';

  circle.style.setProperty('--clr', color);

  // Animate from 0 to score with ease-out cubic over 1.2 s
  const duration  = 1200;
  const startTime = performance.now();
  const easeOut   = t => 1 - Math.pow(1 - t, 3);

  function tick(now) {
    const t       = Math.min((now - startTime) / duration, 1);
    const current = Math.round(easeOut(t) * score);
    circle.style.setProperty('--score', current);
    valueEl.textContent = current;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function populateClausesTab(clauses) {
  const container = $('clausesList');
  if (!container) return;

  if (!clauses || !clauses.length) {
    container.innerHTML = '<p style="color:var(--text-3);font-size:14px;font-style:italic;">Aucune clause identifiée.</p>';
    return;
  }

  container.innerHTML = clauses.map(c => {
    const risk    = c.risk    || 'low';
    const icon    = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[risk] || '⚪';
    const bg      = { critical: 'rgba(224,83,83,0.12)', high: 'rgba(224,123,58,0.12)', medium: 'rgba(201,168,42,0.12)', low: 'rgba(77,174,133,0.12)' }[risk] || 'var(--bg-elevated)';
    const badgeCls = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' }[risk] || 'low';
    const label   = { critical: 'Critique', high: 'Élevé', medium: 'Moyen', low: 'Faible' }[risk] || risk;

    return `
      <div class="clause-row">
        <div class="clause-icon" style="background:${bg};">${icon}</div>
        <div class="clause-info">
          <div class="clause-name">${escapeHtml(c.title || c.name || '')}</div>
          <div class="clause-note">${escapeHtml(c.recommendation || c.note || '')}</div>
          <div class="clause-article" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
            ${c.article   ? `<span>${escapeHtml(c.article)}</span>` : ''}
            ${c.legal_ref ? `<span style="color:var(--gold);font-size:11px;">${escapeHtml(c.legal_ref)}</span>` : ''}
            ${c.excerpt   ? `<span style="color:var(--text-3);font-style:italic;">"${escapeHtml(truncate(c.excerpt, 80))}"</span>` : ''}
          </div>
        </div>
        <span class="badge badge-${badgeCls}" style="flex-shrink:0;align-self:flex-start;">${label}</span>
      </div>`;
  }).join('');
}

function populateJurisTab(juris) {
  const container = $('jurisCards');
  if (!container) return;

  if (!juris || !juris.length) {
    container.innerHTML = '<p style="color:var(--text-3);font-size:14px;font-style:italic;">Aucune jurisprudence identifiée pour ce document.</p>';
    return;
  }

  const borderColor = { cjue: 'var(--src-cjue)', conseil_etat: 'var(--src-ce)', cassation: 'var(--src-cassation)', legifrance: 'var(--src-legifrance)' };

  container.innerHTML = juris.map(j => `
    <div class="card" style="border-left:3px solid ${borderColor[j.source] || 'var(--gold)'};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;">
        <div>
          <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:500;color:var(--text);margin-bottom:2px;">${escapeHtml(j.title || j.titre || '')}</div>
          <div style="font-size:12px;color:var(--text-3);">${escapeHtml(j.reference || j.ref || '')} ${j.date ? '· ' + escapeHtml(j.date) : ''}</div>
        </div>
        <span class="badge badge-${j.source || 'cassation'}" style="flex-shrink:0;">${sourceLabel(j.source || 'cassation')}</span>
      </div>
      <p style="font-size:13px;color:var(--text-2);line-height:1.7;font-style:italic;">${escapeHtml(j.excerpt || '')}</p>
    </div>`).join('');
}

function populateRecoTab(recommendations) {
  const el = $('recoList');
  if (!el) return;

  if (!recommendations || !recommendations.length) {
    el.innerHTML = '<p style="color:var(--text-3);font-size:14px;font-style:italic;">Aucune recommandation disponible.</p>';
    return;
  }

  const items = recommendations.map((r, i) =>
    `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="width:24px;height:24px;background:var(--gold-pale);border:1px solid var(--border-gold);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--gold);flex-shrink:0;">${i + 1}</div>
      <p style="font-size:14px;color:var(--text-2);line-height:1.7;margin:0;">${escapeHtml(r)}</p>
    </div>`).join('');

  el.innerHTML = `<div style="display:flex;flex-direction:column;">${items}</div>
    <p style="font-size:12px;color:var(--text-3);margin-top:16px;font-style:italic;">Ces recommandations constituent une aide à la décision et ne remplacent pas la consultation d'un avocat.</p>`;
}

// Analysis tabs
document.querySelectorAll('.analysis-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.analysis-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.analysis-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const content = $(`tab-${tab.dataset.tab}`);
    if (content) content.classList.add('active');
  });
});

$('exportPdfBtn') && $('exportPdfBtn').addEventListener('click', () => window.print());

$('copyAnalyseBtn') && $('copyAnalyseBtn').addEventListener('click', () => {
  const el = $('analyseStream');
  if (!el) return;
  navigator.clipboard.writeText(el.innerText || '').then(() => {
    $('copyAnalyseBtn').textContent = '✓ Copié';
    setTimeout(() => { $('copyAnalyseBtn').innerHTML = SVG_COPY + ' Copier'; }, 2000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 3 — CHAT JURIDIQUE
// ══════════════════════════════════════════════════════════════════════════════

$('newChatBtn') && $('newChatBtn').addEventListener('click', () => {
  state.chatHistory = [];
  const messages = $('chatMessages');
  if (!messages) return;
  messages.innerHTML = `
    <div class="message ai">
      <div class="message-avatar">⚖</div>
      <div>
        <div class="message-bubble md-content">
          <p>Nouvelle conversation démarrée. Comment puis-je vous assister, ${escapeHtml(state.lawyer)} ?</p>
        </div>
        <div class="message-time">Jurisia · maintenant</div>
      </div>
    </div>`;
});

$('chatList') && $('chatList').addEventListener('click', e => {
  const item = e.target.closest('.chat-list-item');
  if (!item) return;
  $('chatList').querySelectorAll('.chat-list-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
});

$('chatSendBtn') && $('chatSendBtn').addEventListener('click', sendChat);
$('chatInput')   && $('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); }
  // Auto-resize
  setTimeout(() => {
    const ta = $('chatInput');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, 0);
});

$('attachFileBtn') && $('attachFileBtn').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type   = 'file';
  inp.accept = '.pdf,.doc,.docx,.txt';
  inp.onchange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.chatContext = { name: file.name, content: '' };
    if ($('chatContextName')) $('chatContextName').textContent = file.name;
    const pill = $('chatContextPill');
    show(pill);
    if (pill) pill.style.display = 'inline-flex';
    readFileText(file).then(text => { if (state.chatContext) state.chatContext.content = text; }).catch(() => {});
  };
  inp.click();
});

function removeChatContext() {
  state.chatContext = null;
  hide($('chatContextPill'));
}

async function sendChat() {
  if (state.isStreaming) return;
  const input = $('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (!state.apiKey && !state.demoMode) { openModal(); return; }

  input.value = '';
  input.style.height = 'auto';

  appendMessage('user', text);
  state.chatHistory.push({ role: 'user', content: text });

  // Build AI message bubble
  const aiId  = 'ai-' + Date.now();
  const wrap  = $('chatMessages');
  const aiEl  = document.createElement('div');
  aiEl.className = 'message ai';
  aiEl.id        = aiId;
  aiEl.innerHTML = `
    <div class="message-avatar">⚖</div>
    <div style="flex:1;min-width:0;">
      <div class="message-bubble md-content" id="${aiId}-bubble">
        <div class="typing-dots"><span></span><span></span><span></span></div>
      </div>
      <div class="message-time">Jurisia · maintenant</div>
    </div>`;
  wrap.appendChild(aiEl);
  wrap.scrollTop = wrap.scrollHeight;

  const bubble = $(`${aiId}-bubble`);
  state.isStreaming = true;

  if (state.demoMode) {
    // Demo: fake streaming
    await sleep(800);
    const demoReply = getDemoChatReply(text);
    bubble.innerHTML = '';
    await fakeStreamEl(bubble, demoReply);
    state.chatHistory.push({ role: 'assistant', content: demoReply });
    state.isStreaming = false;
    return;
  }

  await sendChatMessage(
    state.chatHistory,
    state.chatContext,
    state.apiKey,
    (_, full) => {
      bubble.innerHTML = renderMarkdown(full) + '<span class="stream-cursor">▋</span>';
      wrap.scrollTop   = wrap.scrollHeight;
    },
    (full) => {
      state.isStreaming = false;
      bubble.innerHTML  = renderMarkdown(full);
      state.chatHistory.push({ role: 'assistant', content: full });
      wrap.scrollTop    = wrap.scrollHeight;
    },
    (err) => {
      state.isStreaming = false;
      bubble.innerHTML  = `<div class="stream-error">⚠ ${escapeHtml(err)}</div>`;
    },
  );
}

function appendMessage(role, content) {
  const messages = $('chatMessages');
  if (!messages) return;
  const el   = document.createElement('div');
  el.className = `message ${role}`;
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (role === 'user') {
    el.innerHTML = `
      <div>
        <div class="message-bubble">${escapeHtml(content)}</div>
        <div class="message-time" style="text-align:right;">Vous · ${time}</div>
      </div>
      <div class="message-avatar">SM</div>`;
  }
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function sendToChatWithQuery(title) {
  if ($('chatInput')) $('chatInput').value = `Analysez en profondeur la décision suivante : ${title}`;
  showView('chat');
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 4 — RÉDACTION ASSISTÉE
// ══════════════════════════════════════════════════════════════════════════════

$('generateBtn') && $('generateBtn').addEventListener('click', generateDocument);

async function generateDocument() {
  const actType = $('actType')?.value      || '';
  const parties = $('actParties')?.value.trim() || '';
  const context = $('actContext')?.value.trim()  || '';

  if (!actType) { $('actType')?.focus(); return; }
  if (!state.apiKey && !state.demoMode) { openModal(); return; }

  const typeLabels = {
    assignation:        'Assignation en justice',
    contrat_prestation: 'Contrat de prestation de services',
    mise_en_demeure:    'Mise en demeure',
    conclusions:        'Conclusions en défense',
    ccession_parts:     'Acte de cession de parts sociales',
    nda:                'Accord de confidentialité (NDA)',
    transaction:        'Protocole transactionnel',
    bail_commercial:    'Bail commercial',
  };

  const typeLabel = typeLabels[actType] || actType;
  const prompt    = `Rédige un ${typeLabel} complet et professionnel en droit français.
${parties ? `Parties : ${parties}` : ''}
${context ? `Instructions complémentaires : ${context}` : ''}

L'acte doit : être formellement correct selon les usages du Barreau de Paris, utiliser le vocabulaire juridique approprié, référencer les textes de loi applicables (Code civil, Code de commerce, etc.), et inclure toutes les clauses standard. Commence par les mentions obligatoires (date, lieu, parties) puis développe chaque article numéroté.`;

  const editor = $('editorContent');
  if (!editor) return;
  editor.value = '';
  if ($('editorStatus')) $('editorStatus').textContent = 'Génération en cours…';

  if (state.demoMode) {
    await sleep(1500);
    editor.value = getDemoDocument(typeLabel, parties);
    updateWordCount();
    if ($('editorStatus')) $('editorStatus').textContent = 'Document généré (démo) ✓';
    return;
  }

  await streamToCallback(
    [{ role: 'user', content: prompt }],
    SYSTEM_PROMPTS.redaction,
    state.apiKey,
    (_, full) => { editor.value = full; updateWordCount(); },
    ()        => { if ($('editorStatus')) $('editorStatus').textContent = 'Document généré ✓'; },
    (err)     => {
      editor.value = `⚠ Erreur : ${err}`;
      if ($('editorStatus')) $('editorStatus').textContent = 'Erreur';
    },
  );
}

function updateWordCount() {
  const editor = $('editorContent');
  if (!editor || !$('wordCount')) return;
  const words = editor.value.trim().split(/\s+/).filter(Boolean).length;
  $('wordCount').textContent = `${words} mot${words !== 1 ? 's' : ''}`;
}

$('editorContent') && $('editorContent').addEventListener('input', updateWordCount);

$('clearEditorBtn') && $('clearEditorBtn').addEventListener('click', () => {
  if ($('editorContent')) $('editorContent').value = '';
  updateWordCount();
  if ($('editorStatus')) $('editorStatus').textContent = 'Prêt';
});

$('exportDocBtn') && $('exportDocBtn').addEventListener('click', () => {
  const content = $('editorContent')?.value || '';
  if (!content.trim()) return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'Jurisia_acte_juridique.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// AI suggestion in editor
$('aiSuggestBtn') && $('aiSuggestBtn').addEventListener('click', async () => {
  if (!state.apiKey && !state.demoMode) { openModal(); return; }
  const editor = $('editorContent');
  if (!editor || !editor.value.trim()) return;

  const box = $('aiSuggestionBox');
  const txt = $('suggestionText');
  show(box);
  if (txt) txt.textContent = 'Chargement…';

  if (state.demoMode) {
    await sleep(900);
    if (txt) txt.textContent = 'Les parties conviennent expressément que toute notification devra être effectuée par lettre recommandée avec accusé de réception à l\'adresse indiquée à l\'en-tête, et que le délai de notification courra à compter de la date de première présentation.';
    return;
  }

  await streamToCallback(
    [{ role: 'user', content: `Texte juridique en cours :\n\n${editor.value.slice(-2000)}\n\nSuggère le paragraphe ou la clause suivante à insérer (80 mots max, français juridique formel).` }],
    SYSTEM_PROMPTS.redaction,
    state.apiKey,
    (_, full) => { if (txt) txt.textContent = full; },
    (full)    => { if (txt) txt.textContent = full; },
    (err)     => { if (txt) txt.textContent = '⚠ ' + err; },
  );
});

$('acceptSuggestion') && $('acceptSuggestion').addEventListener('click', () => {
  const editor = $('editorContent');
  const txt    = $('suggestionText');
  if (editor && txt) { editor.value += '\n\n' + txt.textContent; updateWordCount(); }
  hide($('aiSuggestionBox'));
});

$('dismissSuggestion') && $('dismissSuggestion').addEventListener('click', () => {
  hide($('aiSuggestionBox'));
});

// ══════════════════════════════════════════════════════════════════════════════
// DEMO DATA
// ══════════════════════════════════════════════════════════════════════════════

function buildDemoSearchResults(query, sources) {
  return {
    synthese: `La question posée porte sur un domaine central du droit français. La jurisprudence constante de la Cour de cassation et du Conseil d'État a progressivement affiné les conditions d'application de ces principes, en particulier depuis la réforme du droit des contrats opérée par l'ordonnance du 10 février 2016. Les arrêts sélectionnés ci-dessous illustrent l'évolution récente de la jurisprudence sur ce point. (Mode démo — connectez votre clé API pour des résultats réels)`,
    results: [
      {
        title: 'Cass. civ. 1re, 13 octobre 1998',
        reference: 'n° 96-21.485',
        court: 'Cour de cassation',
        date: '13 octobre 1998',
        source: sources.includes('cassation') ? 'cassation' : sources[0],
        excerpt: 'La gravité du comportement d\'une partie peut justifier que l\'autre résilie unilatéralement le contrat à ses risques et périls, lorsque l\'urgence commande cette décision immédiate.',
        risk_level: 'élevé',
        confidence: 92,
      },
      {
        title: 'Cass. com., 10 juillet 2012',
        reference: 'n° 11-21.954',
        court: 'Cour de cassation',
        date: '10 juillet 2012',
        source: sources.includes('cassation') ? 'cassation' : sources[0],
        excerpt: 'La clause pénale est celle par laquelle les parties évaluent forfaitairement et d\'avance l\'indemnité à laquelle donnera lieu l\'inexécution de l\'obligation. Le juge peut la réduire si elle est manifestement excessive.',
        risk_level: 'modéré',
        confidence: 88,
      },
      {
        title: 'CE, Ass., 8 février 2007',
        reference: 'n° 287110, Arcelor',
        court: 'Conseil d\'État',
        date: '8 février 2007',
        source: sources.includes('conseil_etat') ? 'conseil_etat' : sources[0],
        excerpt: 'Le principe de précaution s\'applique dans les situations d\'incertitude scientifique sur l\'existence d\'un risque, et impose aux autorités de prendre des mesures proportionnées pour en prévenir la réalisation.',
        risk_level: 'critique',
        confidence: 95,
      },
      {
        title: 'CJUE, 5 juin 2018',
        reference: 'aff. C-210/16, Wirtschaftsakademie',
        court: 'Cour de Justice de l\'UE',
        date: '5 juin 2018',
        source: sources.includes('cjue') ? 'cjue' : sources[0],
        excerpt: 'L\'exploitant d\'une page sur un réseau social est responsable conjoint du traitement des données à caractère personnel, au sens de l\'article 2 de la directive 95/46/CE.',
        risk_level: 'faible',
        confidence: 85,
      },
    ],
    points_cles: [
      'Principe de proportionnalité dans l\'appréciation des clauses contractuelles',
      'Rôle modérateur du juge face aux clauses pénales manifestement excessives',
      'Évolution jurisprudentielle post-réforme du droit des contrats (Ord. 2016)',
    ],
  };
}

function buildDemoAnalysis(docName) {
  return {
    global_score: 62,
    risk_level:   'élevé',
    summary: `## Analyse du document : ${docName}

Le présent accord présente un **niveau de risque élevé** (62/100) pour la partie réceptrice, en raison de plusieurs clauses déséquilibrées identifiées lors de l'analyse.

### Points critiques
L'article relatif à la **pénalité conventionnelle** (100 000 € par violation) est potentiellement excessif au sens de l'article 1231-5 du Code civil, qui permet au juge de réduire une clause pénale manifestement excessive. La jurisprudence constante de la Cour de cassation (Cass. civ. 3e, 29 janvier 2020) confirme que ce montant pourrait être contesté en justice.

### Durée et renouvellement
La durée des obligations de confidentialité (5 ans post-contrat) est conforme aux pratiques du marché, mais dépasse la durée recommandée pour des informations à valeur commerciale limitée.

### Recommandation générale
Il est fortement recommandé de négocier la réduction de la clause pénale à un montant raisonnable et proportionné au préjudice effectivement subi, et d'encadrer précisément les catégories d'informations confidentielles.`,
    clauses: [
      { title: 'Clause pénale', article: 'Art. 5', excerpt: 'Une pénalité conventionnelle de 100 000 euros par violation...', risk: 'critical', recommendation: 'Réduire à 20 000-30 000 € ou lier à la preuve du préjudice effectif. Ajouter une limitation au préjudice réel.', legal_ref: 'Art. 1231-5 C. civ.' },
      { title: 'Durée des obligations', article: 'Art. 3', excerpt: 'survivront pendant une période de CINQ (5) ANS', risk: 'medium', recommendation: 'Différencier la durée selon la nature des informations : 2 ans pour les infos commerciales, 5 ans pour les secrets techniques.', legal_ref: 'Art. L151-1 C. com.' },
      { title: 'Retour des informations', article: 'Art. 6', excerpt: 'restituer ou détruire immédiatement et sans délai', risk: 'medium', recommendation: 'Préciser un délai raisonnable (15 jours ouvrés) et exclure les copies de sauvegarde obligatoires conservées pour raisons légales.', legal_ref: 'Art. 6 RGPD' },
      { title: 'Définition des informations confidentielles', article: 'Art. 1', excerpt: 'toutes informations, données, documents, analyses...', risk: 'high', recommendation: 'La définition est trop large et pourrait englober des informations qui deviennent publiques. Ajouter une liste positive des catégories concernées.', legal_ref: 'Art. 1104 C. civ.' },
      { title: 'Exceptions à la confidentialité', article: 'Art. 4', excerpt: 'ne s\'appliquent pas aux informations...', risk: 'low', recommendation: 'Clause équilibrée. Vérifier cependant la charge de la preuve pour les exceptions.', legal_ref: 'Art. L151-2 C. com.' },
      { title: 'Droit applicable et juridiction', article: 'Art. 7', excerpt: 'Tout litige sera soumis à la compétence exclusive des tribunaux de Paris', risk: 'low', recommendation: 'Clause standard et acceptable. Envisager une clause de médiation préalable obligatoire.', legal_ref: 'Art. 48 CPC' },
    ],
    jurisprudence: [
      { title: 'Cass. civ. 3e, 29 janvier 2020', reference: 'n° 18-24.757', source: 'cassation', date: '29 janvier 2020', excerpt: 'La clause pénale peut être réduite par le juge lorsqu\'elle est manifestement excessive par rapport au préjudice réellement subi, même en l\'absence de demande expresse en ce sens.' },
      { title: 'Cass. com., 14 mars 2018', reference: 'n° 16-22.013', source: 'cassation', date: '14 mars 2018', excerpt: 'La définition excessivement large des informations confidentielles peut rendre une clause de confidentialité partiellement nulle pour atteinte disproportionnée à la liberté du commerce.' },
      { title: 'CA Paris, 12 septembre 2019', reference: 'n° 17/12345', source: 'legifrance', date: '12 septembre 2019', excerpt: 'Le délai de restitution "immédiate" sans délai de grâce a été jugé contraire à la bonne foi contractuelle en l\'absence de circonstances exceptionnelles justifiant l\'urgence.' },
    ],
    recommendations: [
      'Réduire la clause pénale à 20 000 € maximum ou la conditionner à la preuve d\'un préjudice réel et documenté (Art. 1231-5 C. civ.)',
      'Préciser et limiter la définition des informations confidentielles à une liste exhaustive de catégories identifiables',
      'Accorder un délai de restitution de 15 jours ouvrés et prévoir une exception pour les copies de sauvegarde légales obligatoires',
      'Différencier les durées de confidentialité selon la nature des informations : 2 ans pour les données commerciales, 5 ans pour les secrets industriels',
      'Insérer une clause de médiation préalable obligatoire avant tout recours judiciaire',
      'Ajouter une clause de limitation de responsabilité globale plafonnée au montant du contrat principal',
    ],
  };
}

// ── Meridian Capital × Artefact Conseil — wow-demo NDA ────────────────────────

function getMeridianNdaDemoContent() {
  return `ACCORD DE CONFIDENTIALITÉ (NDA)

À Paris, le 8 janvier 2026

ENTRE LES SOUSSIGNÉS :

MERIDIAN CAPITAL SAS, société par actions simplifiée au capital de 3 000 000 euros,
immatriculée au RCS de Paris sous le numéro 920 435 812,
dont le siège social est situé 15, place Vendôme, 75001 Paris,
représentée par Monsieur Étienne Beaumont, Président,
ci-après désignée « la Partie Initiatrice »,

ET :

ARTEFACT CONSEIL SARL, société à responsabilité limitée au capital de 500 000 euros,
immatriculée au RCS de Lyon sous le numéro 724 581 036,
dont le siège social est situé 23, quai Jules Courmont, 69002 Lyon,
représentée par Madame Claire Vidal, Gérante,
ci-après désignée « la Partie Réceptrice ».

PRÉAMBULE

Dans le cadre de la négociation d'un partenariat stratégique portant sur le développement et la commercialisation d'une solution de data intelligence destinée aux marchés financiers européens, les parties sont amenées à s'échanger des informations hautement confidentielles. Afin de préserver leurs intérêts respectifs, elles ont décidé de formaliser leurs obligations par le présent accord, régi notamment par les dispositions des articles 1226 et suivants du Code civil relatifs à la clause pénale et aux obligations contractuelles.

ARTICLE 1 — DÉFINITION DES INFORMATIONS CONFIDENTIELLES

Sont réputées confidentielles, au sens du présent accord, toutes informations, quelles que soient leur nature et leur forme (écrite, orale, électronique, visuelle), communiquées directement ou indirectement par la Partie Initiatrice à la Partie Réceptrice, notamment : données financières et bilans prévisionnels, plans stratégiques et roadmaps technologiques, algorithmes propriétaires et code source, listes de clients et partenaires commerciaux, conditions tarifaires, et toute information désignée comme confidentielle lors de sa transmission.

ARTICLE 2 — OBLIGATIONS DE CONFIDENTIALITÉ

La Partie Réceptrice s'engage à (a) maintenir la stricte confidentialité des Informations Confidentielles ; (b) ne les communiquer qu'aux membres de son personnel strictement habilités et soumis à des obligations équivalentes ; (c) ne les utiliser qu'aux seules fins des négociations susvisées ; (d) mettre en œuvre toutes mesures de sécurité raisonnables pour en empêcher la divulgation non autorisée.

ARTICLE 3 — DURÉE ET RENOUVELLEMENT

Le présent accord prend effet à sa date de signature et demeure en vigueur pendant une période de TROIS (3) ANS. Les obligations de confidentialité survivront à l'expiration ou à la résiliation anticipée du présent accord pour une même durée de trois ans. À défaut de dénonciation par l'une ou l'autre des parties six (6) mois avant l'échéance, le présent accord est reconduit automatiquement pour des périodes successives d'un (1) an.

ARTICLE 4 — PÉRIMÈTRE GÉOGRAPHIQUE

Les obligations stipulées au présent accord s'appliquent sur l'ensemble du territoire de l'Union européenne, incluant l'Espace économique européen et la Suisse. Toute utilisation ou divulgation des Informations Confidentielles hors de ce périmètre est expressément prohibée sans accord écrit préalable de la Partie Initiatrice.

ARTICLE 5 — EXCEPTIONS

Les obligations du présent accord ne s'appliquent pas aux informations : (a) tombées dans le domaine public indépendamment d'une faute de la Partie Réceptrice ; (b) connues de la Partie Réceptrice antérieurement à leur communication, sur justification documentaire ; (c) reçues de tiers autorisés à les divulguer ; (d) dont la divulgation est imposée par une autorité judiciaire ou réglementaire compétente, sous réserve d'en informer préalablement la Partie Initiatrice dans les meilleurs délais.

ARTICLE 6 — PROPRIÉTÉ INTELLECTUELLE

Aucune disposition du présent accord ne saurait conférer à la Partie Réceptrice une licence, un droit ou un titre sur les Informations Confidentielles ou sur les droits de propriété intellectuelle qui s'y attachent. L'ensemble des droits demeure la propriété exclusive de la Partie Initiatrice.

ARTICLE 7 — RETOUR ET DESTRUCTION DES INFORMATIONS

À la demande de la Partie Initiatrice ou à l'expiration du présent accord, la Partie Réceptrice s'engage à restituer ou détruire, dans un délai de quinze (15) jours ouvrés, toutes les Informations Confidentielles reçues, en toutes formes et supports, ainsi que toute copie, analyse ou dérivé. Une attestation de destruction sera adressée à la Partie Initiatrice dans ce délai.

ARTICLE 8 — PÉNALITÉS CONVENTIONNELLES

Tout manquement aux obligations du présent accord, dûment constaté, rendra la Partie Réceptrice redevable d'une pénalité conventionnelle d'un montant de cent cinquante mille euros (150 000 €) par violation, exigible immédiatement et sans mise en demeure préalable, conformément aux articles 1226 et suivants du Code civil. Cette pénalité ne fait pas obstacle au droit de la Partie Initiatrice de réclamer des dommages et intérêts complémentaires sur justification du préjudice réel subi.

ARTICLE 9 — NON-SOLLICITATION DES COLLABORATEURS

Les parties renoncent à solliciter, directement ou par personne interposée, tout collaborateur, dirigeant ou consultant de l'autre partie ayant participé aux négociations ou à l'exécution du présent accord, pendant une période de VINGT-QUATRE (24) MOIS suivant la cessation des relations entre les parties, sur l'ensemble du territoire de l'Union européenne. Cette interdiction vise également toute forme de débauchage indirect via des tiers ou des plateformes de recrutement.

ARTICLE 10 — ENTRÉES EN VIGUEUR ET MODIFICATIONS

Toute modification du présent accord devra faire l'objet d'un avenant écrit, signé par les représentants dûment habilités des deux parties. Aucun retard ou omission dans l'exercice d'un droit prévu par le présent accord ne saurait être interprété comme une renonciation à ce droit.

ARTICLE 11 — INDÉPENDANCE DES CLAUSES

La nullité éventuelle d'une clause du présent accord n'affectera pas les autres stipulations, qui demeureront en vigueur dans toutes leurs dispositions. Les parties s'engagent à remplacer toute clause nulle par une stipulation ayant un effet économique équivalent.

ARTICLE 12 — CONFIDENTIALITÉ DE L'ACCORD

L'existence même du présent accord est confidentielle. Les parties s'interdisent d'en révéler la teneur à des tiers sans accord préalable de l'autre partie, sauf obligation légale ou réglementaire.

ARTICLE 13 — FORCE MAJEURE

Aucune partie ne pourra être tenue responsable d'un manquement à ses obligations résultant d'un événement de force majeure au sens de l'article 1218 du Code civil, sous réserve d'en notifier l'autre partie dans les 48 heures suivant sa survenance.

ARTICLE 14 — DROIT APPLICABLE ET JURIDICTION COMPÉTENTE

Le présent accord est soumis exclusivement au droit français. En cas de litige relatif à son interprétation, à sa validité ou à son exécution, les parties s'engagent à rechercher une solution amiable dans un délai de trente (30) jours. À défaut, tout litige sera porté devant le Tribunal de Commerce de Paris, auquel les parties attribuent compétence exclusive, y compris pour les mesures d'urgence et les procédures de référé.

Fait à Paris, en deux exemplaires originaux,
Le 8 janvier 2026.

Pour MERIDIAN CAPITAL SAS                    Pour ARTEFACT CONSEIL SARL
Étienne Beaumont, Président                  Claire Vidal, Gérante`;
}

function getMeridianDemoAnalysis() {
  return {
    global_score: 67,
    risk_level:   'modéré',
    summary: `## Analyse du NDA — Meridian Capital SAS × Artefact Conseil SARL

Ce NDA présente un **niveau de risque modéré (67/100)**. La clause pénale sans mise en demeure préalable constitue le point de vigilance principal, exposant la Partie Réceptrice à une pénalité immédiate de 150 000 € sur simple constat de violation, sans délai de régularisation.

### Points de vigilance

La **clause de non-sollicitation** (Art. 9) à 24 mois sur le territoire européen est à la limite supérieure de ce qu'admet la jurisprudence française. Cumulée avec l'étendue géographique (UE + EEE + Suisse), cette combinaison durée/périmètre pourrait être contestée pour déséquilibre significatif.

### Conclusion

Les clauses de juridiction exclusive (Art. 14) et de définition des informations confidentielles (Art. 1) sont conformes aux standards du marché français. Il est fortement recommandé de négocier la clause pénale pour conditionner son exigibilité à une mise en demeure, et de réduire la non-sollicitation à 12 mois pour sécuriser l'accord.`,
    clauses: [
      {
        title: 'Clause pénale — Art. 8',
        article: 'Art. 8',
        excerpt: 'En cas de violation, une pénalité forfaitaire de 150 000 € sera exigible immédiatement et sans mise en demeure préalable.',
        risk: 'high',
        recommendation: 'Négocier un plafond progressif et conditionner l\'exigibilité à une mise en demeure restée sans effet sous 15 jours. Voir jurisprudence constante de la Cour de cassation sur ce point.',
        legal_ref: 'Art. 1231-5 Code civil',
      },
      {
        title: 'Non-sollicitation — Art. 9',
        article: 'Art. 9',
        excerpt: 'Interdiction de solliciter tout collaborateur des parties pendant 24 mois post-contrat sur l\'ensemble du territoire européen.',
        risk: 'medium',
        recommendation: 'La durée de 24 mois est à la limite de ce qu\'admet la jurisprudence française. Limiter à 12 mois ou restreindre le périmètre géographique. Voir jurisprudence constante en la matière.',
        legal_ref: 'Art. L.1237-19 Code du travail',
      },
      {
        title: 'Juridiction exclusive — Art. 14',
        article: 'Art. 14',
        excerpt: 'Tout litige sera soumis à la compétence exclusive du Tribunal de Commerce de Paris, y compris pour les mesures d\'urgence.',
        risk: 'low',
        recommendation: 'Clause standard et équilibrée. Envisager d\'ajouter une clause d\'arbitrage ICC pour les litiges supérieurs à 500 000 €.',
        legal_ref: 'Art. 48 CPC',
      },
      {
        title: 'Durée et renouvellement — Art. 3',
        article: 'Art. 3',
        excerpt: 'Accord conclu pour 3 ans, renouvelable par tacite reconduction pour des périodes successives d\'un an.',
        risk: 'medium',
        recommendation: 'Prévoir une clause de dénonciation avec préavis de 90 jours minimum avant échéance pour éviter le renouvellement automatique non souhaité.',
        legal_ref: 'Art. 1210 Code civil',
      },
    ],
    jurisprudence: [
      {
        title: 'Cass. com., 18 janvier 2026',
        reference: 'n° 21-16.812',
        source: 'cassation',
        date: '18 janvier 2026',
        excerpt: 'La clause pénale est réductible par le juge lorsqu\'elle est manifestement excessive et que son exigibilité sans mise en demeure préalable constitue un déséquilibre significatif entre les parties au sens de l\'article 1231-5 du Code civil.',
      },
      {
        title: 'CA Paris, 3 mai 2026',
        reference: 'n° 24/08741',
        source: 'legifrance',
        date: '3 mai 2026',
        excerpt: 'La clause de non-sollicitation couvrant l\'ensemble du territoire de l\'Union européenne pendant 24 mois a été jugée disproportionnée en l\'absence de contrepartie financière identifiable pour la partie contrainte.',
      },
    ],
    recommendations: [
      'Conditionner la clause pénale (Art. 8) à une mise en demeure préalable de 15 jours restée sans effet, et prévoir un plafond dégressif selon la gravité de la violation',
      'Limiter la non-sollicitation (Art. 9) à 12 mois maximum et au périmètre France + Benelux, ou prévoir une contrepartie financière proportionnelle à la contrainte imposée',
      'Ajouter une clause de limitation de responsabilité globale plafonnée à 3× les honoraires annuels du contrat principal, conformément aux usages du Barreau de Paris',
      'Insérer une clause de médiation préalable obligatoire (Médiateur du Commerce International) avant tout recours judiciaire, pour réduire les coûts en cas de litige',
    ],
  };
}

function getDemoChatReply(userMessage) {
  const lc = userMessage.toLowerCase();
  if (lc.includes('non-concurrence') || lc.includes('concurrence')) {
    return `## Clause de non-concurrence en droit du travail français

**Conditions de validité** (jurisprudence constante depuis *Cass. soc., 10 juillet 2002, n° 99-43.334*) :

1. **Indispensable** à la protection des intérêts légitimes de l'entreprise
2. **Limitée dans le temps** (généralement 1 à 2 ans maximum)
3. **Limitée dans l'espace** (territoire géographiquement défini)
4. **Assortie d'une contrepartie financière** (au moins 30% du salaire mensuel selon les usages)

### Points clés
- Une clause sans contrepartie financière est **nulle de plein droit** (*Cass. soc., 10 juil. 2002*)
- Le juge peut réduire une clause excessive mais ne peut la compléter
- L'employeur peut renoncer à la clause lors de la rupture, dans les délais prévus

### Prochaines étapes
- Vérifier la présence de ces 4 conditions cumulatives
- Calculer la contrepartie financière due
- Anticiper la gestion à la rupture du contrat

*Note : ces informations sont en mode démo. Connectez votre clé API pour une analyse personnalisée.*`;
  }
  return `## Réponse juridique (Mode démo)

Votre question porte sur un point de droit important. En mode démo, je vous fournis une réponse générique.

**Pour obtenir une analyse personnalisée et précise**, veuillez :
1. Configurer votre clé API Anthropic dans les Paramètres
2. Relancer votre question

La plateforme Jurisia utilise **Claude ${MODEL}** pour des analyses juridiques en droit français et européen, avec citations jurisprudentielles précises.

*Connectez votre clé API pour accéder à l'assistant juridique complet.*`;
}

function getDemoDocument(type, parties) {
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${type.toUpperCase()}

À Paris, le ${today}

ENTRE LES SOUSSIGNÉS :
${parties || 'SOCIÉTÉ ALPHA SAS et SOCIÉTÉ BETA SARL'}

[Document généré en mode démo — connectez votre clé API Anthropic pour générer un vrai ${type} complet et personnalisé avec Claude ${MODEL}]

PRÉAMBULE
Les parties ont convenu de conclure le présent acte dans le respect des dispositions légales applicables...

ARTICLE 1 — OBJET
Le présent acte a pour objet...

ARTICLE 2 — DURÉE
...

ARTICLE 3 — CONDITIONS
...

[Cliquez sur "Paramètres API", saisissez votre clé Anthropic, puis relancez la génération pour obtenir un document complet en français juridique formel.]`;
}

// ── NDA Demo Content ─────────────────────────────────────────────────────────
function getNdaDemoContent() {
  return `ACCORD DE CONFIDENTIALITÉ (NDA)

À Paris, le 15 mars 2026

ENTRE LES SOUSSIGNÉS :

INNOVATECH SAS, société par actions simplifiée, au capital de 250 000 euros,
immatriculée au RCS de Paris sous le numéro 882 156 473,
dont le siège social est situé 42, avenue des Champs-Élysées, 75008 Paris,
représentée par Madame Isabelle Fontaine, Directrice Générale,
ci-après désignée "la Partie Divulgatrice",

ET :

NEXUM CONSULTING SARL, société à responsabilité limitée, au capital de 100 000 euros,
immatriculée au RCS de Lyon sous le numéro 512 784 921,
dont le siège social est situé 15, rue de la République, 69001 Lyon,
représentée par Monsieur Frédéric Morel, Gérant,
ci-après désignée "la Partie Réceptrice".

PRÉAMBULE
Dans le cadre de pourparlers en vue d'un éventuel partenariat commercial relatif au développement d'une solution logicielle d'intelligence artificielle, les parties souhaitent s'échanger des informations confidentielles. Afin de protéger ces informations, elles ont convenu de conclure le présent accord de confidentialité.

ARTICLE 1 — DÉFINITION DES INFORMATIONS CONFIDENTIELLES
Sont considérées comme confidentielles toutes informations, données, documents, analyses, études, know-how, secrets commerciaux, codes sources, algorithmes, données clients, données financières, stratégies commerciales, procédés techniques, et plus généralement toute information de nature professionnelle ou commerciale communiquée par la Partie Divulgatrice à la Partie Réceptrice, sous quelque forme que ce soit (orale, écrite, électronique ou autre).

ARTICLE 2 — OBLIGATIONS DE CONFIDENTIALITÉ
La Partie Réceptrice s'engage à :
(a) Ne pas divulguer les Informations Confidentielles à des tiers sans accord préalable écrit et exprès de la Partie Divulgatrice ;
(b) Utiliser les Informations Confidentielles exclusivement aux fins des négociations prévues au Préambule ;
(c) Protéger les Informations Confidentielles avec le même degré de soin qu'elle accorde à ses propres informations confidentielles, et en tout état de cause avec un soin raisonnable ;
(d) Limiter l'accès aux Informations Confidentielles aux seuls membres de son personnel qui ont besoin d'en connaître pour les fins susmentionnées, et s'assurer que ces personnes sont liées par des obligations de confidentialité équivalentes.

ARTICLE 3 — DURÉE
Le présent accord est conclu pour une durée indéterminée. Les obligations de confidentialité survivront pendant une période de CINQ (5) ANS après la cessation des relations entre les parties, quelle qu'en soit la cause.

ARTICLE 4 — EXCEPTIONS
Les obligations de confidentialité ne s'appliquent pas aux informations qui :
(a) Sont ou deviennent publiques sans faute de la Partie Réceptrice ;
(b) Étaient connues de la Partie Réceptrice avant leur divulgation, comme en atteste une preuve documentaire antérieure ;
(c) Sont développées indépendamment par la Partie Réceptrice sans utilisation des Informations Confidentielles ;
(d) Doivent être divulguées en application d'une obligation légale ou réglementaire, sous réserve d'en informer préalablement la Partie Divulgatrice dans les meilleurs délais.

ARTICLE 5 — SANCTIONS
Tout manquement aux obligations du présent accord exposera la Partie Réceptrice au paiement de dommages et intérêts. Une pénalité conventionnelle de cent mille euros (100 000 €) par violation constatée est expressément convenue entre les parties, sans préjudice de tous autres dommages et intérêts complémentaires.

ARTICLE 6 — RETOUR DES INFORMATIONS
À la demande de la Partie Divulgatrice, formulée à tout moment, la Partie Réceptrice s'engage à restituer ou à détruire immédiatement et sans délai toutes les Informations Confidentielles reçues, sous quelque forme que ce soit, ainsi que toutes les copies, notes ou analyses s'y rapportant.

ARTICLE 7 — DROIT APPLICABLE ET JURIDICTION COMPÉTENTE
Le présent accord est soumis au droit français. En cas de litige relatif à l'interprétation ou à l'exécution du présent accord, les parties s'engagent à rechercher une solution amiable. À défaut d'accord amiable dans un délai de trente (30) jours, tout litige sera soumis à la compétence exclusive des tribunaux de Paris, nonobstant pluralité de défendeurs ou appel en garantie.

Fait à Paris, en deux exemplaires originaux,
Le 15 mars 2026

Pour INNOVATECH SAS                    Pour NEXUM CONSULTING SARL
Isabelle Fontaine                      Frédéric Morel
Directrice Générale                    Gérant`;
}

function getGenericDemoContent(name) {
  return `CONTRAT DE PRESTATION DE SERVICES — ${name}

Entre TechCorp SAS (le Client) et ServicePro SARL (le Prestataire).

ARTICLE 1 — OBJET : fourniture de services de développement informatique.
ARTICLE 3 — DURÉE : 1 an, renouvellement tacite sans notification préalable.
ARTICLE 8 — NON-CONCURRENCE : 3 ans sur tout territoire mondial.
ARTICLE 11 — PÉNALITÉS : 10% par jour de retard sans mise en demeure préalable.
ARTICLE 12 — RÉSILIATION : résiliation unilatérale possible sans préavis ni indemnité.
ARTICLE 15 — RESPONSABILITÉ : plafond limité à 1 mois de facturation.`;
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Render text into an element with a fake streaming effect */
function fakeStream(el, text, speedMs = 8) {
  return new Promise(resolve => {
    el.innerHTML = '';
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(i + 4, text.length);
      el.innerHTML = renderMarkdown(text.slice(0, i)) + (i < text.length ? '<span class="stream-cursor">▋</span>' : '');
      if (el.parentElement) el.parentElement.scrollTop = el.parentElement.scrollHeight;
      if (i >= text.length) { clearInterval(timer); el.innerHTML = renderMarkdown(text); resolve(); }
    }, speedMs);
  });
}

/** Fake stream into a message bubble element */
async function fakeStreamEl(el, text, speedMs = 6) {
  el.innerHTML = '';
  let i = 0;
  return new Promise(resolve => {
    const timer = setInterval(() => {
      i = Math.min(i + 5, text.length);
      el.innerHTML = renderMarkdown(text.slice(0, i)) + (i < text.length ? '<span class="stream-cursor">▋</span>' : '');
      if (i >= text.length) { clearInterval(timer); el.innerHTML = renderMarkdown(text); resolve(); }
    }, speedMs);
  });
}

function sourceLabel(src) {
  return { cassation: 'Cour de cassation', conseil_etat: 'Conseil d\'État', cjue: 'CJUE', legifrance: 'Légifrance' }[src] || 'Jurisprudence';
}

function riskToBadge(risk) {
  const map = { critique: 'critical', critical: 'critical', élevé: 'high', eleve: 'high', high: 'high', modéré: 'medium', modere: 'medium', medium: 'medium', faible: 'low', low: 'low' };
  return map[risk?.toLowerCase()] || 'medium';
}

function riskScoreLabel(score) {
  if (score >= 75) return 'critique';
  if (score >= 50) return 'élevé';
  if (score >= 30) return 'modéré';
  return 'faible';
}

function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function truncate(str, len) {
  return str && str.length > len ? str.slice(0, len) + '…' : (str || '');
}

const SVG_COPY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

// ══════════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════════

function init() {
  updateApiStatus();
  initSettings();

  // Load API key from config.js if not in localStorage and key is set there
  if (!state.apiKey && window.JURISIA_CONFIG?.ANTHROPIC_API_KEY) {
    state.apiKey = window.JURISIA_CONFIG.ANTHROPIC_API_KEY;
    localStorage.setItem('jurisia_api_key', state.apiKey);
    updateApiStatus();
  }

  // First launch: prompt for API key after a short delay
  if (!state.apiKey) {
    setTimeout(openModal, 600);
  }
}

init();
