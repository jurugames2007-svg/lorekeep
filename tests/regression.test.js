// Regresión de los defectos concretos corregidos en la auditoría:
//  · prosa del modelo → párrafos HTML válidos (sin <p></p>, sin doble escape)
//  · deduplicación de fuentes que EXPLICA el motivo y da una salida
//  · validación de imágenes por formato/cabecera/decodificación, no por nombre
//  · getChapter defensivo (arrancaba initApp con TypeError)
//  · avisos de variantes de personaje usando el índice O(1)
//  · clasificación de verso tras limpiar escapes innecesarios
const { makeApp, makeSeed, reporter } = require('./harness');

const R = reporter('regression');
const ok = R.ok;

const seed = makeSeed();
seed.stories[0].chapters = [{ id: 'c1', title: 'Cap 1', content: '<p>Apertura.</p>', status: 'draft' }];
seed.characters = [
  { id: 'k1', storyId: 's1', name: 'Mara', variantLabel: 'Mara del verso A', role: 'protagonista', description: '', knowledge: '', traits: [] },
  { id: 'k2', storyId: 's1', name: 'Mara', variantLabel: 'Mara del verso B', role: 'antagonista', description: '', knowledge: '', traits: [] },
  { id: 'k3', storyId: 's1', name: 'Iris', variantLabel: 'Iris', role: 'mentora', description: '', knowledge: '', traits: [] },
];
seed.activityLog = [];

// PNG real de 1x1 y archivos con el MIME mentiroso. Se usan File reales del
// entorno jsdom para que FileReader pueda leerlos de verdad.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+p7RLAAAAAElFTkSuQmCC';
const PNG_BYTES = Uint8Array.from(Buffer.from(PNG_B64, 'base64'));
const textBytes = (text) => Uint8Array.from(Buffer.from(text, 'utf8'));
let makeFile = null; // se asigna cuando existe la ventana jsdom

const { w, errors } = makeApp({ seed });
makeFile = (bytes, name, type) => new w.File([bytes], name, { type });
const d = w.document;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
// w.__probe ya envuelve el código en eval dentro del ámbito de la app: con una
// IIFE asíncrona podemos awaitear funciones async del renderer desde Node.
const probeAsync = (code) => w.__probe(`(async () => { ${code} })()`);

setTimeout(async () => {
  const probe = w.__probe;

  // ---------- getChapter defensivo (era TypeError en initApp) ----------
  ok('getChapter sin libro abierto no revienta', probe('getChapter(undefined, "x")') === undefined);
  ok('getChapter con libro sin capítulos no revienta', probe('getChapter({}, "x")') === undefined);
  ok('initApp completó sin errores', !errors.some((e) => /Cannot read properties of undefined/.test(e)), errors.slice(0, 2).join(' | '));

  // ---------- Prosa → párrafos ----------
  const html = probe(`prosaToParagraphs('Capítulo 3: El regreso\\n\\nPrimer párrafo.\\nSegunda línea del mismo párrafo.\\n\\n\\nSegundo párrafo con <b>etiqueta</b> y & ampersand.\\n\\n   \\n\\nTercer párrafo.')`);
  ok('cada bloque separado por línea en blanco es un párrafo', (html.match(/<p>/g) || []).length === 3, html);
  ok('no se generan párrafos vacíos', !/<p>\s*<\/p>/.test(html));
  ok('el salto de línea suelto se conserva como <br>', html.includes('Primer párrafo.<br>Segunda línea'));
  ok('el HTML del modelo se escapa una sola vez', html.includes('&lt;b&gt;etiqueta&lt;/b&gt;') && !html.includes('&amp;lt;'), html);
  ok('los ampersands no se duplican', html.includes('&amp; ampersand') && !html.includes('&amp;amp;'));
  ok('el encabezado "Capítulo N:" no entra al cuerpo', !/Capítulo 3/.test(html));
  ok('párrafos de solo espacios se descartan', !/<p>(?:\s|<br>)*<\/p>/.test(html), html);
  ok('texto vacío produce HTML vacío', probe(`prosaToParagraphs('')`) === '');
  ok('texto de una sola línea produce un párrafo', probe(`prosaToParagraphs('Solo una línea.')`) === '<p>Solo una línea.</p>');

  ok('quita encabezado con dos puntos', probe(`stripGeneratedChapterHeading('Capítulo 12: La caída\\n\\nEl resto.')`) === 'El resto.');
  ok('quita encabezado en markdown', probe(`stripGeneratedChapterHeading('**Capítulo 12**\\nEl resto.')`) === 'El resto.');
  ok('no toca un párrafo que empieza con otra cosa', probe(`stripGeneratedChapterHeading('Capitán, dijo.\\n\\nSigue.')`) === 'Capitán, dijo.\n\nSigue.');

  // Flujo real de generación: el capítulo guardado debe ser HTML de párrafos limpio.
  w.lorevinci.aiGenerate = async () => ({
    ok: true,
    truncated: false,
    usage: { promptTokens: 100, completionTokens: 400, totalTokens: 500 },
    text: 'Capítulo 9: Título repetido\n\n' + ('Mara cruzó el puente de eco mientras el alba teñía los reinos y respiraba hondo. '.repeat(30)) + '\n\n—No hay vuelta atrás —dijo Iris.\n\nLa puerta se abrió sola.'
  });
  probe(`DATA.settings.ai.apiKey = 'sk-' + 'x'.repeat(40); DATA.settings.ai.model = 'gpt-4o'; DATA.settings.ai.verifiedAt = Date.now();`);
  probe('showView("stories")');
  probe('openStoryEditor(DATA.stories[0].id)');
  d.getElementById('openAutoBookModalBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('autoBookCount').value = '1';
  d.getElementById('autoBookPlanning').checked = false;
  d.getElementById('startAutoBookBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick(3500);

  const generated = probe('DATA.stories[0].chapters[DATA.stories[0].chapters.length - 1]');
  ok('el flujo guardó un capítulo nuevo', Boolean(generated) && generated.content.length > 200);
  ok('el capítulo generado son párrafos <p>', /^<p>/.test(generated.content) && /<\/p>$/.test(generated.content), generated.content.slice(0, 80));
  ok('el capítulo generado no tiene párrafos vacíos', !/<p>\s*<\/p>/.test(generated.content));
  ok('el diálogo en línea aparte se conserva', generated.content.includes('—No hay vuelta atrás —dijo Iris.'));
  ok('el modelo no cuela su encabezado en el cuerpo', !/Capítulo 9: Título repetido/.test(generated.content));

  // ---------- Deduplicación con explicación ----------
  const list = [{ id: 'd1', name: 'Canon.pdf', content: 'x'.repeat(900) }];
  const identical = probe(`findDuplicateSource(${JSON.stringify(list)}, 'Canon.pdf', ${JSON.stringify('x'.repeat(900))})`);
  ok('duplicado idéntico reporta motivo "identical"', identical && identical.reason === 'identical');
  const sameName = probe(`findDuplicateSource(${JSON.stringify(list)}, 'Canon.pdf', 'contenido totalmente distinto')`);
  ok('mismo nombre con otro contenido reporta "same-name"', sameName && sameName.reason === 'same-name');
  const sameContent = probe(`findDuplicateSource(${JSON.stringify(list)}, 'Otro nombre.pdf', ${JSON.stringify('x'.repeat(900))})`);
  ok('mismo contenido con otro nombre reporta "same-content"', sameContent && sameContent.reason === 'same-content');
  ok('documento nuevo no se marca como duplicado', probe(`findDuplicateSource(${JSON.stringify(list)}, 'Nuevo.pdf', 'texto fresco y distinto')`) === null);
  ok('lista vacía nunca duplica', probe("findDuplicateSource([], 'a.pdf', 'b')") === null);
  ok('el contrato booleano histórico sigue funcionando', probe(`checkAndPreventDuplicateSource(${JSON.stringify(list)}, 'Canon.pdf', 'x')`) === true);

  const msgName = probe(`duplicateSourceMessage(findDuplicateSource(${JSON.stringify(list)}, 'Canon.pdf', 'otro'), 'Canon.pdf')`);
  ok('el mensaje por mismo nombre dice qué archivo chocó', /Canon\.pdf/.test(msgName), msgName);
  ok('el mensaje por mismo nombre da una salida (renombrar)', /Renómbrala/.test(msgName), msgName);
  const msgSame = probe(`duplicateSourceMessage(findDuplicateSource(${JSON.stringify(list)}, 'Otro.pdf', ${JSON.stringify('x'.repeat(900))}), 'Otro.pdf')`);
  ok('el mensaje por mismo contenido explica que el texto ya existe', /contenido es el mismo/.test(msgSame), msgSame);
  const msgId = probe(`duplicateSourceMessage(findDuplicateSource(${JSON.stringify(list)}, 'Canon.pdf', ${JSON.stringify('x'.repeat(900))}), 'Canon.pdf')`);
  ok('el mensaje idéntico no habla de "deduplicación activa"', /mismo nombre y contenido/.test(msgId) && !/deduplicación activa/.test(msgId), msgId);

  // ---------- Validación de imágenes ----------
  const toastText = () => d.getElementById('lorevinciToast').textContent;

  const svg = makeFile(textBytes('<svg onload="alert(1)"></svg>'), 'icono.svg', 'image/svg+xml');
  w.__svg = svg;
  const svgOk = await probeAsync('return await validateImageContentSafety(window.__svg, "portada")');
  ok('SVG no pasa la validación', svgOk === false);
  ok('el rechazo de SVG explica el motivo real', /SVG/.test(toastText()), toastText());

  const htmlFile = makeFile(textBytes('<script>alert(1)</' + 'script>'), 'foto.png', 'text/html');
  w.__htmlFile = htmlFile;
  ok('un HTML disfrazado no pasa por imagen', (await probeAsync('return await validateImageContentSafety(window.__htmlFile, "foto de perfil")')) === false);

  // PNG real al que se le declara un tamaño de 40 MB: el control de peso debe saltar.
  const huge = makeFile(PNG_BYTES, 'grande.png', 'image/png');
  Object.defineProperty(huge, 'size', { value: 40 * 1024 * 1024 });
  w.__huge = huge;
  ok('imagen de 40 MB rechazada', (await probeAsync('return await validateImageContentSafety(window.__huge, "portada")')) === false);
  ok('el rechazo por tamaño cita el límite de imagen', /12 MB/.test(toastText()), toastText());

  const liar = makeFile(textBytes('GIF89a no, en realidad texto plano'), 'mentiroso.png', 'image/png');
  w.__liar = liar;
  ok('cabecera que no coincide con el MIME se rechaza', (await probeAsync('return await validateImageContentSafety(window.__liar, "portada")')) === false);
  ok('el mensaje habla de la cabecera, no del nombre del archivo', /cabecera/.test(toastText()), toastText());

  const good = makeFile(PNG_BYTES, 'retrato.png', 'image/png');
  w.__good = good;
  ok('un PNG real pasa la validación', (await probeAsync('return await validateImageContentSafety(window.__good, "foto de perfil")')) === true);
  ok('la validación entrega el data URL ya verificado', typeof w.__good.__safeDataUrl === 'string' && w.__good.__safeDataUrl.startsWith('data:image/png;base64,'));

  // Bytes JPEG reales con el alias de familia image/jpg (no image/jpeg).
  const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  const alias = makeFile(jpegBytes, 'viejo.jpg', 'image/jpg');
  w.__alias = alias;
  ok('un alias de familia (image/jpg) se acepta como JPEG', (await probeAsync('return await validateImageContentSafety(window.__alias, "portada")')) === true, toastText());

  const bmpAsPng = makeFile(Uint8Array.from([0x42, 0x4d, 1, 2, 3, 4, 5, 6]), 'mentira.png', 'image/png');
  w.__bmpAsPng = bmpAsPng;
  ok('un BMP declarado como PNG se rechaza', (await probeAsync('return await validateImageContentSafety(window.__bmpAsPng, "portada")')) === false);
  ok('el rechazo por familia explica los dos formatos', /image\/png/.test(toastText()) && /image\/bmp/.test(toastText()), toastText());

  // El filtro YA NO decide por palabras del nombre del archivo.
  const innocent = makeFile(PNG_BYTES, 'nsfw-broma-de-mal-gusto.png', 'image/png');
  w.__innocent = innocent;
  ok('una imagen válida no se rechaza por las palabras de su nombre', (await probeAsync('return await validateImageContentSafety(window.__innocent, "portada")')) === true);
  ok('el mensaje de éxito no promete un filtro de contenido inexistente', !/NSFW|contenido seguro/i.test(toastText()), toastText());

  // ---------- Variantes de personaje: mismo aviso, con índice O(1) ----------
  probe('rebuildNarrativeIndexes()');
  const warnings = probe('findNarrativeWarnings(DATA.stories[0])');
  ok('avisa cuando un nombre base tiene varias variantes', warnings.length === 1 && /mara/.test(warnings[0]), JSON.stringify(warnings));
  ok('el aviso indica cuántas variantes hay', /2 variantes/.test(warnings[0] || ''), warnings[0]);
  ok('un nombre sin variantes no genera aviso', !/iris/.test((warnings[0] || '').toLowerCase()));
  ok('getCharacterVariant devuelve null ante ambigüedad', probe(`getCharacterVariant('s1', 'mara')`) === null);
  ok('getCharacterVariant resuelve una variante única', Boolean(probe(`getCharacterVariant('s1', 'iris')`)));
  ok('getCharacterVariant resuelve por etiqueta de variante', Boolean(probe(`getCharacterVariant('s1', 'Mara del verso A')`)));

  // ---------- Clasificación de verso (regex sin escapes inútiles) ----------
  const verseDoc = probe(`classifyDocument('Canon [Universo 7].pdf', 'Contenido del canon del universo siete con suficiente texto para clasificar correctamente.')`);
  ok('detecta el verso entre corchetes', String((verseDoc && verseDoc.verse) || '').trim() === '7', JSON.stringify(verseDoc && verseDoc.verse));
  const verseParen = probe(`classifyDocument('Manual (Verso: Alfa).pdf', 'Contenido del manual del verso alfa con texto suficiente para la clasificación.')`);
  ok('detecta el verso entre paréntesis', /alfa/i.test(String((verseParen && verseParen.verse) || '')), JSON.stringify(verseParen && verseParen.verse));

  const runtime = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
  ok('sin errores de ejecución en la regresión', runtime.length === 0, runtime.slice(0, 3).join(' | '));
  R.done();
}, 2600);
