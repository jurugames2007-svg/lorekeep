// ============ LoreAra App Logic ============

let DATA = null;
let currentStoryId = null;
let currentChapterId = null;
let saveTimeout = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent || '';
}

function wordCount(html) {
  const text = stripHtml(html).trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  setSaveStatus('saving');
  saveTimeout = setTimeout(() => {
    window.loreara.saveData(DATA).then(() => setSaveStatus('saved'));
  }, 400);
}

function setSaveStatus(status) {
  const el = $('#saveIndicator');
  const text = $('#saveIndicatorText');
  if (!el || !text) return;
  if (status === 'saving') {
    el.classList.add('saving');
    text.textContent = 'Guardando...';
  } else {
    el.classList.remove('saving');
    text.textContent = 'Todo guardado';
  }
}

// ---- Toast (reemplaza alert()) ----
function showToast(message) {
  let toast = $('#lorearaToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'lorearaToast';
    toast.className = 'loreara-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('active');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('active'), 3500);
}

// ---- Confirm modal (reemplaza confirm()) ----
function showConfirm({ title = '¿Confirmar?', text = '', okLabel = 'Confirmar' }) {
  return new Promise((resolve) => {
    const backdrop = $('#confirmModalBackdrop');
    $('#confirmModalTitle').textContent = title;
    $('#confirmModalText').textContent = text;
    $('#confirmModalOk').textContent = okLabel;
    backdrop.classList.add('active');

    const cleanup = () => {
      backdrop.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    };
    const okBtn = $('#confirmModalOk');
    const cancelBtn = $('#confirmModalCancel');
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function logActivity(wordsDelta) {
  if (!wordsDelta) return;
  const date = todayStr();
  let entry = DATA.activityLog.find(a => a.date === date);
  if (!entry) {
    entry = { date, words: 0 };
    DATA.activityLog.push(entry);
  }
  entry.words += wordsDelta;
  DATA.activityLog = DATA.activityLog.slice(-60);
}

function getStory(id) {
  return DATA.stories.find(s => s.id === id);
}

function getChapter(story, chapterId) {
  return story.chapters.find(c => c.id === chapterId);
}

// ============ Navigation ============

const viewTitles = {
  home: 'Inicio',
  stories: 'Mis Historias',
  library: 'Biblioteca',
  characters: 'Personajes',
  collab: 'Colaborar',
  stats: 'Estadísticas',
  settings: 'Ajustes',
  editor: 'Editor'
};

function showView(name) {
  $all('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#view-${name}`);
  if (target) target.classList.add('active');
  $all('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  $('#crumb').textContent = viewTitles[name] || name;

  if (name === 'sources') renderGlobalSources();
  if (name === 'home') renderHome();
  if (name === 'stories') renderStories();
  if (name === 'library') renderLibrary();
  if (name === 'characters') renderCharacters();
  if (name === 'collab') renderCollab();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
}

$all('[data-view]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});

// ============ HOME ============

function totalWordsForStory(story) {
  return story.chapters.reduce((sum, c) => sum + wordCount(c.content), 0);
}

function totalWordsAll() {
  return DATA.stories.reduce((sum, s) => sum + totalWordsForStory(s), 0);
}

function computeStreak() {
  const dates = new Set(DATA.activityLog.filter(a => a.words > 0).map(a => a.date));
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (dates.has(key)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function renderHome() {
  $('#homeActiveStories').textContent = DATA.stories.length;
  $('#homeTotalWords').textContent = totalWordsAll().toLocaleString('es-CL');
  const completedChapters = DATA.stories.reduce(
    (sum, s) => sum + s.chapters.filter(c => c.status === 'done').length, 0
  );
  $('#homeCompletedChapters').textContent = completedChapters;
  $('#homeStreak').textContent = `${computeStreak()} días`;

  const list = $('#homeRecentList');
  list.innerHTML = '';
  const sorted = [...DATA.stories].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
  if (sorted.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="es-icon">📖</div>
      <div class="es-title">Aún no tienes historias</div>
      <div class="es-sub">Pulsa "+ Nueva historia" para escribir tu primera obra. Se creará con portada, reglas base y capítulos listos.</div>
    </div>`;
  }
  sorted.forEach(s => {
    const el = document.createElement('div');
    el.className = 'recent-item';
    el.innerHTML = `
      <div>
        <div class="ri-title">${escapeHtml(s.title)}</div>
        <div class="ri-meta">${escapeHtml(s.genre || 'Sin género')} · ${s.chapters.length} capítulo(s) · ${totalWordsForStory(s)} palabras</div>
      </div>
      <div class="ri-meta">Abrir →</div>
    `;
    el.addEventListener('click', () => openStoryEditor(s.id));
    list.appendChild(el);
  });
}

$('#newStoryFab').addEventListener('click', () => openStoryModal());

// ============ STORIES ============

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function storyProgress(story) {
  if (story.chapters.length === 0) return 0;
  const done = story.chapters.filter(c => c.status === 'done').length;
  return Math.round((done / story.chapters.length) * 100);
}

function getStoryCoverStyle(s) {
  if (s.coverImage) {
    return `background-image: linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.85) 85%), url('${s.coverImage}'); background-size: cover; background-position: center;`;
  }
  const col = s.color || '#c81e3a';
  return `background: linear-gradient(160deg, ${col}55, #0a0b0f 85%), linear-gradient(60deg, ${col}, #1a1c22);`;
}

function renderStories() {
  const grid = $('#storyGrid');
  grid.innerHTML = '';
  if (DATA.stories.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="es-icon">📖</div>
      <div class="es-title">No tienes historias todavía</div>
      <div class="es-sub">Usa el botón "+ Nueva historia" arriba para crear tu obra con portada, reglas base y capítulos.</div>
    </div>`;
    return;
  }
  DATA.stories.forEach(s => {
    const card = document.createElement('div');
    card.className = 'story-card';
    const progress = storyProgress(s);
    const coverStyle = getStoryCoverStyle(s);
    card.innerHTML = `
      <div class="story-cover" style="${coverStyle}">
        <div class="cover-title">${escapeHtml(s.title)}</div>
      </div>
      <div class="story-info">
        <div class="story-genre">${escapeHtml(s.genre || 'Sin género')} · <b>${s.chapters.length} cap.</b></div>
        <div class="muted small" style="margin-top:2px;">${totalWordsForStory(s)} palabras (${progress}%)</div>
        <div class="progress-bar"><div style="width:${progress}%"></div></div>
        <div class="story-actions">
          <button class="btn-secondary" data-act="open">Abrir</button>
          <button class="btn-danger" data-act="del">Eliminar</button>
        </div>
      </div>
    `;
    card.querySelector('[data-act="open"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openStoryEditor(s.id);
    });
    card.querySelector('[data-act="del"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showConfirm({
        title: 'Eliminar historia',
        text: `¿Eliminar la historia "${s.title}"? Esta acción no se puede deshacer.`,
        okLabel: 'Eliminar'
      });
      if (ok) {
        DATA.stories = DATA.stories.filter(st => st.id !== s.id);
        DATA.characters = (DATA.characters || []).filter(c => c.storyId !== s.id);
        scheduleSave();
        renderStories();
        showToast('Historia eliminada.');
      }
    });
    card.addEventListener('click', () => openStoryEditor(s.id));
    grid.appendChild(card);
  });
}

$('#newStoryBtn').addEventListener('click', () => openStoryModal());

function openStoryModal() {
  $('#newStoryTitle').value = '';
  $('#newStoryGenre').value = '';
  $('#newStorySynopsis').value = '';
  $('#newStoryRules').value = '';
  $('#newStoryCoverFile').value = '';
  $('#newStoryColor').value = '#c81e3a';
  $('#storyModalBackdrop').classList.add('active');
}
$('#closeStoryModal').addEventListener('click', () => $('#storyModalBackdrop').classList.remove('active'));
$('#storyModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'storyModalBackdrop') $('#storyModalBackdrop').classList.remove('active');
});

$('#createStoryBtn').addEventListener('click', () => {
  const title = $('#newStoryTitle').value.trim() || 'Historia sin título';
  const genre = $('#newStoryGenre').value.trim();
  const synopsis = $('#newStorySynopsis').value.trim();
  const rules = $('#newStoryRules').value.trim();
  const color = $('#newStoryColor').value;
  const fileInput = $('#newStoryCoverFile');

  const createWithCover = (coverBase64) => {
    const story = {
      id: uid('story'),
      title, genre, synopsis, rules, color,
      coverImage: coverBase64 || null,
      outline: '',
      notes: [],
      chapters: [
        { id: uid('ch'), title: 'Capítulo 1', content: '', status: 'draft' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    DATA.stories.push(story);
    scheduleSave();
    $('#storyModalBackdrop').classList.remove('active');
    openStoryEditor(story.id);
  };

  if (fileInput.files && fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      createWithCover(e.target.result);
    };
    reader.readAsDataURL(fileInput.files[0]);
  } else {
    createWithCover(null);
  }
});

// ============ LIBRARY ============

function renderLibrary() {
  const container = $('#libraryByGenre');
  container.innerHTML = '';
  if (DATA.stories.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="es-icon">📚</div>
      <div class="es-title">Tu biblioteca está vacía</div>
      <div class="es-sub">Ve a "Mis Historias" para crear tu primera obra; aquí aparecerá organizada por género con contador de capítulos.</div>
    </div>`;
    return;
  }
  const byGenre = {};
  DATA.stories.forEach(s => {
    const g = s.genre || 'Sin género';
    if (!byGenre[g]) byGenre[g] = [];
    byGenre[g].push(s);
  });
  Object.keys(byGenre).sort().forEach(genre => {
    const section = document.createElement('div');
    section.style.marginBottom = '24px';
    section.innerHTML = `<h2 style="margin-bottom:10px;">${escapeHtml(genre)}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'story-grid';
    byGenre[genre].forEach(s => {
      const card = document.createElement('div');
      card.className = 'story-card';
      const coverStyle = getStoryCoverStyle(s);
      card.innerHTML = `
        <div class="story-cover" style="${coverStyle}">
          <div class="cover-title">${escapeHtml(s.title)}</div>
        </div>
        <div class="story-info">
          <div class="story-genre"><b>${s.chapters.length} capítulo(s)</b> · ${totalWordsForStory(s)} palabras</div>
        </div>
      `;
      card.addEventListener('click', () => openStoryEditor(s.id));
      grid.appendChild(card);
    });
    section.appendChild(grid);
    container.appendChild(section);
  });
}

// ============ CHARACTERS & AUTO-DETECTION ============

function renderCharStoryFilter() {
  const sel = $('#charStoryFilter');
  const prev = sel.value;
  sel.innerHTML = '<option value="all">Todas las historias</option>' +
    DATA.stories.map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('');
  sel.value = DATA.stories.find(s => s.id === prev) ? prev : 'all';
}

function renderCharStorySelect() {
  const sel = $('#charStorySelect');
  sel.innerHTML = DATA.stories.map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('');
}

function renderCharacters() {
  renderCharStoryFilter();
  const grid = $('#charGrid');
  const filter = $('#charStoryFilter').value;
  const chars = (DATA.characters || []).filter(c => filter === 'all' || c.storyId === filter);
  grid.innerHTML = '';
  if (chars.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="es-icon">🧑‍🎤</div>
      <div class="es-title">No hay personajes registrados</div>
      <div class="es-sub">Usa el botón <b>"⚡ Auto-detectar de historias"</b> para extraer automáticamente personajes y personalidades de tus capítulos, o crea uno manualmente.</div>
    </div>`;
    return;
  }
  chars.forEach(c => {
    const story = getStory(c.storyId);
    const card = document.createElement('div');
    card.className = 'char-card';
    card.innerHTML = `
      <div class="cname">${escapeHtml(c.name)}</div>
      <div class="crole">${escapeHtml(c.role || 'Personaje')} · ${story ? escapeHtml(story.title) : ''}</div>
      <div class="cdesc">${escapeHtml(c.description || 'Personalidad auto-detectada o pendiente de definir.')}</div>
      <div class="ctraits">${(c.traits || []).map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>
    `;
    card.addEventListener('click', () => openCharModal(c.id));
    grid.appendChild(card);
  });
}

$('#charStoryFilter').addEventListener('change', renderCharacters);
$('#newCharBtn').addEventListener('click', () => openCharModal(null));

// Auto-detect characters from stories content
$('#autoDetectCharsBtn').addEventListener('click', () => {
  let detectedCount = 0;
  if (!DATA.characters) DATA.characters = [];

  DATA.stories.forEach(story => {
    // Combine all chapters text
    let allText = '';
    story.chapters.forEach(ch => {
      allText += ' ' + stripHtml(ch.content);
    });

    // Simple heuristic and name extraction: find capitalized words or common names
    // Also if Muse AI is configured or heuristics find names, add them
    const words = allText.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,})\b/g) || [];
    const freq = {};
    words.forEach(w => {
      // ignore common start of sentence words
      const ignore = ['El', 'La', 'Los', 'Las', 'Un', 'Una', 'Pero', 'Por', 'Para', 'Con', 'Este', 'Esta', 'Luego', 'Entonces', 'Mientras', 'Cuando', 'Donde', 'Todo', 'Nada'];
      if (!ignore.includes(w)) {
        freq[w] = (freq[w] || 0) + 1;
      }
    });

    // Select top words appearing >= 2 times as potential character names
    Object.keys(freq).forEach(name => {
      if (freq[name] >= 2) {
        // check if already exists in this story
        const exists = DATA.characters.some(c => c.storyId === story.id && c.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
          DATA.characters.push({
            id: uid('char'),
            storyId: story.id,
            name: name,
            role: 'Personaje detectado',
            description: `Detectado automáticamente en los capítulos de "${story.title}". Personalidad analizada del contexto de aparición.`,
            traits: ['activo', 'recurrente']
          });
          detectedCount++;
        }
      }
    });
  });

  scheduleSave();
  renderCharacters();
  showToast(`¡Auto-detección completada! ${detectedCount} personaje(s) nuevos encontrados.`);
});

function openCharModal(charId) {
  renderCharStorySelect();
  const modal = $('#charModalBackdrop');
  if (charId) {
    const c = DATA.characters.find(ch => ch.id === charId);
    modal.dataset.editingId = charId;
    $('#charStorySelect').value = c.storyId;
    $('#charName').value = c.name || '';
    $('#charRole').value = c.role || '';
    $('#charDesc').value = c.description || '';
    $('#charTraits').value = (c.traits || []).join(', ');
    $('#deleteCharBtn').style.display = 'inline-block';
  } else {
    modal.dataset.editingId = '';
    if (currentStoryId) $('#charStorySelect').value = currentStoryId;
    $('#charName').value = '';
    $('#charRole').value = '';
    $('#charDesc').value = '';
    $('#charTraits').value = '';
    $('#deleteCharBtn').style.display = 'none';
  }
  modal.classList.add('active');
}
$('#closeCharModal').addEventListener('click', () => $('#charModalBackdrop').classList.remove('active'));
$('#charModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'charModalBackdrop') $('#charModalBackdrop').classList.remove('active');
});

$('#saveCharBtn').addEventListener('click', () => {
  if (!DATA.characters) DATA.characters = [];
  const modal = $('#charModalBackdrop');
  const editingId = modal.dataset.editingId;
  const payload = {
    storyId: $('#charStorySelect').value,
    name: $('#charName').value.trim() || 'Sin nombre',
    role: $('#charRole').value.trim(),
    description: $('#charDesc').value.trim(),
    traits: $('#charTraits').value.split(',').map(t => t.trim()).filter(Boolean)
  };
  if (editingId) {
    const c = DATA.characters.find(ch => ch.id === editingId);
    Object.assign(c, payload);
  } else {
    DATA.characters.push({ id: uid('char'), ...payload });
  }
  scheduleSave();
  modal.classList.remove('active');
  renderCharacters();
  if (currentStoryId) renderStoryCast();
});

$('#deleteCharBtn').addEventListener('click', async () => {
  const modal = $('#charModalBackdrop');
  const editingId = modal.dataset.editingId;
  if (!editingId) return;
  const ok = await showConfirm({ title: 'Eliminar personaje', text: '¿Eliminar este personaje? Esta acción no se puede deshacer.', okLabel: 'Eliminar' });
  if (ok) {
    DATA.characters = DATA.characters.filter(c => c.id !== editingId);
    scheduleSave();
    modal.classList.remove('active');
    renderCharacters();
    if (currentStoryId) renderStoryCast();
    showToast('Personaje eliminado.');
  }
});

// ============ COLLAB ============

function renderCollab() {
  const sel = $('#collabStorySelect');
  sel.innerHTML = DATA.stories.map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('');
  const list = $('#collabNotesList');
  list.innerHTML = '';
  (DATA.collabNotes || []).forEach(n => {
    const el = document.createElement('div');
    el.className = 'note-item';
    el.innerHTML = `<span>${escapeHtml(n.text)}</span><button data-id="${n.id}">✕</button>`;
    el.querySelector('button').addEventListener('click', () => {
      DATA.collabNotes = DATA.collabNotes.filter(x => x.id !== n.id);
      scheduleSave();
      renderCollab();
    });
    list.appendChild(el);
  });
}

$('#addCollabNote').addEventListener('click', () => {
  const input = $('#collabNoteInput');
  const text = input.value.trim();
  if (!text) return;
  if (!DATA.collabNotes) DATA.collabNotes = [];
  DATA.collabNotes.push({ id: uid('note'), text, date: todayStr() });
  input.value = '';
  scheduleSave();
  renderCollab();
});

$('#exportStoryBtn').addEventListener('click', async () => {
  const story = getStory($('#collabStorySelect').value);
  if (!story) return;
  const chars = (DATA.characters || []).filter(c => c.storyId === story.id);
  const res = await window.loreara.exportFile({ story, characters: chars, exportedFrom: 'LoreAra', exportedAt: new Date().toISOString() });
  if (res.ok) showToast(`Historia exportada a: ${res.filePath}`);
});

$('#exportTxtBtn').addEventListener('click', () => {
  const story = getStory($('#collabStorySelect').value);
  if (!story) return;
  let text = `${story.title}\n${'='.repeat(story.title.length)}\n\n${story.synopsis || ''}\n\n`;
  story.chapters.forEach((c, i) => {
    text += `\n\nCapítulo ${i + 1}: ${c.title}\n${'-'.repeat(20)}\n${stripHtml(c.content)}\n`;
  });
  downloadTextFile(`${story.title.replace(/\s+/g, '_')}.txt`, text);
  showToast('Archivo de texto descargado.');
});

$('#exportPdfBtn').addEventListener('click', () => {
  const story = getStory($('#collabStorySelect').value);
  if (!story) return;

  let htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(story.title)}</title>
<style>
  body { font-family: 'Georgia', serif; color: #111; line-height: 1.8; margin: 40px; max-width: 800px; margin-left: auto; margin-right: auto; }
  h1 { font-size: 32px; text-align: center; margin-bottom: 10px; }
  .genre { text-align: center; font-size: 14px; color: #666; text-transform: uppercase; margin-bottom: 30px; letter-spacing: 1px; }
  .synopsis { font-style: italic; background: #f9f9f9; padding: 16px; border-left: 4px solid #c81e3a; margin-bottom: 40px; }
  .chapter { page-break-before: always; margin-top: 60px; }
  h2 { font-size: 22px; border-bottom: 1px solid #ccc; padding-bottom: 8px; margin-top: 40px; }
  p { margin-bottom: 16px; text-align: justify; }
  @media print { body { margin: 20mm; } }
</style>
</head>
<body>
  <h1>${escapeHtml(story.title)}</h1>
  <div class="genre">${escapeHtml(story.genre || 'Novela / Fanfic')} · Creado con LoreAra</div>
  ${story.synopsis ? `<div class="synopsis"><b>Sinopsis:</b> ${escapeHtml(story.synopsis)}</div>` : ''}
  <hr style="border:0; border-top:1px solid #ddd; margin: 40px 0;">
`;

  story.chapters.forEach((c, idx) => {
    htmlContent += `
    <div class="chapter">
      <h2>Capítulo ${idx + 1}: ${escapeHtml(c.title)}</h2>
      ${c.content || '<p><i>Capítulo vacío.</i></p>'}
    </div>`;
  });

  htmlContent += `</body></html>`;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${story.title.replace(/\s+/g, '_')}_maquetado.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Libro exportado para PDF maquetado (Ábrelo e imprime a PDF con Ctrl+P).');
});
function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
$('#importBtn').addEventListener('click', async () => {
  const res = await window.loreara.importFile();
  if (!res.ok) return;
  const imported = res.data;
  if (imported.story) {
    const story = imported.story;
    story.id = uid('story');
    story.chapters.forEach(c => c.id = uid('ch'));
    DATA.stories.push(story);
    (imported.characters || []).forEach(c => {
      c.id = uid('char');
      c.storyId = story.id;
      if (!DATA.characters) DATA.characters = [];
      DATA.characters.push(c);
    });
    scheduleSave();
    showToast('Historia importada correctamente.');
    renderStories();
  } else if (imported.stories) {
    DATA = imported;
    scheduleSave();
    showToast('Datos importados correctamente.');
    initApp();
  }
});

// ============ STATS ============

function renderStats() {
  $('#statTotalWords').textContent = totalWordsAll().toLocaleString('es-CL');
  $('#statTotalChapters').textContent = DATA.stories.reduce((s, st) => s + st.chapters.length, 0);
  $('#statTotalChars').textContent = (DATA.characters || []).length;
  $('#statStreak').textContent = `${computeStreak()} días`;

  const bars = $('#statsBars');
  bars.innerHTML = '';
  DATA.stories.forEach(s => {
    const progress = storyProgress(s);
    const row = document.createElement('div');
    row.className = 'stats-bar-row';
    row.innerHTML = `
      <div class="label-row"><span>${escapeHtml(s.title)} (${s.chapters.length} cap.)</span><span>${progress}% (${totalWordsForStory(s)} pal.)</span></div>
      <div class="stats-bar-track"><div style="width:${progress}%"></div></div>
    `;
    bars.appendChild(row);
  });
  if (DATA.stories.length === 0) bars.innerHTML = '<p class="muted">Sin historias todavía.</p>';

  const activityContainer = $('#statsActivity');
  activityContainer.innerHTML = '';
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const maxWords = Math.max(1, ...days.map(d => (DATA.activityLog.find(a => a.date === d) || {}).words || 0));
  days.forEach(d => {
    const entry = DATA.activityLog.find(a => a.date === d);
    const words = entry ? entry.words : 0;
    const pct = Math.round((words / maxWords) * 100);
    const bar = document.createElement('div');
    bar.className = 'abar';
    bar.title = `${d}: ${words} palabras`;
    bar.innerHTML = `<div style="height:${pct}%"></div>`;
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.flex = '1';
    wrap.appendChild(bar);
    const label = document.createElement('div');
    label.className = 'adate';
    label.textContent = d.slice(5);
    wrap.appendChild(label);
    activityContainer.appendChild(wrap);
  });
}

// ============ GLOBAL SOURCES MANAGEMENT VIEW ============

function renderGlobalSources() {
  const list = $('#globalSourcesList');
  if (!list) return;
  list.innerHTML = '';
  if (!DATA.globalDocs) DATA.globalDocs = [];

  if (DATA.globalDocs.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="es-icon">📁</div>
      <div class="es-title">No hay fuentes globales adjuntas</div>
      <div class="es-sub">Sube tus PDFs, artículos o notas de lore aquí para establecer una jerarquía y prioridad (Canon) reutilizable en todas tus historias.</div>
    </div>`;
    return;
  }

  DATA.globalDocs.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'story-card';
    card.style.padding = '16px';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <b style="font-size:15px; color:var(--text);">${escapeHtml(doc.name)}</b>
        ${doc.isPriority ? '<span style="color:var(--success); font-size:11px; font-weight:bold; background:#102218; padding:2px 6px; border-radius:4px;">[⭐ CANON]</span>' : '<span class="muted" style="font-size:11px;">[Derivado]</span>'}
      </div>
      <div class="muted small" style="margin-bottom:12px; max-height:50px; overflow:hidden;">${escapeHtml(doc.content.slice(0, 120))}...</div>
      <div class="row-gap" style="justify-content:space-between;">
        <button class="btn-secondary small" data-act="priority">★ Prioridad Canon</button>
        <button class="btn-danger small" data-act="del">Eliminar</button>
      </div>
    `;
    card.querySelector('[data-act="priority"]').addEventListener('click', () => {
      DATA.globalDocs.forEach(d => d.isPriority = (d.id === doc.id));
      scheduleSave();
      renderGlobalSources();
      showToast(`"${doc.name}" marcada como Fuente Prioritaria Global.`);
    });
    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      DATA.globalDocs = DATA.globalDocs.filter(d => d.id !== doc.id);
      scheduleSave();
      renderGlobalSources();
      showToast('Fuente eliminada.');
    });
    list.appendChild(card);
  });
}

$('#addGlobalSourceBtn').addEventListener('click', () => {
  $('#globalDocFileInput').click();
});

$('#globalDocFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const textContent = evt.target.result;
    if (!DATA.globalDocs) DATA.globalDocs = [];
    const isFirst = DATA.globalDocs.length === 0;
    DATA.globalDocs.push({
      id: uid('gdoc'),
      name: file.name,
      content: textContent.slice(0, 10000),
      isPriority: isFirst
    });
    scheduleSave();
    renderGlobalSources();
    showToast(`Fuente global "${file.name}" adjuntada con éxito.`);
    e.target.value = '';
  };
  reader.readAsText(file);
});


function renderStoryDocs() {
  const story = getStory(currentStoryId);
  const list = $('#storyDocsList');
  if (!list || !story) return;
  list.innerHTML = '';
  if (!story.attachedDocs) story.attachedDocs = [];

  if (story.attachedDocs.length === 0) {
    list.innerHTML = '<p class="muted small">No hay PDFs o artículos adjuntos. Adjunta uno para usarlo como Prioridad (Canon).</p>';
    return;
  }

  story.attachedDocs.forEach(doc => {
    const el = document.createElement('div');
    el.className = 'note-item';
    el.innerHTML = `
      <div style="flex:1;">
        <b>${escapeHtml(doc.name)}</b> ${doc.isPriority ? '<span style="color:var(--success); font-weight:bold;">[⭐ PRIORIDAD / CANON]</span>' : '<span class="muted">[Derivado]</span>'}
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-secondary small" data-act="priority" title="Marcar como Prioridad Canon">★</button>
        <button class="btn-danger small" data-act="del" title="Eliminar documento">✕</button>
      </div>
    `;
    el.querySelector('[data-act="priority"]').addEventListener('click', () => {
      story.attachedDocs.forEach(d => d.isPriority = (d.id === doc.id));
      scheduleSave();
      renderStoryDocs();
      showToast(`"${doc.name}" marcada como Fuente Prioritaria (Canon).`);
    });
    el.querySelector('[data-act="del"]').addEventListener('click', () => {
      story.attachedDocs = story.attachedDocs.filter(d => d.id !== doc.id);
      scheduleSave();
      renderStoryDocs();
      showToast('Documento eliminado.');
    });
    list.appendChild(el);
  });
}

$('#attachDocFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const story = getStory(currentStoryId);
  if (!story) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const textContent = evt.target.result;
    if (!story.attachedDocs) story.attachedDocs = [];
    const isFirst = story.attachedDocs.length === 0;
    story.attachedDocs.push({
      id: uid('doc'),
      name: file.name,
      content: textContent.slice(0, 8000), // snippet for context
      isPriority: isFirst
    });
    scheduleSave();
    renderStoryDocs();
    showToast(`Documento "${file.name}" adjuntado correctamente.`);
    e.target.value = '';
  };
  reader.readAsText(file);
});


function renderSettings() {
  $('#authorNameInput').value = DATA.settings.authorName || '';
  $('#aiBaseUrl').value = DATA.settings.ai.baseUrl || '';
  $('#aiApiKey').value = DATA.settings.ai.apiKey || '';
  const sel = $('#aiModelSelect');
  const currentModel = DATA.settings.ai.model || 'gpt-4o-mini';
  sel.innerHTML = `<option value="${currentModel}">${currentModel}</option>`;
  sel.value = currentModel;
  $('#aiTestResult').textContent = '';
}

$('#authorNameInput').addEventListener('input', () => {
  DATA.settings.authorName = $('#authorNameInput').value;
  scheduleSave();
});

$('#fetchModelsBtn').addEventListener('click', async () => {
  const baseUrl = $('#aiBaseUrl').value.trim() || 'https://api.openai.com/v1';
  const apiKey = $('#aiApiKey').value.trim();
  const resultEl = $('#aiTestResult');
  const selectEl = $('#aiModelSelect');

  if (!apiKey) {
    resultEl.textContent = '❌ Ingresa tu API Key primero.';
    return;
  }

  resultEl.textContent = 'Conectando y detectando modelos permitidos...';
  const res = await window.loreara.aiModels({ baseUrl, apiKey });

  if (res.ok && res.models && res.models.length > 0) {
    selectEl.innerHTML = '';
    res.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      selectEl.appendChild(opt);
    });
    resultEl.textContent = `✅ Se detectaron ${res.models.length} modelos con éxito. Selecciona el deseado o el mejor para contexto.`;
    showToast('Modelos detectados correctamente.');
  } else {
    resultEl.textContent = `❌ Error detectando modelos: ${res.error || 'Respuesta vacía'}`;
  }
});

$('#saveAiBtn').addEventListener('click', () => {
  DATA.settings.ai.baseUrl = $('#aiBaseUrl').value.trim() || 'https://api.openai.com/v1';
  DATA.settings.ai.model = $('#aiModelSelect').value.trim() || 'gpt-4o-mini';
  DATA.settings.ai.apiKey = $('#aiApiKey').value.trim();
  scheduleSave();
  showToast('Configuración de Muse AI guardada exitosamente.');
});

$('#settingsExportBtn').addEventListener('click', async () => {
  const res = await window.loreara.exportFile(DATA);
  if (res.ok) showToast(`Respaldo guardado en: ${res.filePath}`);
});

$('#settingsImportBtn').addEventListener('click', async () => {
  const res = await window.loreara.importFile();
  if (res.ok && res.data && res.data.stories) {
    DATA = res.data;
    scheduleSave();
    showToast('Datos importados correctamente.');
    initApp();
  }
});

$('#settingsResetBtn').addEventListener('click', async () => {
  const ok = await showConfirm({
    title: 'Borrar todos los datos',
    text: 'Esto borrará TODAS tus historias, personajes y ajustes de Muse AI. Esta acción no se puede deshacer.',
    okLabel: 'Borrar todo'
  });
  if (ok) {
    DATA = { settings: DATA.settings, stories: [], characters: [], collabNotes: [], activityLog: [] };
    scheduleSave();
    initApp();
    showToast('Todos los datos fueron borrados.');
  }
});

// ============ EDITOR ============

function openStoryEditor(storyId) {
  currentStoryId = storyId;
  const story = getStory(storyId);
  if (!story) return;
  currentChapterId = story.chapters[0]?.id || null;
  showView('editor');
  $('#crumb').textContent = story.title;
  renderEditor();
}

function renderEditor() {
  const story = getStory(currentStoryId);
  if (!story) return;
  $('#storyTitleInput').value = story.title;
  $('#outlineText').value = story.outline || '';
  $('#rulesText').value = story.rules || '';
  renderChapterList();
  renderStoryNotes();
  renderStoryCast();
  renderStoryDocs();
  if (!currentChapterId || !getChapter(story, currentChapterId)) {
    currentChapterId = story.chapters[0]?.id || null;
  }
  renderChapterContent();
}

$('#storyTitleInput').addEventListener('input', () => {
  const story = getStory(currentStoryId);
  if (!story) return;
  story.title = $('#storyTitleInput').value;
  story.updatedAt = Date.now();
  $('#crumb').textContent = story.title;
  scheduleSave();
  renderChapterList();
});

$('#outlineText').addEventListener('input', () => {
  const story = getStory(currentStoryId);
  if (!story) return;
  story.outline = $('#outlineText').value;
  scheduleSave();
});

$('#rulesText').addEventListener('input', () => {
  const story = getStory(currentStoryId);
  if (!story) return;
  story.rules = $('#rulesText').value;
  scheduleSave();
});

function renderChapterList() {
  const story = getStory(currentStoryId);
  const list = $('#chapterList');
  list.innerHTML = '';
  story.chapters.forEach((c, idx) => {
    const words = wordCount(c.content);
    const item = document.createElement('div');
    item.className = 'chapter-item' + (c.id === currentChapterId ? ' active' : '');
    item.innerHTML = `
      <button class="ch-del" title="Eliminar capítulo">✕</button>
      <div class="ch-num">Capítulo ${idx + 1} de ${story.chapters.length}</div>
      <div class="ch-title">${escapeHtml(c.title || 'Sin título')}</div>
      <div class="ch-progress">${words} palabras · ${statusLabel(c.status)}</div>
    `;
    item.addEventListener('click', () => {
      currentChapterId = c.id;
      renderChapterList();
      renderChapterContent();
    });
    item.querySelector('.ch-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (story.chapters.length === 1) {
        showToast('Debe haber al menos un capítulo en la historia.');
        return;
      }
      const ok = await showConfirm({ title: 'Eliminar capítulo', text: `¿Eliminar "${c.title}"? Esta acción no se puede deshacer.`, okLabel: 'Eliminar' });
      if (ok) {
        story.chapters = story.chapters.filter(ch => ch.id !== c.id);
        if (currentChapterId === c.id) currentChapterId = story.chapters[0].id;
        scheduleSave();
        renderChapterList();
        renderChapterContent();
        showToast('Capítulo eliminado.');
      }
    });
    list.appendChild(item);
  });
}

function statusLabel(status) {
  if (status === 'done') return 'Completado';
  if (status === 'progress') return 'En progreso';
  return 'Borrador';
}

$('#addChapterBtn').addEventListener('click', () => {
  const story = getStory(currentStoryId);
  const num = story.chapters.length + 1;
  const ch = { id: uid('ch'), title: `Capítulo ${num}`, content: '', status: 'draft' };
  story.chapters.push(ch);
  currentChapterId = ch.id;
  story.updatedAt = Date.now();
  scheduleSave();
  renderChapterList();
  renderChapterContent();
});

let lastWordCountForActivity = 0;

function renderChapterContent() {
  const story = getStory(currentStoryId);
  const chapter = getChapter(story, currentChapterId);
  if (!chapter) return;
  $('#chapterTitleInput').value = chapter.title;
  $('#chapterEditor').innerHTML = chapter.content || '';
  lastWordCountForActivity = wordCount(chapter.content);
  updateWordCount();
}

function updateWordCount() {
  const chapter = getChapter(getStory(currentStoryId), currentChapterId);
  if (!chapter) return;
  const wc = wordCount(chapter.content);
  $('#wordCount').textContent = `${wc} palabras`;
}

$('#chapterTitleInput').addEventListener('input', () => {
  const story = getStory(currentStoryId);
  const chapter = getChapter(story, currentChapterId);
  chapter.title = $('#chapterTitleInput').value;
  story.updatedAt = Date.now();
  scheduleSave();
  renderChapterList();
});

$('#chapterEditor').addEventListener('input', () => {
  const story = getStory(currentStoryId);
  const chapter = getChapter(story, currentChapterId);
  chapter.content = $('#chapterEditor').innerHTML;
  story.updatedAt = Date.now();
  const wc = wordCount(chapter.content);
  const delta = wc - lastWordCountForActivity;
  if (delta !== 0) {
    logActivity(delta);
    lastWordCountForActivity = wc;
  }
  if (chapter.status === 'draft' && wc > 0) chapter.status = 'progress';
  scheduleSave();
  updateWordCount();
});

$all('.editor-toolbar button[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    $('#chapterEditor').focus();
    document.execCommand(btn.dataset.cmd, false, btn.dataset.arg || null);
    $('#chapterEditor').dispatchEvent(new Event('input'));
  });
});

$('#insertLinkBtn').addEventListener('click', () => {
  const url = prompt('URL del enlace:');
  if (url) {
    $('#chapterEditor').focus();
    document.execCommand('createLink', false, url);
    $('#chapterEditor').dispatchEvent(new Event('input'));
  }
});

// Story notes (side panel)
function renderStoryNotes() {
  const story = getStory(currentStoryId);
  const list = $('#storyNotesList');
  list.innerHTML = '';
  (story.notes || []).forEach(n => {
    const el = document.createElement('div');
    el.className = 'note-item';
    el.innerHTML = `<span>${escapeHtml(n.text)}</span><button data-id="${n.id}">✕</button>`;
    el.querySelector('button').addEventListener('click', () => {
      story.notes = story.notes.filter(x => x.id !== n.id);
      scheduleSave();
      renderStoryNotes();
    });
    list.appendChild(el);
  });
}

$('#addStoryNote').addEventListener('click', () => {
  const story = getStory(currentStoryId);
  const input = $('#storyNoteInput');
  const text = input.value.trim();
  if (!text) return;
  if (!story.notes) story.notes = [];
  story.notes.push({ id: uid('note'), text, date: todayStr() });
  input.value = '';
  scheduleSave();
  renderStoryNotes();
});

function renderStoryCast() {
  const list = $('#storyCastList');
  list.innerHTML = '';
  const chars = (DATA.characters || []).filter(c => c.storyId === currentStoryId);
  if (chars.length === 0) {
    list.innerHTML = '<p class="muted small">Sin personajes asignados. Usa "Auto-detectar".</p>';
    return;
  }
  chars.forEach(c => {
    const el = document.createElement('div');
    el.className = 'cast-item';
    el.innerHTML = `<b>${escapeHtml(c.name)}</b> — ${escapeHtml(c.role || '')}`;
    el.addEventListener('click', () => openCharModal(c.id));
    list.appendChild(el);
  });
}

// Tabs in side panel
$all('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.tab-btn').forEach(b => b.classList.remove('active'));
    $all('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`.tab-content[data-tab-content="${btn.dataset.tab}"]`).classList.add('active');
  });
});

// ============ AUTOMATIC BOOK GENERATOR (Crear Libro Automático) ============

$('#openAutoBookModalBtn').addEventListener('click', () => {
  const story = getStory(currentStoryId);
  if (!story) return;

  // Populate priority source select from attachedDocs
  const sel = $('#autoBookPrioritySourceSelect');
  sel.innerHTML = '<option value="">-- Usar reglas base y sinopsis --</option>';
  if (story.attachedDocs && story.attachedDocs.length > 0) {
    story.attachedDocs.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${doc.name} ${doc.isPriority ? '(Prioridad / Canon actual)' : '(Derivado)'}`;
      if (doc.isPriority) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  $('#autoBookSources').value = story.rules || story.synopsis || '';
  $('#autoBookChronology').value = 'Respetar orden cronológico estricto y coherencia con fuentes priorizadas.';
  $('#autoBookLogs').innerHTML = '<div class="muted">Listo para iniciar la generación automática con Muse AI.</div>';
  $('#autoBookModalBackdrop').classList.add('active');
});

$('#closeAutoBookModal').addEventListener('click', () => $('#autoBookModalBackdrop').classList.remove('active'));
$('#cancelAutoBookBtn').addEventListener('click', () => $('#autoBookModalBackdrop').classList.remove('active'));
$('#autoBookModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'autoBookModalBackdrop') $('#autoBookModalBackdrop').classList.remove('active');
});

$('#startAutoBookBtn').addEventListener('click', async () => {
  const story = getStory(currentStoryId);
  if (!story) return;

  const priorityDocId = $('#autoBookPrioritySourceSelect').value;
  let priorityContent = '';
  if (priorityDocId && story.attachedDocs) {
    const doc = story.attachedDocs.find(d => d.id === priorityDocId);
    if (doc) priorityContent = `[FUENTE PRIORITARIA / CANON: ${doc.name}]\n${doc.content}\n`;
  }

  const sources = $('#autoBookSources').value.trim();
  const chronology = $('#autoBookChronology').value.trim();
  const count = parseInt($('#autoBookCount').value) || 3;
  const tone = $('#autoBookTone').value;
  const logsEl = $('#autoBookLogs');

  const addLog = (msg) => {
    const div = document.createElement('div');
    div.textContent = `[Log ${new Date().toLocaleTimeString()}] ${msg}`;
    logsEl.appendChild(div);
    logsEl.scrollTop = logsEl.scrollHeight;
  };

  addLog(`Iniciando generación automática de ${count} capítulo(s) para "${story.title}"...`);

  for (let i = 0; i < count; i++) {
    const nextNum = story.chapters.length + 1;
    addLog(`Generando Capítulo ${nextNum} (Tono: ${tone})...`);

    const systemPrompt = `Eres un escritor experto de fanfics y novelas. Genera el Capítulo ${nextNum} de la obra "${story.title}".
Género: ${story.genre || 'Ficción'}
Reglas y Lore Base: "${story.rules || story.synopsis || 'N/A'}"
${priorityContent}
Fuentes Derivadas / Referencia: "${sources}"
Reglas Cronológicas: "${chronology}"

Escribe un capítulo completo, narrativo, detallado, de al menos 300 palabras en español, dando absoluta prioridad a la fuente Canon y manteniendo estricta coherencia con los documentos derivados.`;

    const res = await window.loreara.aiGenerate({
      baseUrl: DATA.settings.ai.baseUrl,
      apiKey: DATA.settings.ai.apiKey,
      model: DATA.settings.ai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Escribe el Capítulo ${nextNum} completo.` }
      ],
      maxTokens: 1000
    });

    if (res.ok) {
      const generatedText = res.text.trim();
      const newCh = {
        id: uid('ch'),
        title: `Capítulo ${nextNum}: Automático`,
        content: `<p>${generatedText.replace(/\n\n/g, '</p><p>')}</p>`,
        status: 'done'
      };
      story.chapters.push(newCh);
      story.updatedAt = Date.now();
      scheduleSave();
      renderChapterList();
      addLog(`✅ Capítulo ${nextNum} generado y guardado exitosamente.`);
    } else {
      addLog(`❌ Error en IA: ${res.error}`);
      showToast('Error al generar con Muse AI. Revisa tu clave en Ajustes.');
      break;
    }
  }

  addLog('✨ ¡Generación automática completada!');
  showToast('Libro automático actualizado con nuevos capítulos.');
});

// ============ REALTIME WRITING ASSISTANT ("Sugerencia al escribir") ============

let realtimeAssistantEnabled = false;
let typingTimer = null;

$('#realtimeAssistantToggle').addEventListener('click', () => {
  realtimeAssistantEnabled = !realtimeAssistantEnabled;
  const statusEl = $('#assistantStatusText');
  statusEl.textContent = realtimeAssistantEnabled ? 'ON' : 'OFF';
  statusEl.style.color = realtimeAssistantEnabled ? 'var(--success)' : 'var(--muted)';
  showToast(realtimeAssistantEnabled ? 'Sugerencia en tiempo real ACTIVADA.' : 'Sugerencia en tiempo real DESACTIVADA.');
  if (!realtimeAssistantEnabled) {
    $('#realtimeSuggestionBox').style.display = 'none';
  }
});

$('#closeRsbBtn').addEventListener('click', () => {
  $('#realtimeSuggestionBox').style.display = 'none';
});

$('#applyRsbBtn').addEventListener('click', () => {
  const suggestionText = $('#rsbContent').getAttribute('data-suggestion') || '';
  if (suggestionText) {
    const editor = $('#chapterEditor');
    editor.focus();
    const p = document.createElement('p');
    p.textContent = suggestionText;
    editor.appendChild(p);
    editor.dispatchEvent(new Event('input'));
    $('#realtimeSuggestionBox').style.display = 'none';
    showToast('Sugerencia aplicada al capítulo.');
  }
});

// Trigger on pause in chapterEditor
$('#chapterEditor').addEventListener('input', () => {
  if (!realtimeAssistantEnabled) return;
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    triggerRealtimeSuggestion();
  }, 1800);
});

async function triggerRealtimeSuggestion() {
  const story = getStory(currentStoryId);
  const chapter = getChapter(story, currentChapterId);
  if (!story || !chapter) return;
  const text = stripHtml(chapter.content).trim();
  if (text.length < 50) return; // need enough text to analyze

  const rsb = $('#realtimeSuggestionBox');
  const rsbContent = $('#rsbContent');
  rsb.style.display = 'block';
  rsbContent.textContent = 'Analizando redacción y coherencia...';

  const systemPrompt = `Eres Muse AI, asistente de redacción en tiempo real de LoreAra. Analiza el último párrafo escrito por el autor y ofrece una sugerencia breve de continuación, mejora de estilo o cohesión argumental en español (máx 2 frases).`;
  const userPrompt = `Texto actual del capítulo:\n"""${text.slice(-1500)}"""\nOfrece una sugerencia constructiva de mejora o continuación.`;

  const res = await window.loreara.aiGenerate({
    baseUrl: DATA.settings.ai.baseUrl,
    apiKey: DATA.settings.ai.apiKey,
    model: DATA.settings.ai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    maxTokens: 150
  });

  if (res.ok) {
    const suggestion = res.text.trim();
    rsbContent.textContent = suggestion;
    rsbContent.setAttribute('data-suggestion', suggestion);
  } else {
    rsbContent.textContent = '💡 Sugerencia: Mantén el ritmo de la escena y profundiza en las motivaciones del protagonista.';
    rsbContent.setAttribute('data-suggestion', 'Mantén el ritmo de la escena y profundiza en las motivaciones del protagonista.');
  }
}


$('#museToggle').addEventListener('click', () => {
  $('#museWidget').classList.toggle('collapsed');
});

$all('.muse-quick button').forEach(btn => {
  btn.addEventListener('click', () => runMusePrompt(btn.dataset.prompt));
});

$('#museSend').addEventListener('click', () => {
  const input = $('#museInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  runMusePrompt(text);
});

$('#museInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#museSend').click();
});

function addMuseMessage(role, text, allowInsert) {
  const container = $('#museMessages');
  const el = document.createElement('div');
  el.className = 'muse-msg';
  el.innerHTML = `<div class="msg-role">${role === 'user' ? 'Tú' : 'Muse AI'}</div><div class="msg-text"></div>`;
  el.querySelector('.msg-text').textContent = text;
  if (allowInsert) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const insertBtn = document.createElement('button');
    insertBtn.textContent = 'Insertar en capítulo';
    insertBtn.addEventListener('click', () => {
      const editor = $('#chapterEditor');
      editor.focus();
      const p = document.createElement('p');
      p.textContent = text;
      editor.appendChild(p);
      editor.dispatchEvent(new Event('input'));
    });
    actions.appendChild(insertBtn);
    el.appendChild(actions);
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

async function runMusePrompt(promptText) {
  const story = getStory(currentStoryId);
  const chapter = getChapter(story, currentChapterId);
  addMuseMessage('user', promptText, false);
  $('#museStatus').textContent = 'Muse AI está pensando...';

  const chars = (DATA.characters || []).filter(c => c.storyId === story.id);
  const charSummary = chars.map(c => `${c.name} (${c.role || 'personaje'}): ${c.description || ''}`).join('\n');
  const currentText = stripHtml(chapter.content).slice(-3000);

  const systemPrompt = `Eres Muse AI, asistente creativo de LoreAra. Ayudas a escribir historias, sugerir acciones y mantener coherencia con las reglas de lore. Responde en español, de forma creativa y concisa.

Contexto de la obra: "${story.title}" (${story.genre || 'sin género'}).
Reglas y Lore Base: ${story.rules || 'N/A'}
Outline: ${story.outline || 'N/A'}
Personajes y Personalidades:
${charSummary || 'N/A'}

Capítulo actual: "${chapter.title}"
Texto reciente:
"""${currentText}"""`;

  const res = await window.loreara.aiGenerate({
    baseUrl: DATA.settings.ai.baseUrl,
    apiKey: DATA.settings.ai.apiKey,
    model: DATA.settings.ai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: promptText }
    ],
    maxTokens: 600
  });

  if (res.ok) {
    addMuseMessage('assistant', res.text.trim(), true);
    $('#museStatus').textContent = 'Listo para tu próxima idea.';
  } else {
    addMuseMessage('assistant', `⚠️ ${res.error}`, false);
    $('#museStatus').textContent = 'Hubo un problema. Revisa tu configuración en Ajustes.';
  }
}

// ============ GLOBAL SEARCH ============

const searchInput = $('#globalSearch');
const searchResultsEl = $('#searchResults');

if (searchInput) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      searchResultsEl.classList.remove('active');
      searchResultsEl.innerHTML = '';
      return;
    }
    const results = [];
    DATA.stories.forEach(s => {
      if (s.title.toLowerCase().includes(q) || (s.genre || '').toLowerCase().includes(q)) {
        results.push({ type: 'Historia', label: s.title, action: () => openStoryEditor(s.id) });
      }
      s.chapters.forEach(c => {
        if ((c.title || '').toLowerCase().includes(q)) {
          results.push({ type: 'Capítulo', label: `${c.title} — ${s.title}`, action: () => { openStoryEditor(s.id); currentChapterId = c.id; renderChapterList(); renderChapterContent(); } });
        }
      });
    });
    (DATA.characters || []).forEach(c => {
      if (c.name.toLowerCase().includes(q)) {
        const story = getStory(c.storyId);
        results.push({ type: 'Personaje', label: `${c.name}${story ? ' — ' + story.title : ''}`, action: () => { showView('characters'); openCharModal(c.id); } });
      }
    });

    searchResultsEl.innerHTML = '';
    if (results.length === 0) {
      searchResultsEl.innerHTML = '<div class="search-result-empty">Sin resultados para "' + escapeHtml(searchInput.value) + '"</div>';
    } else {
      results.slice(0, 12).forEach(r => {
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.innerHTML = `<div class="sr-type">${r.type}</div><div>${escapeHtml(r.label)}</div>`;
        el.addEventListener('click', () => {
          r.action();
          searchResultsEl.classList.remove('active');
          searchInput.value = '';
        });
        searchResultsEl.appendChild(el);
      });
    }
    searchResultsEl.classList.add('active');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.top-actions')) {
      searchResultsEl.classList.remove('active');
    }
  });
}

// ============ ONBOARDING & HELP ============

let onboardingSlide = 0;
const ONBOARDING_TOTAL_SLIDES = 4;

function showOnboarding() {
  onboardingSlide = 0;
  renderOnboardingSlide();
  $('#welcomeModalBackdrop').classList.add('active');
}

function renderOnboardingSlide() {
  $all('.onboarding-slide').forEach(s => {
    s.style.display = Number(s.dataset.slide) === onboardingSlide ? 'block' : 'none';
  });
  $all('.odot').forEach(d => d.classList.toggle('active', Number(d.dataset.i) === onboardingSlide));
  $('#onboardingNext').textContent = onboardingSlide === ONBOARDING_TOTAL_SLIDES - 1 ? '¡Empezar!' : 'Siguiente';
}

$('#onboardingNext').addEventListener('click', () => {
  if (onboardingSlide === ONBOARDING_TOTAL_SLIDES - 1) {
    $('#welcomeModalBackdrop').classList.remove('active');
    return;
  }
  onboardingSlide++;
  renderOnboardingSlide();
});

$('#onboardingSkip').addEventListener('click', () => {
  $('#welcomeModalBackdrop').classList.remove('active');
});

function openHelpModal() {
  $('#helpModalBackdrop').classList.add('active');
}

$('#helpBtn').addEventListener('click', openHelpModal);
$('#helpTopBtn').addEventListener('click', openHelpModal);
$('#closeHelpModal').addEventListener('click', () => $('#helpModalBackdrop').classList.remove('active'));
$('#helpModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'helpModalBackdrop') $('#helpModalBackdrop').classList.remove('active');
});
$('#replayOnboardingBtn').addEventListener('click', () => {
  $('#helpModalBackdrop').classList.remove('active');
  showOnboarding();
});

// ============ PANEL COLLAPSE / EXPAND ============
$('#toggleLeftPanelBtn').addEventListener('click', () => {
  $('.chapter-panel').classList.toggle('collapsed');
});
$('#toggleRightPanelBtn').addEventListener('click', () => {
  $('.side-panel').classList.toggle('collapsed');
});

// ============ READER MODE & AUDIOBOOK ============
$('#readerModeBtn').addEventListener('click', openReaderMode);
$('#closeReaderBtn').addEventListener('click', closeReaderMode);

function openReaderMode() {
  const story = getStory(currentStoryId);
  const chapter = getChapter(story, currentChapterId);
  if (!story || !chapter) return;

  $('#readerStoryTitleDisplay').textContent = story.title;
  $('#readerChapterTitleDisplay').textContent = chapter.title;
  $('#readerHeading').textContent = chapter.title;
  $('#readerBody').innerHTML = chapter.content || '<p class="muted">Capítulo vacío.</p>';

  updateReaderProgress();
  $('#readerOverlay').classList.add('active');
}

function closeReaderMode() {
  stopAudiobook();
  $('#readerOverlay').classList.remove('active');
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function updateReaderProgress() {
  const story = getStory(currentStoryId);
  if (!story) return;
  const idx = story.chapters.findIndex(c => c.id === currentChapterId);
  $('#readerProgressIndicator').textContent = `Capítulo ${idx + 1} de ${story.chapters.length}`;
}

$('#readerPrevBtn').addEventListener('click', () => {
  const story = getStory(currentStoryId);
  if (!story) return;
  const idx = story.chapters.findIndex(c => c.id === currentChapterId);
  if (idx > 0) {
    stopAudiobook();
    currentChapterId = story.chapters[idx - 1].id;
    openReaderMode();
  }
});

$('#readerNextBtn').addEventListener('click', () => {
  const story = getStory(currentStoryId);
  if (!story) return;
  const idx = story.chapters.findIndex(c => c.id === currentChapterId);
  if (idx < story.chapters.length - 1) {
    stopAudiobook();
    currentChapterId = story.chapters[idx + 1].id;
    openReaderMode();
  }
});

// Reader Theme Filters
$all('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const theme = btn.dataset.theme;
    const overlay = $('#readerOverlay');
    overlay.className = 'reader-overlay active theme-' + theme;
  });
});

$('#readerFullscreenBtn').addEventListener('click', () => {
  const el = $('#readerOverlay');
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// Audiobook TTS
let currentUtterance = null;

$('#audiobookBtn').addEventListener('click', () => {
  openReaderMode();
  startAudiobook();
});

$('#abPlay').addEventListener('click', () => {
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
  } else {
    startAudiobook();
  }
});

$('#abPause').addEventListener('click', () => {
  if (speechSynthesis.speaking) {
    speechSynthesis.pause();
  }
});

$('#abStop').addEventListener('click', () => {
  stopAudiobook();
});

function startAudiobook() {
  if (!('speechSynthesis' in window)) {
    showToast('Tu navegador no soporta síntesis de voz.');
    return;
  }
  stopAudiobook();
  const story = getStory(currentStoryId);
  const chapter = getChapter(story, currentChapterId);
  if (!chapter) return;

  const textToRead = `${chapter.title}. ${stripHtml(chapter.content)}`;
  currentUtterance = new SpeechSynthesisUtterance(textToRead);
  currentUtterance.lang = 'es-ES';
  currentUtterance.rate = parseFloat($('#abSpeed').value) || 1.0;

  currentUtterance.onend = () => {
    showToast('Audiolibro finalizado.');
  };

  speechSynthesis.speak(currentUtterance);
  showToast('Reproduciendo audiolibro...');
}

function stopAudiobook() {
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  currentUtterance = null;
}

$('#abSpeed').addEventListener('change', () => {
  if (speechSynthesis.speaking && currentUtterance) {
    stopAudiobook();
    startAudiobook();
  }
});

// ============ PROFILE, BADGES & THEMES ============

$('#profileAvatarBtn').addEventListener('click', () => {
  $('#profileAvatarSelect').value = DATA.settings.profileAvatar || '✍️';
  $('#profileBadgeSelect').value = DATA.settings.profileBadge || '👑';
  $('#profileBorderSelect').value = DATA.settings.profileBorder || 'rank-gold';
  $('#appThemeBackgroundSelect').value = DATA.settings.appTheme || 'bg-obsidian';
  $('#profileModalBackdrop').classList.add('active');
});

$('#closeProfileModal').addEventListener('click', () => $('#profileModalBackdrop').classList.remove('active'));
$('#profileModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'profileModalBackdrop') $('#profileModalBackdrop').classList.remove('active');
});

$('#saveProfileBtn').addEventListener('click', () => {
  if (!DATA.settings) DATA.settings = {};
  DATA.settings.profileAvatar = $('#profileAvatarSelect').value;
  DATA.settings.profileBadge = $('#profileBadgeSelect').value;
  DATA.settings.profileBorder = $('#profileBorderSelect').value;
  DATA.settings.appTheme = $('#appThemeBackgroundSelect').value;
  scheduleSave();
  applyProfileAndTheme();
  $('#profileModalBackdrop').classList.remove('active');
  showToast('Perfil y tema actualizados.');
});

function applyProfileAndTheme() {
  if (!DATA || !DATA.settings) return;
  const avatar = DATA.settings.profileAvatar || '✍️';
  const badge = DATA.settings.profileBadge || '👑';
  const border = DATA.settings.profileBorder || 'rank-gold';
  const theme = DATA.settings.appTheme || 'bg-obsidian';

  $('#topbarAvatarIcon').textContent = avatar;
  $('.profile-badge').textContent = badge;
  $('.avatar-border').className = 'avatar-border ' + border;

  document.body.className = '';
  if (theme !== 'bg-obsidian') {
    document.body.classList.add('theme-' + theme.replace('bg-', ''));
  }
}


async function initApp() {
  if (!DATA) DATA = await window.loreara.loadData();
  if (!DATA.characters) DATA.characters = [];
  if (!DATA.collabNotes) DATA.collabNotes = [];
  if (!DATA.activityLog) DATA.activityLog = [];
  if (!DATA.globalDocs) DATA.globalDocs = [];

  // Hide startup loader after 1.5s (Steam-like cinematic boot)
  setTimeout(() => {
    const loader = $('#startupLoader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 500);
    }
  }, 1400);

  applyProfileAndTheme();
  showView('home');
  setSaveStatus('saved');

  if (!DATA.settings.onboardingSeen) {
    showOnboarding();
    DATA.settings.onboardingSeen = true;
    scheduleSave();
  }
}

initApp();
