# LoreVinci

Aplicación de escritorio para escritores: gestiona historias, capítulos, personajes,
notas y colaboración, con un asistente de escritura **Muse AI** integrado.

Construida con **Electron** (funciona en Windows, macOS y Linux). Todos tus datos
(historias, capítulos, personajes, notas) se guardan **localmente** en tu computador,
no en la nube.

## Requisitos

- [Node.js](https://nodejs.org) versión 18 o superior (incluye `npm`).

## Cómo ejecutarla en modo desarrollo

```bash
cd lorevinci-desktop
npm install
npm start
```

Esto abrirá la ventana de la aplicación LoreVinci en tu computador.

## Cómo generar un instalador (.exe / .dmg / .AppImage)

```bash
npm run dist
```

El instalador se generará en la carpeta `dist/`. Debes correr este comando en el
sistema operativo para el cual quieres construir el instalador (por ejemplo, en
Windows para generar el `.exe`, en macOS para el `.dmg`).

## Funcionalidades incluidas

- **Home**: resumen de historias activas, palabras totales, capítulos completados y racha de escritura.
- **My Stories**: crear, abrir y eliminar historias, con portada y progreso.
- **Library**: tus historias organizadas por género.
- **Editor de historia**: lista de capítulos, editor de texto enriquecido (negrita, cursiva, listas, citas, enlaces), outline, notas y elenco de personajes por historia.
- **Muse AI**: asistente flotante dentro del editor que sugiere acciones de personajes, describe escenas, genera outlines o continúa el capítulo, usando el texto y el lore de tu historia como contexto.
- **Characters**: ficha de personajes (rol, descripción, rasgos) por historia.
- **Collab**: exporta una historia como `.json` (para compartir con otro colaborador que la importe) o como `.txt` plano; deja notas para tu equipo.
- **Stats**: palabras totales, capítulos, racha de escritura y actividad de los últimos 14 días.
- **Settings**: nombre de autor/a, configuración y **verificación real** de Muse AI (proveedor, modelo, API key) y respaldo/restauración de todos tus datos.
- **Fuentes & PDFs**: carga de **múltiples PDFs a la vez** con extracción real de texto, clasificación automática por **sub-tipo de historia** y **verso**, y filtros combinados.
- **Mesa RPG**: modo de partida interactiva separado del manuscrito, con ficha persistente, D20 público, recursos, reglas/fórmulas ejecutables y un GM que siempre espera la decisión del jugador.

## Mesa RPG: rol interactivo con reglas reales

Al crear o configurar una obra puedes activar **Partida RPG**. Este modo corrige la diferencia entre pedirle prosa a una IA y ejecutar una partida:

- **Nunca crea capítulos por cada mensaje.** Los turnos viven en una sesión persistente. Convertir una sesión en capítulo es una acción manual, confirmada y crea exactamente uno.
- **Nunca delega los dados ni la aritmética a la IA.** LoreVinci tira el D20 localmente, muestra la operación, comprueba requisitos y descuenta PEM/Vida antes de pedir la narración.
- **Ficha persistente**: identidad, edad, ocupación, grado, linaje, motivación, técnica, herramienta, Restricción Celestial y los seis atributos físicos/malditos.
- **Fórmulas calculadas**: PEM y Vida máximos, iniciativa, carga, percepción, recuperación, costes de técnicas, Tobari y Dominio, entre otras reglas automatizadas.
- **Acciones imposibles se bloquean con una razón.** Por ejemplo, un personaje de Grado 4 no puede abrir un Dominio; la acción no consume recursos ni llama a la API.
- **Auditoría de reglas**: lee reglamentos de 100 o más puntos sin el antiguo recorte fijo de 4.000 caracteres y muestra contradicciones, como “Control más alto” frente a “D20 + Control”.
- **Fuentes realmente consultadas**: la Mesa selecciona pasajes relevantes de los documentos adjuntos y registra cuáles usó en cada turno.
- **Salida segura en español**: bloquea razonamiento interno (`The user wants…`, `I need to…`), narración mayormente inglesa y respuestas que intenten decidir por el jugador. Hace una reparación automática; si no es segura, usa una resolución local sin mostrar el borrador defectuoso.
- **Turno estricto**: el GM describe entorno, PNJ y consecuencias, produce un solo turno y termina preguntando qué hace el jugador.

La sintaxis es opcional; también se acepta lenguaje natural:

- `// intento derribar la puerta CD 15` — acción.
- `— No pienso retroceder` — diálogo del jugador.
- `[¿Qué regla se aplica aquí?]` — consulta fuera de personaje, sin gasto ni tirada.

### Loop de partida y crónica

- El menú lateral **Mesa RPG** abre directamente la última partida usada.
- Cada obra puede elegir **Español, English, Português, Français, Deutsch o Italiano**; el GM, Muse, sugerencias insertables, capítulos RPG y audiolibro usan ese idioma. El filtro de razonamiento interno sigue activo incluso cuando se elige inglés.
- El asistente en tiempo real entrega por defecto **un párrafo final listo para insertar**, no una lista de ideas. El comentario editorial permanece como modo opcional.
- Cada tirada muestra un **D20 animado** antes de revelar el natural, modificador, CD, ventaja/desventaja o crítico. Respeta `prefers-reduced-motion`.
- Al entrar al modo RPG eliges **Jugador** (vivir el mundo mediante tu personaje) o **Director** (controlar escenas, PNJ y sistemas con Muse como copiloto).
- La **Sesión cero guiada** pregunta experiencia, obra/universo, autor o creador, punto de entrada, tono, dificultad, letalidad, límites y relación con el canon; un principiante puede empezar sin conocer reglas previas.
- El panel **Sistemas del mundo** gestiona facciones, misiones, inventario, relojes de peligro, pistas, heridas, lugares, rumores y relaciones. En modo Director también admite comandos como `/estado`, `/reloj`, `/faccion` o `/mision`.
- Al entrar eliges **obra/universo, autor o creador, punto de entrada y relación con el canon**: mundo abierto, canon estricto o línea alternativa.
- El GM permite profundidad equilibrada, cinematográfica o épica. El prompt exige atmósfera, consecuencias, PNJ con subtexto, complicaciones y posición espacial clara, sin decidir por el jugador.
- El mundo conserva ubicación, reloj, hechos y consecuencias. Cada PNJ recibe personalidad, deseos, conocimiento inicial y memoria propia; solo aprende lo que presencia o se le comunica y nunca obtiene omnisciencia por leer el prompt.
- Cada turno tiene cancelación visible, timeout de 45 segundos y cierre transaccional: un comando cancelado no aplica recursos ni consecuencias y nunca deja bloqueados los siguientes comandos.
- **Crónica de capítulos** registra únicamente los turnos nuevos. Puede conservarlos como crónica fiel o transformarlos en prosa con Muse sin alterar hechos, dados ni decisiones.

### Investigación web seleccionable

Desde **Configurar → Estilo y voz** o **Fuentes** puedes buscar información pública en Wikipedia, Open Library y web abierta, o revisar una URL concreta. LoreVinci nunca incorpora resultados silenciosamente: muestra título, resumen, proveedor y dominio para que el usuario seleccione qué fuentes entran al libro.

Las páginas seleccionadas se extraen en el proceso principal, se limitan a 30 MB y se guardan como Referencia Auxiliar con URL y fecha. Se bloquean `file://`, localhost, redes privadas, redirecciones inseguras y contenido binario. Para referencias de autores se usan hechos, bibliografía y rasgos generales; no se copian fragmentos ni se suplanta literalmente su voz.

## Fuentes y PDFs (carga múltiple)

En **Fuentes & PDFs** puedes subir **muchos PDFs al mismo tiempo**:

- Pulsa *"Subir varios PDFs / artículos"* y selecciona todos los archivos que quieras
  (hasta 40 por lote y **30 MB por archivo**), o simplemente **arrástralos juntos** sobre la zona de carga.
- El texto de cada PDF se extrae de verdad con **pdf.js incluido en la app** (100% offline):
  se conserva el número de páginas y el contenido queda buscable.
- Una barra de progreso muestra archivo por archivo qué se añadió, qué era duplicado y
  qué falló. Los PDFs escaneados sin capa de texto se marcan como *"Requiere OCR"*.
- La **deduplicación** sigue activa: un mismo documento no entra dos veces.

### Filtrado por historia, sub-tipo y verso

Cada fuente se clasifica automáticamente al subirla y puedes corregirla a mano:

- **Historia**: a qué libro pertenece la fuente.
- **Sub-tipo de historia**: Canon oficial, Fanfic/Derivado, What If, Precuela, Secuela,
  Spin-off, Crossover, Worldbuilding, Fichas de personaje, Cronología, Guion, Notas,
  Capítulos/Manuscrito.
- **Verso**: canon principal, universo alterno, multiverso, línea futura/pasada o una
  línea temporal divergente. También se reconoce un verso explícito en el nombre del
  archivo, por ejemplo `Cronologia [Verso: Universo 7].pdf`.

La barra de filtros combina búsqueda de texto completo + historia + sub-tipo + verso +
jerarquía de canon. Al generar un libro automático puedes limitar el contexto a un
sub-tipo y a un verso concretos.

### OCR local para PDFs escaneados

Si un PDF no trae capa de texto (es una foto o un escaneo), LoreVinci lo rasteriza
página a página y lo lee con **Tesseract incluido en la app**, con los datos de
español e inglés empaquetados. No se descarga nada ni se envía nada a internet.

- Se aplica **automáticamente** al subir; puedes desactivarlo en *Ajustes → OCR local*.
- Idioma configurable: español, inglés o ambos.
- Cada fuente reconocida muestra su **porcentaje de confianza**; si el OCR no logra
  texto, la fuente queda marcada *Requiere OCR* con un botón para reintentar.
- Tras el OCR el documento se reclasifica solo (sub-tipo y verso), porque ya hay
  texto sobre el que decidir.
- Tope de 60 páginas por documento para no agotar la memoria.

## Configurar un libro (parámetros iniciales, siempre editables)

El botón **Configurar** de cada historia (y *"Configurar libro"* dentro del editor) abre
un panel con pestañas para cambiar en cualquier momento lo que definiste al crearla:

- **Identidad**: título, género, sinopsis y outline.
- **Portada**: subir/quitar imagen de portada y color de respaldo, con vista previa.
- **Lore y reglas**: reglas inquebrantables, lore base extendido y reglas cronológicas.
- **Estilo y voz**: ver más abajo.
- **Fuentes**: adjuntar varios PDFs al libro y revisar los que ya tiene.

## Mantener la personalidad y la escritura de la obra

En **Configurar → Estilo y voz** defines cómo debe sonar la prosa:

- **Obra o autor de referencia** a imitar (ej. *Dragon Ball (Toriyama)*).
- **Notas de voz narrativa**, **persona narrativa**, **registro/tono** y **fidelidad al
  estilo** (alta / media / baja).
- **Muestra de estilo**: un fragmento canónico que la IA usa como patrón de ritmo,
  sintaxis y vocabulario.
- **"Extraer estilo de lo ya escrito"** analiza tus capítulos y fuentes para deducir la
  voz automáticamente (funciona sin API con un analizador local; con API es más fino).
- **Anclas de estilo automáticas**: además de describir la voz, la app envía fragmentos
  reales de tus capítulos ya escritos (priorizando los marcados como terminados) para que
  el modelo tenga ejemplos concretos del ritmo y el vocabulario, no solo adjetivos.

Estas instrucciones se inyectan en cada generación y tienen prioridad sobre el enfoque
narrativo puntual, para que la obra no cambie de voz entre capítulos.

## Generación de capítulos: cómo trabaja el motor

Cada capítulo se produce en tres pasos, no en una sola llamada a ciegas:

1. **Escaleta previa.** Antes de redactar, el modelo planifica en JSON: título,
   objetivo, escenas, conflicto, coste, revelación, gancho y qué continuidad debe
   respetar. Planificar y luego escribir da capítulos mucho más coherentes que pedir
   la prosa de golpe. Puedes desactivarlo con la casilla del modal si prefieres
   ahorrar una llamada.
2. **Redacción** con la escaleta aprobada, el canon y la voz de la obra.
3. **Auditoría automática** del resultado (ver más abajo).

### Presupuesto adaptativo por modelo

El contexto ya no usa topes fijos: se calcula según la ventana real del modelo que
tengas configurado (GPT-4o 128k, Claude 200k, Gemini 1M, GPT-4 8k…), reservando
espacio para la respuesta y un margen de seguridad. Las fuentes se llevan el 62% del
espacio disponible, la memoria el 30% y las anclas de estilo el 8%.

Con un libro real (4 fuentes, 85.000 caracteres de canon, 8 capítulos escritos) y
GPT-4o, el prompt pasó de **16.857 a 87.104 caracteres**: 61.110 de fuentes reales
frente a los 9.617 de antes. Un modelo pequeño recibe automáticamente mucho menos.

### Detección de capítulos truncados

Antes se pedían 1.400 tokens fijos de salida (~1.000 palabras) y **nunca se miraba
`finish_reason`**: si el modelo se quedaba sin presupuesto, la app guardaba el
capítulo cortado a media frase como si estuviera completo. Ahora:

- El proceso principal devuelve `finish_reason`, `truncated` y el consumo de tokens.
- Si el capítulo se trunca, la app **pide automáticamente la continuación** y la
  cose al texto anterior sin repetir nada.
- Si aun así queda abierto, el capítulo se marca visiblemente en la lista.

### Auditoría automática de cada capítulo

Tras generarlo se revisa en local (sin gastar API) y se avisa de:

- Corte a media frase o capítulo demasiado corto.
- Fugas del asistente en la prosa ("Aquí tienes el capítulo…", bloques markdown).
- Copia literal de las fuentes en vez de integrarlas con tu voz.
- Gancho planificado que no aparece en el texto.

En la lista de capítulos verás una insignia **IA ✓**, **Avisos** o **Revisar**, con
el detalle al pasar el cursor. Cada capítulo guarda además su metadato de generación:
modelo, palabras, escaleta usada y fuentes consultadas.

## Aprovechamiento máximo del contenido

Al generar capítulos, LoreVinci ya no manda solo un documento recortado:

- **Digest multi-fuente**: trocea *todas* las fuentes del libro, las puntúa por relevancia
  frente al contexto actual y por jerarquía de canon, y arma el mejor contexto posible
  dentro del presupuesto disponible. Ningún *Canon Absoluto* queda fuera.
- **Memoria narrativa completa**: resume todos los capítulos anteriores y añade los dos
  últimos en detalle, en lugar de mirar solo los dos últimos.
- Cada pasaje va etiquetado con su documento, sub-tipo y verso para que la IA sepa de
  dónde sale cada dato.

## Configurar y verificar Muse AI

Ve a **Ajustes → Muse AI** e ingresa:

- **Proveedor**: un desplegable rellena la URL base por ti (OpenAI, OpenRouter, Groq,
  Ollama, LM Studio) o elige *Personalizado*.
- **URL base**: por defecto `https://api.openai.com/v1` (funciona con cualquier API
  compatible con "Chat Completions" de OpenAI).
- **API Key**: tu clave personal. Se guarda solo en tu computador (nunca se envía a
  ningún servidor de LoreVinci, porque no existe tal servidor: todo corre localmente).
  Un botón *Ver/Ocultar* te deja comprobar lo que pegaste.
- **Modelo**: pulsa *"Detectar modelos"* para traer el catálogo real de tu cuenta.

Pulsa **"Verificar y activar API"**. La verificación es real y de extremo a extremo:

1. Comprueba que hay credencial (o que es un servidor local que no la necesita).
2. Autentica contra `/models` y lista los modelos disponibles.
3. Confirma que el modelo elegido existe en tu catálogo.
4. Lanza una generación mínima contra `/chat/completions` para probar que **de verdad
   escribe**.

Cada paso se muestra en verde o rojo con el motivo exacto del fallo (401 clave inválida,
402 sin créditos, 404 URL o modelo incorrecto, 429 límite de cuota, host inalcanzable…).
Al pasar, la insignia queda en **"operativo"** con fecha de verificación. Si cambias la
clave, la URL o el modelo, la verificación se invalida y hay que repetirla.

> El botón de inicio de sesión con Google se eliminó del widget flotante de Muse AI y de
> Ajustes: no había OAuth real detrás y estorbaba. Toda la conexión se gestiona ahora
> desde el panel de verificación de Ajustes.

## Pruebas

```bash
npm install
npm test
```

Doce suites, 378 comprobaciones: núcleo y seguridad, ingesta multi-PDF con extracción
real, motor de generación, handlers del proceso principal, OCR, Mesa RPG, una batería
adversarial basada en la retroalimentación beta, investigación web segura y un **maratón
de 30 capítulos** contra un modelo simulado adverso (que trunca, devuelve JSON roto,
falla la red y filtra texto del asistente). Las suites RPG verifican reglamentos de 100
puntos, fórmulas, D20 animado, registro incremental, fuentes seleccionadas, reparación
de salidas inglesas y que el chat nunca cree capítulos por accidente.

## Dónde se guardan tus datos

La app guarda un archivo `lorevinci-data.json` en la carpeta de datos de usuario de tu
sistema operativo (gestionada automáticamente por Electron). Puedes hacer respaldo o
restaurar tus datos completos desde **Settings → Datos → Exportar/Importar**.
