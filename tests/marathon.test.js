// MARATÓN: libro completo de 30 capítulos con un modelo simulado ADVERSO
// (trunca, devuelve JSON roto, falla la red y filtra texto del asistente).
// Verifica que el motor entrega 30 capítulos íntegros pese a todo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeApp, makeSeed, reporter, writePdf } = require('./harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-dbz-'));
writePdf(path.join(tmp, '01_Manual_Canon_Absoluto.pdf'), [
  'MANUAL DE CANON ABSOLUTO - DRAGON BALL Z',
  'Goku es un saiyajin criado en la Tierra, nombre de nacimiento Kakarotto.',
  'El Super Saiyajin multiplica x50 el poder base y es una leyenda milenaria.',
  'Freezer destruyo el planeta Vegeta y teme la leyenda del Super Saiyajin.',
  'El Kaio-Ken multiplica el poder pero danha el cuerpo progresivamente.',
  'La Genkidama recolecta energia de seres vivos y requiere tiempo.',
  'Piccolo y Kamisama estan vinculados: si uno muere, el otro tambien.',
  'Namek explota cinco minutos despues del combate final contra Freezer.']);
writePdf(path.join(tmp, '02_What_If_Universo_Alterno.pdf'), [
  'DOCUMENTO WHAT IF - UNIVERSO ALTERNO',
  'Escenario: y si Goku jamas pudiera transformarse en Super Saiyajin.',
  'Realidad alterna divergente del canon principal a partir de Namek.',
  'El gen de la transformacion legendaria esta ausente en Kakarotto.']);
writePdf(path.join(tmp, '03_Fichas_Personaje.pdf'), [
  'FICHAS DE PERSONAJE - GUERREROS Z',
  'Goku: ingenuo, competitivo, generoso, obsesionado con superarse.',
  'Vegeta: orgulloso, sarcastico, incapaz de aceptar ser segundo.',
  'Gohan: sensible y timido, con furia latente devastadora.']);
writePdf(path.join(tmp, '04_Cronologia.pdf'), [
  'CRONOLOGIA - LINEA TEMPORAL',
  'Anho 762: invasion de Nappa y Vegeta.',
  'Anho 762: combate final contra Freezer en Namek.']);

const TITLES = ['La ausencia del legado','Sangre sin dorado','El limite del Kaio-Ken','Orgullo prestado','La furia de Gohan',
'Namek arde','Sin milagro','El precio de la tecnica','Aliados improbables','La apuesta de Krilin','Cuenta regresiva',
'Lo que Vegeta no dira','El plan del namekiano','Energia prestada','Un mono sin leyenda','La grieta','Cicatrices',
'El discipulo supera','Ultimo aliento','Freezer sonrie','La Genkidama imposible','Caida','Reconstruccion','El heredero',
'Promesas rotas','Contrarreloj','El sacrificio','Lo que queda','Amanecer sin dorado','El verdadero poder'];

const S = { plan: 0, write: 0, cont: 0, truncated: 0, badJson: 0, netFail: 0, leaks: 0, promptChars: [], srcChars: [], memChars: [] };
const bridge = { aiGenerate: async (p) => {
  const sys = p.messages[0].content, last = p.messages[p.messages.length - 1].content;
  if (sys.includes('editor de mesa')) {
    S.plan++;
    if (S.plan % 10 === 0) { S.badJson++; return { ok: true, truncated: false, text: 'Sin JSON válido.' }; }
    return { ok: true, truncated: false, text: '```json\n' + JSON.stringify({
      titulo: TITLES[(S.plan - 1) % TITLES.length], objetivo: 'Avanzar sin la transformacion legendaria',
      escenas: ['Goku entrena el Kaio-Ken', 'Vegeta cuestiona', 'Freezer avanza'],
      conflicto: 'El cuerpo no resiste el multiplicador', coste: 'Goku pierde movilidad',
      revelacion: 'El Kaio-Ken x20 es el limite', gancho: 'la esfera de energia se apago en sus manos',
      continuidad: ['Piccolo ligado a Kamisama'] }) + '\n```' };
  }
  if (/Continúa exactamente desde donde quedó/.test(last)) {
    S.cont++;
    return { ok: true, truncated: false, text: 'y el silencio se rompio cuando la esfera de energia se apago en sus manos.' };
  }
  S.write++;
  S.promptChars.push(sys.length + last.length);
  const fm = sys.match(/FUENTES DEL LIBRO[\s\S]*?(?=\nMaterial adicional)/); S.srcChars.push(fm ? fm[0].length : 0);
  const mm = sys.match(/MEMORIA NARRATIVA[\s\S]*?(?=\n\nREGISTRO DE CONOCIMIENTO)/); S.memChars.push(mm ? mm[0].length : 0);
  if (S.write % 12 === 0) { S.netFail++; return { ok: false, error: 'network timeout' }; }
  if (S.write % 7 === 0) { S.truncated++; return { ok: true, truncated: true, text: ('Goku apreto los dientes bajo la gravedad aumentada. '.repeat(45)) + 'Y entonces el aura roja del Kaio-Ken' }; }
  if (S.write % 9 === 0) { S.leaks++; return { ok: true, truncated: false, text: 'Aquí tienes el capítulo:\n\n' + ('Krilin observo el horizonte de Namek. '.repeat(55)) + 'La esfera de energia se apago en sus manos.' }; }
  return { ok: true, truncated: false, text: ('Goku sintio el peso de no poder ir mas alla mientras el Kaio-Ken ardia. '.repeat(60)) + 'La esfera de energia se apago en sus manos.' };
}};

const seed = makeSeed({ stories: [] });
const { w } = makeApp({ seed, bridge, withPdf: true });
const R = reporter('marathon');
const mk = (p) => new w.File([new Uint8Array(fs.readFileSync(p))], path.basename(p), { type: 'application/pdf' });
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

setTimeout(async () => {
  const ok = R.ok, probe = w.__probe, d = w.document;

  // Crear el libro con todos sus parámetros
  probe('showView("stories")');
  d.getElementById('newStoryBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('newStoryTitle').value = 'Dragon Ball Z: Sin Leyenda Dorada';
  d.getElementById('newStoryGenre').value = 'Shonen • Acción • What If';
  d.getElementById('newStorySynopsis').value = 'Kakarotto nace sin el gen de la transformación legendaria.';
  d.getElementById('newStoryRules').value = '1. Goku NUNCA puede transformarse en Super Saiyajin. 2. Kaio-Ken x20 es el límite. 3. Piccolo y Kamisama comparten destino.';
  d.getElementById('newStoryStyleRef').value = 'Dragon Ball Z (Akira Toriyama)';
  d.getElementById('newStyleNotes').value = 'Tercera persona ágil, combates con medición de poder, humor ligero.';
  d.getElementById('createStoryBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const sid = probe('DATA.stories[DATA.stories.length-1].id');
  ok('libro creado con parámetros', probe('DATA.stories[DATA.stories.length-1].style.reference') === 'Dragon Ball Z (Akira Toriyama)');

  // Subir las 4 fuentes de golpe
  w.__files = ['01_Manual_Canon_Absoluto','02_What_If_Universo_Alterno','03_Fichas_Personaje','04_Cronologia'].map(n => mk(path.join(tmp, n + '.pdf')));
  const ing = await probe(`ingestFilesIntoList(window.__files, getStory("${sid}").attachedDocs, {targetName:'DBZ', storyId:"${sid}", useProgressUI:false})`);
  ok('4 PDFs de canon ingeridos', ing.added === 4, JSON.stringify(ing));
  const docs = probe(`getStory("${sid}").attachedDocs`);
  ok('canon con texto real', docs[0].content.includes('Kakarotto'));
  ok('what-if clasificado', docs.some(x => x.subtype === 'what-if'));
  ok('cronología clasificada', docs.some(x => x.subtype === 'cronologia'));

  // Generar 30 capítulos
  probe(`DATA.settings.ai.apiKey='sk-'+'x'.repeat(40); DATA.settings.ai.model='gpt-4o'; DATA.settings.ai.verifiedAt=Date.now();`);
  probe(`currentStoryId="${sid}"; openStoryEditor("${sid}"); getStory("${sid}").chapters=[];`);
  d.getElementById('openAutoBookModalBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('autoBookCount').value = '30';
  d.getElementById('autoBookLength').value = '1200';
  d.getElementById('startAutoBookBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (/Generación automática completada/.test(d.getElementById('autoBookLogs').textContent)) break;
  }

  const chs = probe(`getStory("${sid}").chapters`);
  const words = chs.map(c => strip(c.content).split(/\s+/).filter(Boolean).length);
  ok('30 capítulos generados', chs.length === 30, '' + chs.length);
  ok('fallos inyectados de verdad', S.truncated > 0 && S.badJson > 0 && S.netFail > 0 && S.leaks > 0,
     `trunc=${S.truncated} json=${S.badJson} net=${S.netFail} leak=${S.leaks}`);
  ok('todos los truncados recuperados', S.cont === S.truncated, `${S.cont}/${S.truncated}`);
  ok('ningún capítulo marcado incompleto', chs.filter(c => c.generation && c.generation.truncated).length === 0);
  ok('ninguno cortado a media frase', chs.filter(c => { const t = strip(c.content); return t && !/[.!?…"»)\]]$/.test(t.slice(-1)); }).length === 0);
  ok('fallos de red cubiertos localmente', chs.filter(c => c.generation && c.generation.model === 'local-mock').length === S.netFail);
  ok('fugas del asistente detectadas', chs.filter(c => c.generation && (c.generation.issues || []).some(i => i.level === 'error')).length >= S.leaks);
  ok('escaletas rotas no bloquean', S.badJson > 0 && chs.length === 30);
  ok('títulos únicos', new Set(chs.map(c => c.title)).size === 30);
  ok('títulos narrativos de escaleta', chs.filter(c => c.generation && c.generation.beat).length >= 25);
  ok('trazabilidad completa', chs.filter(c => c.generation).length === 30);
  ok('fuentes registradas por capítulo', chs.filter(c => c.generation && (c.generation.sourcesUsed || []).length).length === 30);
  ok('memoria crece con la saga', S.memChars[S.memChars.length - 1] > S.memChars[0] * 5,
     `${S.memChars[0]} → ${S.memChars[S.memChars.length - 1]}`);
  ok('canon presente en los 30', Math.min(...S.srcChars) > 500);
  ok('volumen total coherente', words.reduce((a, b) => a + b, 0) > 15000, '' + words.reduce((a, b) => a + b, 0));

  fs.rmSync(tmp, { recursive: true, force: true });
  R.done();
}, 2500);
