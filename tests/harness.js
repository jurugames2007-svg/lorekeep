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
    webSearch: async () => ({ ok: true, results: [] }),
    webFetch: async ({ url }) => ({ ok: true, page: { url, title:'Fuente web', description:'', content:'Contenido web de prueba suficientemente extenso para ser una fuente verificable.', fetchedAt:Date.now() } }),
    isDesktop: true
  };
  if (seed || Object.keys(bridge).length) w.lorevinci = { ...defaults, ...bridge };
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  const engineScript = w.document.createElement('script');
  engineScript.textContent = fs.readFileSync(P + 'rpg-engine.js', 'utf8');
  w.document.body.appendChild(engineScript);
  const script = w.document.createElement('script');
  script.textContent = fs.readFileSync(P + 'app.js', 'utf8') + '\n;window.__probe=(c)=>eval(c);';
  w.document.body.appendChild(script);
  return { w, errors, click: (id) => w.document.getElementById(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true })) };
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

module.exports = { makeApp, makeSeed, reporter, writePdf, loadNodePdfjs, ROOT, P };
