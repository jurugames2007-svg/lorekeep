// Regresión de UX y lógica de negocio: deshacer/rehacer reales, inserción en el
// cursor, mensajes coherentes con los límites, búsqueda sobre el contenido,
// centro de actividad, racha en fecha local y borrado sin resurrección de la demo.
const { makeApp, makeSeed, reporter } = require('./harness');

const R = reporter('ux');
const ok = R.ok;
const seed = makeSeed();
seed.stories[0].chapters[0].content = '<p>Primera frase del capítulo.</p>';
seed.stories[0].chapters.push({ id: 'c2', title: 'Cap 2', content: '<p>Segundo capítulo con la palabra Esdrújula repetida. Esdrújula otra vez.</p>', status: 'draft' });
seed.stories[0].chapters.push({ id: 'c3', title: 'Cap 3', content: '', status: 'draft' });
seed.activityLog = [];

const { w, errors, click } = makeApp({ seed });
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const key = (k, opts = {}) => new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts));

setTimeout(() => {
  const d = w.document;
  const probe = w.__probe;
  const byId = (id) => d.getElementById(id);
  const editor = byId('chapterEditor');

  probe('showView("stories")');
  probe('openStoryEditor(DATA.stories[0].id)');

  // ---- Deshacer / rehacer reales ----
  ok('el historial arranca con el contenido actual', probe('editorHistory.entries.length') === 1);
  editor.innerHTML = '<p>Versión dos.</p>';
  editor.dispatchEvent(new w.Event('input'));
  probe('pushHistory(document.getElementById("chapterEditor").innerHTML)');
  ok('segundo punto de control registrado', probe('editorHistory.entries.length') === 2);
  editor.innerHTML = '<p>Versión tres.</p>';
  editor.dispatchEvent(new w.Event('input'));
  probe('pushHistory(document.getElementById("chapterEditor").innerHTML)');
  ok('tercer punto de control registrado', probe('editorHistory.entries.length') === 3);

  click('editorUndoBtn');
  ok('Ctrl+Z visible restaura la versión anterior', probe('getChapter(getStory(currentStoryId),currentChapterId).content') === '<p>Versión dos.</p>');
  ok('el DOM refleja el deshacer', editor.innerHTML.includes('Versión dos'));
  click('editorUndoBtn');
  ok('segundo deshacer vuelve a la versión inicial', editor.innerHTML.includes('Primera frase'));
  click('editorRedoBtn');
  ok('rehacer recupera la versión dos', editor.innerHTML.includes('Versión dos'));

  editor.focus();
  d.dispatchEvent(key('z', { ctrlKey: true }));
  ok('atajo Ctrl+Z sobre el editor deshace', editor.innerHTML.includes('Primera frase'));
  d.dispatchEvent(key('z', { ctrlKey: true, shiftKey: true }));
  ok('atajo Ctrl+Shift+Z rehace', editor.innerHTML.includes('Versión dos'));

  // El historial es por capítulo: cambiar de capítulo no mezcla versiones
  probe('currentChapterId = "c2"; renderChapterContent()');
  ok('cambiar de capítulo reinicia el historial', probe('editorHistory.entries.length') === 1 && editor.innerHTML.includes('Esdrújula'));
  probe('currentChapterId = DATA.stories[0].chapters[0].id; renderChapterContent()');
  ok('volver al capítulo anterior trae su propio contenido', editor.innerHTML.includes('Versión dos'));

  // ---- La sugerencia se inserta donde está el cursor ----
  probe('DATA.stories[0].assistantMode = "insert"');
  byId('rsbContent').setAttribute('data-suggestion', 'Párrafo sugerido por Muse.');
  editor.innerHTML = '<p>Inicio</p><p>Final</p>';
  const range = w.document.createRange();
  range.selectNodeContents(editor.querySelector('p'));
  range.collapse(false);
  const selection = w.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  click('applyRsbBtn');
  const afterInsert = editor.textContent;
  ok('la sugerencia entra en el capítulo', /Párrafo sugerido por Muse\./.test(afterInsert));
  ok('no se duplica el escape de HTML al insertar', !/&lt;|&amp;/.test(afterInsert));
  ok('la caja de sugerencia se cierra al aplicar', byId('realtimeSuggestionBox').style.display === 'none');

  // Muse: el texto entra como prosa, no como etiquetas visibles
  probe(`addMuseMessage('ai', 'Sugerencia de Muse con <i>énfasis</i>.', true)`);
  const museBtn = [...d.querySelectorAll('#museMessages .msg-actions button')].pop();
  museBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  // La IA nunca debe poder inyectar HTML en el capítulo: entra como texto escapado.
  ok('Muse no inyecta HTML vivo del modelo', !/<i>énfasis<\/i>/.test(editor.innerHTML));
  ok('el texto del modelo se conserva legible (etiquetas escapadas)', editor.innerHTML.includes('&lt;i&gt;') && /énfasis/.test(editor.textContent));
  ok('la inserción de Muse queda en el capítulo activo', probe('getChapter(getStory(currentStoryId),currentChapterId).content').includes('Muse'));

  // ---- Mensajes coherentes con los límites reales ----
  const toastText = probe(`(function(){ isFileTooLarge({ size: 31 * 1024 * 1024 }); return document.getElementById('lorevinciToast').textContent; })()`);
  ok('el aviso de tamaño cita el límite real (30 MB)', /30 MB/.test(toastText) && !/8MB|8 MB/.test(toastText), toastText);
  ok('30 MB exactos se aceptan', probe('isFileTooLarge({ size: 30 * 1024 * 1024 })') === false);

  // ---- Búsqueda dentro del contenido de los capítulos ----
  const search = byId('globalSearch');
  search.value = 'Esdrújula';
  search.dispatchEvent(new w.Event('input'));
  return tick(260).then(() => {
    const results = [...d.querySelectorAll('#searchResults .search-result-item')];
    ok('la búsqueda encuentra texto dentro de los capítulos', results.length > 0, String(results.length));
    ok('el resultado muestra el tipo y el contexto', /Capítulo/.test(results[0].textContent) && /Esdrújula/.test(results[0].textContent));
    ok('cada resultado es seleccionable por teclado (role=option)', results[0].getAttribute('role') === 'option');

    search.dispatchEvent(key('ArrowDown'));
    ok('flecha abajo mueve el cursor de resultados', probe('globalSearchCursor') >= 0);
    search.dispatchEvent(key('Escape'));
    ok('Escape cierra los resultados', !byId('searchResults').classList.contains('active'));

    search.value = 'Sugerido por Muse';
    search.dispatchEvent(new w.Event('input'));
    return tick(260);
  }).then(() => {
    ok('la búsqueda encuentra otra frase del cuerpo', d.querySelectorAll('#searchResults .search-result-item').length > 0);
    search.value = '';
    search.dispatchEvent(new w.Event('input'));

    // ---- Centro de actividad ----
    probe('pushNotification("Capítulo generado", "Capítulo 4: 1200 palabras.", "success")');
    ok('la campana muestra el contador de no leídas', byId('notifBtn').querySelector('.notif-badge') && byId('notifBtn').querySelector('.notif-badge').textContent === '1');
    ok('la campana anuncia cuántas hay sin leer', /1 sin leer/.test(byId('notifBtn').getAttribute('aria-label')));
    click('notifBtn');
    ok('el centro de actividad se abre', byId('notifPanel').dataset.open === '1');
    ok('lista la notificación con su texto', /Capítulo 4: 1200 palabras/.test(byId('notifList').textContent));
    return tick(700);
  }).then(() => {
    ok('abrir el centro marca como leídas', byId('notifBtn').querySelector('.notif-badge') === null);
    click('notifClearBtn');
    ok('vaciar deja la lista sin elementos', probe('DATA.notifications.length') === 0);

    // ---- Racha en fecha local, no UTC ----
    const localToday = probe('todayStr()');
    const expected = new Date();
    const manual = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
    ok('todayStr usa la fecha local', localToday === manual, `${localToday} vs ${manual}`);
    probe(`DATA.activityLog = [{ date: todayStr(), words: 100 }]`);
    ok('racha de 1 día con actividad hoy', probe('computeStreak()') === 1);
    probe(`(function(){ const d = new Date(); d.setDate(d.getDate()-1); DATA.activityLog.push({ date: toLocalDateKey(d), words: 50 }); })()`);
    ok('racha de 2 días con ayer registrado', probe('computeStreak()') === 2);
    probe(`DATA.activityLog = [{ date: toLocalDateKey(new Date(Date.now() - 5*86400000)), words: 50 }]`);
    ok('racha 0 cuando no hay actividad reciente', probe('computeStreak()') === 0);

    // ---- Meta diaria ----
    probe('DATA.settings.writingGoals = { dailyWords: 100 }');
    probe(`DATA.activityLog = [{ date: todayStr(), words: 40 }]`);
    probe('updateDailyGoalProgress()');
    ok('la meta diaria muestra el progreso', /40 de 100 palabras hoy \(40%\)/.test(byId('homeGoalText').textContent), byId('homeGoalText').textContent);
    ok('la barra refleja el porcentaje', byId('homeGoalFill').style.width === '40%');
    probe('DATA.settings.writingGoals = { dailyWords: 0 }');
    probe('updateDailyGoalProgress()');
    ok('meta 0 oculta la barra', byId('homeGoalBar').hidden === true);
    probe('DATA.settings.writingGoals = { dailyWords: 100 }');

    // ---- Borrar todo no resucita la demostración ----
    probe(`DATA = { settings: DATA.settings, stories: [], characters: [], collabNotes: [], activityLog: [], globalDocs: [], notifications: [] }`);
    return Promise.resolve(probe('initApp()'));
  }).then(() => tick(30)).then(() => {
    ok('tras borrar todo, la app queda vacía (sin demo re-inyectada)', probe('DATA.stories.length') === 0, String(probe('DATA.stories.length')));
    ok('los ajustes se conservan al borrar', probe('typeof DATA.settings.ai') === 'object');
    ok('la semilla queda marcada como ya vista', probe('DATA.settings.demoSeedSeen') === true);

    // ---- Atajos globales ----
    d.dispatchEvent(key('k', { ctrlKey: true }));
    ok('Ctrl+K lleva el foco a la búsqueda', d.activeElement === byId('globalSearch'));
    d.dispatchEvent(key('F1'));
    ok('F1 abre la guía de uso', byId('helpModalBackdrop').classList.contains('active'));
    d.dispatchEvent(key('Escape'));
    ok('Escape cierra la guía', !byId('helpModalBackdrop').classList.contains('active'));

    // ---- Estado de guardado ----
    probe(`window.lorevinci.saveData = async () => ({ ok: false, error: 'disco lleno' })`);
    return Promise.resolve(probe('persistNow()'));
  }).then(() => {
    ok('un fallo de guardado se hace visible', byId('saveIndicatorText').textContent === 'Sin guardar' && byId('saveIndicator').classList.contains('error'));
    ok('el fallo se anuncia por toast', /No se pudo guardar/.test(byId('lorevinciToast').textContent));
    probe('window.lorevinci.saveData = async () => ({ ok: true })');
    return Promise.resolve(probe('persistNow()'));
  }).then(() => {
    ok('al recuperarse vuelve a "Todo guardado"', byId('saveIndicatorText').textContent === 'Todo guardado');

    const runtime = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
    ok('sin errores de ejecución en UX', runtime.length === 0, runtime.slice(0, 3).join(' | '));
    R.done();
  });
}, 2600);
