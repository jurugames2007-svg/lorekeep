// Handlers del proceso principal: ai:verify, ai:models y reporte de finish_reason.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reporter, ROOT } = require('./harness');

const handlers = {};
const ipcMain = { handle: (c, f) => { handlers[c] = f; } };
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-api-'));
const app = { isPackaged: false, getPath: () => userData, whenReady: () => ({ then: () => ({}) }), on() {} };
const BW = function () { return { setMenuBarVisibility() {}, loadFile() {}, webContents: { openDevTools() {} }, on() {} }; };
BW.getAllWindows = () => [];
const Module = require('module');
const orig = Module._load;
Module._load = function (r) { if (r === 'electron') return { app, BrowserWindow: BW, ipcMain, dialog: {}, shell: {} }; return orig.apply(this, arguments); };
require(path.join(ROOT, 'main.js'));
Module._load = orig;

const R = reporter('api');
let mode = 'ok', finish = 'stop';
const srv = http.createServer((req, res) => {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (mode === 'badkey') return send(401, { error: { message: 'Invalid API key' } });
  if (req.url.endsWith('/models')) return send(200, { data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, { id: 'llama3' }] });
  if (req.url.endsWith('/chat/completions')) {
    if (mode === 'nogen') return send(402, { error: { message: 'Insufficient credits' } });
    let b = ''; req.on('data', d => b += d); req.on('end', () => send(200, {
      choices: [{ message: { content: 'OPERATIVO' }, finish_reason: finish }],
      usage: { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 }
    }));
    return;
  }
  send(404, {});
});

srv.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const ok = R.ok, verify = handlers['ai:verify'], models = handlers['ai:models'], gen = handlers['ai:generate'];
  const KEY = 'sk-' + 'x'.repeat(30);

  ok('handler ai:verify registrado', typeof verify === 'function');
  ok('handler ai:models registrado', typeof models === 'function');

  let r = await verify(null, { baseUrl: base, apiKey: KEY, model: 'gpt-4o-mini' });
  ok('verificación completa ok', r.ok === true);
  ok('4 pasos reportados', r.steps.length === 4);
  ok('paso generación real', r.steps.find(s => s.id === 'generate').detail.includes('OPERATIVO'));

  r = await verify(null, { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'x' });
  ok('sin key se rechaza', r.ok === false && /API Key/i.test(r.error));

  mode = 'badkey';
  r = await verify(null, { baseUrl: base, apiKey: 'sk-bad', model: 'x' });
  ok('401 con mensaje accionable', r.ok === false && /rechazada|401/i.test(r.error));

  mode = 'nogen';
  r = await verify(null, { baseUrl: base, apiKey: KEY, model: 'gpt-4o-mini' });
  ok('402 detectado en generación', r.ok === false && /crédito|402/i.test(r.error));
  ok('auth pasa pero generar falla', r.steps.find(s => s.id === 'auth').ok && !r.steps.find(s => s.id === 'generate').ok);

  mode = 'ok';
  r = await verify(null, { baseUrl: base, apiKey: KEY, model: 'inexistente' });
  ok('modelo desconocido señalado', r.steps.find(s => s.id === 'model').ok === false);

  r = await verify(null, { baseUrl: 'http://127.0.0.1:1/v1', apiKey: KEY, model: 'x' });
  ok('host inalcanzable manejado', r.ok === false && /contactar|conexión/i.test(r.error));

  r = await verify(null, { baseUrl: base, apiKey: '', model: 'llama3' });
  ok('servidor local sin key permitido', r.ok === true);

  const m = await models(null, { baseUrl: base, apiKey: KEY });
  ok('ai:models devuelve catálogo', m.ok && m.models.length === 3);

  finish = 'stop';
  let g = await gen(null, { baseUrl: base, apiKey: KEY, model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxTokens: 2000 });
  ok('finishReason reportado', g.finishReason === 'stop');
  ok('truncated=false con stop', g.truncated === false);
  ok('usage reportado', g.usage && g.usage.totalTokens === 1801);

  finish = 'length';
  g = await gen(null, { baseUrl: base, apiKey: KEY, model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxTokens: 2000 });
  ok('truncated=true con length', g.truncated === true);
  ok('texto devuelto aun truncado', g.text === 'OPERATIVO');

  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  ok('techo max_tokens 32k', /Math\.min\(32000, maxTokens/.test(src));
  ok('límite de prompt 120k', /120000/.test(src));
  srv.close();
  fs.rmSync(userData, { recursive: true, force: true });
  R.done();
});
