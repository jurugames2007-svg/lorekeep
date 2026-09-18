// Regresión de seguridad de salida: sanitizado por lista blanca, escape en
// atributos, URLs de imagen, importaciones hostiles y secreto fuera del JSON.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { makeApp, makeSeed, reporter, ROOT, P } = require('./harness');

const R = reporter('security');
const ok = R.ok;

// ============ 1. Módulo de sanitizado (sin DOM de la app) ============
const Safe = require(path.join(P, 'dom-safe.js'));

const dirty = '<p onclick="alert(1)">hola</p><script>alert(2)</' + 'script>'
  + '<img src="x" onerror="alert(3)"><iframe src="https://evil.test"></iframe>'
  + '<svg onload="alert(4)"><script>alert(5)</' + 'script></svg>'
  + '<a href="javascript:alert(6)">enlace</a>'
  + '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data</a>'
  + '<form action="https://evil.test"><input name="x"></form>'
  + '<div style="background:url(javascript:alert(7))">estilo</div>'
  + '<p>Texto <b>legítimo</b> que debe sobrevivir.</p>';

const clean = Safe.sanitizeHtml(dirty);
ok('elimina <script>', !/<script/i.test(clean));
ok('elimina manejadores onclick/onerror/onload', !/on(click|error|load)\s*=/i.test(clean));
ok('elimina <iframe>', !/<iframe/i.test(clean));
ok('elimina <svg> (vector de script embebido)', !/<svg/i.test(clean));
ok('elimina <form>/<input> inyectados', !/<form/i.test(clean) && !/<input/i.test(clean));
ok('elimina atributos style (inyección CSS)', !/style\s*=/i.test(clean));
ok('bloquea href javascript:', !/javascript:/i.test(clean));
ok('bloquea href data:text/html', !/data:text\/html/i.test(clean));
ok('conserva la prosa legítima', clean.includes('legítimo') && clean.includes('sobrevivir'));
ok('conserva <b> permitido', /<b>legítimo<\/b>/.test(clean));

const unwrapped = Safe.sanitizeHtml('<custom-tag>Capítulo perdido</custom-tag>');
ok('etiqueta desconocida conserva su texto', unwrapped.includes('Capítulo perdido') && !/<custom-tag/i.test(unwrapped));

const link = Safe.sanitizeHtml('<a href="https://ejemplo.test/nota" target="_blank">nota</a>');
ok('enlace https permitido', link.includes('href="https://ejemplo.test/nota"'));
ok('enlace endurecido con rel noopener', /rel="noopener noreferrer nofollow"/.test(link));

ok('SVG como data: rechazado', Safe.safeImageUrl('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+') === '');
ok('PNG como data: aceptado', /^data:image\/png;base64,/.test(Safe.safeImageUrl('data:image/png;base64,iVBORw0KGgo=')));
ok('portada https aceptada', Safe.safeImageUrl('https://cdn.ejemplo.test/portada.jpg').startsWith('https://'));
ok('javascript: en src rechazado', Safe.safeImageUrl('javascript:alert(1)') === '');

// Un data URL con comillas y paréntesis no pasa el filtro: cae a `none` en vez de
// romper el url() e inyectar declaraciones CSS.
const hostileCss = Safe.safeCssImageUrl('data:image/png;base64,AAA"); --x: url("evil');
ok('fondo hostil neutralizado a none', hostileCss === 'none');
const goodCss = Safe.safeCssImageUrl('data:image/png;base64,iVBORw0KGgo=');
ok('fondo válido sí genera url()', goodCss === 'url("data:image/png;base64,iVBORw0KGgo=")');
ok('fondo inválido cae a none', Safe.safeCssImageUrl('data:text/html,<script>1</' + 'script>') === 'none');

ok('escapeHtml cubre comilla doble', Safe.escapeHtml('a" onload="alert(1)') === 'a&quot; onload=&quot;alert(1)');
ok('escapeHtml cubre comilla simple', Safe.escapeHtml("a'").includes('&#39;'));
ok('escapeHtml cubre <> y &', Safe.escapeHtml('<a href="?x=1&y=2">') === '&lt;a href=&quot;?x=1&amp;y=2&quot;&gt;');

ok('htmlToText conserva acentos y rayas de diálogo', Safe.htmlToText('<p>—¿Vienes? —<i>ahora no</i> —dijo Mara.</p>').includes('—¿Vienes?'));
ok('htmlToText no deja etiquetas', !/<[^>]+>/.test(Safe.htmlToText('<p>uno<br>dos</p><script>x</' + 'script>')));
ok('wordCount es estable y memoizado', Safe.wordCount('<p>uno dos tres</p>') === 3 && Safe.wordCount('<p>uno dos tres</p>') === 3);

// ============ 2. Proceso principal: secreto cifrado y datos normalizados ============
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-sec-'));
const handlers = {};
const ipcMain = { handle: (c, f) => { handlers[c] = f; }, on: () => {} };
const app = { isPackaged: false, getPath: () => userData, whenReady: () => ({ then: () => ({}) }), on: () => {} };
const BW = function () { return { setMenuBarVisibility() {}, loadFile() {}, webContents: { openDevTools() {} } }; };
BW.getAllWindows = () => [];
const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app, BrowserWindow: BW, ipcMain, dialog: {}, shell: { openExternal: async () => true },
      clipboard: { writeText: () => {} },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(`enc:${v}`), decryptString: (b) => String(b).slice(4) }
    };
  }
  return realLoad.apply(this, arguments);
};
require(path.join(ROOT, 'main.js'));
Module._load = realLoad;

const dataFile = path.join(userData, 'lorevinci-data.json');
const secretFile = path.join(userData, 'lorevinci-secret.bin');

(async () => {
  const saveRes = await handlers['data:save'](null, {
    settings: { authorName: 'Autora', ai: { apiKey: 'sk-secreta-123', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } },
    stories: [{ id: 's1', title: 'Saga & "citada"', chapters: [{ id: 'c1', title: 'Cap', content: '<p>ok</p><script>alert(1)</' + 'script>' }] }],
    characters: [], activityLog: []
  });
  ok('data:save responde con resultado estructurado', saveRes && saveRes.ok === true && typeof saveRes.bytes === 'number');

  const written = fs.readFileSync(dataFile, 'utf8');
  ok('la API Key NO queda en el JSON de datos', !written.includes('sk-secreta-123') && !/"apiKey"/.test(written));
  ok('el JSON guarda el capítulo sanitizado', !/<script/i.test(written) && written.includes('<p>ok</p>'));
  ok('el secreto viaja a su propio archivo', fs.existsSync(secretFile) && fs.readFileSync(secretFile, 'utf8').includes('sk-secreta-123'));

  const loaded = await handlers['data:load']();
  ok('data:load recupera la clave desde el almacén', loaded.settings.ai.apiKey === 'sk-secreta-123');
  ok('data:load informa el nivel de protección', ['os-encrypted', 'plaintext-fallback', 'none'].includes(loaded.settings.ai.keyProtection));
  ok('data:load devuelve estructura completa', Array.isArray(loaded.stories) && Array.isArray(loaded.characters) && Array.isArray(loaded.activityLog) && loaded.settings);

  // Respaldo corrupto/hostil: no debe romper el arranque
  fs.writeFileSync(dataFile, JSON.stringify({
    settings: { uiScale: 'enorme', density: 42, profilePhoto: 'javascript:alert(1)', wallpaper: 'data:image/svg+xml,<svg/>', ai: { apiKey: '' } },
    stories: [{ id: 'x', title: 'T', color: 'rojo', chapters: 'no-array', notes: null }],
    characters: 'no-array', activityLog: [{ date: 'mal', words: 'NaN' }]
  }));
  const healed = await handlers['data:load']();
  ok('ajustes inválidos se normalizan', healed.settings.uiScale === 'compact' && healed.settings.density === 'comfortable');
  ok('imagen javascript: descartada al cargar', healed.settings.profilePhoto === '');
  ok('SVG como fondo descartado al cargar', healed.settings.wallpaper === '');
  ok('color inválido cae al valor por defecto', healed.stories[0].color === '#c81e3a');
  ok('chapters no-array se corrige', Array.isArray(healed.stories[0].chapters));
  ok('characters no-array se corrige', Array.isArray(healed.characters));
  ok('activityLog con entrada inválida se sanea', healed.activityLog.every((a) => typeof a.words === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(a.date.slice(0, 10))));

  const rejected = await handlers['data:save'](null, null);
  ok('data:save rechaza payload inválido sin escribir', rejected && rejected.ok === false);

  const secret = await handlers['secrets:get']();
  ok('secrets:get expone la clave guardada', secret.ok === true && typeof secret.apiKey === 'string');
  await handlers['secrets:set'](null, '');
  ok('secrets:set("") borra el archivo de secreto', !fs.existsSync(secretFile));

  // ============ 3. Renderer: contenido hostil no se ejecuta ============
  const seed = makeSeed();
  seed.stories[0].chapters[0].content = '<p>Capítulo normal</p><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</' + 'script>';
  const { w, errors } = makeApp({ seed });

  setTimeout(() => {
    const d = w.document;
    const probe = w.__probe;

    probe('showView("stories")');
    probe('openStoryEditor(DATA.stories[0].id)');
    const editorHtml = d.getElementById('chapterEditor').innerHTML;
    ok('el editor sanitiza al renderizar (sin onerror)', !/onerror/i.test(editorHtml));
    ok('el editor sanitiza al renderizar (sin script)', !/<script/i.test(editorHtml));
    ok('el editor conserva la prosa', editorHtml.includes('Capítulo normal'));
    ok('ningún payload se ejecutó al pintar el capítulo', w.__pwned === undefined, String(w.__pwned));

    const hostile = {
      story: {
        id: 'evil',
        title: 'Saga <img src=x onerror=alert(1)> & "citada"',
        chapters: [{ id: 'c', title: 'Cap', content: '<p>ok</p><iframe src="https://evil.test"></iframe><b>negrita</b>' }],
        notes: [],
        attachedDocs: [{ id: 'd', name: 'Manual', content: '<script>alert(9)</' + 'script>Texto de la fuente' }]
      },
      characters: [{ id: 'ch', storyId: 'evil', name: 'Mara <svg onload=alert(2)>', traits: ['<b>x</b>'] }],
      settings: {
        profilePhoto: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
        wallpaper: 'x"); background:url("javascript:alert(3)',
        authorName: 'Autor/a'
      }
    };
    probe(`window.lorevinci.importFile = async () => ({ ok: true, data: ${JSON.stringify(hostile)} })`);
    const before = probe('DATA.stories.length');
    Promise.resolve(probe('importDataFromFile()')).then(() => {
      const imported = probe('DATA.stories[DATA.stories.length-1]');
      ok('la importación hostil añade la historia', probe('DATA.stories.length') === before + 1);
      ok('título importado sin HTML y sin doble escape', !/<img|<script/i.test(imported.title) && !/&amp;amp;/.test(imported.title) && imported.title.includes('&'));
      ok('capítulo importado sin iframe', !/<iframe/i.test(imported.chapters[0].content));
      ok('capítulo importado conserva <b>', /<b>negrita<\/b>/.test(imported.chapters[0].content));
      ok('fuente importada como texto plano (sin etiquetas)', !/<script/i.test(imported.attachedDocs[0].content) && !/&lt;/.test(imported.attachedDocs[0].content) && imported.attachedDocs[0].content.includes('Texto de la fuente'));
      const chars = probe('DATA.characters.filter(c => c.storyId === DATA.stories[DATA.stories.length-1].id)');
      ok('personaje importado sin svg', !/<svg/i.test(chars[0].name));
      ok('rasgos importados como texto plano', !/<b>/.test(chars[0].traits[0]));

      probe('showView("collab")');
      probe('renderCharacters()');
      ok('pintar personajes hostiles no ejecuta nada', w.__pwned === undefined && !/onerror|onload/i.test(d.getElementById('charGrid').innerHTML));

      ok('validateImportData rechaza characters no-array', /characters/.test(String(probe('validateImportData({ stories: [], characters: "x" })'))));
      ok('validateImportData rechaza settings no-objeto', /settings/.test(String(probe('validateImportData({ stories: [], settings: null })'))));
      ok('validateImportData acepta respaldo correcto', probe('validateImportData({ story: { title: "T", chapters: [] } })') === null);
      ok('validateImportData rechaza array en la raíz', probe('validateImportData([])') !== null);

      const runtime = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
      ok('sin errores de ejecución en la suite de seguridad', runtime.length === 0, runtime.slice(0, 3).join(' | '));
      R.done();
    });
  }, 2600);
})();
