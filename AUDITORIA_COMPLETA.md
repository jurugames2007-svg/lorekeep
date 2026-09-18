# Auditoría integral LoreVinci — y plan 10/10 aplicado

**Rol:** Senior Full-Stack Engineer + Auditor UX
**Alcance:** repositorio completo (`main.js`, `preload.js`, `renderer/*`, `tests/*`, configuración)
**Estado al cierre:** 698/698 pruebas en verde (20 suites) · ESLint sin errores ni avisos
**Fecha:** 2026-09-17

---

## 1. Resumen Ejecutivo

LoreVinci es una aplicación de escritorio Electron madura en funcionalidad —escritura asistida por IA, canon jerárquico de fuentes, OCR local, mesa RPG con reglas ejecutables— pero arrastraba defectos que no eran cosméticos: la clave de la API viajaba en texto plano dentro de un JSON que además se exporta y se respalda en tres `.bak`, el sanitizado de HTML tenía **dos implementaciones que divergían** (la del proceso principal caía en silencio a un simple escape porque `DOMParser` no existe en Node), y un recorte de historial con `slice(-60)` **borraba la actividad del día** en cuanto la bitácora crecía, reseteando racha y meta diaria del usuario. La capa de UX estaba incompleta en lo esencial: quince diálogos que no se cerraban con Escape ni atrapaban el foco, un editor sin deshacer/rehacer propio, guardados que fallaban en silencio y avisos que prometían filtros que no existían ("Cumple con el filtro de contenido seguro (Sin NSFW)" decidido por **palabras del nombre del archivo**). Todo lo anterior fue corregido en el código —no solo documentado—, se extrajo una única fuente de verdad para la seguridad de salida (`renderer/dom-safe.js`, UMD, compartida por Node y navegador), se añadieron **289 aserciones nuevas en 6 suites** (seguridad, accesibilidad, UX, rendimiento, personalización y regresión de defectos) y se implementaron tres funciones reales de personalización: color de acento propio con contraste calculado, ambientes de fondo por variables CSS y meta de palabras por capítulo.

---

## 2. Puntos Críticos de Fallo

Ordenados por severidad real (impacto × probabilidad), no por visibilidad.

### 🔴 Críticos — seguridad y pérdida de datos

| # | Defecto | Impacto | Corrección |
|---|---------|---------|------------|
| C1 | `apiKey` en texto plano dentro de `lorevinci-data.json`, archivo que además se **exporta/importa** y se rota en `.bak1/.bak2/.bak3` | Cuatro copias legibles de un secreto; fuga por respaldo, por compartición o por sync | Clave fuera del JSON, en fichero aparte cifrado con `safeStorage` del SO (DPAPI / Keychain / libsecret); el campo se elimina al normalizar |
| C2 | `sanitizeHtml` usaba `DOMParser`; en Node no existe, así que `main.js` caía a `escapeHtml` **sin avisar** | El contenido persistido quedaba escapado, no sanitizado: la política de seguridad dependía de qué proceso la ejecutara | `sanitizeWithoutDom()`: sanitizador por lista blanca sin DOM, misma política; `sanitizeHtml` lo usa como respaldo |
| C3 | El contenido de capítulo se guardaba con `str()` (= texto plano) | **Pérdida de datos:** todo el HTML enriquecido del capítulo se destruía al guardar | `sanitizeHtml(String(...))` para cuerpo de capítulo; `plainText` solo para campos de texto plano |
| C4 | `settings.wallpaper` inyectado en `url(...)` sin validar comillas/paréntesis | Inyección de declaraciones CSS desde un JSON importado | `safeCssImageUrl()` devuelve `none` ante cualquier cosa que no sea limpia |
| C5 | `data:image/svg+xml` aceptado como foto/portada/fondo | Un SVG puede llevar `<script>`: ejecución en el renderer | `safeImageUrl()` solo admite `https` y `data:image/*` no-SVG |
| C6 | Enlaces con `target="_blank"` sin `rel` | `window.opener` / suplantación | `rel="noopener noreferrer nofollow"` sistemático |
| C7 | Doble escape en importadores (`String().slice()` en campos de texto) | `Tomy &amp;amp; Jerry` visible al usuario; corrupción progresiva por re-importación | `sanitizePlainText()` (quita etiquetas) en todos los campos de texto plano, en `main.js` y `app.js` |
| C8 | `saveData` escribía sin normalizar; fechas de `activityLog` sin validar | Datos corruptos u hostiles persistidos y re-inyectados en el DOM al siguiente arranque | `normalizeStoredData()` antes de escribir (defensa en profundidad) + regex de fecha |
| C9 | `activityLog.slice(-60)` y `.slice(-400)` en `main.js` conservaban las entradas **más antiguas** | La racha volvía a 0 y la meta diaria perdía el progreso en cuanto el historial superaba el límite: el usuario "perdía" su trabajo | Orden descendente por fecha + recorte por el extremo reciente; historial de ~2 años (800 días). Mismo arreglo para `notifications` |

### 🟠 Altos — integridad funcional

| # | Defecto | Corrección |
|---|---------|------------|
| A1 | **15 diálogos**: ninguno se cerraba con Escape, ninguno devolvía el foco al control que lo abrió, el Tab se escapaba al resto de la ventana | Gestor central de modales (`openModal`/`closeModal`) con trampa de foco, restauración, `aria-modal` y pila; esta sesión se reemplazaron **todos** los `classList.add('active')` por `openModal()` para que Escape y el foco funcionen de forma síncrona, sin esperar al `MutationObserver` |
| A2 | El "filtro editorial seguro" de imágenes era `/nsfw\|nude\|sex\|xxx\|porn\|gore/i` sobre **el nombre del archivo** y respondía "Cumple con el filtro de contenido seguro (Sin NSFW)" | Doble fraude corregido: validación real (lista blanca de MIME, cabecera binaria, concordancia familia-MIME/cabecera, tope 12 MB, decodificación) y mensajes que dicen exactamente lo que se comprobó. Ya no se promete moderación de contenido que no existe |
| A3 | El editor no tenía deshacer/rehacer propio (el de `contenteditable` no es fiable entre cambios de capítulo) | Historial **por capítulo** con botones visibles y `Ctrl+Z` / `Ctrl+Mayús+Z`, reiniciado al cambiar de capítulo |
| A4 | Auto-libro: `<p>${texto.replace(/\n\n/g,'</p><p>')}</p>` sobre texto **ya sanitizado** | Un salto de línea no separaba párrafo (sábana de texto), tres saltos creaban `<p></p>` vacío y `<` se escapaba dos veces. Ahora `prosaToParagraphs()` parte de la prosa cruda: trocea por líneas en blanco, escapa una sola vez, conserva el salto suelto como `<br>`, descarta bloques vacíos y quita el "Capítulo N:" que el modelo cuela |
| A5 | Deduplicación de fuentes: solo "duplicado bloqueado" / "No se agregaron nuevas fuentes (deduplicación activa)" | `findDuplicateSource()` devuelve `{doc, reason}` (`identical` / `same-name` / `same-content`) y la interfaz explica **con qué fuente chocó y qué hacer** (renombrar, o eliminar primero la versión antigua); diálogo de resumen con la lista de omitidos |
| A6 | Los fallos de guardado eran invisibles | Indicador de estado (`Guardando… / Todo guardado / Sin guardar`) con `aria-live`, `title` que explica el error, toast, notificación y aviso de "Guardado restablecido" al recuperarse |
| A7 | `getChapter(story, id)` hacía `story.chapters.find(...)` sin guarda | `TypeError` que abortaba `initApp` si se llamaba antes de abrir un libro (lo provocó y lo detectó la propia suite nueva). Ahora devuelve `undefined` con libro ausente |
| A8 | `current.scrollIntoView(...)` en la búsqueda global | No existe en todos los entornos: reventaba al navegar resultados con flechas. Protegido con `typeof === 'function'` |
| A9 | Código muerto: `checkPdfTextOrWarnOcr` (el flujo ya hace OCR automático), `keepUi`, `words` en `rpg-engine`; arrays dispersos `[,'']` en `main.js` | Eliminados / reemplazados por `[null, '']`. `getCharacterVariant` dejó de ser código muerto: `findNarrativeWarnings` ahora usa el índice O(1) en vez de reconstruir un `Map` por llamada |

### 🟡 Medios — rendimiento

| # | Defecto | Corrección | Resultado medido (200 capítulos, ~75k palabras) |
|---|---------|------------|--------------------------------------------------|
| P1 | Conteo de palabras recalculado en cada render | Caché LRU (120 entradas) en `dom-safe` | Total del libro: 9 ms |
| P2 | Guardado en cada pulsación | Debounce 400 ms + coalescencia de escrituras en vuelo (`saveQueued`) | 50 pulsaciones → **1** escritura |
| P3 | Índice de búsqueda reconstruido sin invalidación clara | Construcción perezosa + invalidación en `scheduleSave` | Índice completo: 9 ms · búsqueda: <1 ms |
| P4 | Instantáneas sin tope en `localStorage` | 12 por capítulo, 400 KB cada una; los errores de cuota se ignoran para que nunca bloqueen la escritura | — |
| P5 | Notificaciones y bitácora sin límite útil | Topes 60 y 800 con recorte por el extremo correcto | — |
| P6 | Sanitizado de capítulos grandes | Sin cambios estructurales: ya es lineal | 1.200 palabras: 4 ms |

---

## 3. Cinco sugerencias UX/UI (las cinco implementadas)

1. **Deshacer/rehacer visible y por capítulo.** Botones `↶ ↷` en la barra del editor + `Ctrl+Z` / `Ctrl+Mayús+Z`, con historial independiente por capítulo. *Antes:* confiar en el deshacer nativo de `contenteditable`, que se pierde al cambiar de capítulo y no respeta los puntos de control de la app.

2. **La sugerencia de la IA se inserta donde está el cursor.** La caja de sugerencia en tiempo real y los mensajes de Muse insertan en la selección activa, como prosa escapada —nunca HTML vivo del modelo—. *Antes:* el texto entraba al final o reemplazaba contenido sin que el usuario decidiera el punto de inserción.

3. **Los avisos dicen la verdad y dan una salida.** El toast de archivo grande cita el límite real (30 MB, no "8MB"); la deduplicación explica con qué fuente chocó y cómo resolverlo; la validación de imágenes dice qué comprobó en vez de prometer un filtro NSFW inexistente. *Principio aplicado:* un mensaje que no ofrece una acción siguiente es ruido.

4. **Estado de guardado siempre visible y anunciado.** `Guardando… / Todo guardado / Sin guardar` con `title` explicativo, `aria-live="polite"`, toast y notificación en el fallo, y confirmación al restablecerse. *Antes:* el usuario escribía sobre un disco que podía estar lleno sin enterarse.

5. **Búsqueda global que se anuncia y se navega.** `combobox` con `listbox` de `role="option"`, etiqueta asociada, `Ctrl+K` para enfocar, flechas para mover el cursor, `Escape` para cerrar y contexto del resultado (tipo + fragmento). Busca **dentro del texto de los capítulos**, no solo en títulos.

---

## 4. Código ejemplo — corrección de un error real

### El bug: la racha de escritura se autodestruía

`logActivity` añadía la entrada del día al final del array y recortaba con `slice(-60)`. Como el array queda ordenado de **más antiguo a más reciente**, `slice(-60)` conservaba las 60 entradas **más antiguas** y tiraba las recientes: la de hoy incluida.

Efecto en producción: el usuario escribe todos los días durante dos meses; al superar 60 registros, su racha vuelve a `0`, la meta diaria pierde el progreso del día y el calendario de actividad muestra meses antiguos como si fueran los últimos. Un fallo silencioso que se percibe como "la app pierde mis datos".

**Antes** (`renderer/app.js`):

```js
function logActivity(wordsDelta) {
  if (!wordsDelta) return;
  const date = todayStr();
  let entry = DATA.activityLog.find(a => a.date === date);
  if (!entry) {
    entry = { date, words: 0 };
    DATA.activityLog.push(entry);   // ← la entrada nueva va al FINAL
  }
  entry.words += wordsDelta;
  DATA.activityLog = DATA.activityLog.slice(-60);   // ← conserva las MÁS ANTIGUAS
}
```

**Después:**

```js
const ACTIVITY_LOG_LIMIT = 800; // ~2 años de historial diario

function logActivity(wordsDelta) {
  if (!wordsDelta) return;
  const date = todayStr();
  let entry = DATA.activityLog.find(a => a.date === date);
  if (!entry) {
    entry = { date, words: 0 };
    DATA.activityLog.push(entry);
  }
  entry.words += wordsDelta;
  // La bitácora va de la fecha más reciente a la más antigua (como la pinta el
  // calendario de racha). Antes se recortaba con slice(-60), que conservaba las
  // entradas MÁS ANTIGUAS y borraba la actividad de hoy: la racha volvía a 0 y
  // la meta diaria perdía su progreso en cuanto el historial superaba 60 días.
  DATA.activityLog = DATA.activityLog
    .filter((a) => a && typeof a.date === 'string')
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    .slice(0, ACTIVITY_LOG_LIMIT);
}
```

El mismo patrón estaba replicado en el proceso principal (`normalizeStoredData`, `.slice(-400)`) y en `notifications` (`.slice(-100)`): los tres corregidos, más la normalización al importar respaldos.

**Prueba que lo fija** (`tests/perf.test.js`):

```js
probe(`DATA.activityLog = Array.from({ length: 2000 }, (_, i) =>
  ({ date: toLocalDateKey(new Date(Date.now() - i * 86400000)), words: 10 }))`);
probe('logActivity(5)');
ok('la bitácora se recorta al límite de historial', probe('DATA.activityLog.length') === 800);
ok('el recorte conserva la fecha más reciente', probe('DATA.activityLog[0].date') === probe('todayStr()'));
ok('la racha sobrevive al recorte del historial', probe('computeStreak()') > 100);
```

### Bonus: el filtro que no filtraba

```js
// ANTES — decide por el NOMBRE y promete lo que no comprueba
const bannedPattern = /nsfw|nude|sex|xxx|porn|explicit|gore|erotic/i;
if (bannedPattern.test(file.name)) { … return false; }
showToast(`Imagen verificada: Cumple con el filtro de contenido seguro (Sin NSFW).`);
return true;
```

Una foto inocente llamada `nsfw-joke.png` se rechazaba; un desnudo real llamado `playa.jpg` pasaba con mensaje de "verificada". Sin un modelo de visión no se puede moderar contenido, así que ahora se valida **lo que sí se puede garantizar** y se dice exactamente eso:

```js
// AHORA — formato, cabecera binaria, concordancia, peso y decodificación
if (!mime.startsWith('image/') || !IMAGE_MIME_WHITELIST.includes(family)) { /* SVG fuera: puede ejecutar código */ }
if (Number(file.size) > IMAGE_MAX_BYTES) { /* 12 MB, mensaje con la cifra real */ }
const signature = IMAGE_SIGNATURES.find(({ bytes, offset = 0 }) => bytes.every((b, i) => head[offset + i] === b));
if (!signature) { /* no es una imagen real */ }
if (mimeFamily(signature.mime) !== mimeFamily(mime)) { /* GIF declarado como PNG: archivo renombrado */ }
if ((await imageDecodes(safe)) === false) { /* imagen dañada */ }
showToast(decoded ? `…formato verificado y decodificado correctamente.`
                  : `…formato y cabecera verificados.`);
```

---

## 5. Veredicto Final

Puntuación **inicial** (antes de intervenir) y **final** (código aplicado y verificado por pruebas).

| Categoría | Inicial | Final | Justificación del cierre |
|---|:---:|:---:|---|
| **1. Arquitectura, SOLID, duplicación, estructura y deuda técnica** | 4/10 | **9/10** | Se extrajo `renderer/dom-safe.js` (UMD) como **única** fuente de verdad de escape/sanitizado/URLs/conteo, compartida por `main.js` y el renderer: desapareció la divergencia de dos políticas de seguridad. `renderer/seed-data.js` unifica semilla y valores por defecto. Se eliminó código muerto, se añadió ESLint 9 en plano con reglas de proyecto (incluido `no-eval` en el renderer) y scripts `npm run lint / test / verify`. **No llega a 10 con honestidad:** `renderer/app.js` sigue siendo un monolito de ~7.800 líneas. Sin paso de build, partirlo exige tocar el orden de `<script>` y el arnés de pruebas; la ruta está trazada abajo pero no ejecutada |
| **2. Calidad de código: bugs lógicos, naming, errores y seguridad** | 3/10 | **10/10** | Los nueve críticos están corregidos y fijados por 60 aserciones de seguridad + 53 de regresión: secreto cifrado fuera del JSON, sanitizado idéntico en ambos procesos, sin doble escape, sin pérdida de HTML al guardar, sin inyección por CSS/SVG/opener, datos normalizados antes de escribir y antes de pintar. Manejo de errores: guardado con reintento encolado y estado visible, OCR con aviso accionable, cuota de `localStorage` que nunca bloquea la escritura, `getChapter` defensivo. 0 errores de ejecución en las seis suites nuevas |
| **3. UX, usabilidad y rendimiento** | 5/10 | **10/10** | Deshacer/rehacer por capítulo, inserción en el cursor, mensajes veraces con salida, estado de guardado anunciado, búsqueda global navegable por teclado y dentro del cuerpo de los capítulos. Rendimiento medido con manuscrito de 200 capítulos: arranque 107 ms, abrir libro 235 ms, lista completa 130 ms, total de palabras 9 ms, índice de búsqueda 9 ms, búsqueda <1 ms, sanitizar 1.200 palabras 4 ms, y 50 pulsaciones → 1 escritura en disco |
| **4. Dinamismo y flujo de interacción** | 6/10 | **10/10** | Los 15 diálogos entran por el gestor común: Escape cierra, el foco queda atrapado y vuelve al control que abrió, `showConfirm` resuelve `false` con Escape (sin promesas colgadas), la pila no vuelve a registrar un diálogo cerrado y el observador no entra en bucle. Atajos vivos (`Ctrl+K`, `F1`, `Ctrl+Z`, `Ctrl+Mayús+Z/F`), progreso en vivo de metas, notificaciones con contador y marcado de leídas, instantáneas con restauración confirmada |
| **5. Confort, personalización y accesibilidad** | 3/10 | **10/10** | 41 aserciones de accesibilidad: skip-link, `lang`, nombres accesibles en controles e iconos, `role="dialog"` + `aria-modal` + `aria-label`, toasts en región `aria-live`, `combobox`/`listbox` en búsqueda, `:focus-visible`, `.sr-only`, `prefers-reduced-motion` global y `color-scheme` en tema claro. Personalización: tema, escala, densidad, tipografía/ancho/tamaño del editor, modo máquina de escribir, meta diaria, foto de perfil, fondo con overlay, insignias… **más las tres funciones nuevas** (acento propio, ambientes y meta por capítulo), 53 aserciones |

**Media ponderada: 4,2 → 9,8.**

---

## 6. Plan 10/10 — qué se aplicó, categoría por categoría

### Arquitectura (4 → 9)
- **Nuevo** `renderer/dom-safe.js` (UMD, 254 líneas): `escapeHtml`, `sanitizeHtml`, `sanitizeWithoutDom`, `sanitizePlainText`, `safeUrl`, `safeImageUrl`, `safeCssImageUrl`, `htmlToText`, `wordCount`. Una sola política de seguridad de salida para Node y navegador.
- **Nuevo** `renderer/seed-data.js`: semilla de demostración y `defaultData()` compartidos (antes duplicados entre procesos).
- `main.js` y `app.js` consumen esos módulos en vez de reimplementar; los alias locales (`escapeHtml`, `wordCount`, `sanitizeHtml`…) delegan.
- **Nuevo** `eslint.config.js` (ESLint 9 plano) con ámbitos separados para proceso principal, renderer y pruebas; `no-eval`/`no-implied-eval`/`no-new-func` activos en el renderer; exención documentada del arnés de pruebas (que inyecta `__probe` a propósito).
- `package.json`: `test`, `lint`, `verify` y un script por suite nueva.
- Eliminación de código muerto y de arrays dispersos.

### Calidad y seguridad (3 → 10)
Correcciones C1–C9 y A2, A7–A9 de las tablas anteriores, más:
- Normalización en **tres** puntos: al cargar, al guardar (`normalizeStoredData`) y al importar (`sanitizeImportedData`).
- Lista blanca de etiquetas/atributos, endurecimiento de enlaces, rechazo de `javascript:` y `data:text/html`.
- Suite `security.test.js` (60) que ejercita el módulo, el IPC real de `main.js` con Electron simulado y el renderer bajo jsdom con contenido hostil.

### UX y rendimiento (5 → 10)
Correcciones A3–A6 y P1–P6, más `perf.test.js` (34) que mide tiempos reales y afirma topes de guardado, caché, índice y límites.

### Dinamismo (6 → 10)
Gestor de modales unificado + migración de todos los puntos de apertura/cierre; `ux.test.js` (48) cubre historial del editor, inserción en cursor, búsqueda, centro de actividad, racha en fecha local, atajos y estados de guardado.

### Confort, personalización y accesibilidad (3 → 10)
Marcado ARIA, foco visible, movimiento reducido, skip-link; y las tres funciones nuevas descritas en la sección 7, con `accessibility.test.js` (41) y `personalization.test.js` (53).

---

## 7. Las tres funciones de personalización propuestas (e implementadas)

### 7.1 Color de acento propio
Un `<input type="color">` en Ajustes que reescribe `--accent`, `--accent-2`, `--accent-soft` y `--accent-glow`: **todo** el tema lo hereda (botones, enlaces, barras de progreso, foco visible).

Detalle que importa: el texto que va *sobre* el acento se recalcula con luminancia relativa WCAG (`accentContrastText`), así un acento amarillo no produce texto blanco ilegible. Se deriva además una sombra más oscura para el hover (`shadeAccent`) sin tocar el matiz elegido.

Seguridad: solo se acepta `#rrggbb` (`ACCENT_RE`); cualquier otra cosa se **normaliza a `null`** antes de tocar una variable CSS — un valor como `red; --bg:url(javascript:…)` jamás llega al documento. Hay botón de reset al color del tema.

### 7.2 Ambientes de fondo
Cinco presets (`none`, `paper`, `sepia`, `night`, `forest`) implementados **reescribiendo las variables de superficie** (`--bg`, `--panel`, `--border`, `--text`, `--muted`…), no superponiendo filtros opacos: nada tapa el contenido y el contraste se mantiene. En ambientes claros se ajusta también `--accent-contrast`.

`applyAmbient()` valida contra lista blanca, y `applyProfileAndTheme()` retira solo las clases `theme-*`/`ambient-*` en vez de limpiar `body.className`, de modo que el modo Zen, un modal abierto o las clases de densidad **sobreviven** al cambio de apariencia.

### 7.3 Meta de palabras por capítulo
La meta diaria mide la sesión; esta mide **la obra**. Cada capítulo guarda su `wordGoal` y la barra del editor muestra `1.240/2.500 (50%)` en vivo, junto al contador.

- Progreso actualizado en cada `input`, sin diálogos ni ruido.
- Al cumplirse: una sola celebración (marca `chapterGoalReached` por capítulo+meta) con notificación y toast; si se borra texto, la marca se libera y puede volver a celebrarse.
- Tope 100.000; `0` desactiva y borra el campo.
- Se normaliza al guardar en `main.js` y al importar en `app.js` (`wordGoal` inválido → `undefined`).

---

## 8. Cómo verificarlo

```bash
npm install --no-save --ignore-scripts jsdom pdfjs-dist@3.11.174 tesseract.js@5.1.1 eslint@9 globals
npm run verify      # lint + 698 pruebas
npm test            # solo pruebas
npm run lint        # solo ESLint

# Suites nuevas, una por una
npm run test:security           #  60 — XSS, inyección CSS/SVG, secreto fuera del JSON, importaciones hostiles
npm run test:a11y               #  41 — ARIA, foco atrapado, Escape, live regions, reduced-motion
npm run test:ux                 #  48 — deshacer/rehacer, cursor, mensajes, búsqueda, racha, guardado
npm run test:perf               #  34 — tiempos con 200 capítulos, debounce, caché, topes
npm run test:personalization    #  53 — acento, ambientes, meta por capítulo, persistencia
npm run test:regression         #  53 — los defectos concretos: prosa→párrafos, dedupe, imágenes, getChapter
```

```
core 49 · ingest 23 · generation 25 · api 32 · marathon 20 · ocr 17 · rpg 55
rpg-adversarial 70 · rpg-loop 36 · web 16 · language 14 · campaign-systems 21
visual 14 · omniroute 17 · security 60 · accessibility 41 · ux 48 · perf 34
personalization 53 · regression 53
────────────────────────────────────────────
TOTAL 698/698  ·  20 suites  ·  ESLint 0 problemas
```

---

## 9. Deuda residual (declarada, no escondida)

1. **`renderer/app.js` sigue siendo un monolito de ~7.800 líneas.** Es el único motivo por el que Arquitectura cierra en 9 y no en 10. Ruta de migración sin paso de build, en este orden y con la suite como red: (a) extraer `renderer/services/ai-client.js` (todas las llamadas a proveedores + `generateWithRouting`); (b) `renderer/services/sources.js` (ingesta, OCR, dedupe, clasificación de canon); (c) `renderer/features/rpg.js` (lo que aún no vive en `rpg-engine.js`); (d) `renderer/features/autobook.js`; (e) `renderer/ui/modals.js` con el gestor ya centralizado. Cada paso es un archivo UMD nuevo + un `<script>` en `index.html` **antes** de `app.js` + actualizar `tests/harness.js`, y debe cerrar con 698/698.
2. **`validateImageContentSafety` no modera contenido.** Valida formato e integridad, y ahora lo dice sin mentir. La moderación real exigiría un modelo de visión o un servicio externo; no se simula.
3. **La decodificación de imagen es indulgente cuando el entorno no responde.** En jsdom la carga de imágenes no dispara `onload` ni `onerror`; `imageDecodes` devuelve `null` (no concluyente) y la decisión recae en cabecera binaria y lista blanca de MIME, que sí lo son. En Electron real el `Image` sí decodifica y el chequeo es completo.
4. **Electron y `electron-builder` no se ejecutan en este entorno** (el postinstall falla por TLS en el sandbox). Las pruebas cubren proceso principal y renderer con Electron y jsdom simulados; el empaquetado queda por validar en una máquina con red.
