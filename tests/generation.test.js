// Motor de generación: escaleta, truncado + continuación, auditoría, títulos, presupuesto.
const { makeApp, makeSeed, reporter } = require('./harness');

const seed = makeSeed();
seed.stories[0].chapters = [];
for (let i = 1; i <= 8; i++) {
  seed.stories[0].chapters.push({ id: 'c' + i, title: 'Capítulo ' + i, status: 'done',
    content: '<p>' + ('Eventos, decisiones y consecuencias del capítulo ' + i + '. ').repeat(30) + '</p>' });
}
seed.stories[0].style = { reference: 'Dragon Ball (Toriyama)', notes: 'Frases cortas', person: 'third-limited', register: 'agil', strength: 'alta', sample: 'Goku apretó los puños. El aire crujió.' };
seed.stories[0].attachedDocs = [{ id: 'd1', name: 'Canon.pdf', content: 'Dato canónico del universo. '.repeat(200), priorityLevel: 'primary', isPriority: true, subtype: 'canon-oficial', subtypeLabel: 'Canon oficial', verse: 'canon-principal', verseLabel: 'Verso canónico principal' }];

const calls = [];
let scenario = 'truncate';
const bridge = { aiGenerate: async (p) => {
  calls.push(p);
  const last = p.messages[p.messages.length - 1].content;
  if (p.messages[0].content.includes('editor de mesa')) {
    return { ok: true, truncated: false, text: '```json\n{"titulo":"El puente de eco","objetivo":"o","escenas":["a","b"],"conflicto":"c","coste":"k","revelacion":"r","gancho":"la puerta se abrió sola","continuidad":["x"]}\n```' };
  }
  if (/Continúa exactamente desde donde quedó/.test(last)) {
    return { ok: true, truncated: false, text: 'y el cristal respondió. La puerta se abrió sola.' };
  }
  if (scenario === 'truncate') return { ok: true, truncated: true, usage: { promptTokens: 4000, completionTokens: 1400, totalTokens: 5400 }, text: ('Mara avanzó por el puente. '.repeat(30)) + 'El guardián alzó la mano y' };
  return { ok: true, truncated: false, usage: { promptTokens: 4000, completionTokens: 900, totalTokens: 4900 }, text: ('Mara cruzó el puente de eco mientras el alba teñía los reinos. '.repeat(60)) + 'La puerta se abrió sola.' };
}};

const { w } = makeApp({ seed, bridge });
const R = reporter('generation');

setTimeout(async () => {
  const ok = R.ok, probe = w.__probe, d = w.document;
  const big = probe('computePromptBudget("gpt-4o")');
  ok('anclas desde capítulos reales', probe('buildStyleAnchors(DATA.stories[0], 2400)').includes('MUESTRAS REALES'));

  const sid = probe('DATA.stories[0].id');
  probe(`DATA.settings.ai.apiKey='sk-'+'x'.repeat(40); DATA.settings.ai.model='gpt-4o'; DATA.settings.ai.verifiedAt=Date.now();`);
  const before = probe('DATA.stories[0].chapters.length');
  probe(`currentStoryId="${sid}"; openStoryEditor("${sid}");`);
  d.getElementById('openAutoBookModalBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('autoBookCount').value = '1';
  d.getElementById('startAutoBookBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 3500));

  const L = d.getElementById('autoBookLogs').textContent;
  ok('se pidió escaleta', calls.some(c => c.messages[0].content.includes('editor de mesa')));
  ok('log muestra escaleta', /Escaleta lista/.test(L));
  ok('log muestra ventana del modelo', /ventana ~128/.test(L));
  ok('TRUNCADO detectado', /truncado por límite de tokens/.test(L), L.slice(0, 200));
  ok('continuación solicitada', calls.some(c => /Continúa exactamente/.test(c.messages[c.messages.length - 1].content)));
  ok('log confirma capítulo completado', /capítulo completado/i.test(L));
  ok('capítulo guardado', probe('DATA.stories[0].chapters.length') === before + 1);

  const ch = probe('DATA.stories[0].chapters[DATA.stories[0].chapters.length-1]');
  ok('título desde la escaleta', ch.title === 'Capítulo 9: El puente de eco', ch.title);
  ok('texto cosido y cerrado', /La puerta se abrió sola\.<\/p>$/.test(ch.content));
  ok('metadatos guardados', ch.generation && ch.generation.model === 'gpt-4o');
  ok('escaleta persistida', ch.generation.beat.titulo === 'El puente de eco');
  ok('fuentes registradas', (ch.generation.sourcesUsed || []).length > 0);

  const write = calls.find(c => !c.messages[0].content.includes('editor de mesa'));
  ok('max_tokens adaptativo (no 1400)', write.maxTokens === big.outputTokens, '' + write.maxTokens);
  ok('mensaje user sustancial', write.messages[1].content.length > 300);
  ok('user lleva la escaleta', write.messages[1].content.includes('ESCALETA APROBADA'));
  ok('user fija extensión', /entre \d+ y \d+ palabras/.test(write.messages[1].content));
  ok('system con anclas de estilo', write.messages[0].content.includes('MUESTRAS REALES'));
  ok('sin cargo-cult "10/10"', !/10\/10/.test(write.messages[0].content));
  ok('instrucciones afirmativas', (write.messages[0].content.match(/^- (No|NO|Ningún) /gm) || []).length <= 1);
  probe('renderChapterList()');
  ok('lista muestra insignia IA', !!d.querySelector('#chapterList .ch-flag'));

  // Escenario limpio
  scenario = 'clean'; calls.length = 0;
  d.getElementById('openAutoBookModalBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('autoBookCount').value = '1';
  d.getElementById('startAutoBookBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 3000));
  ok('sin truncado no hay continuación', !calls.some(c => /Continúa exactamente/.test(c.messages[c.messages.length - 1].content)));
  ok('auditoría limpia', /Revisión sin incidencias/.test(d.getElementById('autoBookLogs').textContent));
  ok('no marcado como truncado', probe('DATA.stories[0].chapters[DATA.stories[0].chapters.length-1]').generation.truncated === false);

  // Planificación desactivable
  calls.length = 0;
  d.getElementById('openAutoBookModalBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('autoBookCount').value = '1';
  d.getElementById('autoBookPlanning').checked = false;
  d.getElementById('startAutoBookBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2500));
  ok('planificación desactivable', !calls.some(c => c.messages[0].content.includes('editor de mesa')));
  R.done();
}, 2500);
