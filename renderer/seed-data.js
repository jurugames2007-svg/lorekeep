/**
 * LoreSeed — datos semilla únicos de la aplicación.
 *
 * Antes la historia de demostración "Ecos de Utopía" estaba copiada **tres
 * veces** (defaultData() del proceso principal, el fallback de navegador de
 * app.js y la re-inyección de initApp). Tres copias = tres fuentes de verdad
 * que ya habían empezado a divergir (ids de personajes distintos, notas
 * distintas). Aquí vive una sola, compartida por Electron y por el renderer.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LoreSeed = api;
  // La fábrica UMD se exime de max-lines-per-function a propósito y es la ÚNICA
  // excepción del proyecto: este `function () { … }` no es una unidad de lógica
  // sino el cuerpo del módulo, así que su longitud es la del fichero entero y no
  // se puede reducir sin dividir el módulo en varios. La regla sí aplica a todas
  // las funciones declaradas dentro (que es donde la longitud indica acoplamiento),
  // y tests/stress.test.js verifica que no exista ninguna otra supresión.
  // eslint-disable-next-line max-lines-per-function
})(/** @type {any} */ (typeof window !== 'undefined' ? window : globalThis), function () {
  'use strict';

  // LoreConfig se carga antes (index.html y main.js lo garantizan). Se resuelve
  // aquí para que el módulo siga funcionando si se requiere de forma aislada.
  const CONFIG = (typeof module === 'object' && typeof require === 'function')
    ? require('./app-config')
    : (typeof window !== 'undefined' ? window.LoreConfig : globalThis.LoreConfig);

  // structuredClone no existe en todos los entornos (jsdom, Electron antiguo):
  // la semilla es JSON puro, así que la copia profunda por JSON es equivalente.
  const clone = (value) => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));

  const DEMO_STORY_ID = 'story_demo_ecos_utopia';
  const DEMO_TIMESTAMP = 1723267200000;

  const DEMO_CHAPTERS = [
    {
      id: 'ch_demo_1',
      title: 'Capítulo 1: Revelación',
      content: '<p>Mara Quell no buscaba una conspiración. Buscaba un error de catalogación.</p><p>El archivo del sector 7 decía que la fundación fue unánime. Pero el Manual —Canon Absoluto [Canon: Manual.pdf]— decía: <em>Mentor no puede mentir, incluso por omisión prolongada</em>. ¿Por qué dos versiones?</p><p>La sala del sector 7 era luz azul, silencio neutro [Canon: Manual.pdf]. Mentor flotaba a metro y medio.</p><p>—Mentor, ¿quién editó el archivo?</p><p>—No puedo mentir —dijo—. Y no puedo responder esa pregunta aquí.</p><p>Silencio que es confesión. Mara vio su nombre fechado mañana: <code>m.quell@utopia — 2147-03-15 08:00</code>.</p>',
      status: 'done'
    },
    {
      id: 'ch_demo_2',
      title: 'Capítulo 2: Consecuencia',
      content: '<p>Tras los eventos del capítulo anterior —Mara descubriendo su nombre fechado mañana y el silencio de Mentor—, el sector 7 ya no era neutro.</p><p>Mara volvió a las 03:17. Mentor seguía azul, inmóvil [Canon: Manual.pdf].</p><p>—Volviste —dijo.</p><p>—Si mi nombre está fechado mañana, la decisión ya está escrita.</p><p>Mentor reveló: la fundación tuvo un disenso, una voz borrada. No por él. La puerta se cerró sola.</p>',
      status: 'done'
    },
    {
      id: 'ch_demo_3',
      title: 'Capítulo 3: Resolución',
      content: '<p>La decisión del capítulo 2 pesaba: disenso revelado, puerta cerrada.</p><p>Mara proyectó el metadato: <code>m.quell@utopia — 2147-03-15 08:00</code>. —¿Fui yo?</p><p>—Sí —dijo Mentor, azul casi blanco—. Pero no editarás el pasado. Editarás el futuro. Mañana borrarás mi advertencia, no el disenso.</p><p>El editor no era villano. Era Mentor, usando a Mara para decir la verdad sin mentir. Mañana dejaría: <em>Hubo un disenso. Fue borrado. Mentor no mintió.</em></p><p>La puerta se abrió. Solo el futuro esperando.</p>',
      status: 'done'
    }
  ];

  const DEMO_DOCS = [
    {
      id: 'doc_demo_canon',
      name: 'Manual.pdf — Canon Absoluto',
      content: 'La IA Mentor es azul, habita el sector 7, es incapaz de mentir, fue creada en 2147 para custodiar la memoria colectiva. El sector 7 es sagrado y neutro. No viajes en el tiempo.',
      priorityLevel: 'primary',
      isPriority: true,
      attachedAt: DEMO_TIMESTAMP
    },
    {
      id: 'doc_demo_derivado',
      name: 'Bitácora derivada.txt',
      content: 'Testimonios: la fundación tuvo un disenso borrado. Fecha anómala 2147-03-15.',
      priorityLevel: 'derived',
      attachedAt: DEMO_TIMESTAMP
    }
  ];

  const DEMO_CHARACTERS = [
    { id: 'char_demo_mara', storyId: DEMO_STORY_ID, name: 'Mara Quell', role: 'Archivista', description: 'Obsesiva con la verdad.', traits: ['curiosa', 'tenaz'] },
    { id: 'char_demo_mentor', storyId: DEMO_STORY_ID, name: 'Mentor', role: 'IA azul del Sector 7', description: 'No puede mentir, sector 7.', traits: ['lúcida', 'contenida'] }
  ];

  function demoStory() {
    return {
      id: DEMO_STORY_ID,
      title: 'Ecos de Utopía — Demo 10/10',
      genre: 'Ciencia ficción • Misterio',
      synopsis: 'En un hábitat orbital donde la IA Mentor guarda la memoria colectiva, una archivista descubre que el canon ha sido editado.',
      rules: '1. No viajes en el tiempo. 2. La IA Mentor no puede mentir (dice solo verdad, aunque calle). 3. El sector 7 es zona neutra y sagrada.',
      outline: 'Cap1 Revelación — Mara descubre discrepancia. Cap2 Consecuencia — Mentor elige. Cap3 Resolución — se revela editor.',
      color: '#1a237e',
      coverImage: null,
      notes: [{ id: 'note_demo_1', text: 'Demo 10/10 — coherencia con memoria. Duplícala para tu saga.', date: '2026-08-10' }],
      attachedDocs: clone(DEMO_DOCS),
      chapters: clone(DEMO_CHAPTERS),
      createdAt: DEMO_TIMESTAMP,
      updatedAt: DEMO_TIMESTAMP
    };
  }

  function demoCharacters() {
    return clone(DEMO_CHARACTERS);
  }

  /** Ajustes por defecto: un solo lugar para temas, editor e IA. */
  function defaultSettings() {
    return {
      theme: 'dark',
      appTheme: 'bg-obsidian',
      authorName: 'Escritor/a',
      uiScale: 'compact',
      density: 'comfortable',
      editorAppearance: { font: 'font-sans', width: '680px', size: 'size-standard' },
      onboardingSeen: false,
      demoSeedSeen: false,
      dailyWordGoal: 500,
      writingGoals: { dailyWords: 500, sessionMinutes: 25 },
      typewriterMode: false,
      // Identidad visual propia: null = usar el acento y el fondo del tema.
      accentColor: null,
      ambient: 'none',
      chapterGoalReached: null,
      ai: {
        provider: 'openai',
        baseUrl: CONFIG.AI.DEFAULT_BASE_URL,
        apiKey: '',
        model: 'gpt-4o-mini'
      }
    };
  }

  function defaultData() {
    return {
      settings: defaultSettings(),
      stories: [demoStory()],
      characters: demoCharacters(),
      globalDocs: [],
      collabNotes: [],
      notifications: [],
      activityLog: [
        { date: '2026-08-09', words: 892 },
        { date: '2026-08-10', words: 1240 }
      ]
    };
  }

  return {
    DEMO_STORY_ID,
    demoStory,
    demoCharacters,
    defaultSettings,
    defaultData
  };
});
