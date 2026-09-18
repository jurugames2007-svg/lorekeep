// Utilidades compartidas por las pruebas. Requieren jsdom y pdfjs-dist:
//   npm install --no-save jsdom pdfjs-dist@3.11.174
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = path.join(ROOT, 'renderer') + '/';

function loadNodePdfjs() {
  const saved = { w: global.window, d: global.document, s: global.self, n: global.navigator, l: global.location };
  global.self = global; global.window = global;
  global.navigator = { userAgent: 'node', platform: 'linux' };
  global.document = { currentScript: null, createElement: () => ({ style: {}, setAttribute() {}, getContext: () => null }), documentElement: { style: {} }, head: { appendChild() {} } };
  global.location = { href: 'file:///tmp/', protocol: 'file:' };
  let pdf = null;
  try { pdf = require('pdfjs-dist/legacy/build/pdf.js'); } catch { try { pdf = require('/tmp/pdfjs/package/legacy/build/pdf.js'); } catch {} }
  global.window = saved.w; global.document = saved.d; global.self = saved.s; global.navigator = saved.n; global.location = saved.l;
  return pdf;
}

function makeApp({ seed = null, bridge = {}, withPdf = false } = {}) {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(P + 'index.html', 'utf8')
    .replace('<script src="vendor/pdfjs/pdf.min.js"></script>', '')
    .replace('<script src="vendor/tesseract/tesseract.min.js"></script>', '')
    .replace('<script src="app.js"></script>', '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  w.localStorage.clear();
  w.speechSynthesis = { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [] };
  w.SpeechSynthesisUtterance = function () {};
  w.prompt = () => null;
  if (withPdf) {
    const nodePdf = loadNodePdfjs();
    w.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: (o) => nodePdf.getDocument({ ...o, disableWorker: true, isEvalSupported: false }) };
  }
  const defaults = {
    loadData: async () => (seed ? JSON.parse(JSON.stringify(seed)) : undefined),
    saveData: async () => true,
    exportFile: async () => ({ ok: true }),
    importFile: async () => ({ ok: false }),
    openExternal: async () => {},
    aiGenerate: async () => ({ ok: true, text: 'texto', truncated: false }),
    aiModels: async () => ({ ok: true, models: ['gpt-4o'] }),
    aiVerify: async () => ({ ok: true, steps: [] }),
    omniRouteStatus: async () => ({ ok:true, baseUrl:'http://localhost:20128/v1', dashboardUrl:'http://localhost:20128', latencyMs:12, modelCount:4, models:['auto','auto/smart','auto/fast','auto/cheap'], autoAvailable:true, version:'3.8.50' }),
    webSearch: async () => ({ ok: true, results: [] }),
    webFetch: async ({ url }) => ({ ok: true, page: { url, title:'Fuente web', description:'', content:'Contenido web de prueba suficientemente extenso para ser una fuente verificable.', fetchedAt:Date.now() } }),
    isDesktop: true
  };
  if (seed || Object.keys(bridge).length) w.lorevinci = { ...defaults, ...bridge };
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  // El núcleo de la aplicación emite logs estructurados (una línea JSON) por
  // console.debug. Se capturan en un array en vez de volcarlos a stdout: una
  // suite que pasa debe ser silenciosa, y las pruebas que necesitan inspeccionar
  // la observabilidad leen `logs` directamente.
  const logs = [];
  w.console.debug = (line) => { logs.push(String(line)); };
  w.console.info = (line) => { logs.push(String(line)); };
  // Módulos compartidos (seguridad de salida + semilla) antes que el motor y la app.
  ['app-kernel.js', 'dom-safe.js', 'seed-data.js', 'rpg-engine.js'].forEach((file) => {
    const moduleScript = w.document.createElement('script');
    moduleScript.textContent = fs.readFileSync(P + file, 'utf8');
    w.document.body.appendChild(moduleScript);
  });
  const script = w.document.createElement('script');
  script.textContent = fs.readFileSync(P + 'app.js', 'utf8') + '\n;window.__probe=(c)=>eval(c);';
  w.document.body.appendChild(script);
  return {
    w,
    errors,
    logs,
    /** Logs estructurados parseados (descarta lo que no sea JSON). */
    parsedLogs: () => logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean),
    click: (id) => w.document.getElementById(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  };
}

function makeSeed(overrides = {}) {
  return Object.assign({
    settings: { theme: 'dark', authorName: 'Test', uiScale: 'compact', density: 'comfortable',
      editorAppearance: { font: 'font-sans', width: '680px', size: 'size-standard' }, onboardingSeen: true,
      ai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' } },
    stories: [{ id: 's1', title: 'Obra', genre: 'F', synopsis: 'x', rules: 'r', outline: 'o', color: '#111',
      coverImage: null, notes: [], attachedDocs: [], chapters: [{ id: 'c1', title: 'Cap 1', content: '<p>hola</p>', status: 'draft' }],
      createdAt: 1, updatedAt: 1 }],
    characters: [], globalDocs: [], collabNotes: [], activityLog: []
  }, overrides);
}

function reporter(name) {
  const t = [];
  return {
    ok(label, cond, extra = '') { t.push(`${cond ? 'PASS' : 'FAIL'} — ${label}${!cond && extra ? ' :: ' + extra : ''}`); },
    /**
     * Cierra la suite en rojo cuando revienta a mitad. Sin esto, una excepción
     * no capturada dejaba el recuento intacto y la suite podía reportarse en
     * verde habiendo ejecutado la mitad de las aserciones.
     * @param {unknown} error
     */
    crash(error) {
      const detail = (error && error.stack) ? String(error.stack).split('\n').slice(0, 4).join(' | ') : String(error);
      t.push(`FAIL — la suite reventó antes de terminar :: ${detail}`);
      this.done();
    },
    done() {
      const fails = t.filter(x => x.startsWith('FAIL'));
      console.log(t.join('\n'));
      console.log(`\n[${name}] TOTAL: ${t.length}  PASS: ${t.length - fails.length}  FAIL: ${fails.length}`);
      if (fails.length) process.exit(1);
    }
  };
}

// Genera un PDF mínimo con capa de texto real.
function writePdf(filePath, lines) {
  let content = Buffer.alloc(0); let y = 760;
  for (const l of lines) {
    const safe = String(l).replace(/[()\\]/g, '');
    content = Buffer.concat([content, Buffer.from(`BT /F1 11 Tf 50 ${y} Td (${safe}) Tj ET\n`, 'latin1')]);
    y -= 18; if (y < 50) break;
  }
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  ];
  let out = Buffer.from('%PDF-1.4\n'); const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); });
  const x = out.length;
  out = Buffer.concat([out, Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`)]);
  offs.forEach(o => { out = Buffer.concat([out, Buffer.from(String(o).padStart(10, '0') + ' 00000 n \n')]); });
  out = Buffer.concat([out, Buffer.from(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`)]);
  fs.writeFileSync(filePath, out);
  return filePath;
}

// ------------------------------------------------------------
// Reloj falso determinista. El controlador de persistencia recibe los timers por
// inyección, así que las pruebas de carga no necesitan dormir ni depender de la
// puntualidad del planificador: se avanza el tiempo a voluntad y el resultado es
// reproducible ejecución tras ejecución.
// ------------------------------------------------------------
function makeClock(startMs = 0) {
  const tasks = new Map();
  let seq = 0;
  let nowMs = startMs;
  return {
    setTimeout: (fn, ms) => { seq += 1; tasks.set(seq, { fn, at: nowMs + (Number(ms) || 0) }); return seq; },
    clearTimeout: (id) => { tasks.delete(id); },
    advance(ms) {
      const target = nowMs + ms;
      for (;;) {
        const due = Array.from(tasks.entries())
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, task] = due;
        tasks.delete(id);
        nowMs = task.at;
        task.fn();
      }
      nowMs = target;
      return nowMs;
    },
    pending: () => tasks.size,
    now: () => nowMs
  };
}

// Drena microtareas con un timer REAL (el reloj falso solo vive en el controlador).
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settleDeep(times = 6) {
  for (let i = 0; i < times; i += 1) await settle();
}

// PRNG determinista (mulberry32): las pruebas de carga que necesitan azar —por
// ejemplo un transporte que falla el 30 % de las veces— deben poder reproducir
// exactamente el mismo escenario si algo se rompe.
function makeRandom(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { makeApp, makeSeed, reporter, writePdf, loadNodePdfjs, makeClock, settle, settleDeep, makeRandom, ROOT, P };
