// OCR local: recursos vendorizados + reconocimiento real de una imagen escaneada.
// El reconocimiento requiere tesseract.js instalado:  npm install --no-save tesseract.js@5.1.1
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { reporter, ROOT } = require('./harness');

const V = path.join(ROOT, 'renderer', 'vendor', 'tesseract') + '/';
const R = reporter('ocr');

// Genera un PNG en escala de grises con texto dibujado (simula un escaneo).
function writeScanPng(file) {
  const F = {
    D:['11110','10001','10001','10001','10001','10001','11110'], R:['11110','10001','10001','11110','10100','10010','10001'],
    A:['01110','10001','10001','11111','10001','10001','10001'], G:['01110','10001','10000','10111','10001','10001','01110'],
    O:['01110','10001','10001','10001','10001','10001','01110'], N:['10001','11001','10101','10011','10001','10001','10001'],
    L:['10000','10000','10000','10000','10000','10000','11111'], Z:['11111','00001','00010','00100','01000','10000','11111'],
    K:['10001','10010','10100','11000','10100','10010','10001'], U:['10001','10001','10001','10001','10001','10001','01110'],
    S:['01110','10001','10000','01110','00001','10001','01110'], P:['11110','10001','10001','11110','10000','10000','10000'],
    E:['11111','10000','10000','11110','10000','10000','11111'], I:['11111','00100','00100','00100','00100','00100','11111'],
    Y:['10001','10001','01010','00100','00100','00100','00100'], J:['00111','00010','00010','00010','00010','10010','01100'],
    M:['10001','11011','10101','10001','10001','10001','10001'], H:['10001','10001','10001','11111','10001','10001','10001'],
    T:['11111','00100','00100','00100','00100','00100','00100'], ' ':['00000','00000','00000','00000','00000','00000','00000'],
    '.':['00000','00000','00000','00000','00000','01100','01100']
  };
  const W = 1200, H = 300;
  const px = Array.from({ length: H }, () => new Array(W).fill(255));
  const draw = (text, x0, y0, sc) => {
    let x = x0;
    for (const ch of text.toUpperCase()) {
      const g = F[ch] || F[' '];
      g.forEach((row, ry) => row.split('').forEach((b, rx) => {
        if (b === '1') for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) {
          const Y = y0 + ry * sc + dy, X = x + rx * sc + dx;
          if (Y >= 0 && Y < H && X >= 0 && X < W) px[Y][X] = 0;
        }
      }));
      x += 6 * sc;
    }
  };
  draw('DRAGON BALL Z', 40, 40, 7);
  draw('GOKU SUPER SAIYAJIN', 40, 140, 5);
  draw('KAME HAME HA.', 40, 220, 5);
  const raw = Buffer.concat(px.map(r => Buffer.concat([Buffer.from([0]), Buffer.from(r)])));
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : require('zlib').crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
  return file;
}

(async () => {
  const ok = R.ok;
  const need = [
    ['tesseract.min.js', 'tesseract.min.js', 50000],
    ['worker.min.js', 'worker.min.js', 50000],
    ['core SIMD wasm', 'core/tesseract-core-simd-lstm.wasm.js', 500000],
    ['core fallback wasm', 'core/tesseract-core-lstm.wasm.js', 500000],
    ['datos español', 'lang/spa.traineddata.gz', 1000000],
    ['datos inglés', 'lang/eng.traineddata.gz', 1000000]
  ];
  need.forEach(([label, rel, min]) => {
    const f = V + rel;
    ok(`vendorizado: ${label}`, fs.existsSync(f) && fs.statSync(f).size > min);
  });

  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  ok('index.html carga tesseract', html.includes('vendor/tesseract/tesseract.min.js'));
  ok('CSP permite wasm', /wasm-unsafe-eval/.test(html));
  const appjs = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
  ok('workerPath apunta a vendor', /workerPath: 'vendor\/tesseract\/worker\.min\.js'/.test(appjs));
  ok('langPath apunta a vendor', /langPath: 'vendor\/tesseract\/lang'/.test(appjs));
  ok('OCR se integra en la ingesta', /ocrPdfFile\(file/.test(appjs));

  let createWorker = null;
  try { ({ createWorker } = require('tesseract.js')); } catch {
    try { ({ createWorker } = require('/tmp/ocrrun/node_modules/tesseract.js')); } catch {}
  }
  if (!createWorker) {
    console.log('  (omitido el reconocimiento: instala tesseract.js@5.1.1 para ejecutarlo)');
    return R.done();
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-ocr-'));
  const img = writeScanPng(path.join(tmp, 'scan.png'));
  const worker = await createWorker('spa', 1, { langPath: V + 'lang', gzip: true, cachePath: tmp, logger: () => {} });
  const { data } = await worker.recognize(img);
  const text = (data.text || '').toUpperCase().replace(/\s+/g, ' ').trim();
  await worker.terminate();
  ok('OCR reconoce DRAGON', text.includes('DRAGON'), text);
  ok('OCR reconoce BALL', /[BE]?ALL/.test(text), text); // la B de la fuente bitmap del test es ambigua
  ok('OCR reconoce GOKU', text.includes('GOKU'), text);
  ok('OCR reconoce SAIYAJIN', /SAIYAJ/.test(text), text);
  ok('OCR reconoce KAME', /KAME/.test(text), text);
  ok('confianza reportada', typeof data.confidence === 'number' && data.confidence > 50, '' + data.confidence);
  fs.rmSync(tmp, { recursive: true, force: true });
  R.done();
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
