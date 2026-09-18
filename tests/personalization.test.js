// Regresión de confort y personalización: color de acento propio, ambientes de
// fondo, tema/escala/densidad/apariencia del editor y meta de palabras por
// capítulo. Verifica que cada preferencia se aplica al instante, persiste, se
// normaliza al importar y no pisa el resto del estado del <body>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { makeApp, makeSeed, reporter, ROOT } = require('./harness');

const R = reporter('personalization');
const ok = R.ok;

const seed = makeSeed();
seed.stories[0].chapters = [
  { id: 'c1', title: 'Capítulo uno', content: '<p>Cien palabras de apertura para medir la meta del capítulo con calma.</p>', status: 'draft' },
  { id: 'c2', title: 'Capítulo dos', content: '', status: 'draft', wordGoal: 40 },
];
seed.settings.accentColor = null;
seed.settings.ambient = 'none';

// ============ Proceso principal con electron simulado ============
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-pers-'));
const handlers = {};
const ipcMain = { handle: (c, f) => { handlers[c] = f; }, on: () => {} };
const appStub = { isPackaged: false, getPath: () => userData, whenReady: () => ({ then: () => ({}) }), on: () => {} };
const BW = function () { return { setMenuBarVisibility() {}, loadFile() {}, webContents: { openDevTools() {} } }; };
BW.getAllWindows = () => [];
const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: appStub, BrowserWindow: BW, ipcMain, dialog: {}, shell: { openExternal: async () => true },
      clipboard: { writeText: () => {} },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(`enc:${v}`), decryptString: (b) => String(b).slice(4) },
    };
  }
  return realLoad.apply(this, arguments);
};
require(path.join(ROOT, 'main.js'));
Module._load = realLoad;

const dataFile = path.join(userData, 'lorevinci-data.json');
let mainSettings = {};
let mainChapter = {};
async function saveThroughMain(payload) {
  await handlers['data:save'](null, payload);
  const written = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  mainSettings = written.settings || {};
  mainChapter = ((written.stories || [])[0] || {}).chapters?.[0] || {};
  return written;
}

const { w, errors, click } = makeApp({ seed });
let lastSavedPayload = null;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const d = w.document;
const byId = (id) => d.getElementById(id);
const rootVar = (name) => d.documentElement.style.getPropertyValue(name);
const bodyHas = (cls) => d.body.classList.contains(cls);

w.lorevinci.saveData = async (payload) => { lastSavedPayload = JSON.parse(JSON.stringify(payload)); return { ok: true }; };

setTimeout(() => {
  const probe = w.__probe;
  probe('showView("stories")');
  probe('openStoryEditor(DATA.stories[0].id)');

  // ---------- 1. Color de acento propio ----------
  probe(`DATA.settings.accentColor = '#ff8800'; applyAccentColor({ save: true })`);
  ok('el acento válido se aplica a la variable CSS', rootVar('--accent') === '#ff8800', rootVar('--accent'));
  ok('se deriva un acento secundario más oscuro', /^#[0-9a-f]{6}$/i.test(rootVar('--accent-2')) && rootVar('--accent-2') !== '#ff8800', rootVar('--accent-2'));
  ok('el body marca que hay acento personalizado', bodyHas('custom-accent'));
  ok('el selector de color refleja el valor guardado', byId('settingsAccentColor').value === '#ff8800');
  ok('el acento queda persistido en ajustes', probe('DATA.settings.accentColor') === '#ff8800');

  // Texto sobre el acento: con un color oscuro debe ser claro, y viceversa.
  const contrastLightAccent = probe(`accentContrastText('#ff8800')`);
  const contrastDarkAccent = probe(`accentContrastText('#101820')`);
  ok('sobre acento luminoso el texto es oscuro', contrastLightAccent === '#12100f', contrastLightAccent);
  ok('sobre acento oscuro el texto es blanco', contrastDarkAccent === '#ffffff', contrastDarkAccent);
  probe(`DATA.settings.accentColor = '#101820'; applyAccentColor()`);
  ok('la variable de contraste acompaña al acento elegido', rootVar('--accent-contrast') === '#ffffff', rootVar('--accent-contrast'));

  // Valores inválidos: nunca llegan a CSS (se inyectan en variables del documento).
  probe(`DATA.settings.accentColor = 'red; --bg:url(javascript:alert(1))'; applyAccentColor()`);
  ok('un acento inválido no se inyecta en CSS', rootVar('--accent') === '' && !bodyHas('custom-accent'));
  ok('el valor inválido se limpia de los ajustes', probe('DATA.settings.accentColor') === null);
  probe(`DATA.settings.accentColor = '#FFF'; applyAccentColor()`);
  ok('el formato corto (#FFF) se rechaza por no ser #rrggbb', rootVar('--accent') === '');

  // Reset al color del tema.
  probe(`DATA.settings.accentColor = '#3dd68c'; applyAccentColor()`);
  click('accentColorResetBtn');
  ok('el botón de reset devuelve el acento del tema', probe('DATA.settings.accentColor') === null && rootVar('--accent') === '' && !bodyHas('custom-accent'));
  ok('el reset avisa por toast', /Acento restaurado/.test(byId('lorevinciToast').textContent));

  // La interacción real con el <input type="color">.
  const accentInput = byId('settingsAccentColor');
  accentInput.value = '#4c8dff';
  accentInput.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('mover el selector aplica el acento al instante', rootVar('--accent') === '#4c8dff');
  accentInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('el cambio confirmado se anuncia', /Color de acento aplicado/.test(byId('lorevinciToast').textContent));

  // ---------- 2. Ambientes de fondo ----------
  const ambientSelect = byId('settingsAmbientSelect');
  const setAmbient = (value) => {
    ambientSelect.value = value;
    ambientSelect.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  setAmbient('sepia');
  ok('el ambiente sepia añade su clase', bodyHas('ambient-sepia') && probe('DATA.settings.ambient') === 'sepia');
  ok('el ambiente avisa qué se activó', /Ambiente sepia activado/.test(byId('lorevinciToast').textContent));
  ok('no se acumulan ambientes anteriores', !bodyHas('ambient-paper') && !bodyHas('ambient-night'));

  setAmbient('night');
  ok('cambiar de ambiente reemplaza al anterior', bodyHas('ambient-night') && !bodyHas('ambient-sepia'));
  ok('la densidad elegida sobrevive al cambio de ambiente', bodyHas('density-comfortable'));
  ok('el tema elegido sobrevive al ambiente', probe('DATA.settings.appTheme') === 'bg-obsidian');

  setAmbient('none');
  ok('el ambiente "none" quita todas las clases de ambiente', !AMBIENT_CLS.some((c) => bodyHas(c)));

  probe(`DATA.settings.ambient = 'javascript:alert(1)'; applyAmbient()`);
  ok('un ambiente inválido se normaliza a "none"', probe('DATA.settings.ambient') === 'none' && !AMBIENT_CLS.some((c) => bodyHas(c)));

  // applyProfileAndTheme no debe pisar estados ajenos (zen, modal abierto…).
  d.body.classList.add('zen-mode');
  probe('applyProfileAndTheme()');
  ok('reaplicar el perfil conserva el modo zen', bodyHas('zen-mode'));
  d.body.classList.remove('zen-mode');

  // ---------- 3. Meta de palabras por capítulo ----------
  probe('currentChapterId = "c1"; renderChapterContent()');
  ok('la meta del capítulo aparece en la barra del editor', byId('chapterGoalWrap').hidden === false);
  const goalInput = byId('chapterGoalInput');
  goalInput.value = '25';
  goalInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('la meta se guarda en el capítulo', probe('DATA.stories[0].chapters[0].wordGoal') === 25);
  ok('la meta se anuncia por toast', /Meta del capítulo: 25 palabras/.test(byId('lorevinciToast').textContent));
  ok('el progreso se muestra junto al contador', /palabras/.test(byId('chapterGoalProgress').textContent) === false && /\d+\/25 \(\d+%\)/.test(byId('chapterGoalProgress').textContent), byId('chapterGoalProgress').textContent);

  const pctBefore = byId('chapterGoalProgress').textContent;
  probe(`(function(){ const c = getChapter(getStory(currentStoryId), currentChapterId); c.content = '<p>Texto breve.</p>'; updateChapterGoalProgress(); })()`);
  ok('el progreso reacciona al contenido del capítulo', byId('chapterGoalProgress').textContent !== pctBefore, `${pctBefore} → ${byId('chapterGoalProgress').textContent}`);

  // Meta cumplida: una sola celebración, visible en la barra.
  probe('DATA.notifications = []');
  probe(`(function(){ const c = getChapter(getStory(currentStoryId), currentChapterId); c.content = '<p>' + ('palabra '.repeat(60)) + '</p>'; updateChapterGoalProgress(); })()`);
  ok('al cumplir la meta la barra se marca como lograda', byId('chapterGoalWrap').classList.contains('goal-reached'));
  ok('cumplir la meta notifica una vez', probe('DATA.notifications.length') === 1 && /Meta del capítulo cumplida/.test(probe('DATA.notifications[0].title')))
  probe('updateChapterGoalProgress()');
  ok('no se repite la notificación al seguir escribiendo', probe('DATA.notifications.length') === 1);

  // Cambiar de capítulo trae su propia meta (c2 ya viene con 40).
  probe('currentChapterId = "c2"; renderChapterContent()');
  ok('cada capítulo tiene su propia meta', byId('chapterGoalInput').value === '40');
  ok('la meta del otro capítulo no se contagia', probe('DATA.stories[0].chapters[1].wordGoal') === 40 && probe('DATA.stories[0].chapters[0].wordGoal') === 25);

  // Meta 0 desactiva la función.
  goalInput.value = '0';
  goalInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('meta 0 desactiva el objetivo del capítulo', probe('DATA.stories[0].chapters[1].wordGoal') === undefined);
  ok('el progreso se limpia al desactivar', byId('chapterGoalProgress').textContent === '');
  ok('desactivar se anuncia', /Meta del capítulo desactivada/.test(byId('lorevinciToast').textContent));

  goalInput.value = '999999';
  goalInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('la meta se limita a 100.000 palabras', probe('DATA.stories[0].chapters[1].wordGoal') === 100000);

  // ---------- 4. Persistencia y normalización ----------
  probe(`DATA.settings.accentColor = '#4c8dff'; DATA.settings.ambient = 'forest'; DATA.stories[0].chapters[0].wordGoal = 25;`);
  return Promise.resolve(probe('persistNow()')).then(() => tick(50)).then(() => {
    ok('los ajustes de identidad viajan en el guardado', probe('DATA.settings.accentColor') === '#4c8dff' && probe('DATA.settings.ambient') === 'forest');
    const payload = lastSavedPayload;
    ok('el guardado envía el acento y el ambiente al proceso principal', payload && payload.settings.accentColor === '#4c8dff' && payload.settings.ambient === 'forest');

    // Capa del renderer: importar un respaldo con valores hostiles.
    w.__hostile = {
      settings: { accentColor: 'red;background:url(javascript:1)', ambient: '<script>x</' + 'script>', wallpaper: 'data:text/html,<script>alert(1)</' + 'script>', authorName: 'Ana', writingGoals: { dailyWords: 'muchas', sessionMinutes: -5 } },
      stories: [{ id: 's9', title: 'Importada', chapters: [{ id: 'k1', title: 'C', content: '<p>hola</p>', wordGoal: 'abc' }], notes: [], attachedDocs: [] }],
      characters: [], globalDocs: [], collabNotes: [], activityLog: [], notifications: [],
    };
    const clean = probe('sanitizeImportedData(window.__hostile)');
    ok('importar limpia un acento inválido', clean.settings.accentColor === null, String(clean.settings.accentColor));
    ok('importar normaliza un ambiente inválido', clean.settings.ambient === 'none', String(clean.settings.ambient));
    ok('importar descarta un fondo hostil', !clean.settings.wallpaper || !/javascript|text\/html/i.test(clean.settings.wallpaper), String(clean.settings.wallpaper));
    ok('importar descarta una meta de capítulo inválida', clean.stories[0].chapters[0].wordGoal === undefined);
    ok('importar conserva el nombre de autor/a', clean.settings.authorName === 'Ana');
    ok('importar sanea metas diarias imposibles', clean.settings.writingGoals.dailyWords === 0 && clean.settings.writingGoals.sessionMinutes === 0);

    // Capa del proceso principal: main.js normaliza antes de escribir a disco.
    return saveThroughMain({
      settings: { authorName: 'Autora', accentColor: '#FF8800', ambient: 'paper', ai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } },
      stories: [{ id: 's1', title: 'Saga', chapters: [{ id: 'c1', title: 'Cap', content: '<p>ok</p>', wordGoal: 500 }] }],
      characters: [], activityLog: [],
    });
  }).then(() => {
    ok('main.js conserva un acento válido (en minúsculas)', mainSettings.accentColor === '#ff8800', String(mainSettings.accentColor));
    ok('main.js conserva un ambiente de la lista blanca', mainSettings.ambient === 'paper', String(mainSettings.ambient));
    ok('main.js conserva la meta de palabras del capítulo', mainChapter.wordGoal === 500, String(mainChapter.wordGoal));

    return saveThroughMain({
      settings: { authorName: 'Autora', accentColor: 'url(javascript:alert(1))', ambient: 'root', ai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } },
      stories: [{ id: 's1', title: 'Saga', chapters: [{ id: 'c1', title: 'Cap', content: '<p>ok</p>', wordGoal: 1e9 }] }],
      characters: [], activityLog: [],
    });
  }).then(() => {
    ok('main.js neutraliza un acento hostil', mainSettings.accentColor === null, String(mainSettings.accentColor));
    ok('main.js neutraliza un ambiente desconocido', mainSettings.ambient === 'none', String(mainSettings.ambient));
    ok('main.js limita una meta desmesurada', mainChapter.wordGoal === 100000, String(mainChapter.wordGoal));

    const runtime = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
    ok('sin errores de ejecución en personalización', runtime.length === 0, runtime.slice(0, 3).join(' | '));
    R.done();
  });
}, 2600);

const AMBIENT_CLS = ['ambient-paper', 'ambient-sepia', 'ambient-night', 'ambient-forest'];
