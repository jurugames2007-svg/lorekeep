// Regresión de rendimiento: escritura fluida con manuscritos grandes.
// Cubre debounce de guardado, coalescencia de escrituras en vuelo, memoización
// del conteo de palabras, índice de búsqueda perezoso, límites de snapshots,
// notificaciones y bitácora, y tiempos de render/sanitizado con 200 capítulos.
const { makeApp, makeSeed, reporter } = require('./harness');

const R = reporter('perf');
const ok = R.ok;

const seed = makeSeed();
// Manuscrito grande: 200 capítulos de ~1.200 palabras cada uno (~240k palabras).
const paragraphs = [];
for (let p = 0; p < 40; p++) {
  paragraphs.push(`Párrafo ${p} con treinta palabras de relleno para medir el rendimiento real del editor y del buscador global`);
}
const bigContent = paragraphs.map((t) => `<p>${t}.</p>`).join('');
const bigStory = seed.stories[0];
bigStory.chapters = [];
for (let i = 0; i < 200; i++) {
  bigStory.chapters.push({
    id: `ch-${i}`,
    title: `Capítulo ${i + 1}`,
    content: i % 7 === 0 ? bigContent : `<p>Capítulo ${i + 1}: ${bigContent.slice(0, 2000)}</p>`,
    status: i % 3 === 0 ? 'done' : 'draft',
  });
}
seed.activityLog = [];

const { w, errors } = makeApp({ seed });
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const d = w.document;
const byId = (id) => d.getElementById(id);

const toLocalKey = (daysAgo) => {
  const dt = new Date(Date.now() - daysAgo * 86400000);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const measure = (fn) => {
  const t0 = Date.now();
  const out = fn();
  return { ms: Date.now() - t0, out };
};

setTimeout(() => {
  const probe = w.__probe;

  // Contador de guardados reales hacia el proceso principal.
  let saveCalls = 0;
  probe('window.lorevinci.saveData = async () => { return { ok: true }; }');
  w.lorevinci.saveData = async () => { saveCalls += 1; return { ok: true }; };

  const boot = measure(() => probe('initApp()'));
  ok(`arranque con 200 capítulos es rápido (${boot.ms} ms)`, boot.ms < 2500, `${boot.ms} ms`);

  const openEditor = measure(() => probe(`openStoryEditor(DATA.stories[0].id)`));
  ok(`abrir el libro grande (${openEditor.ms} ms)`, openEditor.ms < 2500, `${openEditor.ms} ms`);

  const listRender = measure(() => probe('renderChapterList()'));
  ok(`render de la lista de 200 capítulos (${listRender.ms} ms)`, listRender.ms < 1500, `${listRender.ms} ms`);
  ok('la lista pinta todos los capítulos', d.querySelectorAll('#chapterList .chapter-item').length === 200);

  // ---- Conteo de palabras memoizado ----
  const firstCount = measure(() => probe('wordCount(DATA.stories[0].chapters[0].content)'));
  const secondCount = measure(() => probe('wordCount(DATA.stories[0].chapters[0].content)'));
  ok('wordCount devuelve el mismo resultado', firstCount.out === secondCount.out && firstCount.out > 300, `${firstCount.out} vs ${secondCount.out}`);
  ok('el segundo conteo del mismo capítulo no vuelve a parsear', secondCount.ms <= firstCount.ms, `${firstCount.ms} → ${secondCount.ms} ms`);

  const totalWords = measure(() => probe('totalWordsForStory(DATA.stories[0])'));
  ok(`total de palabras del libro (${totalWords.ms} ms)`, totalWords.ms < 1500 && totalWords.out > 50000, `${totalWords.out} palabras en ${totalWords.ms} ms`);
  const totalWords2 = measure(() => probe('totalWordsForStory(DATA.stories[0])'));
  ok(`recalcular el total del libro (${totalWords2.ms} ms)`, totalWords2.ms < 1500 && totalWords2.out === totalWords.out);

  // ---- Guardado con debounce: 50 pulsaciones = 1 escritura en disco ----
  probe('currentChapterId = "ch-1"; renderChapterContent()');
  const editor = byId('chapterEditor');
  for (let i = 0; i < 50; i++) {
    editor.innerHTML = `<p>Tecleo rápido número ${i} sobre el manuscrito.</p>`;
    editor.dispatchEvent(new w.Event('input'));
  }
  ok('ningún guardado síncrono mientras se teclea', saveCalls === 0, `saveCalls=${saveCalls}`);
  ok('el indicador pasa a "Guardando…"', byId('saveIndicatorText').textContent === 'Guardando…');
  return tick(700).then(() => {
    ok('50 pulsaciones producen un único guardado', saveCalls === 1, `saveCalls=${saveCalls}`);
    ok('el contenido final es el último tecleado', probe('getChapter(getStory(currentStoryId),currentChapterId).content').includes('número 49'));
    ok('el indicador vuelve a "Todo guardado"', byId('saveIndicatorText').textContent === 'Todo guardado');

    // ---- Escrituras en vuelo se encolan, no se apilan ----
    let resolveGate = null;
    let gatedCalls = 0;
    w.lorevinci.saveData = () => { gatedCalls += 1; return new Promise((res) => { resolveGate = res; }); };
    probe('scheduleSave()');
    return tick(500).then(() => {
      probe('scheduleSave()');
      probe('scheduleSave()');
      return tick(500);
    }).then(() => {
      ok('una sola escritura en vuelo a la vez', gatedCalls === 1, `gatedCalls=${gatedCalls}`);
      resolveGate({ ok: true });
      return tick(700);
    }).then(() => {
      ok('lo encolado se vuelca en una segunda escritura', gatedCalls === 2, `gatedCalls=${gatedCalls}`);
      if (resolveGate) resolveGate({ ok: true });
      return tick(700);
    }).then(() => {
      ok('no se acumulan escrituras adicionales', gatedCalls === 2, `gatedCalls=${gatedCalls}`);
      w.lorevinci.saveData = async () => { saveCalls += 1; return { ok: true }; };

      // ---- Índice de búsqueda perezoso ----
      probe('globalSearchIndex = []');
      const lazyBuild = measure(() => probe('buildSearchIndex()'));
      ok(`construir el índice de 200 capítulos (${lazyBuild.ms} ms)`, lazyBuild.ms < 3000, `${lazyBuild.ms} ms`);
      const searchRun = measure(() => probe('searchEverything("rendimiento real del editor")'));
      ok(`buscar en el manuscrito completo (${searchRun.ms} ms)`, searchRun.ms < 800 && searchRun.out.length > 0, `${searchRun.ms} ms`);
      const searchCached = measure(() => probe('searchEverything("rendimiento real del editor")'));
      ok('la segunda búsqueda usa el índice construido', searchCached.ms <= searchRun.ms + 5);

      // ---- Sanitizado de un capítulo grande ----
      const sanitizeRun = measure(() => probe('sanitizeHtml(DATA.stories[0].chapters[0].content)'));
      ok(`sanitizar 1.200 palabras (${sanitizeRun.ms} ms)`, sanitizeRun.ms < 2000, `${sanitizeRun.ms} ms`);

      // ---- Límites que impiden crecimiento sin tope ----
      probe('DATA.notifications = []');
      for (let i = 0; i < 200; i++) probe(`pushNotification('t${i}', 'x', 'info')`);
      ok('las notificaciones se recortan a 60', probe('DATA.notifications.length') === 60, String(probe('DATA.notifications.length')));
      ok('se conservan las más recientes', probe('DATA.notifications[0].title') === 't199');

      // La bitácora guarda un registro por día, de la fecha más reciente a la más
      // antigua, y se recorta por el extremo reciente (antes usaba slice(-60) y
      // borraba la actividad de hoy en cuanto el historial crecía).
      probe(`DATA.activityLog = Array.from({ length: 2000 }, (_, i) => ({ date: toLocalDateKey(new Date(Date.now() - i * 86400000)), words: 10 }))`);
      probe('logActivity(5)');
      ok('la bitácora se recorta al límite de historial', probe('DATA.activityLog.length') === 800, String(probe('DATA.activityLog.length')));
      ok('el recorte conserva la fecha más reciente', probe('DATA.activityLog[0].date') === probe('todayStr()'), probe('DATA.activityLog[0].date'));
      ok('el recorte conserva la más antigua permitida (no la de hace 5 años)', probe('DATA.activityLog[799].date') > toLocalKey(900));
      ok('logActivity acumula en el día actual sin duplicar entradas', probe('DATA.activityLog.filter(a => a.date === todayStr()).length') === 1);
      ok('la racha sobrevive al recorte del historial', probe('computeStreak()') > 100, String(probe('computeStreak()')));
      probe('DATA.activityLog = []');
      probe('logActivity(5); logActivity(7)');
      ok('dos incrementos del mismo día se suman en una entrada', probe('DATA.activityLog.length') === 1 && probe('DATA.activityLog[0].words') === 12);

      probe('currentChapterId = "ch-2"');
      for (let i = 0; i < 40; i++) {
        probe(`(function(){ const c = getChapter(getStory(currentStoryId), currentChapterId); c.content = '<p>Variante ${i} del capítulo con texto distinto.</p>'; saveChapterSnapshot(currentStoryId, currentChapterId, 'prueba'); })()`);
      }
      const snaps = probe('listChapterSnapshots()');
      ok('los snapshots se limitan a 12 versiones', snaps.length === 12, String(snaps.length));
      ok('el snapshot más reciente va primero', /Variante 39/.test(snaps[0].content));
      ok('snapshots idénticos consecutivos no duplican', probe('saveChapterSnapshot(currentStoryId, currentChapterId, "prueba")') === false);

      // ---- Render del panel de inicio con datos grandes ----
      const homeRender = measure(() => probe('showView("home")'));
      ok(`volver al inicio con 200 capítulos (${homeRender.ms} ms)`, homeRender.ms < 2000, `${homeRender.ms} ms`);
      const storiesRender = measure(() => probe('showView("stories")'));
      ok(`vista de biblioteca (${storiesRender.ms} ms)`, storiesRender.ms < 2000, `${storiesRender.ms} ms`);

      const runtime = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
      ok('sin errores de ejecución en rendimiento', runtime.length === 0, runtime.slice(0, 3).join(' | '));
      R.done();
    });
  });
}, 2600);
