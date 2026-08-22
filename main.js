const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');

const isDev = !app.isPackaged;
const aiAbortControllers = new Map();

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Tiempo de espera agotado')), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeWebEntities(value) {
  const named = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_m, key) => {
    if (key[0] === '#') {
      const hex = key[1].toLowerCase() === 'x';
      const number = parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : '';
    }
    return named[key.toLowerCase()] || '';
  });
}

function stripWebHtml(value) {
  return decodeWebEntities(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function isPrivateIp(address) {
  const ip = String(address || '').toLowerCase();
  if (!net.isIP(ip)) return true;
  if (net.isIPv6(ip)) return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:') || ip === '::';
  const parts = ip.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || (parts[0] >= 224);
}

async function assertPublicWebUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Solo se permiten URLs http/https.');
  if (/^(localhost|.+\.localhost)$/i.test(parsed.hostname)) throw new Error('No se permiten direcciones locales.');
  const records = await dns.lookup(parsed.hostname, { all:true, verbatim:true });
  if (!records.length || records.some(r => isPrivateIp(r.address))) throw new Error('La URL resuelve a una red privada o no permitida.');
  return parsed;
}

async function fetchPublicWebPage(rawUrl, maxBytes = 30 * 1024 * 1024) {
  let current = await assertPublicWebUrl(rawUrl);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const res = await fetchWithTimeout(current.toString(), {
      method:'GET', redirect:'manual',
      headers:{ 'User-Agent':'LoreVinci/1.0 Research (+https://lorevinci.app)', Accept:'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.2' }
    }, 30000);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = await assertPublicWebUrl(new URL(res.headers.get('location'), current).toString());
      continue;
    }
    if (!res.ok) throw new Error(`La fuente respondió HTTP ${res.status}.`);
    const length = Number(res.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error('La página supera el límite de 30 MB.');
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (/application\/pdf|application\/octet-stream/.test(type)) throw new Error('La URL apunta a un archivo binario/PDF. Descárgalo y súbelo desde Fuentes para extraerlo con seguridad.');
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    let buffer;
    if (reader) {
      const chunks = []; let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { try { await reader.cancel(); } catch {} throw new Error('La página supera el límite de 30 MB.'); }
        chunks.push(Buffer.from(value));
      }
      buffer = Buffer.concat(chunks, total);
    } else {
      buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error('La página supera el límite de 30 MB.');
    }
    const html = buffer.toString('utf8');
    const title = stripWebHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1]).slice(0, 240);
    const description = stripWebHtml((html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i) || [,''])[1]).slice(0, 600);
    const content = (type.includes('text/plain') ? html : stripWebHtml(html)).slice(0, 60000);
    if (content.length < 80) throw new Error('La página no contiene texto legible suficiente.');
    return { url:current.toString(), title:title || current.hostname, description, content, contentType:type || 'text/html', fetchedAt:Date.now() };
  }
  throw new Error('Demasiadas redirecciones.');
}

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

function isOmniRouteUrl(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ''));
    return url.port === '20128' || /omniroute/i.test(url.hostname);
  } catch { return false; }
}

ipcMain.handle('ai:models', async (_evt, payload) => {
  const { baseUrl, apiKey } = payload || {};
  const root = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(root);
  if (!apiKey && !isLocal) return { ok: false, error: 'Falta la API Key.' };
  try {
    const url = `${root}/models`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (baseUrl && baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://lorevinci.app';
      headers['X-Title'] = 'LoreVinci Desktop';
    }
    const res = await fetchWithTimeout(url, { method: 'GET', headers });
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

ipcMain.handle('ai:omnirouteStatus', async (_evt, payload) => {
  const baseUrl = String(payload?.baseUrl || 'http://localhost:20128/v1').replace(/\/$/, '');
  const apiKey = String(payload?.apiKey || '');
  if (!isOmniRouteUrl(baseUrl)) return { ok:false, error:'La URL no parece una instancia OmniRoute (puerto esperado 20128).' };
  const headers = { Accept:'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const started = Date.now();
    const res = await fetchWithTimeout(`${baseUrl}/models`, { method:'GET', headers }, 12000);
    if (!res.ok) {
      const detail = (await res.text()).slice(0,240);
      return { ok:false, status:res.status, error:res.status === 401 || res.status === 403 ? 'OmniRoute responde, pero requiere una API key creada en Dashboard → API Keys.' : `OmniRoute respondió HTTP ${res.status}: ${detail}` };
    }
    const json = await res.json();
    const models = (json.data || json.models || []).map(m => m.id || m.name || m).filter(Boolean);
    const dashboardUrl = baseUrl.replace(/\/v1$/i, '');
    return {
      ok:true, baseUrl, dashboardUrl, latencyMs:Date.now()-started, modelCount:models.length,
      models:models.slice(0,500), autoAvailable:true, // `auto` es un modelo virtual y puede no aparecer en /v1/models
      version:res.headers.get('x-omniroute-version') || null
    };
  } catch (err) {
    return { ok:false, error:`No se detectó OmniRoute en ${baseUrl}: ${String(err.message || err).slice(0,180)}` };
  }
});

// Verificación completa de la API: comprueba credencial (GET /models) y capacidad real
// de generación (POST /chat/completions con un ping mínimo). Devuelve un diagnóstico
// accionable para que el usuario deje la IA operativa desde Ajustes.
ipcMain.handle('ai:verify', async (_evt, payload) => {
  const { baseUrl, apiKey, model } = payload || {};
  const steps = [];
  const root = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(root);

  if (!apiKey && !isLocal) {
    return {
      ok: false,
      steps: [{ id: 'key', ok: false, label: 'API Key presente', detail: 'No hay API Key configurada.' }],
      error: 'Falta la API Key. Pégala en el campo de arriba y vuelve a verificar.'
    };
  }
  steps.push({ id: 'key', ok: true, label: 'API Key presente', detail: isLocal && !apiKey ? 'Servidor local sin key (correcto)' : 'Clave detectada' });

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (root.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://lorevinci.app';
    headers['X-Title'] = 'LoreVinci Desktop';
  }

  let models = [];
  // Paso 1: credencial + catálogo de modelos
  try {
    const res = await fetchWithTimeout(`${root}/models`, { method: 'GET', headers });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      let hint = `Error ${res.status}.`;
      if (res.status === 401 || res.status === 403) hint = 'Credencial rechazada (401/403). Revisa que la API Key sea válida y esté activa.';
      else if (res.status === 404) hint = 'Endpoint /models no encontrado (404). Revisa la URL base: suele terminar en /v1.';
      else if (res.status === 429) hint = 'Límite de cuota alcanzado (429). Espera o revisa tu plan.';
      steps.push({ id: 'auth', ok: false, label: 'Autenticación y catálogo', detail: `${hint} ${errText}`.trim() });
      return { ok: false, steps, error: hint };
    }
    const json = await res.json();
    const list = json.data || json.models || [];
    models = list.map(m => m.id || m.name || m).filter(Boolean);
    steps.push({ id: 'auth', ok: true, label: 'Autenticación y catálogo', detail: `${models.length} modelo(s) disponibles` });
  } catch (err) {
    steps.push({ id: 'auth', ok: false, label: 'Autenticación y catálogo', detail: `No hay conexión con ${root}: ${String(err).slice(0, 200)}` });
    return { ok: false, steps, error: `No se pudo contactar ${root}. Revisa la URL base y tu conexión.` };
  }

  // Paso 2: el modelo elegido existe en el catálogo
  const chosen = model || models[0] || 'gpt-4o-mini';
  const modelExists = (isOmniRouteUrl(root) && /^auto(?:\/|$)/i.test(chosen)) || models.length === 0 || models.includes(chosen);
  steps.push({
    id: 'model',
    ok: modelExists,
    label: 'Modelo seleccionado',
    detail: modelExists ? `"${chosen}" disponible` : `"${chosen}" no aparece en el catálogo; elige uno de la lista detectada.`
  });

  // Paso 3: generación real (prueba de extremo a extremo)
  try {
    const res = await fetchWithTimeout(`${root}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: chosen,
        messages: [
          { role: 'system', content: 'Responde exactamente con la palabra: OPERATIVO' },
          { role: 'user', content: 'ping' }
        ],
        max_tokens: 12,
        temperature: 0
      })
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      let hint = `La generación falló (${res.status}).`;
      if (res.status === 402) hint = 'Sin créditos (402). Recarga saldo en tu proveedor.';
      else if (res.status === 401 || res.status === 403) hint = 'La clave lee modelos pero no puede generar (permisos insuficientes).';
      else if (res.status === 404) hint = `El modelo "${chosen}" no existe para esta cuenta.`;
      else if (res.status === 429) hint = 'Límite de peticiones (429). Reintenta en unos segundos.';
      steps.push({ id: 'generate', ok: false, label: 'Generación de texto', detail: `${hint} ${errText}`.trim() });
      return { ok: false, steps, models, error: hint };
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    steps.push({ id: 'generate', ok: true, label: 'Generación de texto', detail: `Respuesta recibida: "${String(text).trim().slice(0, 40) || '(vacía)'}"` });
    return { ok: true, steps, models, model: chosen };
  } catch (err) {
    steps.push({ id: 'generate', ok: false, label: 'Generación de texto', detail: String(err).slice(0, 200) });
    return { ok: false, steps, models, error: 'No se pudo completar la prueba de generación.' };
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
    if (raw.length > 30*1024*1024) return { ok: false, error: 'JSON demasiado grande (límite 30 MB).' };
    const parsed = JSON.parse(raw);
    // validación rápida
    if (parsed.stories && !Array.isArray(parsed.stories)) return { ok: false, error: 'Formato inválido: stories no es array.' };
    if (parsed.stories && parsed.stories.length > 500) return { ok: false, error: 'Demasiadas historias.' };
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('web:search', async (_evt, payload) => {
  const query = String(payload && payload.query || '').trim().slice(0, 240);
  const provider = String(payload && payload.provider || 'all');
  if (query.length < 2) return { ok:false, error:'Escribe al menos 2 caracteres para buscar.' };
  const results = [];
  const push = item => {
    if (!item || !item.url || results.some(r => r.url === item.url)) return;
    results.push({ title:String(item.title || item.url).slice(0,240), url:String(item.url), snippet:String(item.snippet || '').slice(0,700), provider:item.provider || 'web' });
  };
  const headers = { 'User-Agent':'LoreVinci/1.0 Research (+https://lorevinci.app)', Accept:'application/json,text/html;q=0.9' };
  const errors = [];

  if (provider === 'all' || provider === 'wikipedia') {
    try {
      const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&origin=*&srlimit=6`;
      const res = await fetchWithTimeout(url, { headers }, 20000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      (json?.query?.search || []).forEach(row => push({
        title:row.title, url:`https://es.wikipedia.org/wiki/${encodeURIComponent(String(row.title).replace(/ /g,'_'))}`,
        snippet:stripWebHtml(row.snippet), provider:'Wikipedia'
      }));
    } catch (err) { errors.push(`Wikipedia: ${String(err.message || err)}`); }
  }

  if (provider === 'all' || provider === 'books') {
    try {
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=6&fields=key,title,author_name,first_publish_year,subject`;
      const res = await fetchWithTimeout(url, { headers }, 20000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      (json?.docs || []).forEach(row => push({
        title:row.title, url:`https://openlibrary.org${row.key}`,
        snippet:[(row.author_name || []).slice(0,3).join(', '), row.first_publish_year, (row.subject || []).slice(0,5).join(' · ')].filter(Boolean).join(' — '), provider:'Open Library'
      }));
    } catch (err) { errors.push(`Open Library: ${String(err.message || err)}`); }
  }

  if (provider === 'all' || provider === 'web') {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetchWithTimeout(url, { headers:{ ...headers, Accept:'text/html' } }, 20000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const linkRx = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = linkRx.exec(html)) && results.length < 18) {
        let target = decodeWebEntities(match[1]);
        try {
          const parsed = new URL(target, 'https://duckduckgo.com');
          target = parsed.searchParams.get('uddg') || parsed.toString();
          const targetUrl = new URL(target);
          if (!['http:','https:'].includes(targetUrl.protocol) || /duckduckgo\.com$/i.test(targetUrl.hostname)) continue;
          const tail = html.slice(linkRx.lastIndex, linkRx.lastIndex + 1600);
          const snippet = stripWebHtml((tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i) || [,''])[1]);
          push({ title:stripWebHtml(match[2]), url:targetUrl.toString(), snippet, provider:'Web' });
        } catch {}
      }
    } catch (err) { errors.push(`Web: ${String(err.message || err)}`); }
  }

  return results.length
    ? { ok:true, results:results.slice(0,18), warnings:errors }
    : { ok:false, results:[], error:errors.join(' · ') || 'No se encontraron resultados.' };
});

ipcMain.handle('web:fetch', async (_evt, payload) => {
  try {
    const page = await fetchPublicWebPage(payload && payload.url);
    return { ok:true, page };
  } catch (err) {
    return { ok:false, error:String(err.message || err).slice(0,400) };
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

if (typeof ipcMain.on === 'function') {
  ipcMain.on('ai:cancel', (_evt, requestId) => {
    const controller = aiAbortControllers.get(String(requestId || ''));
    if (controller) controller.abort(new Error('Generación cancelada por el usuario'));
  });
}

ipcMain.handle('ai:generate', async (_evt, payload) => {
  const { provider, baseUrl, apiKey, model, messages, maxTokens, temperature, requestId, task, compression, sessionId } = payload || {};
  const root = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(root);

  if (!apiKey && !isLocal) {
    return { ok: false, error: 'Falta configurar tu API Key en Ajustes > Muse AI.' };
  }
  // Validación de mensajes para evitar prompt injection extremo: limitar tamaño
  try {
    const totalChars = JSON.stringify(messages).length;
    if (totalChars > 120000) return { ok: false, error: 'Prompt demasiado largo (límite 120k chars). Reduce fuentes o reglas.' };
  } catch {}

  const controller = new AbortController();
  const key = String(requestId || '');
  const timeout = setTimeout(() => controller.abort(new Error('La IA superó 90 segundos de espera')), 90000);
  if (key) aiAbortControllers.set(key, controller);

  try {
    const url = `${root}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    if (baseUrl && baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://lorevinci.app';
      headers['X-Title'] = 'LoreVinci Desktop';
    }
    if (isOmniRouteUrl(root)) {
      headers['X-Request-Id'] = key || `lorevinci-${Date.now()}`;
      if (sessionId) headers['X-OmniRoute-Session-Id'] = String(sessionId).slice(0,128);
      if (compression && ['off','default','engine:rtk'].includes(compression)) headers['X-OmniRoute-Compression'] = compression;
      if (task) headers['X-LoreVinci-Task'] = String(task).slice(0,40);
    }

    const fetchOpts = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages,
        max_tokens: Math.min(32000, maxTokens || 500),
        temperature: typeof temperature === 'number' ? Math.max(0, Math.min(1.2, temperature)) : 0.65
      })
    };
    fetchOpts.signal = controller.signal;

    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Error API (${res.status}): ${errText.slice(0, 400)}` };
    }

    const json = await res.json();
    const choice = json?.choices?.[0];
    const text = choice?.message?.content || '';
    // finish_reason es la única forma fiable de saber si el modelo se quedó sin
    // presupuesto a mitad de frase. Sin esto guardaríamos capítulos cortados
    // haciéndolos pasar por completos.
    const finishReason = choice?.finish_reason || choice?.native_finish_reason || null;
    const usage = json?.usage || null;
    const route = isOmniRouteUrl(root) ? {
      decision:res.headers.get('x-omniroute-decision'),
      provider:res.headers.get('x-omniroute-provider'),
      model:res.headers.get('x-omniroute-model') || json?.model || null,
      latencyMs:Number(res.headers.get('x-omniroute-latency-ms')) || null,
      responseCost:res.headers.get('x-omniroute-response-cost'),
      cacheHit:res.headers.get('x-omniroute-cache-hit') || res.headers.get('x-omniroute-cache'),
      fallbackAttempts:Number(res.headers.get('x-omniroute-fallback-attempts')) || 0,
      compression:res.headers.get('x-omniroute-compression'),
      version:res.headers.get('x-omniroute-version'),
      requestId:res.headers.get('x-omniroute-request-id')
    } : null;
    return {
      ok: true,
      text,
      route,
      finishReason,
      truncated: finishReason === 'length',
      usage: usage ? {
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null
      } : null
    };
  } catch (err) {
    const cancelled = controller.signal.aborted;
    return { ok: false, error: cancelled ? `Generación cancelada o expirada: ${String(controller.signal.reason || err)}` : `No se pudo conectar con el proveedor de IA: ${String(err)}` };
  } finally {
    clearTimeout(timeout);
    if (key) aiAbortControllers.delete(key);
  }
});
