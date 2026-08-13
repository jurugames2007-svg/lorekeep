// Regresión del núcleo: navegación, edición, configuración, filtros, seguridad.
const { makeApp, reporter } = require('./harness');
const { w, errors, click } = makeApp();
const R = reporter('core');

setTimeout(() => {
  const d = w.document, ok = R.ok, probe = w.__probe;

  ['home','stories','sources','characters','collab','stats','settings'].forEach(v => {
    probe(`showView("${v}")`);
    ok(`vista ${v} se activa`, d.getElementById('view-' + v).classList.contains('active'));
  });

  // Creación con estilo
  probe('showView("stories")'); click('newStoryBtn');
  d.getElementById('newStoryTitle').value = 'Mi Saga';
  d.getElementById('newStoryGenre').value = 'Shonen';
  d.getElementById('newStoryStyleRef').value = 'One Piece (Oda)';
  d.getElementById('newStyleNotes').value = 'humor y aventura';
  const n0 = probe('DATA.stories.length');
  click('createStoryBtn');
  ok('historia creada', probe('DATA.stories.length') === n0 + 1);
  const st = probe('DATA.stories[DATA.stories.length-1]');
  ok('estilo capturado al crear', st.style.reference === 'One Piece (Oda)');
  ok('cronología por defecto', !!st.chronology);

  // Editor
  const ed = d.getElementById('chapterEditor');
  ed.innerHTML = '<p>Primera frase del capítulo.</p>';
  ed.dispatchEvent(new w.Event('input'));
  ok('contenido guardado', probe('getChapter(getStory(currentStoryId),currentChapterId).content').includes('Primera frase'));
  click('addChapterBtn');
  ok('capítulo añadido', probe('getStory(currentStoryId).chapters.length') === 2);

  // Configurar
  probe('showView("stories")');
  const cards = d.querySelectorAll('#storyGrid .story-card');
  cards[cards.length - 1].querySelector('[data-act="configure"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('Configurar abre el modal', d.getElementById('storyConfigModalBackdrop').classList.contains('active'));
  ok('modal precargado', d.getElementById('cfgTitle').value === 'Mi Saga');
  ok('estilo precargado', d.getElementById('cfgStyleRef').value === 'One Piece (Oda)');
  d.querySelector('.config-tab[data-ctab="style"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('pestaña estilo activa', d.querySelector('.config-pane[data-cpane="style"]').classList.contains('active'));
  d.getElementById('cfgLoreBase').value = 'Lore extendido';
  click('cfgSaveBtn');
  ok('guarda loreBase', probe('DATA.stories[DATA.stories.length-1].loreBase') === 'Lore extendido');

  // Presupuesto adaptativo
  ok('ventana gpt-4o', probe('getModelContextWindow("gpt-4o")') === 128000);
  ok('ventana gpt-4', probe('getModelContextWindow("gpt-4")') === 8192);
  ok('ventana claude', probe('getModelContextWindow("claude-3-5-sonnet")') === 200000);
  ok('modelo desconocido conservador', probe('getModelContextWindow("xyz")') === 16000);
  const big = probe('computePromptBudget("gpt-4o")'), small = probe('computePromptBudget("gpt-4")');
  ok('modelo grande recibe más', big.inputChars > small.inputChars * 4);
  ok('tope duro respetado', probe('computePromptBudget("gemini-1.5-pro")').inputChars <= 115000);
  ok('fuentes > memoria > estilo', big.sourcesChars > big.memoryChars && big.memoryChars > big.styleChars);

  // Clasificación y filtros
  ok('clasifica canon', probe('classifyDocument("Manual Canon Oficial.pdf","canon oficial")').subtype === 'canon-oficial');
  ok('clasifica what-if', probe('classifyDocument("What If Universo Alterno.pdf","what if alterno")').subtype === 'what-if');
  ok('verso explícito', probe('classifyDocument("Cronologia [Verso: Universo 7].pdf","x")').verseLabel === 'Universo 7');
  ok('filtro por sub-tipo', probe(`sourceFilters={search:'',story:'all',subtype:'what-if',verse:'all',canon:'all'};applySourceFilters([{id:'a',name:'x',subtype:'what-if',content:''},{id:'b',name:'y',subtype:'fanfic',content:''}]).length`) === 1);
  ok('filtro por verso', probe(`sourceFilters={search:'',story:'all',subtype:'all',verse:'alterno',canon:'all'};applySourceFilters([{id:'a',name:'x',verse:'alterno',content:''},{id:'b',name:'y',verse:'canon-principal',content:''}]).length`) === 1);
  ok('filtro por canon', probe(`sourceFilters={search:'',story:'all',subtype:'all',verse:'all',canon:'primary'};applySourceFilters([{id:'a',name:'x',priorityLevel:'primary',content:''},{id:'b',name:'y',priorityLevel:'derived',content:''}]).length`) === 1);
  probe("sourceFilters={search:'',story:'all',subtype:'all',verse:'all',canon:'all'};");

  // Auditoría y utilidades
  ok('JSON con fences', probe('extractJsonObject("```json\\n{\\"a\\":1}\\n```").a') === 1);
  ok('JSON con coma colgante', probe('extractJsonObject(\'{"a":1,}\').a') === 1);
  ok('JSON inválido → null', probe('extractJsonObject("nada")') === null);
  ok('audita corte a media frase', probe('auditChapterLocally("Texto que se corta a media", DATA.stories[0], null)').issues.some(i => i.msg.includes('corte a media frase')));
  ok('audita fuga del asistente', probe('auditChapterLocally("Aquí tienes el capítulo: hola. ".repeat(30), DATA.stories[0], null)').issues.some(i => i.level === 'error'));
  ok('texto limpio sin incidencias', probe('auditChapterLocally("Frase completa que termina bien. ".repeat(80), DATA.stories[0], null)').issues.length === 0);

  // Seguridad
  const dirty = probe(`sanitizeHtml('<p onclick="alert(1)">hola</p><script>alert(2)<\\/script><img src=x onerror="alert(3)">')`);
  ok('XSS: script eliminado', !dirty.includes('<script'));
  ok('XSS: onclick eliminado', !/onclick/i.test(dirty));
  ok('XSS: onerror eliminado', !/onerror/i.test(dirty));
  ok('XSS: contenido conservado', dirty.includes('hola'));
  ok('dedupe por nombre', probe(`checkAndPreventDuplicateSource([{name:'a.pdf',content:'x'}],'a.pdf','y')`) === true);
  ok('dedupe permite nuevo', probe(`checkAndPreventDuplicateSource([{name:'a.pdf',content:'x'}],'b.pdf','otro texto largo distinto')`) === false);

  // OCR disponible como API
  ok('ocrIsAvailable definido', probe('typeof ocrIsAvailable') === 'function');
  ok('ocrPdfFile definido', probe('typeof ocrPdfFile') === 'function');
  ok('runOcrOnDoc definido', probe('typeof runOcrOnDoc') === 'function');
  ok('OCR ausente se reporta bien', probe('ocrIsAvailable()') === false);

  const runtime = errors.filter(e => !/Not implemented|Could not parse CSS/i.test(e));
  ok('sin errores de ejecución', runtime.length === 0, runtime.slice(0, 3).join(' | '));
  R.done();
}, 2500);
