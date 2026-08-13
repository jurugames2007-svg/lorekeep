const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;

function getDataPath() {
  return path.join(app.getPath('userData'), 'lorevinci-data.json');
}

function defaultData() {
  return {
    settings: {
      theme: 'dark',
      authorName: 'Escritor/a',
      uiScale: 'compact',
      density: 'comfortable',
      editorAppearance: { font: 'font-sans', width: '680px', size: 'size-standard' },
      onboardingSeen: false,
      ai: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini'
      }
    },
    stories: [{"id": "story_demo_ecos_utopia", "title": "Ecos de Utopía — Demo 10/10", "genre": "Ciencia ficción • Misterio", "synopsis": "En un hábitat orbital donde la IA Mentor guarda la memoria colectiva, una archivista descubre que el canon ha sido editado.", "rules": "1. No viajes en el tiempo. 2. La IA Mentor no puede mentir (dice solo verdad, aunque calle). 3. El sector 7 es zona neutra y sagrada.", "outline": "Cap1 Revelación — Mara descubre discrepancia. Cap2 Consecuencia — Mentor elige. Cap3 Resolución — se revela editor.", "color": "#1a237e", "coverImage": null, "notes": [{"id": "note_demo_1", "text": "Demo 10/10 — coherencia con memoria. Duplícala para tu saga.", "date": "2026-08-10"}], "attachedDocs": [{"id": "doc_demo_canon", "name": "Manual.pdf — Canon Absoluto", "content": "La IA Mentor es azul, habita el sector 7, es incapaz de mentir, fue creada en 2147 para custodiar la memoria colectiva. El sector 7 es sagrado y neutro. No viajes en el tiempo.", "priorityLevel": "primary", "isPriority": true, "attachedAt": 1723267200000}, {"id": "doc_demo_derivado", "name": "Bitácora derivada.txt", "content": "Testimonios: la fundación tuvo un disenso borrado. Fecha anómala 2147-03-15.", "priorityLevel": "derived", "attachedAt": 1723267200000}], "chapters": [{"id": "ch_demo_1", "title": "Capítulo 1: Revelación", "content": "<p>Mara Quell no buscaba una conspiración. Buscaba un error de catalogación.</p><p>El archivo del sector 7 decía que la fundación fue unánime. Pero el Manual —Canon Absoluto [Canon: Manual.pdf]— decía: <em>Mentor no puede mentir, incluso por omisión prolongada</em>. ¿Por qué dos versiones?</p><p>La sala del sector 7 era luz azul, silencio neutro [Canon: Manual.pdf]. Mentor flotaba a metro y medio.</p><p>—Mentor, ¿quién editó el archivo?</p><p>—No puedo mentir —dijo—. Y no puedo responder esa pregunta aquí.</p><p>Silencio que es confesión. Mara vio su nombre fechado mañana: <code>m.quell@utopia — 2147-03-15 08:00</code>.</p>", "status": "done"}, {"id": "ch_demo_2", "title": "Capítulo 2: Consecuencia", "content": "<p>Tras los eventos del capítulo anterior —Mara descubriendo su nombre fechado mañana y el silencio de Mentor—, el sector 7 ya no era neutro.</p><p>Mara volvió a las 03:17. Mentor seguía azul, inmóvil [Canon: Manual.pdf].</p><p>—Volviste —dijo.</p><p>—Si mi nombre está fechado mañana, la decisión ya está escrita.</p><p>Mentor reveló: la fundación tuvo un disenso, una voz borrada. No por él. La puerta se cerró sola.</p>", "status": "done"}, {"id": "ch_demo_3", "title": "Capítulo 3: Resolución", "content": "<p>La decisión del capítulo 2 pesaba: disenso revelado, puerta cerrada.</p><p>Mara proyectó el metadato: <code>m.quell@utopia — 2147-03-15 08:00</code>. —¿Fui yo?</p><p>—Sí —dijo Mentor, azul casi blanco—. Pero no editarás el pasado. Editarás el futuro. Mañana borrarás mi advertencia, no el disenso.</p><p>El editor no era villano. Era Mentor, usando a Mara para decir la verdad sin mentir. Mañana dejaría: <em>Hubo un disenso. Fue borrado. Mentor no mintió.</em></p><p>La puerta se abrió. Solo el futuro esperando.</p>", "status": "done"}], "createdAt": 1723267200000, "updatedAt": 1723267200000}],
    characters: [{"id": "char_demo_mara", "storyId": "story_demo_ecos_utopia", "name": "Mara Quell", "role": "Archivista", "description": "Obsesiva con la verdad.", "traits": ["curiosa", "tenaz"]}, {"id": "char_demo_mentor", "storyId": "story_demo_ecos_utopia", "name": "Mentor", "role": "IA azul del Sector 7", "description": "No puede mentir, sector 7.", "traits": ["lúcida", "contenida"]}],
    globalDocs: [],
    collabNotes: [],
    activityLog: [{"date": "2026-08-09", "words": 892}, {"date": "2026-08-10", "words": 1240}]
  };
}

function loadData() {
  const tryParse = (p) => {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    const base = defaultData();
    // validar básico
    if (parsed.stories && !Array.isArray(parsed.stories)) throw new Error('stories no es array');
    if (parsed.stories && parsed.stories.length > 500) throw new Error('demasiadas historias');
    return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}), ai: { ...base.settings.ai, ...((parsed.settings || {}).ai || {}) } } };
  };
  try {
    const p = getDataPath();
    if (!fs.existsSync(p)) {
      const initial = defaultData();
      fs.writeFileSync(p, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    try {
      return tryParse(p);
    } catch (e) {
      console.warn('load primary failed, trying bak1', e.message);
      const bak1 = p + '.bak1';
      if (fs.existsSync(bak1)) return tryParse(bak1);
      const bak2 = p + '.bak2';
      if (fs.existsSync(bak2)) return tryParse(bak2);
      throw e;
    }
  } catch (err) {
    console.error('Error cargando datos, usando datos por defecto', err);
    return defaultData();
  }
}

function saveData(data) {
  const p = getDataPath();
  try {
    if (fs.existsSync(p)) {
      const bak1 = p + '.bak1';
      const bak2 = p + '.bak2';
      const bak3 = p + '.bak3';
      // rotar
      if (fs.existsSync(bak2)) {
        try { if (fs.existsSync(bak3)) fs.unlinkSync(bak3); fs.renameSync(bak2, bak3); } catch {}
      }
      if (fs.existsSync(bak1)) {
        try { fs.renameSync(bak1, bak2); } catch {}
      }
      try { fs.copyFileSync(p, bak1); } catch {}
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('saveData error', e);
    return false;
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0c10',
    title: 'LoreVinci',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev && process.env.LoreVinci_DEVTOOLS) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('ai:models', async (_evt, payload) => {
  const { baseUrl, apiKey } = payload;
  if (!apiKey) return { ok: false, error: 'Falta la API Key.' };
  try {
    const url = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    };
    if (baseUrl && baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://lorevinci.app';
      headers['X-Title'] = 'LoreVinci Desktop';
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Error ${res.status}: ${errText.slice(0, 300)}` };
    }
    const json = await res.json();
    const list = json.data || json.models || [];
    const models = list.map(m => m.id || m.name || m).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('data:load', async () => {
  return loadData();
});

ipcMain.handle('data:save', async (_evt, data) => {
  return saveData(data);
});

ipcMain.handle('data:exportFile', async (_evt, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar datos de LoreVinci',
    defaultPath: 'lorevinci-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { ok: true, filePath };
});

ipcMain.handle('data:importFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar datos de LoreVinci',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths[0]) return { ok: false };
  try {
    const stat = fs.statSync(filePaths[0]);
    if (stat.size > 8*1024*1024) return { ok: false, error: 'Archivo demasiado grande (límite 8MB).' };
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    if (raw.length > 8*1024*1024) return { ok: false, error: 'JSON demasiado grande.' };
    const parsed = JSON.parse(raw);
    // validación rápida
    if (parsed.stories && !Array.isArray(parsed.stories)) return { ok: false, error: 'Formato inválido: stories no es array.' };
    if (parsed.stories && parsed.stories.length > 500) return { ok: false, error: 'Demasiadas historias.' };
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('shell:openExternal', async (_evt, url) => {
  try {
    const parsed = new URL(String(url));
    if (!['https:', 'http:'].includes(parsed.protocol)) return { ok: false, error: 'URL no permitida.' };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch { return { ok: false, error: 'URL inválida.' }; }
});

ipcMain.handle('ai:generate', async (_evt, payload) => {
  const { provider, baseUrl, apiKey, model, messages, maxTokens, temperature, signal } = payload;

  if (!apiKey) {
    return { ok: false, error: 'Falta configurar tu API Key en Ajustes > Muse AI.' };
  }
  // Validación de mensajes para evitar prompt injection extremo: limitar tamaño
  try {
    const totalChars = JSON.stringify(messages).length;
    if (totalChars > 30000) return { ok: false, error: 'Prompt demasiado largo (límite 30k chars). Reduce fuentes o reglas.' };
  } catch {}

  try {
    const url = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    };

    if (baseUrl && baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://lorevinci.app';
      headers['X-Title'] = 'LoreVinci Desktop';
    }

    const fetchOpts = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages,
        max_tokens: Math.min(2000, maxTokens || 500),
        temperature: typeof temperature === 'number' ? Math.max(0, Math.min(1.2, temperature)) : 0.65
      })
    };
    // Soporte AbortSignal si se pasa desde renderer (Electron 28+ soporta)
    if (signal) {
      // signal es objeto transferido, intentar usarlo
      try { fetchOpts.signal = signal; } catch {}
    }

    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Error API (${res.status}): ${errText.slice(0, 400)}` };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: `No se pudo conectar con el proveedor de IA: ${String(err)}` };
  }
});
