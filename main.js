const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
// Datos semilla compartidos con el renderer: una sola fuente de verdad.
const LoreSeed = require('./renderer/seed-data');
const LoreDomSafe = require('./renderer/dom-safe');
const LoreConfig = require('./renderer/app-config');
const LoreKernel = require('./renderer/app-kernel');

// Log estructurado del proceso principal: una línea JSON por evento, con
// trace_id para correlacionar todo lo que ocurre dentro de un mismo guardado.
const mainLogger = LoreKernel.createLogger({ scope: 'main' });

// Límites centralizados: ni números mágicos ni strings repetidos en el handler.
const MAX_PROMPT_CHARS = 120000;
const CLIPBOARD_MAX_CHARS = 20000;

const sanitizeHtml = LoreDomSafe.sanitizeHtml;
const safeImageUrl = LoreDomSafe.safeImageUrl;
// Campos de texto plano (títulos, nombres, notas, contenido de fuentes): se les
// quita el HTML en vez de escaparlo. Escapar aquí provocaba doble escape al
// renderizar (el renderer vuelve a escapar), y se veía "Tomy &amp; Jerry".
const plainText = LoreDomSafe.sanitizePlainText;

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
      headers:{ 'User-Agent':LoreConfig.APP.USER_AGENT_RESEARCH, Accept:'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.2' }
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
        if (total > maxBytes) {
          // Se libera el stream antes de lanzar: si `cancel()` falla, el socket
          // queda abierto. No puede romper el flujo, pero tampoco silenciarse.
          await LoreKernel.runCleanup('web-reader', () => reader.cancel(), mainLogger);
          throw new Error('La página supera el límite de 30 MB.');
        }
        chunks.push(Buffer.from(value));
      }
      buffer = Buffer.concat(chunks, total);
    } else {
      buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error('La página supera el límite de 30 MB.');
    }
    const html = buffer.toString('utf8');
    const title = stripWebHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, ''])[1]).slice(0, 240);
    const description = stripWebHtml((html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i) || [null, ''])[1]).slice(0, 600);
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
  // Semilla única (ver renderer/seed-data.js). Antes estaba duplicada aquí, en el
  // fallback de navegador de app.js y en initApp(), y las tres copias ya divergían.
  return LoreSeed.defaultData();
}

/**
 * Texto plano acotado. Era la función local `str` dentro de
 * `normalizeStoredData`; al descomponerla en pasos con nombre hace falta que sea
 * compartida, y de paso deja de ser un alias críptico de tres letras.
 * @param {unknown} value
 * @param {number} [limit]
 * @returns {string}
 */
function toPlainText(value, limit = 4000) {
  return plainText(value, limit);
}

/**
 * Recortes por colección. Estaban dispersos como literales numéricos dentro de
 * `normalizeStoredData`; juntos y con nombre se puede razonar sobre el peor caso
 * de memoria sin leer la función entera.
 */
const NORMALIZE_LIMITS = Object.freeze({
  stories: 500,
  characters: 5000,
  globalDocs: 2000,
  collabNotes: 2000,
  activityLog: 800,
  notifications: 100,
  chapterContent: 2000000,
  docContent: 400000,
  longText: 200000
});

// Listas blancas de identidad visual. Estos valores se inyectan en el DOM o en
// variables CSS, así que lo que no está en la lista no pasa.
const UI_SCALES = ['compact', 'balanced', 'spacious'];
const UI_DENSITIES = ['comfortable', 'compact'];
const UI_AMBIENTS = ['none', 'paper', 'sepia', 'night', 'forest'];
const EDITOR_FONTS = ['font-sans', 'font-serif', 'font-mono'];
const EDITOR_SIZES = ['size-compact', 'size-standard', 'size-large'];

/**
 * Identidad visual y apariencia del editor: tema, escala, acento, ambiente e
 * imágenes de perfil y fondo.
 *
 * @param {Record<string, any>} settings Se muta y se devuelve, para que el paso
 *   siguiente de la normalización pueda encadenarse sobre el mismo objeto.
 * @returns {Record<string, any>}
 */
function normalizeAppearance(settings) {
  settings.authorName = toPlainText(settings.authorName, 120);
  settings.appTheme = toPlainText(settings.appTheme, 40) || 'bg-obsidian';
  settings.uiScale = UI_SCALES.includes(settings.uiScale) ? settings.uiScale : 'compact';
  settings.density = UI_DENSITIES.includes(settings.density) ? settings.density : 'comfortable';
  settings.dailyWordGoal = Math.min(20000, Math.max(0, Number(settings.dailyWordGoal) || 0));
  // El acento solo admite #rrggbb porque se inyecta en variables CSS.
  settings.accentColor = typeof settings.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(settings.accentColor.trim())
    ? settings.accentColor.trim().toLowerCase()
    : null;
  settings.ambient = UI_AMBIENTS.includes(settings.ambient) ? settings.ambient : 'none';
  // Imágenes de perfil/fondo: solo https o data:image/* (nunca data:image/svg+xml).
  settings.profilePhoto = safeImageUrl(settings.profilePhoto);
  settings.wallpaper = safeImageUrl(settings.wallpaper);
  settings.editorAppearance = {
    font: EDITOR_FONTS.includes(settings.editorAppearance?.font) ? settings.editorAppearance.font : 'font-sans',
    width: toPlainText(settings.editorAppearance?.width || '680px', 20),
    size: EDITOR_SIZES.includes(settings.editorAppearance?.size) ? settings.editorAppearance.size : 'size-standard'
  };
  return settings;
}

/**
 * Un capítulo.
 *
 * Ojo: aquí NO se usa `toPlainText()` (que convierte a texto plano) porque el
 * cuerpo del capítulo es HTML enriquecido legítimo; solo se sanitiza.
 *
 * @param {Record<string, any>} chapter
 * @returns {Record<string, any>}
 */
function normalizeChapter(chapter) {
  return {
    ...chapter,
    title: toPlainText(chapter && chapter.title, 240),
    content: sanitizeHtml(String((chapter && chapter.content) ?? '').slice(0, NORMALIZE_LIMITS.chapterContent)),
    // Meta de palabras del capítulo (personalización por obra).
    wordGoal: Number.isFinite(Number(chapter && chapter.wordGoal)) && Number(chapter.wordGoal) > 0
      ? Math.min(100000, Math.round(Number(chapter.wordGoal)))
      : undefined
  };
}

/**
 * Una fuente adjunta a la obra.
 *
 * El contenido se fuerza a texto plano, sin etiquetas: así no puede convertirse
 * en HTML al renderizarse y el resumen o la previsualización se leen correctos.
 *
 * @param {Record<string, any>} doc
 * @returns {Record<string, any>}
 */
function normalizeAttachedDoc(doc) {
  return {
    ...doc,
    name: toPlainText(doc && doc.name, 240),
    content: toPlainText(doc && doc.content, NORMALIZE_LIMITS.docContent)
  };
}

/**
 * Una obra.
 *
 * Se MUTA el objeto recibido en vez de devolver una copia, y eso es deliberado:
 * el código original recorría `data.stories` modificando cada obra en el sitio,
 * así que `data.stories[i]` y el resultado compartían identidad. Devolver copias
 * rompería a quien conserva una referencia a la obra. Los personajes y el resto
 * de colecciones sí se copian, igual que antes.
 *
 * @param {Record<string, any>} story
 * @returns {Record<string, any>} El mismo objeto, normalizado.
 */
function normalizeStory(story) {
  if (!story || typeof story !== 'object') return story;
  story.title = toPlainText(story.title, 240) || 'Historia sin título';
  story.genre = toPlainText(story.genre, 120);
  story.synopsis = toPlainText(story.synopsis, 4000);
  story.rules = toPlainText(story.rules, NORMALIZE_LIMITS.longText);
  story.outline = toPlainText(story.outline, NORMALIZE_LIMITS.longText);
  story.loreBase = toPlainText(story.loreBase, NORMALIZE_LIMITS.longText);
  story.chronology = toPlainText(story.chronology, 4000);
  story.color = /^#[0-9a-f]{3,8}$/i.test(toPlainText(story.color, 12)) ? story.color : '#c81e3a';
  story.coverImage = safeImageUrl(story.coverImage) || null;
  story.notes = (Array.isArray(story.notes) ? story.notes : [])
    .map((n) => ({ ...n, text: toPlainText(n && n.text, 4000) }));
  story.attachedDocs = (Array.isArray(story.attachedDocs) ? story.attachedDocs : []).map(normalizeAttachedDoc);
  story.chapters = (Array.isArray(story.chapters) ? story.chapters : []).map(normalizeChapter);
  return story;
}

/**
 * Bitácora de actividad diaria.
 *
 * Orden descendente por fecha y recorte por el extremo reciente: con `slice(-400)`
 * se conservaban los registros MÁS ANTIGUOS y se perdía la actividad de hoy.
 *
 * @param {unknown} raw
 * @returns {Array<{ date: string, words: number }>}
 */
function normalizeActivityLog(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((a) => a && typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.date))
    .map((a) => ({ date: a.date.slice(0, 10), words: Math.max(-1000000, Math.min(1000000, Number(a.words) || 0)) }))
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    .slice(0, NORMALIZE_LIMITS.activityLog);
}

/**
 * @param {unknown} raw
 * @returns {Array<Record<string, any>>}
 */
function normalizeNotifications(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, NORMALIZE_LIMITS.notifications)
    .map((n) => ({
      ...n,
      title: toPlainText(n && n.title, 160),
      text: toPlainText(n && n.text, 600),
      at: Number(n && n.at) || Date.now(),
      read: Boolean(n && n.read)
    }));
}

/**
 * Normaliza datos cargados o importados: tipos correctos, HTML ajeno sanitizado
 * y URLs de imagen validadas. Es la última línea de defensa antes de que el
 * renderer inyecte cualquier campo en el DOM.
 *
 * Era una función de 71 líneas que mezclaba seis colecciones distintas. Queda
 * como orquestador: cada paso tiene su propia función con nombre, su propio
 * contrato y se puede probar por separado.
 *
 * @param {unknown} parsed
 * @returns {Record<string, any>}
 */
function normalizeStoredData(parsed) {
  // El cast es necesario y no decorativo: con `parsed` tipado como `unknown`, el
  // estrechamiento `typeof === 'object'` produce el tipo `object`, que en
  // TypeScript no admite acceso a propiedades. Sin la anotación de `@param` esto
  // compilaba porque `parsed` era `any` implícito, es decir, porque no se
  // verificaba nada.
  const data = /** @type {Record<string, any>} */ (parsed && typeof parsed === 'object' ? parsed : {});
  const rawSettings = data.settings || {};

  const settings = normalizeAppearance({ ...defaultData().settings, ...rawSettings });
  settings.ai = { ...defaultData().settings.ai, ...(rawSettings.ai || {}) };

  const stories = (Array.isArray(data.stories) ? data.stories.slice(0, NORMALIZE_LIMITS.stories) : [])
    .map(normalizeStory);

  const characters = (Array.isArray(data.characters) ? data.characters : []).slice(0, NORMALIZE_LIMITS.characters)
    .map((c) => ({
      ...c,
      name: toPlainText(c && c.name, 160),
      role: toPlainText(c && c.role, 160),
      description: toPlainText(c && c.description, 4000),
      knowledge: toPlainText(c && c.knowledge, 8000),
      traits: (Array.isArray(c && c.traits) ? c.traits : []).map((t) => toPlainText(t, 60)).slice(0, 40)
    }));

  const globalDocs = (Array.isArray(data.globalDocs) ? data.globalDocs : []).slice(0, NORMALIZE_LIMITS.globalDocs)
    .map(normalizeAttachedDoc);

  const collabNotes = (Array.isArray(data.collabNotes) ? data.collabNotes : []).slice(0, NORMALIZE_LIMITS.collabNotes)
    .map((n) => ({ ...n, text: toPlainText(n && n.text, 4000) }));

  return {
    ...data,
    settings,
    stories,
    characters,
    globalDocs,
    collabNotes,
    activityLog: normalizeActivityLog(data.activityLog),
    notifications: normalizeNotifications(data.notifications)
  };
}

// ============ ALMACÉN SEGURO (API Key cifrada con safeStorage del SO) ============
// Antes la clave viajaba en texto plano dentro de lorevinci-data.json, un archivo
// que además se exporta/importa y se respalda en .bak1/.bak2/.bak3: cuatro copias
// legibles de un secreto. Ahora vive en un fichero aparte y cifrado con la clave
// del sistema operativo (DPAPI en Windows, Keychain en macOS, libsecret en Linux).
function getSecretPath() {
  return path.join(app.getPath('userData'), 'lorevinci-secret.bin');
}

function encryptionAvailable() {
  try { return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()); }
  catch { return false; }
}

function readSecretKey() {
  try {
    const p = getSecretPath();
    if (!fs.existsSync(p)) return '';
    const raw = fs.readFileSync(p);
    if (encryptionAvailable()) {
      try { return safeStorage.decryptString(raw); } catch { return ''; }
    }
    // Sin cifrado del SO disponible (Linux sin gestor de claves): el archivo es
    // base64 y se marca como degradado para avisar al usuario en Ajustes.
    const payload = JSON.parse(raw.toString('utf8'));
    return payload && payload.plain === true ? String(payload.key || '') : '';
  } catch (err) {
    console.warn('No se pudo leer la clave guardada', err);
    return '';
  }
}

function writeSecretKey(apiKey) {
  const p = getSecretPath();
  try {
    const key = String(apiKey || '');
    if (!key) { if (fs.existsSync(p)) fs.unlinkSync(p); return { stored: false, encrypted: false }; }
    if (encryptionAvailable()) {
      fs.writeFileSync(p, safeStorage.encryptString(key));
      return { stored: true, encrypted: true };
    }
    fs.writeFileSync(p, JSON.stringify({ plain: true, key }), { mode: 0o600 });
    return { stored: true, encrypted: false };
  } catch (err) {
    console.error('No se pudo guardar la clave', err);
    return { stored: false, encrypted: false };
  }
}

/** Quita el secreto del objeto que se persiste/exporta en texto plano. */
function splitSecret(data) {
  const clone = { ...data, settings: { ...(data && data.settings) } };
  clone.settings.ai = { ...(clone.settings.ai || {}) };
  const apiKey = String(clone.settings.ai.apiKey || '');
  delete clone.settings.ai.apiKey;
  return { payload: clone, apiKey };
}

const MAX_STORE_BYTES = 200 * 1024 * 1024;

function loadData() {
  const tryParse = (p) => {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.stories && !Array.isArray(parsed.stories)) throw new Error('stories no es array');
    if (parsed && parsed.stories && parsed.stories.length > 500) throw new Error('demasiadas historias');
    // Normalizar = tipar, recortar y sanitizar todo HTML ajeno antes del renderer.
    return normalizeStoredData({ ...defaultData(), ...parsed });
  };
  try {
    const p = getDataPath();
    if (!fs.existsSync(p)) {
      const initial = defaultData();
      fs.writeFileSync(p, JSON.stringify(initial, null, 2), 'utf-8');
      return withSecret(initial);
    }
    try {
      return withSecret(tryParse(p));
    } catch (e) {
      console.warn('load primary failed, trying bak1', e.message);
      const bak1 = p + '.bak1';
      if (fs.existsSync(bak1)) return withSecret(tryParse(bak1));
      const bak2 = p + '.bak2';
      if (fs.existsSync(bak2)) return withSecret(tryParse(bak2));
      throw e;
    }
  } catch (err) {
    console.error('Error cargando datos, usando datos por defecto', err);
    return withSecret(defaultData());
  }
}

/** Reincorpora la clave desde el almacén cifrado y reporta su estado. */
function withSecret(data) {
  const stored = readSecretKey();
  const out = { ...data, settings: { ...data.settings, ai: { ...data.settings.ai } } };
  if (stored && !out.settings.ai.apiKey) out.settings.ai.apiKey = stored;
  out.settings.ai.keyProtection = encryptionAvailable() ? 'os-encrypted' : (stored ? 'plaintext-fallback' : 'none');
  return out;
}

/**
 * Escritura atómica: primero a un temporal y luego rename. Un cierre de sesión o
 * un disco lleno a mitad de `writeFileSync` ya no puede dejar el JSON truncado
 * (que era exactamente el caso que obligaba a caer en los .bak).
 */
function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

/**
 * Rota `datos.json` → `.bak1` → `.bak2` → `.bak3`.
 *
 * Los tres `catch {}` que había aquí silenciaban por completo un fallo de
 * respaldo: el usuario creía tener tres copias de seguridad y podía no tener
 * ninguna. Un fallo de rotación no debe impedir el guardado (sería peor), pero
 * sí debe quedar registrado con su causa.
 *
 * @param {string} filePath Ruta del JSON de datos.
 * @returns {{ rotated: number, failures: Array<{ step: string, code: string }> }}
 */
function rotateBackups(filePath) {
  if (!fs.existsSync(filePath)) return { rotated: 0, failures: [] };

  const slots = [filePath + '.bak1', filePath + '.bak2', filePath + '.bak3'];
  const [bak1, bak2, bak3] = slots;
  /** @type {Array<{ step: string, code: string }>} */
  const failures = [];

  // Cada paso es una función de un solo propósito; `attempt` convierte la
  // excepción en un `Result` en vez de obligar a un try/catch por línea.
  const steps = [
    { step: 'unlink_bak3', run: () => { if (fs.existsSync(bak3)) fs.unlinkSync(bak3); } },
    { step: 'promote_bak2_to_bak3', run: () => { if (fs.existsSync(bak2)) fs.renameSync(bak2, bak3); } },
    { step: 'promote_bak1_to_bak2', run: () => { if (fs.existsSync(bak1)) fs.renameSync(bak1, bak2); } },
    { step: 'copy_current_to_bak1', run: () => fs.copyFileSync(filePath, bak1) }
  ];

  let rotated = 0;
  for (const { step, run } of steps) {
    const result = LoreKernel.attempt(run, (thrown) => LoreKernel.toAppError(thrown, step));
    if (result.isOk) { rotated += 1; continue; }
    failures.push({ step, code: result.error.code });
    mainLogger.warn('backup_rotation_step_failed', {
      step,
      code: result.error.code,
      reason: result.error.message,
      path: filePath
    });
  }
  if (failures.length) {
    mainLogger.error('backup_rotation_incomplete', { failures, path: filePath });
  }
  return { rotated, failures };
}

function saveData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Datos inválidos: se esperaba el objeto de la aplicación.' };
  }
  const p = getDataPath();
  try {
    // Defensa en profundidad: además de normalizar al cargar, se normaliza al
    // escribir. Así ningún HTML hostil queda persistido en el JSON ni en los
    // respaldos .bak aunque venga de una ruta que no pasó por el renderer.
    const { payload, apiKey } = splitSecret(normalizeStoredData(data));
    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (err) {
      return { ok: false, error: `No se pudo serializar los datos: ${String(err.message || err)}` };
    }
    if (serialized.length > MAX_STORE_BYTES) {
      return { ok: false, error: 'Los datos superan 200 MB. Exporta un respaldo y elimina fuentes antiguas.' };
    }
    // Escritura diferida de la clave: nunca entra al JSON ni a sus respaldos.
    const secretState = writeSecretKey(apiKey);
    rotateBackups(p);
    atomicWriteJson(p, payload);
    return { ok: true, filePath: p, bytes: serialized.length, keyStored: secretState.stored, keyEncrypted: secretState.encrypted };
  } catch (e) {
    console.error('saveData error', e);
    return { ok: false, error: `No se pudo guardar en disco: ${String(e.message || e)}` };
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

  // ---- Endurecimiento de navegación ----
  // La prosa del editor es HTML de terceros (IA, PDFs, respaldos importados) y
  // puede contener <a href>. Sin estos guardas, un clic navegaba la ventana
  // principal fuera de la app (perdiendo el preload) o abría una BrowserWindow
  // nueva sin aislamiento de contexto.
  const contents = mainWindow.webContents;
  if (typeof contents.setWindowOpenHandler === 'function') {
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url);
      return { action: 'deny' };
    });
  }
  if (typeof contents.on === 'function') {
    contents.on('will-navigate', (event, url) => {
      const current = typeof contents.getURL === 'function' ? contents.getURL() : '';
      if (url !== current) {
        event.preventDefault();
        openExternalSafely(url);
      }
    });
    contents.on('render-process-gone', (_e, details) => {
      console.error('Renderer terminado de forma anómala:', details && details.reason);
    });
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Modo humo: solo con la variable de entorno, y solo para `npm run test:launch`.
  if (process.env.LOREVINCI_SMOKE === '1') runDesktopSmokeTest(mainWindow);

  if (isDev && process.env.LoreVinci_DEVTOOLS) {
    mainWindow.webContents.openDevTools();
  }
}

/**
 * Verifica que la ventana arranca de verdad y lo informa por stdout.
 *
 * Las pruebas unitarias simulan Electron: cubren la lógica y el cableado IPC, pero
 * ninguna abre una ventana. Esta función es la mitad que falta, y la ejecuta
 * `scripts/smoke-launch.js` mediante `npm run test:launch`.
 *
 * Sondea el renderer cada 250 ms en vez de fiarse de `did-finish-load`: ese evento
 * salta cuando el HTML termina de cargar, pero `initApp()` sigue en vuelo (pide los
 * datos por IPC, siembra y pinta). Esperar a ese evento daría por bueno un arranque
 * que todavía no terminó, o por fallido uno que iba bien.
 *
 * El criterio de éxito es el que un usuario vería: que el puente `lorevinci` esté
 * expuesto y que la biblioteca haya pintado historias. El de fracaso, que aparezca
 * `#bootErrorBanner`, que es lo que `initApp()` deja cuando su `catch` salta.
 *
 * @param {Electron.BrowserWindow} win
 * @returns {void}
 */
function runDesktopSmokeTest(win) {
  const finish = (code, payload) => {
    process.stdout.write('LOREVINCI_SMOKE ' + JSON.stringify(payload) + '\n');
    app.exit(code);
  };
  const deadline = Date.now() + 45000;
  const guard = setTimeout(() => finish(1, { ok: false, step: 'timeout', detail: 'el renderer no informó en 45 s' }), 46000);
  win.webContents.once('did-fail-load', (unusedEvent, code, description) => {
    clearTimeout(guard);
    finish(1, { ok: false, step: 'did-fail-load', detail: code + ' ' + description });
  });

  const probe = `(function () {
    var bridge = window.lorevinci || {};
    var methods = Object.keys(bridge).filter(function (k) { return typeof bridge[k] === 'function'; });
    var bootError = document.getElementById('bootErrorBanner');
    return {
      cards: document.querySelectorAll('.story-card').length,
      bridgeMethods: methods.length,
      bootError: bootError ? String(bootError.textContent).slice(0, 200) : null
    };
  })()`;

  const poll = setInterval(async () => {
    let snapshot = null;
    try { snapshot = await win.webContents.executeJavaScript(probe); } catch (err) { return; }
    if (!snapshot || typeof snapshot !== 'object') return;
    const stop = (code, step, detail) => {
      clearTimeout(guard); clearInterval(poll);
      finish(code, { ok: code === 0, step, detail, snapshot });
    };
    if (snapshot.bootError) { stop(1, 'boot', snapshot.bootError); return; }
    if (snapshot.cards > 0 && snapshot.bridgeMethods >= 10) { stop(0, 'ready', null); return; }
    if (Date.now() > deadline) stop(1, 'incomplete', 'la ventana cargó pero el renderer no completó el arranque');
  }, 250);
}

/** Abre una URL externa solo si es http/https; devuelve el resultado. */
async function openExternalSafely(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!['https:', 'http:'].includes(parsed.protocol)) return { ok: false, error: 'URL no permitida.' };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch {
    return { ok: false, error: 'URL inválida.' };
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

/** Normaliza la URL base del proveedor (sin barra final, con valor por defecto). */
function normalizeAiRoot(baseUrl) {
  return String(baseUrl || LoreConfig.AI.DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

/**
 * Detecta un backend local. La versión anterior de `ai:verify` no contemplaba el
 * puerto, así que Ollama (localhost:11434) y LM Studio (localhost:1234) eran
 * tratados como remotos y la verificación exigía una API key inexistente.
 */
function isLocalAiRoot(root) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(String(root || ''));
}

/**
 * Cabeceras de proveedor en un solo lugar. Estaban copiadas tres veces
 * (ai:models, ai:verify y ai:generate) y ya eran distintas entre sí.
 *
 * Sin el `@param`, TypeScript infería el tipo del objeto desestructurado a
 * partir del valor por defecto (`= {}`) y solo reconocía `contentType`: las tres
 * llamadas que pasan `baseUrl` y `apiKey` daban error. La firma real es esta.
 *
 * @param {{ baseUrl?: string, apiKey?: string, contentType?: string }} [options]
 * @returns {Record<string, string>}
 */
function buildAiHeaders({ baseUrl, apiKey, contentType = 'application/json' } = {}) {
  const root = normalizeAiRoot(baseUrl);
  const headers = { Accept: 'application/json' };
  if (contentType) headers['Content-Type'] = contentType;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (/openrouter\.ai/i.test(root)) {
    headers['HTTP-Referer'] = LoreConfig.APP.HTTP_REFERER;
    headers['X-Title'] = 'LoreVinci Desktop';
  }
  return headers;
}

ipcMain.handle('ai:models', async (_evt, payload) => {
  const { baseUrl, apiKey } = payload || {};
  const root = normalizeAiRoot(baseUrl);
  if (!apiKey && !isLocalAiRoot(root)) return { ok: false, error: 'Falta la API Key.' };
  try {
    const url = `${root}/models`;
    const headers = buildAiHeaders({ baseUrl, apiKey, contentType: null });
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
  const baseUrl = normalizeAiRoot(payload?.baseUrl || LoreConfig.AI.OMNIROUTE_LOCAL_BASE_URL);
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

/**
 * Traduce un código HTTP del catálogo de modelos a un diagnóstico accionable.
 * Era una cadena de `if/else if` dentro del handler: al sacarla, el mapa de
 * errores queda en un sitio y se puede probar sin montar una petición.
 * @param {number} status
 * @returns {string}
 */
function describeCatalogFailure(status) {
  if (status === 401 || status === 403) return 'Credencial rechazada (401/403). Revisa que la API Key sea válida y esté activa.';
  if (status === 404) return 'Endpoint /models no encontrado (404). Revisa la URL base: suele terminar en /v1.';
  if (status === 429) return 'Límite de cuota alcanzado (429). Espera o revisa tu plan.';
  return `Error ${status}.`;
}

/**
 * Idem para la prueba de generación, cuyos códigos no significan lo mismo: un
 * 404 aquí es un modelo inexistente, no un endpoint mal escrito.
 * @param {number} status
 * @param {string} model
 * @returns {string}
 */
function describeGenerationFailure(status, model) {
  if (status === 402) return 'Sin créditos (402). Recarga saldo en tu proveedor.';
  if (status === 401 || status === 403) return 'La clave lee modelos pero no puede generar (permisos insuficientes).';
  if (status === 404) return `El modelo "${model}" no existe para esta cuenta.`;
  if (status === 429) return 'Límite de peticiones (429). Reintenta en unos segundos.';
  return `La generación falló (${status}).`;
}

/**
 * @typedef {Object} VerifyStep
 * @property {string} id
 * @property {boolean} ok
 * @property {string} label
 * @property {string} detail
 */

/**
 * Paso 1 de la verificación: credencial y catálogo de modelos (GET /models).
 * @param {string} root
 * @param {Record<string, string>} headers
 * @returns {Promise<{ ok: boolean, models: string[], hint: string|null, step: VerifyStep }>}
 */
async function verifyCatalog(root, headers) {
  try {
    const res = await fetchWithTimeout(`${root}/models`, { method: 'GET', headers });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      const hint = describeCatalogFailure(res.status);
      return {
        ok: false, models: [], hint,
        step: { id: 'auth', ok: false, label: 'Autenticación y catálogo', detail: `${hint} ${errText}`.trim() }
      };
    }
    const json = await res.json();
    const list = json.data || json.models || [];
    const models = list.map((m) => m.id || m.name || m).filter(Boolean);
    return {
      ok: true, models, hint: null,
      step: { id: 'auth', ok: true, label: 'Autenticación y catálogo', detail: `${models.length} modelo(s) disponibles` }
    };
  } catch (err) {
    return {
      ok: false, models: [],
      hint: `No se pudo contactar ${root}. Revisa la URL base y tu conexión.`,
      step: { id: 'auth', ok: false, label: 'Autenticación y catálogo', detail: `No hay conexión con ${root}: ${String(err).slice(0, 200)}` }
    };
  }
}

/**
 * Paso 2: el modelo elegido existe en el catálogo. En OmniRoute `auto` es un
 * modelo virtual que puede no aparecer listado, y con catálogo vacío no hay
 * contra qué comparar: ambos casos se aceptan.
 * @param {string} root
 * @param {string[]} models
 * @param {string} [requested]
 * @returns {{ chosen: string, step: VerifyStep }}
 */
function verifyModelSelection(root, models, requested) {
  const chosen = requested || models[0] || 'gpt-4o-mini';
  const exists = (isOmniRouteUrl(root) && /^auto(?:\/|$)/i.test(chosen)) || models.length === 0 || models.includes(chosen);
  return {
    chosen,
    step: {
      id: 'model',
      ok: exists,
      label: 'Modelo seleccionado',
      detail: exists ? `"${chosen}" disponible` : `"${chosen}" no aparece en el catálogo; elige uno de la lista detectada.`
    }
  };
}

/**
 * Paso 3: generación real de extremo a extremo (POST /chat/completions con un
 * ping mínimo). Es lo que distingue "la clave existe" de "la IA funciona".
 * @param {string} root
 * @param {Record<string, string>} headers
 * @param {string} chosen
 * @returns {Promise<{ ok: boolean, hint: string|null, step: VerifyStep }>}
 */
async function verifyGeneration(root, headers, chosen) {
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
      const hint = describeGenerationFailure(res.status, chosen);
      return {
        ok: false, hint,
        step: { id: 'generate', ok: false, label: 'Generación de texto', detail: `${hint} ${errText}`.trim() }
      };
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    return {
      ok: true, hint: null,
      step: { id: 'generate', ok: true, label: 'Generación de texto', detail: `Respuesta recibida: "${String(text).trim().slice(0, 40) || '(vacía)'}"` }
    };
  } catch (err) {
    return {
      ok: false,
      hint: 'No se pudo completar la prueba de generación.',
      step: { id: 'generate', ok: false, label: 'Generación de texto', detail: String(err).slice(0, 200) }
    };
  }
}

/**
 * Verificación completa de la API: comprueba credencial (GET /models) y capacidad
 * real de generación (POST /chat/completions con un ping mínimo). Devuelve un
 * diagnóstico accionable para que el usuario deje la IA operativa desde Ajustes.
 *
 * Antes era un handler de 75 líneas con los tres pasos, sus dos mapas de errores
 * HTTP y sus cuatro `return` tempranos en el mismo cuerpo. Ahora es un
 * orquestador: cada paso es una función con contrato propio y el orden de los
 * `steps` —que la UI renderiza— se lee de un vistazo.
 *
 * @param {any} payload
 * @returns {Promise<Record<string, any>>}
 */
async function runAiVerification(payload) {
  const { baseUrl, apiKey, model } = payload || {};
  const root = normalizeAiRoot(baseUrl);
  const isLocal = isLocalAiRoot(root);

  if (!apiKey && !isLocal) {
    return {
      ok: false,
      steps: [{ id: 'key', ok: false, label: 'API Key presente', detail: 'No hay API Key configurada.' }],
      error: 'Falta la API Key. Pégala en el campo de arriba y vuelve a verificar.'
    };
  }

  /** @type {VerifyStep[]} */
  const steps = [{
    id: 'key',
    ok: true,
    label: 'API Key presente',
    detail: isLocal && !apiKey ? 'Servidor local sin key (correcto)' : 'Clave detectada'
  }];
  const headers = buildAiHeaders({ baseUrl, apiKey });

  const catalog = await verifyCatalog(root, headers);
  steps.push(catalog.step);
  if (!catalog.ok) return { ok: false, steps, error: catalog.hint };

  const selection = verifyModelSelection(root, catalog.models, model);
  steps.push(selection.step);

  const generation = await verifyGeneration(root, headers, selection.chosen);
  steps.push(generation.step);
  if (!generation.ok) return { ok: false, steps, models: catalog.models, error: generation.hint };

  return { ok: true, steps, models: catalog.models, model: selection.chosen };
}

ipcMain.handle('ai:verify', (_evt, payload) => runAiVerification(payload));

ipcMain.handle('data:load', async () => {
  return loadData();
});

ipcMain.handle('data:save', async (_evt, data) => saveData(data));

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

/** Tope de enlaces por búsqueda web. */
const MAX_WEB_RESULTS = 18;

/**
 * @typedef {Object} SearchResultCollector
 * @property {(item: any) => void} push   Añade si no es duplicado.
 * @property {() => number} count         Resultados acumulados.
 * @property {() => boolean} isFull       Ya se alcanzó el tope.
 * @property {() => Array<Record<string, string>>} list Copia acotada al tope.
 */

/**
 * Recolector de resultados con deduplicación por URL.
 *
 * El Set de URLs vistas vivía suelto junto al array dentro del handler; al
 * empaquetarlo con su única operación de escritura, la invariant "no hay dos
 * resultados con la misma URL" deja de depender de que quien añada recuerde
 * consultar el Set. La deduplicación sigue siendo O(1) por enlace: antes era un
 * `results.some(...)` dentro de un bucle, es decir O(n²).
 *
 * @param {number} limit
 * @returns {SearchResultCollector}
 */
function createResultCollector(limit) {
  /** @type {Array<Record<string, string>>} */
  const results = [];
  const seenUrls = new Set();
  return {
    push: (item) => {
      if (!item || !item.url || seenUrls.has(item.url)) return;
      seenUrls.add(item.url);
      results.push({
        title: String(item.title || item.url).slice(0, 240),
        url: String(item.url),
        snippet: String(item.snippet || '').slice(0, 700),
        provider: item.provider || 'web'
      });
    },
    count: () => results.length,
    isFull: () => results.length >= limit,
    list: () => results.slice(0, limit)
  };
}

/**
 * Proveedor Wikipedia (API de búsqueda).
 * @param {string} query
 * @param {SearchResultCollector} collector
 * @param {Record<string, string>} headers
 * @returns {Promise<string|null>} null si fue bien; el mensaje de error si no.
 */
async function searchWikipedia(query, collector, headers) {
  try {
    const res = await fetchWithTimeout(LoreConfig.wikipediaSearchUrl(query, 6), { headers }, 20000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    (json?.query?.search || []).forEach((row) => collector.push({
      title: row.title,
      url: LoreConfig.wikipediaArticleUrl(row.title),
      snippet: stripWebHtml(row.snippet),
      provider: 'Wikipedia'
    }));
    return null;
  } catch (err) {
    return `Wikipedia: ${String(err.message || err)}`;
  }
}

/**
 * Proveedor Open Library (libros: título, autoría, año y materias).
 * @param {string} query
 * @param {SearchResultCollector} collector
 * @param {Record<string, string>} headers
 * @returns {Promise<string|null>}
 */
async function searchOpenLibrary(query, collector, headers) {
  try {
    const res = await fetchWithTimeout(LoreConfig.openLibrarySearchUrl(query, 6), { headers }, 20000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    (json?.docs || []).forEach((row) => collector.push({
      title: row.title,
      url: LoreConfig.openLibraryUrl(row.key),
      snippet: [
        (row.author_name || []).slice(0, 3).join(', '),
        row.first_publish_year,
        (row.subject || []).slice(0, 5).join(' · ')
      ].filter(Boolean).join(' — '),
      provider: 'Open Library'
    }));
    return null;
  } catch (err) {
    return `Open Library: ${String(err.message || err)}`;
  }
}

/**
 * Resuelve UN enlace de la página de resultados de DuckDuckGo.
 *
 * Cada enlace se resuelve de forma aislada: uno roto se descarta y se registra,
 * pero no puede tumbar el resto de resultados. El `catch {}` que había antes los
 * descartaba sin dejar rastro, así que una búsqueda que devolvía 0 resultados no
 * se podía diagnosticar.
 *
 * @param {RegExpExecArray} match   Coincidencia del enlace.
 * @param {string} html             Página completa, para buscar el snippet.
 * @param {number} tailFrom         Índice tras el enlace: dónde empieza el snippet.
 * @returns {any} `Result` con el enlace o con null si debe descartarse.
 */
function parseWebResultLink(match, html, tailFrom) {
  const rawTarget = decodeWebEntities(match[1]);
  return LoreKernel.attempt(() => {
    const parsed = new URL(rawTarget, LoreConfig.SEARCH.DUCKDUCKGO_BASE);
    const resolved = parsed.searchParams.get('uddg') || parsed.toString();
    const targetUrl = new URL(resolved);
    if (!['http:', 'https:'].includes(targetUrl.protocol) || /duckduckgo\.com$/i.test(targetUrl.hostname)) {
      return null; // enlace interno o de esquema no admitido: se descarta
    }
    const tail = html.slice(tailFrom, tailFrom + 1600);
    const snippet = stripWebHtml((tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i) || [null, ''])[1]);
    return { title: stripWebHtml(match[2]), url: targetUrl.toString(), snippet, provider: 'Web' };
  });
}

/**
 * Proveedor web genérico: raspa la página HTML de DuckDuckGo.
 * @param {string} query
 * @param {SearchResultCollector} collector
 * @param {Record<string, string>} headers
 * @returns {Promise<{ error: string|null, skipped: number }>}
 */
async function searchWeb(query, collector, headers) {
  let skipped = 0;
  try {
    const res = await fetchWithTimeout(LoreConfig.duckDuckGoSearchUrl(query), { headers: { ...headers, Accept: 'text/html' } }, 20000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const linkRx = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRx.exec(html)) && !collector.isFull()) {
      const parsedLink = parseWebResultLink(match, html, linkRx.lastIndex);
      if (parsedLink.isErr) {
        skipped += 1;
        mainLogger.debug('web_result_link_skipped', {
          reason: parsedLink.error.message,
          target_head: decodeWebEntities(match[1]).slice(0, 120)
        });
        continue;
      }
      if (parsedLink.value) collector.push(parsedLink.value);
    }
    return { error: null, skipped };
  } catch (err) {
    return { error: `Web: ${String(err.message || err)}`, skipped };
  }
}

/**
 * Búsqueda de investigación en varios proveedores.
 *
 * Era un handler de 78 líneas con tres bloques try/catch casi idénticos, el
 * recolector y el raspado HTML todo en el mismo cuerpo. Ahora cada proveedor es
 * una función que devuelve su propio error (o null) y el orquestador solo decide
 * cuáles ejecutar y cómo agregar.
 *
 * @param {any} payload
 * @returns {Promise<Record<string, any>>}
 */
async function runWebSearch(payload) {
  const query = String(payload && payload.query || '').trim().slice(0, 240);
  const provider = String(payload && payload.provider || 'all');
  if (query.length < 2) return { ok: false, error: 'Escribe al menos 2 caracteres para buscar.' };

  const collector = createResultCollector(MAX_WEB_RESULTS);
  const headers = { 'User-Agent': LoreConfig.APP.USER_AGENT_RESEARCH, Accept: 'application/json,text/html;q=0.9' };
  /** @type {string[]} */
  const errors = [];
  let skippedLinks = 0;

  const wanted = (name) => provider === 'all' || provider === name;

  if (wanted('wikipedia')) {
    const failure = await searchWikipedia(query, collector, headers);
    if (failure) errors.push(failure);
  }
  if (wanted('books')) {
    const failure = await searchOpenLibrary(query, collector, headers);
    if (failure) errors.push(failure);
  }
  if (wanted('web')) {
    const web = await searchWeb(query, collector, headers);
    if (web.error) errors.push(web.error);
    skippedLinks = web.skipped;
  }

  if (skippedLinks) {
    mainLogger.warn('web_results_links_skipped', { skipped: skippedLinks, kept: collector.count() });
  }

  return collector.count()
    ? { ok: true, results: collector.list(), warnings: errors }
    : { ok: false, results: [], error: errors.join(' · ') || 'No se encontraron resultados.' };
}

ipcMain.handle('web:search', (_evt, payload) => runWebSearch(payload));

ipcMain.handle('web:fetch', async (_evt, payload) => {
  try {
    const page = await fetchPublicWebPage(payload && payload.url);
    return { ok:true, page };
  } catch (err) {
    return { ok:false, error:String(err.message || err).slice(0,400) };
  }
});

ipcMain.handle('shell:openExternal', async (_evt, url) => openExternalSafely(url));

// ============ SECRETO: lectura/escritura explícita de la API Key ============
ipcMain.handle('secrets:get', async () => ({ ok: true, apiKey: readSecretKey(), encrypted: encryptionAvailable() }));
ipcMain.handle('secrets:set', async (_evt, apiKey) => {
  const state = writeSecretKey(apiKey);
  return { ok: state.stored || !String(apiKey || ''), encrypted: state.encrypted, available: encryptionAvailable() };
});
ipcMain.handle('secrets:status', async () => ({ ok: true, encrypted: encryptionAvailable() }));
ipcMain.handle('clipboard:write', async (_evt, text) => {
  const written = LoreKernel.attempt(() => clipboard.writeText(String(text || '').slice(0, CLIPBOARD_MAX_CHARS)));
  if (written.isErr) {
    mainLogger.warn('clipboard_write_failed', { code: written.error.code, reason: written.error.message });
    return { ok: false, error: written.error.message };
  }
  return { ok: true };
});

if (typeof ipcMain.on === 'function') {
  ipcMain.on('ai:cancel', (_evt, requestId) => {
    const controller = aiAbortControllers.get(String(requestId || ''));
    if (controller) controller.abort(new Error('Generación cancelada por el usuario'));
  });
}

/** Espera máxima de una generación antes de abortarla. */
const AI_GENERATION_TIMEOUT_MS = 90000;
/** Modos de compresión que OmniRoute acepta por cabecera. */
const OMNIROUTE_COMPRESSIONS = ['off', 'default', 'engine:rtk'];

/**
 * Validación ESTRUCTURAL del prompt.
 *
 * Sin ella, un `messages` malformado viajaba hasta el proveedor y el fallo
 * volvía disfrazado de error de red: el usuario leía "no se pudo conectar"
 * cuando el problema era el payload. Rechazar antes es más barato (no quema una
 * llamada) y el mensaje dice qué pasó de verdad.
 *
 * Se mide con `attempt` para que ni un Proxy ni un getter hostil puedan lanzar
 * fuera del handler.
 *
 * @param {unknown} messages
 * @param {{ model?: unknown, task?: unknown }} context Solo para el log.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validatePromptShape(messages, context) {
  const shape = LoreKernel.attempt(() => {
    if (!Array.isArray(messages) || messages.length === 0) return { valid: false, reason: 'vacio' };
    const idx = messages.findIndex((m) => !m || typeof m !== 'object'
      || (typeof m.content !== 'string' && !Array.isArray(m.content)));
    return idx === -1 ? { valid: true } : { valid: false, reason: 'malformado', index: idx };
  });

  if (shape.isErr) {
    mainLogger.error('prompt_shape_unreadable', {
      code: shape.error.code,
      reason: shape.error.message,
      model: String(context.model || ''),
      task: String(context.task || '')
    });
    return { ok: false, error: 'El prompt no se pudo inspeccionar (estructura ilegible). Vuelve a intentarlo.' };
  }

  const detail = shape.unwrap();
  if (detail.valid) return { ok: true };

  mainLogger.warn('prompt_messages_invalid', {
    reason: detail.reason,
    index: typeof detail.index === 'number' ? detail.index : null,
    task: String(context.task || '')
  });
  return {
    ok: false,
    error: detail.reason === 'vacio'
      ? 'El prompt está vacío. Escribe algo o adjunta una fuente antes de generar.'
      : `El mensaje nº ${detail.index + 1} del prompt no tiene texto. Revisa las fuentes adjuntas.`
  };
}

/**
 * Límite de tamaño del prompt: control de coste y de inyección.
 *
 * El `catch {}` que había aquí dejaba el control FALLANDO ABIERTO: si
 * `JSON.stringify` lanzaba (referencias circulares en `messages`, un BigInt, un
 * getter que revienta) la comprobación se omitía por completo y el prompt sin
 * medir salía hacia la API. Un límite que no se aplica cuando más falta hace es
 * peor que no tenerlo: da falsa seguridad. Falla CERRADO y registra la causa.
 *
 * @param {unknown} messages
 * @param {{ model?: unknown, task?: unknown }} context
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validatePromptSize(messages, context) {
  const measured = LoreKernel.attempt(() => JSON.stringify(messages).length);

  if (measured.isErr) {
    mainLogger.error('prompt_size_unmeasurable', {
      code: measured.error.code,
      reason: measured.error.message,
      model: String(context.model || ''),
      task: String(context.task || '')
    });
    return { ok: false, error: 'No se pudo medir el tamaño del prompt (mensaje no serializable). Revisa las fuentes adjuntas e inténtalo de nuevo.' };
  }

  const chars = measured.unwrap();
  if (chars > MAX_PROMPT_CHARS) {
    mainLogger.warn('prompt_too_long', { chars, limit: MAX_PROMPT_CHARS, task: String(context.task || '') });
    return { ok: false, error: `Prompt demasiado largo (límite ${MAX_PROMPT_CHARS / 1000}k chars). Reduce fuentes o reglas.` };
  }
  return { ok: true };
}

/**
 * Cabeceras de la generación. Las de OmniRoute solo se añaden contra un
 * enrutador local: enviarlas a un proveedor público filtraría metadatos de
 * sesión y de tarea que allí no significan nada.
 *
 * @param {string} root
 * @param {{ baseUrl?: string, apiKey?: string, requestId?: string, sessionId?: unknown, compression?: unknown, task?: unknown }} options
 * @returns {Record<string, string>}
 */
function buildGenerationHeaders(root, options) {
  const headers = buildAiHeaders({ baseUrl: options.baseUrl, apiKey: options.apiKey });
  if (!isOmniRouteUrl(root)) return headers;

  headers['X-Request-Id'] = options.requestId || `lorevinci-${Date.now()}`;
  if (options.sessionId) headers['X-OmniRoute-Session-Id'] = String(options.sessionId).slice(0, 128);
  if (options.compression && OMNIROUTE_COMPRESSIONS.includes(String(options.compression))) {
    headers['X-OmniRoute-Compression'] = String(options.compression);
  }
  if (options.task) headers['X-LoreVinci-Task'] = String(options.task).slice(0, 40);
  return headers;
}

/**
 * Cuerpo de la petición, con los topes de tokens y de temperatura aplicados en
 * un solo sitio.
 * @param {{ model?: unknown, messages?: unknown, maxTokens?: unknown, temperature?: unknown }} options
 * @returns {string}
 */
function buildGenerationBody(options) {
  return JSON.stringify({
    model: options.model || 'gpt-4o-mini',
    messages: options.messages,
    max_tokens: Math.min(32000, Number(options.maxTokens) || 500),
    temperature: typeof options.temperature === 'number' ? Math.max(0, Math.min(1.2, options.temperature)) : 0.65
  });
}

/**
 * Traza de enrutado de OmniRoute, leída de las cabeceras de respuesta.
 * @param {string} root
 * @param {{ headers: { get(name: string): string|null } }} res
 * @param {any} json
 * @returns {Record<string, any>|null} null si el proveedor no es OmniRoute.
 */
function extractRouteTrace(root, res, json) {
  if (!isOmniRouteUrl(root)) return null;
  const h = (name) => res.headers.get(name);
  return {
    decision: h('x-omniroute-decision'),
    provider: h('x-omniroute-provider'),
    model: h('x-omniroute-model') || json?.model || null,
    latencyMs: Number(h('x-omniroute-latency-ms')) || null,
    responseCost: h('x-omniroute-response-cost'),
    cacheHit: h('x-omniroute-cache-hit') || h('x-omniroute-cache'),
    fallbackAttempts: Number(h('x-omniroute-fallback-attempts')) || 0,
    compression: h('x-omniroute-compression'),
    version: h('x-omniroute-version'),
    requestId: h('x-omniroute-request-id')
  };
}

/**
 * Convierte la respuesta del proveedor en el sobre que consume el renderer.
 *
 * `finish_reason` es la única forma fiable de saber si el modelo se quedó sin
 * presupuesto a mitad de frase. Sin esto se guardarían capítulos cortados
 * haciéndolos pasar por completos.
 *
 * @param {string} root
 * @param {{ headers: { get(name: string): string|null } }} res
 * @param {any} json
 * @returns {Record<string, any>}
 */
function toGenerationResult(root, res, json) {
  const choice = json?.choices?.[0];
  const usage = json?.usage || null;
  const finishReason = choice?.finish_reason || choice?.native_finish_reason || null;
  return {
    ok: true,
    text: choice?.message?.content || '',
    route: extractRouteTrace(root, res, json),
    finishReason,
    truncated: finishReason === 'length',
    usage: usage ? {
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null
    } : null
  };
}

/**
 * Generación de texto contra el proveedor configurado.
 *
 * Era un handler de 116 líneas que mezclaba dos validaciones de seguridad con
 * sus cuatro ramas de log, el ciclo de vida del AbortController, la construcción
 * de cabeceras y cuerpo, y el parseo de la respuesta. Ahora cada preocupación es
 * una función con contrato propio y el orquestador muestra el flujo completo:
 * validar → armar → enviar → traducir → limpiar.
 *
 * @param {any} payload
 * @returns {Promise<Record<string, any>>}
 */
async function runAiGeneration(payload) {
  const { baseUrl, apiKey, model, messages, maxTokens, temperature, requestId, task, compression, sessionId } = payload || {};
  const root = normalizeAiRoot(baseUrl);

  if (!apiKey && !isLocalAiRoot(root)) {
    return { ok: false, error: 'Falta configurar tu API Key en Ajustes > Muse AI.' };
  }

  const context = { model, task };
  const shape = validatePromptShape(messages, context);
  if (!shape.ok) return shape;
  const size = validatePromptSize(messages, context);
  if (!size.ok) return size;

  const controller = new AbortController();
  const key = String(requestId || '');
  const timeout = setTimeout(
    () => controller.abort(new Error(`La IA superó ${AI_GENERATION_TIMEOUT_MS / 1000} segundos de espera`)),
    AI_GENERATION_TIMEOUT_MS
  );
  if (key) aiAbortControllers.set(key, controller);

  try {
    const res = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: buildGenerationHeaders(root, { baseUrl, apiKey, requestId: key, sessionId, compression, task }),
      body: buildGenerationBody({ model, messages, maxTokens, temperature }),
      signal: controller.signal
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Error API (${res.status}): ${errText.slice(0, 400)}` };
    }
    return toGenerationResult(root, res, await res.json());
  } catch (err) {
    const cancelled = controller.signal.aborted;
    return {
      ok: false,
      error: cancelled
        ? `Generación cancelada o expirada: ${String(controller.signal.reason || err)}`
        : `No se pudo conectar con el proveedor de IA: ${String(err)}`
    };
  } finally {
    clearTimeout(timeout);
    if (key) aiAbortControllers.delete(key);
  }
}

ipcMain.handle('ai:generate', (_evt, payload) => runAiGeneration(payload));
