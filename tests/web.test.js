// Investigación web: proveedores, extracción, metadatos y defensas SSRF/tamaño/binarios.
const path = require('path');
const Module = require('module');
const { reporter, ROOT } = require('./harness');
const handlers = {};
const ipcMain = { handle:(name, fn) => { handlers[name] = fn; }, on(){} };
const app = { isPackaged:false, getPath:() => '/tmp', whenReady:() => ({ then:() => ({}) }), on(){} };
const BW = function(){ return { setMenuBarVisibility(){}, loadFile(){}, webContents:{openDevTools(){}} }; };
BW.getAllWindows = () => [];
const electron = { app, BrowserWindow:BW, ipcMain, dialog:{}, shell:{} };
const realLoad = Module._load;
Module._load = function(request) {
  if (request === 'electron') return electron;
  if (request === 'dns') return { promises:{ lookup:async hostname => {
    if (hostname === 'private.test') return [{ address:'192.168.1.20', family:4 }];
    if (hostname === '127.0.0.1') return [{ address:'127.0.0.1', family:4 }];
    return [{ address:'93.184.216.34', family:4 }];
  } } };
  return realLoad.apply(this, arguments);
};

const originalFetch = global.fetch;
const fetched = [];
global.fetch = async (url, options = {}) => {
  const u = String(url); fetched.push({ url:u, options });
  if (u.includes('es.wikipedia.org/w/api.php')) return new Response(JSON.stringify({ query:{ search:[{ title:'Autora Ejemplo', snippet:'Biografía <b>verificada</b> y obra.' }] } }), { status:200, headers:{'Content-Type':'application/json'} });
  if (u.includes('openlibrary.org/search.json')) return new Response(JSON.stringify({ docs:[{ key:'/authors/OL1A', title:'Libro Ejemplo', author_name:['Autora Ejemplo'], first_publish_year:1999, subject:['Ficción','Drama'] }] }), { status:200, headers:{'Content-Type':'application/json'} });
  if (u.includes('html.duckduckgo.com')) return new Response('<div class="result"><a class="result__a" href="https://example.com/article">Análisis público</a><a class="result__snippet">Entrevista y contexto editorial.</a></div>', { status:200, headers:{'Content-Type':'text/html'} });
  if (u === 'https://example.com/article') return new Response('<!doctype html><html><head><title>Artículo &amp; entrevista</title><meta name="description" content="Contexto editorial verificable"></head><body><script>alert(1)</script><h1>Análisis</h1><p>Este artículo público documenta entrevistas, fechas, obras y rasgos generales con suficiente información para contrastar el contexto de una historia.</p></body></html>', { status:200, headers:{'Content-Type':'text/html; charset=utf-8'} });
  if (u === 'https://example.com/redirect-private') return new Response('', { status:302, headers:{ location:'http://127.0.0.1/secret' } });
  if (u === 'https://example.com/book.pdf') return new Response('%PDF', { status:200, headers:{'Content-Type':'application/pdf'} });
  if (u === 'https://example.com/huge') return new Response('x', { status:200, headers:{'Content-Type':'text/html','Content-Length':String(31*1024*1024)} });
  return new Response('not found', { status:404 });
};

require(path.join(ROOT, 'main.js'));
Module._load = realLoad;
const R = reporter('web');

(async () => {
  const ok = R.ok;
  const search = handlers['web:search'], fetchPage = handlers['web:fetch'];
  ok('handlers web disponibles', typeof search === 'function' && typeof fetchPage === 'function');

  let res = await search(null, { query:'Autora Ejemplo estilo y obra', provider:'all' });
  ok('búsqueda multi-proveedor responde', res.ok === true);
  ok('combina Wikipedia, Open Library y web abierta', new Set(res.results.map(x => x.provider)).size === 3, JSON.stringify(res.results));
  ok('limpia HTML del snippet', res.results.find(x => x.provider === 'Wikipedia').snippet === 'Biografía verificada y obra.');
  ok('deduplica y limita resultados', res.results.length === 3);

  res = await search(null, { query:'Autora', provider:'wikipedia' });
  ok('filtro de proveedor evita consultas innecesarias', res.ok && res.results.every(x => x.provider === 'Wikipedia'));

  res = await fetchPage(null, { url:'https://example.com/article' });
  ok('extrae página pública seleccionada', res.ok && res.page.title === 'Artículo & entrevista');
  ok('conserva URL y fecha de consulta', res.page.url === 'https://example.com/article' && Number.isFinite(res.page.fetchedAt));
  ok('extrae texto legible y elimina scripts', /documenta entrevistas/.test(res.page.content) && !/alert\(1\)/.test(res.page.content));
  ok('extrae descripción verificable', res.page.description === 'Contexto editorial verificable');

  res = await fetchPage(null, { url:'file:///etc/passwd' });
  ok('bloquea protocolos no web', !res.ok && /http\/https/.test(res.error));
  res = await fetchPage(null, { url:'http://private.test/admin' });
  ok('bloquea DNS que resuelve a IP privada', !res.ok && /red privada/.test(res.error));
  res = await fetchPage(null, { url:'https://example.com/redirect-private' });
  ok('revalida redirecciones y bloquea salto a localhost', !res.ok && /direcciones locales|red privada/.test(res.error));
  res = await fetchPage(null, { url:'https://example.com/book.pdf' });
  ok('rechaza PDF/binario y recomienda flujo seguro', !res.ok && /binario\/PDF/.test(res.error));
  res = await fetchPage(null, { url:'https://example.com/huge' });
  ok('rechaza contenido mayor a 30 MB antes de leer', !res.ok && /30 MB/.test(res.error));

  ok('todas las búsquedas usan User-Agent identificable', fetched.filter(x => /wikipedia|openlibrary|duckduckgo/.test(x.url)).every(x => /LoreVinci/.test(x.options.headers['User-Agent'])));
  global.fetch = originalFetch;
  R.done();
})().catch(err => { global.fetch = originalFetch; console.error(err); process.exit(1); });
