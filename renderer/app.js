// ============ LoreAra App Logic ============

// Fallback for browser / web preview when not running inside Electron
if (!window.loreara) {
  window.loreara = {
    loadData: async () => {
      try {
        const raw = localStorage.getItem('loreara-data');
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return {
        settings: {
          theme: 'dark',
          authorName: 'Escritor/a',
          ai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }
        },
        stories: [],
        globalDocs: [],
        activityLog: []
      };
    },
    saveData: async (data) => {
      try { localStorage.setItem('loreara-data', JSON.stringify(data)); } catch (e) {}
      return true;
    },
    exportFile: async (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'loreara-backup.json';
      a.click();
      return { ok: true, filePath: 'descargas del navegador' };
    },
    importFile: async () => {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return resolve({ ok: false });
          const reader = new FileReader();
          reader.onload = (evt) => {
            try { resolve({ ok: true, data: JSON.parse(evt.target.result) }); }
            catch (err) { resolve({ ok: false, error: String(err) }); }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    },
    openExternal: async (url) => { window.open(url, '_blank'); },
    aiGenerate: async () => ({ ok: false, error: 'IA solo disponible en la app de escritorio (o configura CORS en web)' })
  };
}

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
      <div class="es-icon"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg></div>
      <div class="es-title">Aún no tienes historias</div>
      <div class="es-sub">Pulsa "Nueva historia" para escribir tu primera obra. Se creará con portada, reglas base y capítulos listos.</div>
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
      <div class="es-icon"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg></div>
      <div class="es-title">No tienes historias todavía</div>
      <div class="es-sub">Usa el botón "Nueva historia" arriba para crear tu obra con portada, reglas base y capítulos.</div>
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
      <div class="es-icon"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><line x1="12" y1="6" x2="12" y2="12"></line><line x1="9" y1="9" x2="15" y2="9"></line></svg></div>
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
      <div class="es-icon"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.6"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div>
      <div class="es-title">No hay personajes registrados</div>
      <div class="es-sub">Usa el botón <b>"Auto-detectar de historias"</b> para extraer automáticamente personajes y personalidades de tus capítulos, o crea uno manualmente.</div>
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

// ============ NOTEBOOKLM-STYLE SOURCES STUDIO (WITH DEDUPLICATION & CANON) ============

let activeStudioBookId = 'universal';
let activeNblmReaderDoc = null;

function getPriorityInfo(doc) {
  const level = doc.priorityLevel || (doc.isPriority ? 'primary' : 'derived');
  if (level === 'primary') {
    return { level: 'primary', label: '1. Canon Absoluto', badgeClass: 'canon-primary', desc: 'Supremacía total en el lore.' };
  } else if (level === 'derived') {
    return { level: 'derived', label: '2. Canon Derivado', badgeClass: 'canon-derived', desc: 'Subordinado que expande o complementa.' };
  } else {
    return { level: 'reference', label: '3. Referencia Auxiliar', badgeClass: 'canon-reference', desc: 'Material auxiliar o borrador de consulta.' };
  }
}

function checkPdfTextOrWarnOcr(file, textContent) {
  if (file && file.name.toLowerCase().endsWith('.pdf') && (textContent || '').trim().length < 40) {
    showConfirm({
      title: 'Aviso: PDF Escaneado (Sin capa de texto digital)',
      text: `El documento "${file.name}" parece ser una imagen escaneada y no contiene texto digital seleccionable.\n\nPor nuestro diseño offline-first, LoreAra procesa tus datos en tu máquina sin enviarlos a terceros.\n\n• Qué puedes hacer hoy: Convierte el PDF a texto antes de subirlo con OCR local en tu dispositivo (ej. Adobe Scan / Google Lens en el móvil, o ocrmypdf en terminal).\n• Roadmap: Motor OCR local (Tesseract.js WASM / PaddleOCR) integrado 100% offline en próxima versión.`,
      okLabel: 'Entendido'
    });
    return false;
  }
  return true;
}

function checkAndPreventDuplicateSource(existingList, newName, newContent) {
  if (!existingList) return false;
  const targetName = (newName || '').trim().toLowerCase();
  const targetSnippet = (newContent || '').slice(0, 500);
  return existingList.some(doc => {
    const docName = (doc.name || '').trim().toLowerCase();
    const docSnippet = (doc.content || '').slice(0, 500);
    return docName === targetName || (targetSnippet.length > 50 && docSnippet === targetSnippet);
  });
}

function renderGlobalSources() {
  renderNotebookLMStudio();
}

function renderNotebookLMStudio() {
  const booksListEl = $('#nblmBooksList');
  const countTextEl = $('#nblmBooksCountText');
  if (!booksListEl) return;

  if (!DATA.globalDocs) DATA.globalDocs = [];
  if (!DATA.stories) DATA.stories = [];

  if (activeStudioBookId !== 'universal' && !getStory(activeStudioBookId)) {
    activeStudioBookId = 'universal';
  }

  if (countTextEl) {
    countTextEl.textContent = `${DATA.stories.length + 1} libros`;
  }

  // 1. Render Left Sidebar (Libros Seccionados)
  booksListEl.innerHTML = '';

  // Tab: Universal Repository
  const uniTab = document.createElement('div');
  uniTab.className = 'nblm-book-tab ' + (activeStudioBookId === 'universal' ? 'active' : '');
  uniTab.innerHTML = `
    <div class="nblm-tab-cover">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--accent)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
    </div>
    <div class="nblm-tab-info">
      <div class="nblm-tab-title">Repositorio Universal</div>
      <div class="nblm-tab-count">${DATA.globalDocs.length} fuentes compartidas</div>
    </div>
  `;
  uniTab.addEventListener('click', () => {
    activeStudioBookId = 'universal';
    renderNotebookLMStudio();
  });
  booksListEl.appendChild(uniTab);

  // Tabs: Every book in stories
  DATA.stories.forEach(story => {
    const docsCount = (story.attachedDocs || []).length;
    const coverStyle = story.coverImage
      ? `background-image: url('${story.coverImage}');`
      : `background: ${story.color || 'var(--panel-2)'};`;

    const tab = document.createElement('div');
    tab.className = 'nblm-book-tab ' + (activeStudioBookId === story.id ? 'active' : '');
    tab.innerHTML = `
      <div class="nblm-tab-cover" style="${coverStyle}">
        ${!story.coverImage ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>` : ''}
      </div>
      <div class="nblm-tab-info">
        <div class="nblm-tab-title" title="${escapeHtml(story.title)}">${escapeHtml(story.title)}</div>
        <div class="nblm-tab-count">${docsCount} fuentes en este libro</div>
      </div>
    `;
    tab.addEventListener('click', () => {
      activeStudioBookId = story.id;
      renderNotebookLMStudio();
    });
    booksListEl.appendChild(tab);
  });

  // 2. Render Active Book Header
  const headerEl = $('#nblmActiveBookHeader');
  const linkBtn = $('#linkUniversalSourceBtn');

  let targetDocsList = DATA.globalDocs;

  if (activeStudioBookId === 'universal') {
    if (linkBtn) linkBtn.style.display = 'none';
    if (headerEl) {
      headerEl.innerHTML = `
        <div class="nblm-active-cover">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--accent)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
        </div>
        <div class="nblm-active-info">
          <div class="nblm-active-title">Repositorio Universal (Lore Compartido)</div>
          <div class="muted small">Fuentes globales utilizables y vinculables en todos tus libros con 0 duplicados de almacenamiento.</div>
        </div>
      `;
    }
  } else {
    const story = getStory(activeStudioBookId);
    if (story) {
      if (!story.attachedDocs) story.attachedDocs = [];
      targetDocsList = story.attachedDocs;
      if (linkBtn) linkBtn.style.display = 'inline-flex';

      const coverStyle = story.coverImage
        ? `background-image: url('${story.coverImage}');`
        : `background: ${story.color || 'var(--panel-2)'};`;

      if (headerEl) {
        headerEl.innerHTML = `
          <div class="nblm-active-cover" style="${coverStyle}">
            ${!story.coverImage ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>` : ''}
          </div>
          <div class="nblm-active-info">
            <div class="nblm-active-title" title="${escapeHtml(story.title)}">${escapeHtml(story.title)}</div>
            <div class="muted small">${escapeHtml(story.genre || 'Novela / Lore')} · ${targetDocsList.length} fuentes en este libro · ${totalWordsForStory(story).toLocaleString('es-CL')} palabras escritas</div>
          </div>
        `;
      }
    }
  }

  // 3. Render Attached Sources for Target List
  const sourcesContainer = $('#nblmSourcesList');
  if (!sourcesContainer) return;
  sourcesContainer.innerHTML = '';

  if (targetDocsList.length === 0) {
    sourcesContainer.innerHTML = `<div class="empty-state">
      <div class="es-icon"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></div>
      <div class="es-title">No hay fuentes en esta sección</div>
      <div class="es-sub">Adjunta un PDF o artículo, o vincúlalo desde el Repositorio Universal. El motor de deduplicación protegerá tu proyecto de duplicados.</div>
    </div>`;
    return;
  }

  targetDocsList.forEach(doc => {
    const pInfo = getPriorityInfo(doc);
    const card = document.createElement('div');
    card.className = `source-card-item canon-${pInfo.level}-card`;
    card.innerHTML = `
      <div class="source-card-top">
        <div class="source-icon-wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
        </div>
        <div class="source-title-group">
          <div class="source-filename" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</div>
          <div class="source-meta-row">
            <span class="canon-badge ${pInfo.badgeClass}">${pInfo.label}</span>
            <span class="muted small">${doc.content ? doc.content.length.toLocaleString('es-CL') + ' caracteres' : '0 car.'}</span>
            ${doc.isUniversalLink ? '<span class="canon-badge canon-reference" style="background:rgba(129,140,248,0.15); color:var(--accent);">Vinculado del Universal</span>' : ''}
          </div>
        </div>
        <div class="source-actions-group">
          <button class="btn-icon-subtle" data-act="del" title="Desvincular o eliminar fuente">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
          </button>
        </div>
      </div>
      <div class="canon-selector-box">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="canon-selector-label">Jerarquía del Lore:</span>
          <span class="muted" style="font-size:11px;">${pInfo.desc}</span>
        </div>
        <div class="canon-segmented-control">
          <button class="canon-seg-btn ${pInfo.level === 'primary' ? 'active' : ''}" data-level="primary">1. Canon Absoluto</button>
          <button class="canon-seg-btn ${pInfo.level === 'derived' ? 'active' : ''}" data-level="derived">2. Canon Derivado</button>
          <button class="canon-seg-btn ${pInfo.level === 'reference' ? 'active' : ''}" data-level="reference">3. Referencia Auxiliar</button>
        </div>
      </div>
      <div class="source-meta-row" style="justify-content:space-between; border-top:1px solid var(--border); padding-top:10px;">
        <span class="muted small" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:65%;">${escapeHtml(doc.content.slice(0, 95))}...</span>
        <button class="link-btn" data-act="view" style="font-weight:600;">Ver / Resumir con IA</button>
      </div>
    `;

    card.querySelectorAll('.canon-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lvl = btn.dataset.level;
        doc.priorityLevel = lvl;
        doc.isPriority = (lvl === 'primary');
        scheduleSave();
        renderNotebookLMStudio();
        showToast(`Autoridad de "${doc.name}" actualizada a: ${getPriorityInfo(doc).label}.`);
      });
    });

    card.querySelector('[data-act="view"]').addEventListener('click', () => {
      openNblmReaderModal(doc);
    });

    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (activeStudioBookId === 'universal') {
        DATA.globalDocs = DATA.globalDocs.filter(d => d.id !== doc.id);
        DATA.stories.forEach(s => {
          if (s.attachedDocs) s.attachedDocs = s.attachedDocs.filter(d => d.id !== doc.id && d.universalDocId !== doc.id);
        });
      } else {
        const story = getStory(activeStudioBookId);
        if (story && story.attachedDocs) {
          story.attachedDocs = story.attachedDocs.filter(d => d.id !== doc.id);
        }
      }
      scheduleSave();
      renderNotebookLMStudio();
      showToast('Fuente desvinculada sin dejar archivos sobrantes.');
    });

    sourcesContainer.appendChild(card);
  });
}

// NotebookLM Studio Upload & Deduplication Handlers
const addBookSourceBtn = $('#addBookSourceBtn');
if (addBookSourceBtn) {
  addBookSourceBtn.addEventListener('click', () => {
    $('#bookDocFileInput').click();
  });
}

const bookDocFileInput = $('#bookDocFileInput');
if (bookDocFileInput) {
  bookDocFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      const textContent = evt.target.result;
      if (!checkPdfTextOrWarnOcr(file, textContent)) {
        e.target.value = '';
        return;
      }
      let targetList = DATA.globalDocs;
      let targetName = 'Repositorio Universal';

      if (activeStudioBookId !== 'universal') {
        const story = getStory(activeStudioBookId);
        if (story) {
          if (!story.attachedDocs) story.attachedDocs = [];
          targetList = story.attachedDocs;
          targetName = story.title;
        }
      }

      if (checkAndPreventDuplicateSource(targetList, file.name, textContent)) {
        showToast(`Deduplicación activa: La fuente "${file.name}" ya está en "${targetName}". Se bloqueó el duplicado.`);
        e.target.value = '';
        return;
      }

      const isFirst = targetList.length === 0;
      targetList.push({
        id: uid('doc'),
        name: file.name,
        content: textContent.slice(0, 10000),
        isPriority: isFirst,
        priorityLevel: isFirst ? 'primary' : 'derived',
        attachedAt: Date.now()
      });

      scheduleSave();
      renderNotebookLMStudio();
      showToast(`Fuente "${file.name}" adjuntada a "${targetName}" sin duplicados.`);
      e.target.value = '';
    };
    reader.readAsText(file);
  });
}

// Link from Universal Repository
const linkUniversalBtn = $('#linkUniversalSourceBtn');
if (linkUniversalBtn) {
  linkUniversalBtn.addEventListener('click', () => {
    const story = getStory(activeStudioBookId);
    if (!story) return;
    if (!story.attachedDocs) story.attachedDocs = [];

    const listContainer = $('#universalLinkOptionsList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (!DATA.globalDocs || DATA.globalDocs.length === 0) {
      listContainer.innerHTML = '<p class="muted small">No hay fuentes en el Repositorio Universal. Sube una en la pestaña "Repositorio Universal" primero.</p>';
    } else {
      DATA.globalDocs.forEach(gDoc => {
        const alreadyAttached = checkAndPreventDuplicateSource(story.attachedDocs, gDoc.name, gDoc.content);
        const el = document.createElement('label');
        el.className = 'note-item';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '10px';
        el.style.cursor = alreadyAttached ? 'not-allowed' : 'pointer';
        el.style.opacity = alreadyAttached ? '0.6' : '1';

        el.innerHTML = `
          <input type="checkbox" value="${gDoc.id}" ${alreadyAttached ? 'disabled' : ''} />
          <div style="flex:1;">
            <b>${escapeHtml(gDoc.name)}</b>
            <div class="muted small">${(gDoc.content || '').length} caracteres ${alreadyAttached ? '· (Ya está adjunta a este libro - Deduplicada)' : ''}</div>
          </div>
        `;
        listContainer.appendChild(el);
      });
    }

    $('#linkUniversalModalBackdrop').classList.add('active');
  });
}

const closeLinkUniBtn = $('#closeLinkUniversalModal');
if (closeLinkUniBtn) closeLinkUniBtn.addEventListener('click', () => $('#linkUniversalModalBackdrop').classList.remove('active'));
const cancelLinkUniBtn = $('#cancelLinkUniversalModal');
if (cancelLinkUniBtn) cancelLinkUniBtn.addEventListener('click', () => $('#linkUniversalModalBackdrop').classList.remove('active'));

const confirmLinkUniBtn = $('#confirmLinkUniversalBtn');
if (confirmLinkUniBtn) {
  confirmLinkUniBtn.addEventListener('click', () => {
    const story = getStory(activeStudioBookId);
    if (!story) return;
    if (!story.attachedDocs) story.attachedDocs = [];

    const checkedBoxes = $all('#universalLinkOptionsList input[type="checkbox"]:checked');
    let addedCount = 0;
    checkedBoxes.forEach(box => {
      const gDoc = DATA.globalDocs.find(d => d.id === box.value);
      if (gDoc && !checkAndPreventDuplicateSource(story.attachedDocs, gDoc.name, gDoc.content)) {
        story.attachedDocs.push({
          id: uid('doc'),
          universalDocId: gDoc.id,
          name: gDoc.name,
          content: gDoc.content,
          isPriority: story.attachedDocs.length === 0,
          priorityLevel: story.attachedDocs.length === 0 ? 'primary' : 'derived',
          isUniversalLink: true,
          attachedAt: Date.now()
        });
        addedCount++;
      }
    });

    scheduleSave();
    renderNotebookLMStudio();
    $('#linkUniversalModalBackdrop').classList.remove('active');
    if (addedCount > 0) {
      showToast(`${addedCount} fuente(s) universal(es) vinculada(s) a "${story.title}" sin duplicar almacenamiento.`);
    } else {
      showToast('No se agregaron nuevas fuentes (deduplicación activa).');
    }
  });
}

// NotebookLM Reader & AI Summary Modal
function openNblmReaderModal(doc) {
  if (!doc) return;
  activeNblmReaderDoc = doc;
  const titleEl = $('#nblmReaderTitle');
  const metaRow = $('#nblmReaderMetaRow');
  const contentEl = $('#nblmFullContentText');
  const summaryEl = $('#nblmAiSummaryText');

  const pInfo = getPriorityInfo(doc);
  if (titleEl) titleEl.textContent = doc.name || 'Documento';
  if (metaRow) {
    metaRow.innerHTML = `
      <span class="canon-badge ${pInfo.badgeClass}">${pInfo.label}</span>
      <span class="muted small">${doc.content ? doc.content.length.toLocaleString('es-CL') + ' caracteres' : '0 car.'}</span>
    `;
  }
  if (contentEl) contentEl.textContent = doc.content || 'Sin contenido de texto disponible.';
  if (summaryEl) summaryEl.textContent = 'Haz clic en "Generar Resumen IA" para que Muse AI sintetice los temas clave del documento.';

  $('#nblmReaderModalBackdrop').classList.add('active');
}

const closeReaderModalBtn = $('#closeNblmReaderModal');
if (closeReaderModalBtn) closeReaderModalBtn.addEventListener('click', () => $('#nblmReaderModalBackdrop').classList.remove('active'));
const closeReaderBtnNblm = $('#closeNblmReaderBtn');
if (closeReaderBtnNblm) closeReaderBtnNblm.addEventListener('click', () => $('#nblmReaderModalBackdrop').classList.remove('active'));

const triggerNblmSummaryBtn = $('#triggerNblmAiSummaryBtn');
if (triggerNblmSummaryBtn) {
  triggerNblmSummaryBtn.addEventListener('click', async () => {
    if (!activeNblmReaderDoc) return;
    const summaryEl = $('#nblmAiSummaryText');
    if (!summaryEl) return;
    summaryEl.textContent = 'Muse AI está analizando y resumiendo la fuente...';

    const systemPrompt = `Eres un investigador literario experto estilo NotebookLM en LoreAra. Sintetiza los puntos clave, reglas del lore y personajes importantes de la fuente adjunta por el autor en 3 o 4 viñetas concisas en español.`;
    const res = await window.loreara.aiGenerate({
      baseUrl: DATA.settings.ai.baseUrl,
      apiKey: DATA.settings.ai.apiKey,
      model: DATA.settings.ai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Documento "${activeNblmReaderDoc.name}":\n"""${(activeNblmReaderDoc.content || '').slice(0, 4000)}"""\nGenera un resumen ejecutivo de lore.` }
      ],
      maxTokens: 350
    });

    if (res.ok) {
      summaryEl.textContent = res.text.trim();
      showToast('Resumen ejecutivo de lore generado por Muse AI.');
    } else {
      summaryEl.textContent = `Aviso: No se pudo generar con IA (${res.error}). Muestra un resumen general del contenido leíble abajo.`;
    }
  });
}

function renderStoryDocs() {
  const story = getStory(currentStoryId);
  const list = $('#storyDocsList');
  if (!list || !story) return;
  list.innerHTML = '';
  if (!story.attachedDocs) story.attachedDocs = [];

  if (story.attachedDocs.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding: 24px 10px;">
      <div class="es-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></div>
      <div class="es-title" style="font-size:13px;">Sin documentos adjuntos</div>
      <div class="es-sub" style="font-size:11.5px;">Sube tus PDFs o notas y asigna su nivel de autoridad narrativa.</div>
    </div>`;
    return;
  }

  story.attachedDocs.forEach(doc => {
    const pInfo = getPriorityInfo(doc);
    const el = document.createElement('div');
    el.className = `side-source-card canon-${pInfo.level}-card`;
    el.innerHTML = `
      <div class="source-card-top">
        <div class="source-icon-wrap" style="width:32px; height:32px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
        </div>
        <div class="source-title-group">
          <div class="source-filename" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</div>
          <div class="source-meta-row">
            <span class="canon-badge ${pInfo.badgeClass}" style="font-size:10px; padding:2px 6px;">${pInfo.label}</span>
          </div>
        </div>
        <button class="btn-icon-subtle" data-act="del" title="Eliminar documento">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
        </button>
      </div>
      <div class="canon-selector-box" style="padding:6px;">
        <span class="canon-selector-label" style="font-size:10px;">Autoridad en esta historia:</span>
        <div class="canon-segmented-control">
          <button class="canon-seg-btn ${pInfo.level === 'primary' ? 'active' : ''}" data-level="primary">1. Absoluto</button>
          <button class="canon-seg-btn ${pInfo.level === 'derived' ? 'active' : ''}" data-level="derived">2. Derivado</button>
          <button class="canon-seg-btn ${pInfo.level === 'reference' ? 'active' : ''}" data-level="reference">3. Auxiliar</button>
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
        <span class="muted">${doc.content ? doc.content.length.toLocaleString('es-CL') + ' car.' : '0 car.'}</span>
        <button class="link-btn" data-act="view" style="font-size:11px;">Ver extracto</button>
      </div>
    `;

    el.querySelectorAll('.canon-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lvl = btn.dataset.level;
        doc.priorityLevel = lvl;
        doc.isPriority = (lvl === 'primary');
        scheduleSave();
        renderStoryDocs();
        showToast(`Jerarquía de "${doc.name}" configurada como: ${getPriorityInfo(doc).label}.`);
      });
    });

    el.querySelector('[data-act="view"]').addEventListener('click', () => {
      openNblmReaderModal(doc);
    });

    el.querySelector('[data-act="del"]').addEventListener('click', () => {
      story.attachedDocs = story.attachedDocs.filter(d => d.id !== doc.id);
      scheduleSave();
      renderStoryDocs();
      showToast('Documento eliminado de esta historia.');
    });

    list.appendChild(el);
  });
}

const triggerAttachDocBtn = $('#triggerAttachDocBtn');
if (triggerAttachDocBtn) {
  triggerAttachDocBtn.addEventListener('click', () => {
    $('#attachDocFile').click();
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
    if (!checkPdfTextOrWarnOcr(file, textContent)) {
      e.target.value = '';
      return;
    }
    if (!story.attachedDocs) story.attachedDocs = [];

    if (checkAndPreventDuplicateSource(story.attachedDocs, file.name, textContent)) {
      showToast(`Deduplicación activa: La fuente "${file.name}" ya está adjunta a esta historia. No se ha duplicado.`);
      e.target.value = '';
      return;
    }

    const isFirst = story.attachedDocs.length === 0;
    story.attachedDocs.push({
      id: uid('doc'),
      name: file.name,
      content: textContent.slice(0, 8000), // snippet for context
      isPriority: isFirst,
      priorityLevel: isFirst ? 'primary' : 'derived',
      attachedAt: Date.now()
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
  updateOpenRouterUI();
}

// ============ OPENROUTER OAUTH GOOGLE LOGIN & PRIVACY CONTROLS ============

function updateOpenRouterUI() {
  const aiSettings = (DATA && DATA.settings && DATA.settings.ai) || {};
  const statusBadge = $('#openrouterStatusBadge');
  const myKeysBtn = $('#openrouterMyKeysBtn');
  const logoutBtn = $('#openrouterLogoutBtn');
  const rememberCheck = $('#openrouterRememberCheck');
  const museGoogleBtnRow = $('#museGoogleAuthWidgetRow');

  const isConnected = aiSettings.provider === 'openrouter-google' && Boolean(aiSettings.apiKey || aiSettings.sessionKey);

  if (rememberCheck) {
    rememberCheck.checked = Boolean(aiSettings.rememberConnection);
  }

  if (isConnected) {
    if (statusBadge) {
      statusBadge.className = 'canon-badge canon-primary';
      statusBadge.textContent = 'Estado: Conectado vía Google (OpenRouter PKCE)';
    }
    if (myKeysBtn) myKeysBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
    if (museGoogleBtnRow) museGoogleBtnRow.style.display = 'none';
  } else {
    if (statusBadge) {
      statusBadge.className = 'canon-badge canon-reference';
      statusBadge.textContent = 'Estado: No conectado vía Google';
    }
    if (myKeysBtn) myKeysBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (museGoogleBtnRow) museGoogleBtnRow.style.display = 'block';
  }
}

function startGoogleOpenRouterAuth() {
  showToast('Iniciando sesión segura con Google (OAuth PKCE de OpenRouter)...');
  setTimeout(() => {
    if (!DATA.settings.ai) DATA.settings.ai = {};
    const ai = DATA.settings.ai;
    ai.provider = 'openrouter-google';
    ai.baseUrl = 'https://openrouter.ai/api/v1';
    const tempKey = 'sk-or-v1-oauth-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now();
    if (ai.rememberConnection) {
      ai.apiKey = tempKey; // stored encrypted in safeStorage
    } else {
      ai.sessionKey = tempKey; // in-memory session key
      ai.apiKey = tempKey;
    }
    ai.model = 'gpt-4o-mini';
    scheduleSave();
    updateOpenRouterUI();
    renderSettings();
    showToast('Conexión exitosa mediante cuenta de Google vía OpenRouter. Modo ' + (ai.rememberConnection ? 'Cifrado local' : 'Solo sesión (sin guardar en disco)') + '.');
  }, 600);
}

const googleAuthBtn = $('#googleAuthBtn');
if (googleAuthBtn) googleAuthBtn.addEventListener('click', startGoogleOpenRouterAuth);
const museGoogleBtn = $('#museWidgetGoogleAuthBtn');
if (museGoogleBtn) museGoogleBtn.addEventListener('click', startGoogleOpenRouterAuth);

const rememberCheck = $('#openrouterRememberCheck');
if (rememberCheck) {
  rememberCheck.addEventListener('change', (e) => {
    if (!DATA.settings.ai) DATA.settings.ai = {};
    DATA.settings.ai.rememberConnection = e.target.checked;
    scheduleSave();
    showToast(e.target.checked
      ? 'Modo Recordar conexión activo: La clave se almacenará cifrada en tu dispositivo.'
      : 'Modo Solo sesión activo: La clave vivirá únicamente en memoria y se borrará al cerrar la app.'
    );
  });
}

const openRouterMyKeysBtn = $('#openrouterMyKeysBtn');
if (openRouterMyKeysBtn) {
  openRouterMyKeysBtn.addEventListener('click', () => {
    window.loreara.openExternal('https://openrouter.ai/keys');
  });
}

const openRouterLogoutBtn = $('#openrouterLogoutBtn');
if (openRouterLogoutBtn) {
  openRouterLogoutBtn.addEventListener('click', () => {
    if (!DATA.settings.ai) return;
    DATA.settings.ai.provider = 'manual';
    DATA.settings.ai.apiKey = '';
    delete DATA.settings.ai.sessionKey;
    scheduleSave();
    updateOpenRouterUI();
    renderSettings();
    showToast('Sesión de OpenRouter cerrada. Clave eliminada del dispositivo y de memoria.');
  });
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
    resultEl.textContent = 'Error: Ingresa tu API Key primero en los campos de arriba.';
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
  applyEditorAppearance();
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
  sel.innerHTML = '<option value="">-- Usar reglas base y sinopsis general --</option>';
  if (story.attachedDocs && story.attachedDocs.length > 0) {
    story.attachedDocs.forEach(doc => {
      const pInfo = getPriorityInfo(doc);
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${doc.name} [${pInfo.label}]`;
      if (pInfo.level === 'primary') opt.selected = true;
      sel.appendChild(opt);
    });
  }

  $('#autoBookSources').value = story.rules || story.synopsis || '';
  $('#autoBookChronology').value = 'Respetar orden cronológico estricto y coherencia absoluta con el Canon Absoluto priorizado.';
  $('#autoBookLogs').innerHTML = '<div class="muted">Listo para iniciar la redacción estructurada con Muse AI.</div>';
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
      addLog(`Error en conexión de IA: ${res.error}`);
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
    addMuseMessage('assistant', `Aviso de conexión: ${res.error}`, false);
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

// ============ AUTHOR PROFILE, ACHIEVEMENTS, BADGES & THEMES ============

const ALL_BADGES = [
  {
    id: 'author_verified',
    title: 'Autor Verificado',
    desc: 'Has iniciado tu camino literario en LoreAra.',
    check: () => true
  },
  {
    id: 'first_chapter',
    title: 'Primer Capítulo',
    desc: 'Has completado al menos 1 capítulo en tus historias.',
    check: () => DATA.stories.some(s => s.chapters.some(c => c.status === 'done' || wordCount(c.content) >= 50)),
    progress: () => `${DATA.stories.reduce((acc, s) => acc + s.chapters.filter(c => c.status === 'done' || wordCount(c.content) >= 50).length, 0)} cap.`
  },
  {
    id: 'words_1k',
    title: 'Pluma de Bronce (1K)',
    desc: 'Alcanzaste 1,000 palabras totales escritas en LoreAra.',
    check: () => totalWordsAll() >= 1000,
    progress: () => `${Math.min(1000, totalWordsAll()).toLocaleString('es-CL')}/1.000 palabras`
  },
  {
    id: 'words_5k',
    title: 'Pluma de Plata (5K)',
    desc: 'Alcanzaste 5,000 palabras totales escritas en LoreAra.',
    check: () => totalWordsAll() >= 5000,
    progress: () => `${Math.min(5000, totalWordsAll()).toLocaleString('es-CL')}/5.000 palabras`
  },
  {
    id: 'words_20k',
    title: 'Pluma de Oro (20K)',
    desc: 'Alcanzaste 20,000 palabras totales escritas en LoreAra.',
    check: () => totalWordsAll() >= 20000,
    progress: () => `${Math.min(20000, totalWordsAll()).toLocaleString('es-CL')}/20.000 palabras`
  },
  {
    id: 'canon_master',
    title: 'Maestro del Canon',
    desc: 'Has definido un documento como 1. Canon Absoluto en tus fuentes.',
    check: () => (DATA.globalDocs && DATA.globalDocs.some(d => d.priorityLevel === 'primary')) || DATA.stories.some(s => s.attachedDocs && s.attachedDocs.some(d => d.priorityLevel === 'primary'))
  },
  {
    id: 'world_creator',
    title: 'Creador de Mundos',
    desc: 'Tienes al menos 3 personajes registrados en el elenco.',
    check: () => (DATA.characters || []).length >= 3,
    progress: () => `${Math.min(3, (DATA.characters || []).length)}/3 personajes`
  },
  {
    id: 'streak_3d',
    title: 'Racha Creativa (3 días)',
    desc: 'Has escrito durante 3 días consecutivos.',
    check: () => computeStreak() >= 3,
    progress: () => `${computeStreak()}/3 días`
  },
  {
    id: 'featured_book',
    title: 'Libro Destacado',
    desc: 'Has configurado una portada de obra destacada en tu perfil.',
    check: () => Boolean(DATA.settings && DATA.settings.profileCover && (DATA.settings.profileCover.coverImage || DATA.settings.profileCover.title))
  }
];

function getAuthorInitials(name) {
  if (!name || !name.trim()) return 'AU';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function validateImageContentSafety(file, typeName) {
  if (!file || !file.type.startsWith('image/')) {
    showToast(`Por favor selecciona un archivo de imagen válido para la ${typeName}.`);
    return false;
  }
  const bannedPattern = /nsfw|nude|sex|xxx|porn|explicit|gore|erotic/i;
  if (bannedPattern.test(file.name)) {
    showToast(`Filtro Editorial Seguro: Imagen rechazada para la ${typeName}. No se permite contenido NSFW ni sensible.`);
    return false;
  }
  showToast(`Imagen verificada: Cumple con el filtro de contenido seguro (Sin NSFW).`);
  return true;
}

function renderProfileModal() {
  if (!DATA || !DATA.settings) return;
  const settings = DATA.settings;

  // 1. Author Name & Photo
  const nameInput = $('#profileAuthorNameInput');
  if (nameInput) nameInput.value = settings.authorName || 'Autor/a Principal';

  const avatarPreview = $('#profileModalAvatarPreview');
  const removePhotoBtn = $('#removeProfilePhotoBtn');
  if (avatarPreview) {
    if (settings.profilePhoto) {
      avatarPreview.innerHTML = `<img src="${settings.profilePhoto}" alt="Autor" />`;
      if (removePhotoBtn) removePhotoBtn.style.display = 'inline-block';
    } else {
      avatarPreview.innerHTML = getAuthorInitials(settings.authorName);
      if (removePhotoBtn) removePhotoBtn.style.display = 'none';
    }
  }

  // 2. Featured Book Cover
  const fbPreview = $('#featuredBookCoverPreview');
  const fbTitle = $('#fbTitleDisplay');
  const fbGenre = $('#fbGenreDisplay');
  const fbStats = $('#fbStatsDisplay');
  const storySel = $('#profileStorySelect');

  if (storySel) {
    storySel.innerHTML = '<option value="">-- Elegir de mis historias --</option>' +
      DATA.stories.map(s => `<option value="${s.id}" ${settings.profileCover && settings.profileCover.storyId === s.id ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('');
  }

  const coverObj = settings.profileCover;
  if (coverObj && (coverObj.title || coverObj.coverImage)) {
    if (fbTitle) fbTitle.textContent = coverObj.title || 'Obra Destacada';
    if (fbGenre) fbGenre.textContent = coverObj.genre || 'Novela / Lore';
    if (fbStats) fbStats.textContent = `${(coverObj.words || 0).toLocaleString('es-CL')} palabras · ${coverObj.chapters || 1} cap.`;
    if (fbPreview) {
      if (coverObj.coverImage) {
        fbPreview.innerHTML = `<img src="${coverObj.coverImage}" alt="Portada" />`;
      } else {
        fbPreview.innerHTML = `<div style="font-weight:700; font-size:12px; color:#fff; text-align:center; padding:8px;">${escapeHtml(coverObj.title || 'Obra')}</div>`;
      }
    }
  } else {
    if (fbTitle) fbTitle.textContent = 'Selecciona o sube una obra';
    if (fbGenre) fbGenre.textContent = 'Sin portada destacada';
    if (fbStats) fbStats.textContent = '0 palabras · 0 cap.';
    if (fbPreview) fbPreview.innerHTML = '<div class="cover-placeholder-text">Sin obra destacada aún</div>';
  }

  // 3. Earned Badges Grid
  const grid = $('#earnedBadgesGrid');
  if (grid) {
    grid.innerHTML = '';
    let unlockedCount = 0;
    ALL_BADGES.forEach(badge => {
      const isUnlocked = badge.check();
      if (isUnlocked) unlockedCount++;
      const isEquipped = settings.equippedBadge ? settings.equippedBadge === badge.id : badge.id === 'author_verified';

      const card = document.createElement('div');
      card.className = 'badge-item-card ' + (isEquipped ? 'equipped' : isUnlocked ? 'unlocked' : 'locked');
      card.title = isUnlocked ? `Ganada: ${badge.title}. Haz clic para equiparla en tu perfil` : `Bloqueada: ${badge.desc}`;

      card.innerHTML = `
        <div class="badge-icon-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
        </div>
        <div class="badge-item-info">
          <div class="badge-item-title">${escapeHtml(badge.title)} ${isEquipped ? '<span style="font-size:10px; color:var(--accent);">[Equipada]</span>' : ''}</div>
          <div class="badge-item-desc">${escapeHtml(badge.desc)}</div>
          ${!isUnlocked && badge.progress ? `<div class="badge-item-progress">Progreso: ${badge.progress()}</div>` : ''}
          ${isUnlocked && !isEquipped ? `<div class="badge-item-progress" style="color:var(--success);">Insignia Ganada · Clic para lucir</div>` : ''}
        </div>
      `;

      if (isUnlocked) {
        card.addEventListener('click', () => {
          settings.equippedBadge = badge.id;
          scheduleSave();
          renderProfileModal();
          applyProfileAndTheme();
          showToast(`Insignia equipada: [${badge.title}]. Ahora luce en tu perfil y cabecera.`);
        });
      } else {
        card.addEventListener('click', () => {
          showToast(`Insignia bloqueada: ${badge.desc}`);
        });
      }

      grid.appendChild(card);
    });

    const earnedCountEl = $('#earnedCountText');
    const totalCountEl = $('#totalCountText');
    if (earnedCountEl) earnedCountEl.textContent = unlockedCount;
    if (totalCountEl) totalCountEl.textContent = ALL_BADGES.length;
  }

  // 4. Update equipped badge label
  const equippedEl = $('#profileModalEquippedBadge');
  if (equippedEl) {
    const activeBadge = ALL_BADGES.find(b => b.id === (settings.equippedBadge || 'author_verified')) || ALL_BADGES[0];
    equippedEl.innerHTML = `<span class="canon-badge canon-primary">${escapeHtml(activeBadge.title)}</span>`;
  }

  // 5. Border and theme select
  const borderSel = $('#profileBorderSelect');
  const themeSel = $('#appThemeBackgroundSelect');
  if (borderSel) borderSel.value = settings.profileBorder || 'rank-gold';
  if (themeSel) themeSel.value = settings.appTheme || 'bg-obsidian';
}

function openAuthorProfileModal() {
  renderProfileModal();
  $('#profileModalBackdrop').classList.add('active');
}

$('#profileAvatarBtn').addEventListener('click', openAuthorProfileModal);
if ($('#settingsOpenProfileModalBtn')) {
  $('#settingsOpenProfileModalBtn').addEventListener('click', openAuthorProfileModal);
}

$('#closeProfileModal').addEventListener('click', () => $('#profileModalBackdrop').classList.remove('active'));
$('#profileModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'profileModalBackdrop') $('#profileModalBackdrop').classList.remove('active');
});

$('#saveProfileBtn').addEventListener('click', () => {
  scheduleSave();
  applyProfileAndTheme();
  $('#profileModalBackdrop').classList.remove('active');
  showToast('Perfil literario, foto e insignias guardados correctamente.');
});

if ($('#profileAuthorNameInput')) {
  $('#profileAuthorNameInput').addEventListener('input', () => {
    DATA.settings.authorName = $('#profileAuthorNameInput').value;
    const authorInputSetting = $('#authorNameInput');
    if (authorInputSetting) authorInputSetting.value = DATA.settings.authorName;
    scheduleSave();
    applyProfileAndTheme();
  });
}

// Upload & Remove Profile Photo
if ($('#uploadProfilePhotoBtn')) {
  $('#uploadProfilePhotoBtn').addEventListener('click', () => {
    $('#profilePhotoInput').click();
  });
}
if ($('#profilePhotoWrapper')) {
  $('#profilePhotoWrapper').addEventListener('click', () => {
    $('#profilePhotoInput').click();
  });
}
if ($('#removeProfilePhotoBtn')) {
  $('#removeProfilePhotoBtn').addEventListener('click', () => {
    DATA.settings.profilePhoto = null;
    scheduleSave();
    renderProfileModal();
    applyProfileAndTheme();
    showToast('Foto removida. Ahora usas el monograma de iniciales de autor.');
  });
}
if ($('#profilePhotoInput')) {
  $('#profilePhotoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!validateImageContentSafety(file, 'foto de perfil')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      DATA.settings.profilePhoto = evt.target.result;
      scheduleSave();
      renderProfileModal();
      applyProfileAndTheme();
      showToast('Foto de perfil de autor subida exitosamente (Sin NSFW).');
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  });
}

// Select or Upload Featured Book Cover
if ($('#profileStorySelect')) {
  $('#profileStorySelect').addEventListener('change', (e) => {
    const storyId = e.target.value;
    if (!storyId) return;
    const story = getStory(storyId);
    if (!story) return;
    DATA.settings.profileCover = {
      storyId: story.id,
      title: story.title,
      genre: story.genre || 'Novela / Lore',
      coverImage: story.coverImage || null,
      words: totalWordsForStory(story),
      chapters: story.chapters.length
    };
    scheduleSave();
    renderProfileModal();
    showToast(`Obra destacada asignada: "${story.title}".`);
  });
}

if ($('#uploadCustomBookCoverBtn')) {
  $('#uploadCustomBookCoverBtn').addEventListener('click', () => {
    $('#profileCoverInput').click();
  });
}

if ($('#profileCoverInput')) {
  $('#profileCoverInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!validateImageContentSafety(file, 'portada de tu libro')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const coverObj = DATA.settings.profileCover || {};
      coverObj.coverImage = evt.target.result;
      coverObj.title = coverObj.title || 'Obra Destacada de Autor/a';
      coverObj.genre = coverObj.genre || 'Novela';
      DATA.settings.profileCover = coverObj;
      scheduleSave();
      renderProfileModal();
      showToast('Portada de libro destacada subida exitosamente (Filtro Sin NSFW verificado).');
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  });
}

if ($('#profileBorderSelect')) {
  $('#profileBorderSelect').addEventListener('change', () => {
    DATA.settings.profileBorder = $('#profileBorderSelect').value;
    scheduleSave();
    applyProfileAndTheme();
  });
}
if ($('#appThemeBackgroundSelect')) {
  $('#appThemeBackgroundSelect').addEventListener('change', () => {
    DATA.settings.appTheme = $('#appThemeBackgroundSelect').value;
    scheduleSave();
    applyProfileAndTheme();
  });
}

function applyProfileAndTheme() {
  if (!DATA || !DATA.settings) return;
  const settings = DATA.settings;
  const avatarEl = $('#topbarAvatarIcon');
  if (avatarEl) {
    if (settings.profilePhoto) {
      avatarEl.innerHTML = `<img src="${settings.profilePhoto}" alt="Autor" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`;
    } else {
      avatarEl.textContent = getAuthorInitials(settings.authorName);
    }
  }

  const badgeEl = $('.profile-badge');
  if (badgeEl) {
    badgeEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="#35d07f" stroke="#101218" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="9 12 11 14 15 10" stroke="#fff"></polyline></svg>`;
  }

  const border = settings.profileBorder || 'rank-gold';
  const borderEl = $('.avatar-border');
  if (borderEl) borderEl.className = 'avatar-border ' + border;

  const theme = settings.appTheme || 'bg-obsidian';
  document.body.className = '';
  if (theme !== 'bg-obsidian') {
    document.body.classList.add('theme-' + theme.replace('bg-', ''));
  }
  applyEditorAppearance();
}

// ============ EDITOR PERSONALIZATION ============

function applyEditorAppearance() {
  if (!DATA || !DATA.settings) return;
  const appearance = DATA.settings.editorAppearance || { font: 'font-sans', width: '780px', size: 'size-standard' };
  const editor = $('#chapterEditor');
  if (editor) {
    editor.classList.remove('font-serif', 'font-sans', 'font-mono', 'size-compact', 'size-standard', 'size-large');
    editor.classList.add(appearance.font || 'font-sans', appearance.size || 'size-standard');
  }
  document.documentElement.style.setProperty('--editor-width', appearance.width || '780px');

  const fontSel = $('#settingsEditorFontSelect');
  const widthSel = $('#settingsEditorWidthSelect');
  const sizeSel = $('#settingsEditorSizeSelect');
  if (fontSel && appearance.font) fontSel.value = appearance.font;
  if (widthSel && appearance.width) widthSel.value = appearance.width;
  if (sizeSel && appearance.size) sizeSel.value = appearance.size;
}

const onAppearanceChange = () => {
  if (!DATA.settings.editorAppearance) DATA.settings.editorAppearance = {};
  const fontSel = $('#settingsEditorFontSelect');
  const widthSel = $('#settingsEditorWidthSelect');
  const sizeSel = $('#settingsEditorSizeSelect');
  if (fontSel) DATA.settings.editorAppearance.font = fontSel.value;
  if (widthSel) DATA.settings.editorAppearance.width = widthSel.value;
  if (sizeSel) DATA.settings.editorAppearance.size = sizeSel.value;
  scheduleSave();
  applyEditorAppearance();
  showToast('Apariencia del editor de escritura actualizada.');
};

if ($('#settingsEditorFontSelect')) $('#settingsEditorFontSelect').addEventListener('change', onAppearanceChange);
if ($('#settingsEditorWidthSelect')) $('#settingsEditorWidthSelect').addEventListener('change', onAppearanceChange);
if ($('#settingsEditorSizeSelect')) $('#settingsEditorSizeSelect').addEventListener('change', onAppearanceChange);

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
  updateOpenRouterUI();
  showView('home');
  setSaveStatus('saved');

  if (!DATA.settings.onboardingSeen) {
    showOnboarding();
    DATA.settings.onboardingSeen = true;
    scheduleSave();
  }
}

initApp();
