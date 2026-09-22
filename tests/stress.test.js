// Suite "stress": somete la aplicación a la carga que promete aguantar.
//
// Las suites funcionales responden "¿hace lo correcto con una entrada normal?".
// Esta responde otras cuatro preguntas, que son las que separan una demo de un
// producto:
//
//   1. VOLUMEN   — ¿sigue funcionando con una biblioteca de cientos de obras?
//   2. VELOCIDAD — ¿aguanta un usuario que escribe más rápido que el guardado?
//   3. HOSTILIDAD— ¿sobrevive a entradas que nadie escribiría a propósito
//                  (payloads circulares, BigInt, getters que lanzan, HTML roto)?
//   4. DURACIÓN  — ¿hay algo que crezca sin tope (timers, mapas, DOM, memoria)?
//
// Reglas de diseño de esta suite:
//   · El tiempo se INYECTA (reloj falso) en todo lo que depende de debounce, así
//     que la carga es determinista: no hay "a veces falla en CI".
//   · El azar se INYECTA (PRNG con semilla fija), no se usa Math.random().
//   · Los presupuestos de tiempo son holgados a propósito: lo que se afirma es
//     el orden de magnitud y la ausencia de degradación, no el último milisegundo.
//   · Se registran unhandledRejection/uncaughtException durante TODA la suite y
//     se exige cero al final: bajo carga, un rechazo no manejado es el fallo que
//     no aparece en ningún assert y tira el proceso en producción.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { makeApp, makeSeed, reporter, makeClock, settleDeep, makeRandom, ROOT, P } = require('./harness');

const R = reporter('stress');
const ok = R.ok;
const K = require(path.join(P, 'app-kernel.js'));

// ============================================================
// 0. Integridad del proceso: se vigila durante TODA la suite
// ============================================================
const unhandled = [];
const uncaught = [];
process.on('unhandledRejection', (reason) => { unhandled.push(String((reason && reason.message) || reason)); });
process.on('uncaughtException', (error) => { uncaught.push(String((error && error.message) || error)); });

const SUITE_START = Date.now();

/**
 * Formatea un valor para el diagnóstico de una aserción SIN poder reventar.
 *
 * `ok(label, cond, extra)` evalúa `extra` eagerly, así que un diagnóstico como
 * `show(x, 120)` lanza un TypeError cuando `x` es undefined —
 * que es justo lo que devuelve `.find()` cuando la aserción PASA. Eso hacía que
 * la suite reventara en verde. Todo diagnóstico pasa por aquí.
 */
function show(value, max = 140) {
  // JSON.stringify, no show(): una versión anterior de este helper se llamaba a
  // sí misma por un reemplazo automático mal aplicado, y el catch de abajo se
  // comía el RangeError devolviendo '<no serializable>'. Todos los diagnósticos
  // de la suite quedaron ciegos y ninguna prueba falló. De ahí el autotest S0.
  try { return String(JSON.stringify(value)).slice(0, max); } catch { return '<no serializable>'; }
}

/**
 * Autotest del helper de diagnóstico.
 *
 * Un helper que degrada en silencio es peor que no tenerlo: hace que los mensajes
 * de fallo de TODA la suite dejen de aportar información sin que nada falle. Se
 * verifica explícitamente, y esta aserción es la que habría detectado la
 * recursión infinita del párrafo anterior en la primera ejecución.
 */
function selfTestDiagnostics() {
  const circular = { x: 1 };
  circular.self = circular;
  ok('S0 · show() serializa un objeto', show({ a: 1 }) === '{"a":1}', show({ a: 1 }));
  ok('S0 · show() no confunde undefined con un objeto vacío', show(undefined) === 'undefined', show(undefined));
  ok('S0 · show() respeta el largo máximo', show({ a: 'x'.repeat(500) }, 20).length === 20, String(show({ a: 'x'.repeat(500) }, 20).length));
  ok('S0 · show() no lanza ante un valor circular', show(circular) === '<no serializable>', show(circular));
  // La invariante real: debe delegar en JSON.stringify. Si alguien la reescribe
  // llamándose a sí misma, el RangeError lo absorbe su propio catch y devuelve
  // '<no serializable>', que es justo lo que pasó y ninguna prueba detectó.
  ok('S0 · show() delega en JSON.stringify (no en sí misma)', /JSON\.stringify\(/.test(String(show)), 'no se encontró JSON.stringify en la implementación');
  ok('S0 · un objeto plano NUNCA se reporta como no serializable', show({ a: 1, b: [2, 3] }) !== '<no serializable>', show({ a: 1, b: [2, 3] }));
}

/** Mide una operación síncrona o asíncrona y devuelve su coste real. */
async function timed(fn) {
  const t0 = Date.now();
  const out = await fn();
  return { ms: Date.now() - t0, out };
}

const silentLogger = () => K.createLogger({ sink: () => {} });

// ============================================================
// 1. VELOCIDAD — tormenta de edición (el debounce bajo fuego)
// ============================================================
async function editStorm() {
  const N = 5000;
  const clock = makeClock();
  let writes = 0;
  let writtenPayload = null;
  let payload = { n: 0 };
  const statuses = [];
  const controller = K.createPersistenceController({
    save: async (p) => { writes += 1; writtenPayload = p.n; return { ok: true }; },
    getPayload: () => payload,
    onStatus: (status) => statuses.push(status),
    timers: clock,
    logger: silentLogger()
  });

  const storm = await timed(async () => {
    for (let i = 1; i <= N; i += 1) {
      payload = { n: i };
      controller.schedule();
    }
  });

  ok(`S1 · ${N} ediciones seguidas no provocan ninguna escritura síncrona`, writes === 0, `writes=${writes}`);
  ok(`S1 · ${N} ediciones dejan UN SOLO temporizador (sin fuga de timers)`, clock.pending() === 1, `pending=${clock.pending()}`);
  ok('S1 · la cola es una bandera, no una lista que crece con la carga', typeof controller.getState().queued === 'boolean');
  ok('S1 · la caja de estado sigue congelada bajo carga', Object.isFrozen(controller.getState()));
  ok(`S1 · planificar ${N} ediciones es barato (${storm.ms} ms)`, storm.ms < 1500, `${storm.ms} ms`);

  clock.advance(K.PERSISTENCE.DEBOUNCE_MS);
  await settleDeep();

  ok(`S1 · ${N} ediciones producen EXACTAMENTE 1 escritura`, writes === 1, `writes=${writes}`);
  ok('S1 · se escribe el último snapshot, no el primero', writtenPayload === N, String(writtenPayload));
  ok('S1 · tras escribir no queda ningún temporizador colgando', clock.pending() === 0, `pending=${clock.pending()}`);
  ok('S1 · el estado vuelve a idle y sin cambios pendientes', controller.getState().idle === true && controller.getState().dirty === false);
  ok('S1 · las métricas cuadran con la carga real', controller.getState().writesOk === 1 && controller.getState().writesFailed === 0);
  ok('S1 · el indicador pasó por "guardando" y terminó en "guardado"',
    statuses.includes(K.PERSISTENCE.STATUS.SAVING) && statuses[statuses.length - 1] === K.PERSISTENCE.STATUS.SAVED);
  // Exactamente dos avisos: uno al empezar a guardar y otro al terminar. Antes de
  // deduplicar el publicador eran 5001 — un aviso por pulsación — y cada uno
  // reescribía el mismo texto en el DOM (2 classList.toggle + setAttribute +
  // textContent + title), además de re-fijar aria-live en cada tecla.
  ok(`S1 · ${N} ediciones emiten EXACTAMENTE 2 avisos de estado`, statuses.length === 2, statuses.join(','));
  ok('S1 · los dos avisos son "guardando" y luego "guardado"',
    statuses[0] === K.PERSISTENCE.STATUS.SAVING && statuses[1] === K.PERSISTENCE.STATUS.SAVED, statuses.join(','));
}

// ============================================================
// 2. HOSTILIDAD + DURACIÓN — 600 ciclos con un transporte que falla solo
// ============================================================
async function hostileTransport() {
  const CYCLES = 600;
  const clock = makeClock();
  const rnd = makeRandom(20260918); // semilla fija: el escenario es reproducible
  let calls = 0;
  let payload = { n: 0 };
  const statuses = [];
  const failures = [];
  const recoveries = [];
  const controller = K.createPersistenceController({
    save: async () => {
      calls += 1;
      if (rnd() < 0.3) throw new Error('transporte caído'); // 30 % de fallos
      return { ok: true };
    },
    getPayload: () => payload,
    onStatus: (status) => statuses.push(status),
    onFailure: (error) => failures.push(error),
    onRecover: () => recoveries.push(1),
    timers: clock,
    logger: silentLogger()
  });

  let maxPending = 0;
  const run = await timed(async () => {
    for (let i = 1; i <= CYCLES; i += 1) {
      payload = { n: i };
      // Ráfaga triple: simula teclear, pegar y mover el cursor en la misma ventana.
      controller.schedule();
      controller.schedule();
      controller.schedule();
      clock.advance(K.PERSISTENCE.DEBOUNCE_MS);
      await settleDeep(3);
      maxPending = Math.max(maxPending, clock.pending());
    }
  });

  const state = controller.getState();
  ok(`S2 · cada uno de los ${CYCLES} ciclos produce exactamente una escritura`, calls === CYCLES, `calls=${calls}`);
  ok('S2 · no se pierde ni una escritura en el recuento', state.writesOk + state.writesFailed === CYCLES,
    `${state.writesOk}+${state.writesFailed} != ${CYCLES}`);
  ok('S2 · el transporte falló de verdad (la prueba no fue un paseo)', state.writesFailed > 50, `failed=${state.writesFailed}`);
  ok('S2 · y aun así la mayoría salió adelante', state.writesOk > state.writesFailed, `${state.writesOk} ok / ${state.writesFailed} mal`);
  ok('S2 · los temporizadores NUNCA se acumulan entre ciclos', maxPending <= 1, `max=${maxPending}`);
  ok('S2 · al terminar no queda nada pendiente', clock.pending() === 0 && state.idle === true && state.dirty === false);
  ok('S2 · el usuario llegó a ver el estado de error', statuses.includes(K.PERSISTENCE.STATUS.ERROR));
  ok('S2 · cada fallo entrega un AppError tipado, no un string suelto',
    failures.length > 0 && failures.every((e) => e && typeof e.code === 'string' && typeof e.message === 'string'));
  ok('S2 · el fallo se notifica UNA vez por episodio, no 600', failures.length < CYCLES, String(failures.length));
  ok('S2 · la recuperación tras el fallo también se notifica', recoveries.length > 0, String(recoveries.length));
  ok(`S2 · ${CYCLES} ciclos con transporte hostil en ${run.ms} ms`, run.ms < 20000, `${run.ms} ms`);
}

// ============================================================
// 3. DURACIÓN — runCleanup repetido: la limpieza no debe dejar residuo
// ============================================================
async function cleanupStorm() {
  const ITERATIONS = 2000;
  const lines = [];
  const logger = K.createLogger({ scope: 'stress', sink: (line) => lines.push(line) });
  const rnd = makeRandom(7);
  let released = 0;

  const run = await timed(async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      // Alterna liberaciones reales, síncronas, asíncronas y fallidas: es el
      // abanico que ven pdf.destroy(), worker.terminate() y reader.cancel().
      const outcome = await K.runCleanup('recurso', () => {
        if (rnd() < 0.25) throw new Error('handle ya cerrado');
        released += 1;
        return rnd() < 0.5 ? Promise.resolve(true) : true;
      }, logger);
      if (!outcome || typeof outcome.isOk !== 'boolean') throw new Error('runCleanup no devolvió un Result');
    }
  });

  ok(`S3 · ${ITERATIONS} limpiezas devuelven siempre un Result`, true);
  ok('S3 · ninguna limpieza lanzó hacia el flujo principal', uncaught.length === 0, uncaught.slice(0, 2).join(' | '));
  ok('S3 · las limpiezas fallidas quedaron registradas', lines.length > 100, String(lines.length));
  ok('S3 · cada línea de log es JSON válido', lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  ok('S3 · solo se registra el fallo, nunca el éxito', lines.length === ITERATIONS - released, `${lines.length} logs / ${released} éxitos`);
  ok('S3 · el logger no acumula estado entre llamadas', typeof logger.child === 'function');
  ok(`S3 · ${ITERATIONS} limpiezas en ${run.ms} ms`, run.ms < 10000, `${run.ms} ms`);
}

// ============================================================
// 4. Proceso principal real (main.js con stubs de Electron)
// ============================================================
function loadMainProcess() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-stress-'));
  const handlers = {};
  // handle Y on: ai:cancel se registra con ipcMain.on, así que si el stub lo
  // ignora la prueba de cancelación se queda sin handler y no verifica nada.
  const ipcMain = {
    handle: (channel, fn) => { handlers[channel] = fn; },
    on: (channel, fn) => { handlers[channel] = fn; }
  };
  const appStub = { isPackaged: false, getPath: () => userData, whenReady: () => ({ then: () => ({}) }), on: () => {} };
  const BW = function () { return { setMenuBarVisibility() {}, loadFile() {}, webContents: { openDevTools() {} } }; };
  BW.getAllWindows = () => [];
  const clipWritten = [];
  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') {
      return {
        app: appStub, BrowserWindow: BW, ipcMain, dialog: {}, shell: { openExternal: async () => true },
        clipboard: { writeText: (t) => { clipWritten.push(String(t).length); } },
        safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(`enc:${v}`), decryptString: (b) => String(b).slice(4) }
      };
    }
    return realLoad.apply(this, arguments);
  };
  const captured = [];
  const realDebug = console.debug;
  console.debug = (line) => { captured.push(line); };
  try {
    require(path.join(ROOT, 'main.js'));
  } finally {
    Module._load = realLoad;
    console.debug = realDebug;
  }
  return {
    handlers,
    userData,
    clipWritten,
    captured,
    /** Activa o desactiva la captura del log estructurado del proceso principal. */
    capture(on) { if (on) { captured.length = 0; console.debug = (l) => captured.push(l); } else { console.debug = realDebug; } },
    events() { return captured.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); },
    dispose() { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* ya no existe */ } }
  };
}

/** Respuesta HTTP mínima compatible con lo que consume main.js. */
function httpStub({ ok: isOk = true, status = 200, body = '', json = null } = {}) {
  return {
    ok: isOk,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => (json !== null ? json : JSON.parse(body || '{}'))
  };
}

async function hostilePromptPayloads(main) {
  const gen = main.handlers['ai:generate'];
  const cancel = main.handlers['ai:cancel'];
  ok('S4 · el handler de cancelación existe (no se prueba un fallback vacío)', typeof cancel === 'function');
  const base = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-stress', model: 'gpt-4o', task: 'writing' };

  // Batería de payloads que ningún usuario escribiría, pero que un fallo de
  // estado o una extensión sí pueden producir. La promesa de la app es que un
  // prompt roto se RECHAZA con un mensaje útil: nunca una excepción, nunca una
  // llamada a la API sin medir.
  const circular = { role: 'user', content: 'x' };
  circular.self = circular;
  const deep = (() => { let node = { role: 'user', content: 'fondo' }; for (let i = 0; i < 20000; i += 1) node = { nested: node }; return node; })();
  const throwingGetter = { role: 'user', get content() { throw new Error('getter hostil'); } };
  const hostileProxy = new Proxy({ role: 'user', content: 'x' }, {
    get(target, prop) { if (prop === 'content') throw new Error('proxy hostil'); return Reflect.get(target, prop); }
  });

  const blocked = [
    ['referencia circular', [circular]],
    ['BigInt no serializable', [{ role: 'user', content: 'x', big: BigInt('9007199254740993') }]],
    ['getter que lanza', [throwingGetter]],
    ['proxy hostil', [hostileProxy]],
    ['anidamiento de 20 000 niveles', [deep]],
    ['prompt de 400 000 caracteres', [{ role: 'user', content: 'a'.repeat(400000) }]],
    ['lista vacía de mensajes', []],
    ['messages no es una lista', { role: 'user', content: 'x' }],
    ['messages es null', null],
    ['mensaje sin texto', [{ role: 'user' }]],
    ['mensaje que no es objeto', ['solo un string']],
    ['número en lugar de mensajes', 42]
  ];

  const realFetch = global.fetch;
  let fetchCalls = 0;
  // El stub vive durante TODA la función. La primera versión lo restauraba en el
  // finally del bucle hostil, así que las aserciones del camino feliz acababan
  // llamando al fetch real, que en el sandbox falla porque no hay red: el test
  // medía el sandbox en vez de medir el código.
  global.fetch = async () => {
    fetchCalls += 1;
    return httpStub({ json: { choices: [{ message: { content: 'respuesta' }, finish_reason: 'stop' }] } });
  };
  main.capture(true);
  let threw = 0;
  const results = [];
  try {
    // ---- Fase 1: todo lo que debe quedar bloqueado ----
    for (const [label, messages] of blocked) {
      let res;
      try {
        res = await gen(null, { ...base, messages });
      } catch (error) {
        threw += 1;
        results.push([label, { ok: false, error: `LANZÓ: ${error.message}` }]);
        continue;
      }
      results.push([label, res]);
    }

    ok('S4 · ningún payload hostil hace que el handler LANCE', threw === 0,
      results.filter(([, r]) => /LANZÓ/.test(r.error || '')).map(([l]) => l).join(','));
    ok('S4 · todos los payloads hostiles se rechazan', results.every(([, r]) => r && r.ok === false),
      results.filter(([, r]) => !r || r.ok !== false).map(([l]) => l).join(','));
    ok('S4 · todos devuelven un objeto con forma estable', results.every(([, r]) => r && typeof r === 'object' && typeof r.ok === 'boolean'));
    ok('S4 · cada rechazo trae un mensaje de error no vacío',
      results.every(([, r]) => typeof r.error === 'string' && r.error.trim().length > 10),
      results.filter(([, r]) => !(typeof r.error === 'string' && r.error.length > 10)).map(([l, r]) => `${l}=${show(r.error)}`).join(' | '));
    ok('S4 · NINGÚN payload hostil llega a la API', fetchCalls === 0, `fetchCalls=${fetchCalls}`);
    ok('S4 · ningún mensaje de error es engañoso ("no se pudo conectar")',
      results.every(([, r]) => !/conectar con el proveedor/i.test(r.error || '')),
      results.map(([, r]) => r.error).filter((e) => /conectar/i.test(e || '')).join(' | '));

    // ---- Fase 2: lo legítimo NO debe quedar bloqueado ----
    fetchCalls = 0;
    const good = await gen(null, { ...base, messages: [{ role: 'system', content: 'Eres útil.' }, { role: 'user', content: 'hola' }] });
    ok('S4 · un prompt válido sí llega a la API', fetchCalls === 1, `fetchCalls=${fetchCalls}`);
    ok('S4 · un prompt válido devuelve el texto del modelo', good.ok === true && good.text === 'respuesta', show(good, 140));

    // content como array es legítimo (mensajes multimodales de la API).
    fetchCalls = 0;
    const multimodal = await gen(null, { ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'describe' }] }] });
    ok('S4 · un mensaje multimodal (content array) no se rechaza', multimodal.ok === true && fetchCalls === 1, show(multimodal, 140));

    // Un requestId reutilizado no debe heredar un AbortController viejo: si el
    // finally no lo borrara del mapa, la segunda llamada nacería ya abortada.
    fetchCalls = 0;
    const first = await gen(null, { ...base, messages: [{ role: 'user', content: 'uno' }], requestId: 'REQ-REPETIDO' });
    const second = await gen(null, { ...base, messages: [{ role: 'user', content: 'dos' }], requestId: 'REQ-REPETIDO' });
    ok('S4 · reutilizar requestId funciona dos veces seguidas', first.ok === true && second.ok === true,
      `${show(first, 90)} / ${show(second, 90)}`);
    ok('S4 · ambas llamadas con requestId repetido llegaron a la API', fetchCalls === 2, `fetchCalls=${fetchCalls}`);

    // ai:cancel con identificadores inexistentes o ya terminados no debe lanzar.
    ok('S4 · cancelar un requestId inexistente no rompe nada', (() => {
      try { cancel(null, 'REQ-QUE-NO-EXISTE'); return true; } catch { return false; }
    })());
    ok('S4 · cancelar un requestId ya terminado no rompe nada', (() => {
      try { cancel(null, 'REQ-REPETIDO'); return true; } catch { return false; }
    })());

    // ---- Fase 3: el log estructurado de todo lo anterior ----
    const events = main.events();
    ok('S4 · cada rechazo queda registrado en el log estructurado', events.length >= blocked.length, `${events.length} eventos / ${blocked.length} payloads`);
    ok('S4 · el log distingue el motivo del rechazo', events.some((e) => e.event === 'prompt_size_unmeasurable') && events.some((e) => e.event === 'prompt_messages_invalid'),
      [...new Set(events.map((e) => e.event))].join(','));
    ok('S4 · todos los eventos llevan trace_id', events.every((e) => typeof e.trace_id === 'string' && e.trace_id.length > 0));
    ok('S4 · los únicos errores registrados vienen de payloads hostiles',
      events.filter((e) => e.level === 'error').every((e) => e.event === 'prompt_size_unmeasurable' || e.event === 'prompt_shape_unreadable'),
      events.filter((e) => e.level === 'error').map((e) => e.event).join(','));
  } finally {
    global.fetch = realFetch;
    main.capture(false);
  }
}

async function concurrencyStorm(main) {
  const PARALLEL = 40;
  const payload = {
    settings: { authorName: 'Estrés', ai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } },
    stories: Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `Obra ${i}`, chapters: [{ id: `c${i}`, title: 'Cap', content: '<p>texto</p>' }] })),
    characters: [], activityLog: []
  };
  const save = main.handlers['data:save'];
  const load = main.handlers['data:load'];

  const run = await timed(async () => Promise.all(
    Array.from({ length: PARALLEL }, (_, i) => (i % 3 === 0 ? load(null) : save(null, payload)))
  ));
  const results = run.out;

  // data:save devuelve un sobre {ok}; data:load devuelve los DATOS normalizados.
  // Exigir la misma forma a los dos era un error de la prueba, no del código.
  const saves = results.filter((_, i) => i % 3 !== 0);
  const loads = results.filter((_, i) => i % 3 === 0);
  ok(`S5 · las ${PARALLEL} operaciones en paralelo resuelven todas`, results.length === PARALLEL && results.every((r) => r && typeof r === 'object'));
  ok(`S5 · los ${saves.length} guardados paralelos tienen forma de sobre`, saves.every((r) => typeof r.ok === 'boolean'),
    show(saves.find((r) => typeof r.ok !== 'boolean'), 120));
  ok('S5 · ningún guardado paralelo falla', saves.every((r) => r.ok === true),
    saves.filter((r) => !r.ok).map((r) => r.error).slice(0, 3).join(' | '));
  ok(`S5 · las ${loads.length} lecturas paralelas devuelven datos normalizados`, loads.every((r) => Array.isArray(r.stories)),
    show(loads[0], 120));
  ok('S5 · ninguna lectura devuelve datos a medio normalizar', loads.every((r) => Array.isArray(r.characters) && Array.isArray(r.activityLog)));
  ok('S5 · el archivo en disco queda íntegro tras la concurrencia', (() => {
    try {
      const read = JSON.parse(fs.readFileSync(path.join(main.userData, 'lorevinci-data.json'), 'utf8'));
      return Array.isArray(read.stories) && read.stories.length === 25;
    } catch { return false; }
  })());
  ok(`S5 · ${PARALLEL} operaciones concurrentes en ${run.ms} ms`, run.ms < 15000, `${run.ms} ms`);
}

async function backupRotationStorm(main) {
  const ROUNDS = 40;
  const payload = {
    settings: { authorName: 'Rotación', ai: { apiKey: '', baseUrl: '', model: '' } },
    stories: [{ id: 's1', title: 'Obra', chapters: [] }], characters: [], activityLog: []
  };
  const dataFile = path.join(main.userData, 'lorevinci-data.json');
  const save = main.handlers['data:save'];

  // Envenena .bak3 con un directorio no vacío: unlinkSync falla de verdad en
  // CADA ronda, así que la rotación se ejercita en su peor caso, repetido.
  // La tormenta de concurrencia anterior ya creó .bak3 como ARCHIVO; hay que
  // retirarlo antes de poner el directorio que hace fallar unlinkSync.
  fs.rmSync(dataFile + '.bak3', { recursive: true, force: true });
  fs.mkdirSync(dataFile + '.bak3', { recursive: true });
  fs.writeFileSync(path.join(dataFile + '.bak3', 'estorbo.txt'), 'x');

  main.capture(true);
  let failed = 0;
  const run = await timed(async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      try {
        const res = await save(null, payload);
        if (!res || res.ok !== true) failed += 1;
      } catch { failed += 1; }
    }
  });
  const events = main.events();
  main.capture(false);

  const bakFiles = fs.readdirSync(main.userData).filter((f) => f.includes('.bak'));
  ok(`S6 · ${ROUNDS} guardados con la rotación rota no impiden guardar NINGUNO`, failed === 0, `failed=${failed}`);
  ok('S6 · cada paso fallido de la rotación queda registrado', events.filter((e) => e.event === 'backup_rotation_step_failed').length >= ROUNDS,
    String(events.filter((e) => e.event === 'backup_rotation_step_failed').length));
  ok('S6 · los respaldos NO crecen sin tope', bakFiles.length <= 4, bakFiles.join(','));
  ok('S6 · el archivo principal sigue existiendo y es JSON válido', (() => {
    try { JSON.parse(fs.readFileSync(dataFile, 'utf8')); return true; } catch { return false; }
  })());
  ok('S6 · el log de la rotación no crece más que las rondas', events.length < ROUNDS * 12, String(events.length));
  ok(`S6 · ${ROUNDS} rondas de rotación fallida en ${run.ms} ms`, run.ms < 20000, `${run.ms} ms`);
}

async function webSearchStorm(main) {
  const search = main.handlers['web:search'];
  // 1.5 MB de HTML con 300 enlaces rotos y 40 válidos: el caso real de un
  // buscador que cambia de markup. La promesa es que la búsqueda devuelva los
  // válidos y no reviente con los rotos.
  // `new URL('http://', base)` LANZA. La primera versión usaba `%%%roto%%%`, que
  // con una base se resuelve sin error y acaba descartado como enlace interno:
  // la prueba no ejercitaba la ruta de fallo que decía ejercitar.
  const brokenTargets = ['http://', 'https://[malformado', 'http://exa mple.org/x', 'https://%%%', 'http://a:b:c/'];
  const broken = Array.from({ length: 300 }, (_, i) => `<a class="result__a" href="${brokenTargets[i % brokenTargets.length]}"><b>Título</b> roto ${i}</a><div class="result__snippet">relleno ${'x'.repeat(200)}</div>`).join('\n');
  const valid = Array.from({ length: 40 }, (_, i) => `<a class="result__a" href="https://ejemplo.org/pagina-${i}">Resultado válido ${i}</a><div class="result__snippet">Snippet del resultado ${i}</div>`).join('\n');
  const html = `<html><body>${broken}${valid}${'<!-- relleno -->'.repeat(20000)}</body></html>`;

  const realFetch = global.fetch;
  global.fetch = async () => httpStub({ body: html });
  main.capture(true);
  let res;
  let threw = null;
  const run = await timed(async () => {
    try { res = await search(null, { query: 'novela histórica', provider: 'web' }); } catch (error) { threw = error; }
  });
  const events = main.events();
  main.capture(false);
  global.fetch = realFetch;

  ok('S7 · una página de búsqueda enorme y rota no hace lanzar al handler', threw === null, threw && threw.message);
  ok('S7 · la búsqueda devuelve resultados pese a los 300 enlaces rotos', res && res.ok === true && res.results.length > 0, show(res, 160));
  ok('S7 · solo se conservan enlaces http/https válidos', res.results.every((r) => /^https?:\/\//.test(r.url)), res.results.map((r) => r.url).filter((u) => !/^https?:/.test(u)).slice(0, 3).join(','));
  ok('S7 · el tope de resultados se respeta', res.results.length <= 18, String(res.results.length));
  ok('S7 · los enlaces descartados se cuentan en el log', events.some((e) => e.event === 'web_results_links_skipped'), events.map((e) => e.event).slice(0, 5).join(','));
  ok('S7 · ningún resultado trae HTML sin sanitizar en el título', res.results.every((r) => !/<[a-z]/i.test(r.title)), res.results.map((r) => r.title).filter((t) => /</.test(t)).slice(0, 2).join(' | '));
  ok('S7 · los snippets quedan recortados', res.results.every((r) => r.snippet.length <= 700));
  ok(`S7 · procesar ${Math.round(html.length / 1024)} KB de HTML en ${run.ms} ms`, run.ms < 20000, `${run.ms} ms`);

  // Sin resultados válidos: debe informar, no devolver un ok:true vacío.
  global.fetch = async () => httpStub({ body: '<html><body>sin resultados aquí</body></html>' });
  const empty = await search(null, { query: 'zzz', provider: 'web' });
  global.fetch = realFetch;
  ok('S7 · una búsqueda sin resultados lo dice explícitamente', empty.ok === false && typeof empty.error === 'string' && empty.error.length > 5, show(empty, 120));

  // Proveedor que devuelve HTTP 500: no debe tumbar el resto de proveedores.
  global.fetch = async () => httpStub({ ok: false, status: 500, body: 'server error' });
  const allDown = await search(null, { query: 'fantasía', provider: 'all' });
  global.fetch = realFetch;
  ok('S7 · con todos los proveedores caídos devuelve un error compuesto', allDown.ok === false && /Wikipedia|Web|Open Library/.test(allDown.error), show(allDown, 160));
  ok('S7 · el handler nunca lanza aunque fallen todos los proveedores', true);
}

async function clipboardAndLimitsStorm(main) {
  const write = main.handlers['clipboard:write'];
  const sizes = [0, 1, 1000, 19999, 20000, 20001, 250000, 2000000];
  const results = [];
  for (const size of sizes) {
    results.push(await write(null, 'x'.repeat(size)));
  }
  ok('S8 · el portapapeles acepta textos de 0 a 2 MB sin lanzar', results.every((r) => r && r.ok === true), show(results.filter((r) => !r.ok)));
  ok('S8 · lo escrito al portapapeles queda recortado al límite', main.clipWritten.every((n) => n <= 20000), main.clipWritten.join(','));
  ok('S8 · el texto enorme se trunca en vez de rechazar', main.clipWritten[main.clipWritten.length - 1] === 20000, String(main.clipWritten[main.clipWritten.length - 1]));

  // Entrada no textual: el handler promete escribir "algo" sin romperse.
  const weird = [null, undefined, 42, { a: 1 }, ['x'], Symbol.iterator ? NaN : 0];
  let threw = 0;
  for (const value of weird) {
    try { await write(null, value); } catch { threw += 1; }
  }
  ok('S8 · el portapapeles no lanza ante entradas no textuales', threw === 0, `lanzó ${threw} veces`);
}

// ============================================================
// 5. VOLUMEN — el renderer con una biblioteca grande de verdad
// ============================================================
function bigSeed({ stories = 400, chaptersPerStory = 3, wordsPerChapter = 220, characters = 250, docs = 120 } = {}) {
  const paragraph = (seedWord) => Array.from({ length: wordsPerChapter }, (_, i) => `${seedWord}${i}`).join(' ');
  return makeSeed({
    stories: Array.from({ length: stories }, (_, s) => ({
      id: `s${s}`,
      title: `Obra de estrés ${s}`,
      genre: 'Fantasía',
      synopsis: paragraph('sinopsis'),
      rules: paragraph('reglas'),
      outline: paragraph('esquema'),
      color: '#345',
      coverImage: null,
      notes: [{ id: `n${s}`, title: 'Nota', body: paragraph('nota') }],
      attachedDocs: [],
      chapters: Array.from({ length: chaptersPerStory }, (_, c) => ({
        id: `s${s}c${c}`,
        title: `Capítulo ${c + 1}`,
        content: `<p>${paragraph(`cap${s}_${c}`)}</p>`,
        status: 'draft'
      })),
      createdAt: 1,
      updatedAt: 1
    })),
    characters: Array.from({ length: characters }, (_, i) => ({
      id: `ch${i}`, name: `Personaje ${i}`, role: 'protagonista',
      description: paragraph(`personaje${i}`), storyIds: [`s${i % stories}`]
    })),
    globalDocs: Array.from({ length: docs }, (_, i) => ({ id: `d${i}`, title: `Documento ${i}`, content: paragraph(`doc${i}`) })),
    activityLog: Array.from({ length: 900 }, (_, i) => ({ date: `2026-0${(i % 9) + 1}-1${i % 9}`, words: 10 + (i % 50) })),
    collabNotes: [],
    notifications: []
  });
}

async function volumeStress() {
  const seed = bigSeed();
  const totalChapters = seed.stories.reduce((acc, s) => acc + s.chapters.length, 0);
  const boot = await timed(async () => {
    const app = makeApp({ seed });
    // El arranque carga datos, renderiza y construye índices: se espera a que se asiente.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return app;
  });
  const { w, errors, parsedLogs } = boot.out;
  const d = w.document;
  const probe = w.__probe;

  ok(`S9 · arranca con ${seed.stories.length} obras y ${totalChapters} capítulos`, probe('DATA.stories.length') === seed.stories.length, String(probe('DATA.stories.length')));
  ok('S9 · el arranque no produce errores de ejecución', errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e)).length === 0,
    errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e)).slice(0, 3).join(' | '));
  ok(`S9 · el arranque completo cuesta menos de 12 s (${boot.ms} ms)`, boot.ms < 12000, `${boot.ms} ms`);

  // ---- Renderizado de la lista bajo volumen ----
  const renderRun = await timed(async () => probe('renderStories(); document.querySelectorAll("#storyGrid > .story-card").length'));
  const rendered = renderRun.out;
  ok('S9 · la lista de obras se renderiza con volumen', rendered > 0, String(rendered));
  ok(`S9 · renderizar ${rendered} tarjetas cuesta menos de 6 s (${renderRun.ms} ms)`, renderRun.ms < 6000, `${renderRun.ms} ms`);

  // ---- Re-renderizado repetido: el DOM no debe acumular ----
  const before = probe('document.querySelectorAll("#storyGrid > .story-card").length');
  for (let i = 0; i < 12; i += 1) probe('renderStories()');
  const after = probe('document.querySelectorAll("#storyGrid > .story-card").length');
  ok('S9 · re-renderizar 12 veces NO duplica las tarjetas del DOM', before === after, `${before} → ${after}`);

  // ---- Índice de búsqueda sobre todo el manuscrito ----
  probe('globalSearchIndex = []');
  const indexRun = await timed(async () => probe('buildSearchIndex(); globalSearchIndex.length'));
  ok('S9 · el índice de búsqueda cubre el manuscrito', indexRun.out > 100, String(indexRun.out));
  ok(`S9 · indexar ${totalChapters} capítulos cuesta menos de 25 s (${indexRun.ms} ms)`, indexRun.ms < 25000, `${indexRun.ms} ms`);

  const firstSearch = await timed(async () => probe('searchEverything("cap3_150")'));
  const secondSearch = await timed(async () => probe('searchEverything("cap3_150")'));
  ok('S9 · la búsqueda encuentra lo que existe en el manuscrito', Array.isArray(firstSearch.out) && firstSearch.out.length > 0, show(firstSearch.out, 120));
  ok(`S9 · buscar en ${totalChapters} capítulos cuesta menos de 5 s (${firstSearch.ms} ms)`, firstSearch.ms < 5000, `${firstSearch.ms} ms`);
  ok('S9 · la segunda búsqueda usa el índice y no es más lenta', secondSearch.ms <= firstSearch.ms + 50, `${firstSearch.ms} → ${secondSearch.ms} ms`);
  const missing = await timed(async () => probe('searchEverything("zzz_no_existe_en_ningun_lado")'));
  ok('S9 · buscar algo inexistente devuelve vacío sin romper', Array.isArray(missing.out) && missing.out.length === 0, show(missing.out, 80));

  // ---- Límites que impiden crecimiento sin tope ----
  probe('DATA.notifications = []');
  const NOTIF_BURST = 1000;

  // Medir aquí el tiempo de pared es engañoso: `pushNotification` llama a
  // `$('#notifBtn')` y el querySelector de jsdom cuesta ~1,2 ms por llamada
  // (perfilado: 1222 ms en 1000 búsquedas, frente a 2 ms de 1000 uid()). En un
  // navegador real eso son microsegundos. Así que en vez de un presupuesto
  // absoluto que mediría jsdom, se compara contra la MISMA cantidad de búsquedas
  // de DOM: si el producto no añade trabajo cuadrático, el coste total debe ser
  // del mismo orden que el baseline del entorno.
  const baseline = await timed(async () => probe(`
    (() => { let hits = 0; for (let i = 0; i < ${NOTIF_BURST}; i += 1) hits += $('#notifBtn') ? 1 : 0; return hits; })()
  `));
  const notifRun = await timed(async () => probe(`
    (() => {
      for (let i = 0; i < ${NOTIF_BURST}; i += 1) pushNotification('t' + i, 'x', 'info');
      return DATA.notifications.length;
    })()
  `));

  ok(`S9 · ${NOTIF_BURST} notificaciones se recortan al tope del producto`, notifRun.out <= 60, String(notifRun.out));
  ok('S9 · se conservan las notificaciones más recientes', probe('DATA.notifications[0].title') === `t${NOTIF_BURST - 1}`, String(probe('DATA.notifications[0].title')));
  ok(`S9 · ${NOTIF_BURST} notificaciones no añaden trabajo cuadrático sobre el coste del DOM (${notifRun.ms} ms vs baseline ${baseline.ms} ms)`,
    notifRun.ms < Math.max(2500, baseline.ms * 4), `${notifRun.ms} ms vs ${baseline.ms} ms`);

  // Fuga real de DOM: la insignia se crea solo si no existe, así que por muchas
  // notificaciones que pasen debe quedar EXACTAMENTE una.
  ok('S9 · la insignia de la campana no se duplica tras 1000 notificaciones',
    probe("document.querySelectorAll('.notif-badge').length") === 1, String(probe("document.querySelectorAll('.notif-badge').length")));
  ok('S9 · la insignia muestra el tope visible, no el contador crudo',
    probe("document.querySelector('.notif-badge').textContent") === '9+', String(probe("document.querySelector('.notif-badge').textContent")));
  ok('S9 · el aria-label del campana refleja los no leídos', /sin leer/.test(String(probe("document.getElementById('notifBtn').getAttribute('aria-label')"))),
    String(probe("document.getElementById('notifBtn').getAttribute('aria-label')")));

  // El panel solo pinta las 25 más recientes: abrirlo con el tope lleno no debe
  // volcar las 60 ni acumular nodos entre aperturas.
  probe('renderNotificationPanel()');
  const panelFirst = probe("document.querySelectorAll('#notifList > *').length");
  probe('renderNotificationPanel()');
  probe('renderNotificationPanel()');
  const panelThird = probe("document.querySelectorAll('#notifList > *').length");
  ok('S9 · el panel pinta solo las 25 notificaciones más recientes', panelFirst === 25, String(panelFirst));
  ok('S9 · reabrir el panel tres veces no acumula filas', panelFirst === panelThird, `${panelFirst} → ${panelThird}`);

  // ---- Sanitizado de un capítulo muy grande ----
  probe(`DATA.stories[0].chapters[0].content = '<p>' + 'palabra '.repeat(30000) + '</p><script>alert(1)</scr' + 'ipt>'`);
  const sanitizeRun = await timed(async () => probe('sanitizeHtml(DATA.stories[0].chapters[0].content)'));
  ok(`S9 · sanitizar 30 000 palabras cuesta menos de 15 s (${sanitizeRun.ms} ms)`, sanitizeRun.ms < 15000, `${sanitizeRun.ms} ms`);
  ok('S9 · el sanitizado elimina el script inyectado', !/<script/i.test(String(sanitizeRun.out)), String(sanitizeRun.out).slice(-120));

  // ---- Guardado real bajo volumen ----
  let saveCalls = 0;
  w.lorevinci.saveData = async () => { saveCalls += 1; return { ok: true }; };
  probe('scheduleSave()');
  await new Promise((resolve) => setTimeout(resolve, 900));
  ok('S9 · una biblioteca grande se guarda en una sola escritura', saveCalls === 1, `saveCalls=${saveCalls}`);
  for (let i = 0; i < 40; i += 1) { probe('scheduleSave()'); await new Promise((resolve) => setTimeout(resolve, 5)); }
  await new Promise((resolve) => setTimeout(resolve, 900));
  ok('S9 · 40 guardados seguidos se agrupan (no hay una escritura por edición)', saveCalls <= 4, `saveCalls=${saveCalls}`);

  // ---- Interacción real bajo volumen: abrir el editor de una obra ----
  const targetIndex = Math.floor(seed.stories.length / 2);
  const targetId = seed.stories[targetIndex].id;
  const navRun = await timed(async () => {
    probe(`openStoryEditor('${targetId}')`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    return d.querySelectorAll('#chapterList > *').length;
  });
  ok('S9 · abrir una obra con la biblioteca cargada puebla la lista de capítulos', navRun.out === seed.stories[0].chapters.length, `${navRun.out} capítulos`);
  ok(`S9 · navegar a una obra cuesta menos de 6 s (${navRun.ms} ms)`, navRun.ms < 6000, `${navRun.ms} ms`);
  ok('S9 · la obra abierta es EXACTAMENTE la que se pidió', probe('currentStoryId') === targetId, String(probe('currentStoryId')));
  ok('S9 · la migaja de pan refleja la obra abierta', d.getElementById('crumb').textContent === seed.stories[targetIndex].title, d.getElementById('crumb').textContent);

  ok('S9 · tras toda la carga no aparecen errores de ejecución', errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e)).length === 0,
    errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e)).slice(0, 3).join(' | '));
  ok('S9 · la carga no dispara logs de error inesperados', parsedLogs().filter((e) => e.level === 'error' && e.event !== 'local_load_failed').length === 0,
    parsedLogs().filter((e) => e.level === 'error').map((e) => e.event).slice(0, 4).join(','));

  w.close();
}

// ============================================================
// 6. Cuota de almacenamiento agotada (el navegador dice "no cabe")
// ============================================================
async function quotaStress() {
  const app = makeApp({ seed: makeSeed() });
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const { w, errors, parsedLogs } = app;
  const probe = w.__probe;

  // Llena localStorage de verdad hasta que el navegador lance QuotaExceeded.
  const snapshotKey = probe('SNAPSHOT_STORAGE_KEY');
  // Se retira la instantánea existente para que la escritura siguiente sea una
  // adición neta: si la clave ya existe, reemplazarla libera sus bytes primero.
  w.localStorage.removeItem(snapshotKey);

  // Rellenar solo con bloques de 512 KB dejaba hasta 511 KB de hueco libre, así
  // que la instantánea cabía y la prueba no medía el escenario que anunciaba.
  // Se baja el tamaño del bloque hasta dejar la cuota a cero.
  const writtenKeys = [];
  let quotaHit = false;
  for (const size of [512 * 1024, 32 * 1024, 1024, 16, 1]) {
    const chunk = 'x'.repeat(size);
    for (let i = 0; i < 200; i += 1) {
      const key = `relleno-${size}-${i}`;
      try { w.localStorage.setItem(key, chunk); writtenKeys.push(key); } catch { quotaHit = true; break; }
    }
    // Sin `break` exterior a propósito: cuando un tamaño ya no cabe hay que
    // seguir con el siguiente más pequeño para consumir el hueco restante. La
    // primera versión salía en cuanto fallaba el bloque grande y dejaba hasta
    // 511 KB libres, así que la instantánea cabía y la prueba no medía nada.
  }

  ok('S10 · se pudo reproducir el agotamiento real de cuota', quotaHit, `claves escritas: ${writtenKeys.length}`);

  // Con la cuota llena, guardar una instantánea no debe tirar la app.
  let threw = 0;
  let snapshotResult = null;
  try { snapshotResult = probe('writeSnapshotStore({ cap: { at: 1 } })'); } catch { threw += 1; }
  ok('S10 · escribir una instantánea con la cuota llena NO lanza', threw === 0);
  ok('S10 · writeSnapshotStore informa del fracaso en vez de callar', snapshotResult === false, String(snapshotResult));
  ok('S10 · el fallo por cuota queda registrado', parsedLogs().some((e) => e.event === 'snapshot_write_failed'),
    parsedLogs().slice(-4).map((e) => e.event).join(','));

  // La aplicación sigue siendo utilizable: el capítulo sigue ahí.
  ok('S10 · la app sigue viva tras agotar la cuota', probe('DATA.stories.length') === 1, String(probe('DATA.stories.length')));
  ok('S10 · leer las instantáneas con la cuota llena no rompe', (() => {
    try { return typeof probe('readSnapshotStore()') === 'object'; } catch { return false; }
  })());
  ok('S10 · no aparecen errores de ejecución nuevos', errors.filter((e) => !/Not implemented|Could not parse CSS|QuotaExceeded/i.test(e)).length === 0,
    errors.filter((e) => !/Not implemented|Could not parse CSS|QuotaExceeded/i.test(e)).slice(0, 2).join(' | '));

  writtenKeys.forEach((key) => w.localStorage.removeItem(key));
  w.close();
}

// ============================================================
// 7. Motor de campaña bajo fuego repetido (motor puro, sin DOM)
// ============================================================
function engineStory() {
  return {
    projectMode: 'rpg',
    rpg: {
      player: {
        name: 'Akira', age: 18, occupation: 'Chamán', grade: '4', motivation: 'Proteger a su hermana',
        equipment: 'Katana Grado 4', innateTechnique: 'Desgarro Vectorial', heavenlyRestriction: false,
        attributes: { strength: 4, agility: 5, resistance: 3, control: 8, flow: 7, reserve: 2 },
        resources: { pemCurrent: 130, hpCurrent: 80 }, conditions: []
      }
    }
  };
}

async function engineStress() {
  // Carga el motor aislado: así se mide el motor de reglas, no jsdom.
  const engineSource = fs.readFileSync(path.join(P, 'rpg-engine.js'), 'utf8');
  const fakeWindow = { crypto: { getRandomValues: (a) => { a[0] = 19; return a; } } };
  new Function('window', engineSource)(fakeWindow);
  const E = fakeWindow.LoreRpgEngine;
  ok('S11 · el motor se carga sin DOM', typeof E === 'object' && typeof E.resolveAction === 'function');

  const story = engineStory();
  E.ensureStory(story);

  // ---- 600 resoluciones de acción ----
  const ACTIONS = 600;
  const run = await timed(async () => {
    let produced = 0;
    for (let i = 0; i < ACTIONS; i += 1) {
      const parsed = E.parseInput(`// Ataco con mi técnica maldita CD ${10 + (i % 10)}`);
      const out = E.resolveAction(story, parsed, { forcedRoll: 1 + (i % 20) });
      if (out && typeof out === 'object') produced += 1;
    }
    return produced;
  });
  ok(`S11 · ${ACTIONS} resoluciones devuelven siempre un objeto`, run.out === ACTIONS, String(run.out));
  ok(`S11 · ${ACTIONS} resoluciones en ${run.ms} ms`, run.ms < 15000, `${run.ms} ms`);

  // ---- Determinismo: misma entrada, misma salida ----
  const once = JSON.stringify(E.resolveAction(story, E.parseInput('// Ataco con mi técnica maldita CD 15'), { forcedRoll: 12 }));
  const twice = JSON.stringify(E.resolveAction(story, E.parseInput('// Ataco con mi técnica maldita CD 15'), { forcedRoll: 12 }));
  ok('S11 · la misma tirada forzada produce el mismo resultado', typeof once === 'string' && once === twice, `${String(once).slice(0, 70)} vs ${String(twice).slice(0, 70)}`);
  ok('S11 · el resultado es serializable (viaja por IPC)', typeof once === 'string' && once.startsWith('{') && once.length > 10, String(once).slice(0, 90));

  // ---- Volumen de reglas: una campaña con 500 reglas numeradas ----
  const manyRules = Array.from({ length: 500 }, (_, i) => `${i + 1}. Regla de estrés ${i + 1}: condición persistente que el motor debe conservar.`).join('');
  const compileRun = await timed(async () => E.compileRules(manyRules));
  ok('S11 · compila las 500 reglas sin recortar', compileRun.out.rules.length === 500, String(compileRun.out.rules.length));
  ok(`S11 · compilar 500 reglas cuesta menos de 10 s (${compileRun.ms} ms)`, compileRun.ms < 10000, `${compileRun.ms} ms`);

  // ---- 2000 entradas de jugador clasificadas ----
  const parseRun = await timed(async () => {
    let typed = 0;
    for (let i = 0; i < 2000; i += 1) {
      const prefix = ['// ', '— ', '[', ''][i % 4];
      const out = E.parseInput(`${prefix}entrada número ${i}`);
      if (out && typeof out.type === 'string' && out.type.length > 0) typed += 1;
    }
    return typed;
  });
  ok('S11 · 2000 entradas de jugador se clasifican todas', parseRun.out === 2000, String(parseRun.out));
  ok(`S11 · clasificar 2000 entradas cuesta menos de 5 s (${parseRun.ms} ms)`, parseRun.ms < 5000, `${parseRun.ms} ms`);

  // ---- Auditoría de salida de la IA con texto hostil y enorme ----
  const hostileText = `${'El pasillo tiembla mientras avanzas. '.repeat(4000)}\nThe user wants me to continue the novel from the last word.\n${'Relleno. '.repeat(4000)}`;
  const auditRun = await timed(async () => E.auditModelOutput(hostileText));
  ok('S11 · auditar 150 KB de salida de IA no lanza', auditRun.out && typeof auditRun.out.ok === 'boolean');
  ok('S11 · la auditoría detecta el razonamiento meta incrustado en texto enorme', auditRun.out.ok === false, show(auditRun.out, 140));
  ok(`S11 · auditar 150 KB cuesta menos de 15 s (${auditRun.ms} ms)`, auditRun.ms < 15000, `${auditRun.ms} ms`);

  const gmRun = await timed(async () => E.auditGmOutput('Levantas el brazo, corres al bosque y atacas. '.repeat(2000)));
  ok('S11 · la auditoría del GM aguanta el mismo volumen', gmRun.out && typeof gmRun.out.ok === 'boolean');
  ok('S11 · detecta la acción impuesta al jugador en texto repetido', gmRun.out.ok === false);
}

// ============================================================
// 8. CONTRATO — que nada de lo que la app promete quede desconectado
// ============================================================
// La app de escritorio tiene tres costuras que pueden romperse en silencio y no
// las cubre ninguna prueba funcional, porque cada una vive en un proceso o en un
// fichero distinto:
//   · preload.js invoca un canal IPC que main.js no registra → botón muerto.
//   · app.js llama a window.lorevinci.X que el preload no expone → TypeError.
//   · index.html carga un script que no existe, o en el orden equivocado → la
//     app no arranca.
// Se verifican las tres en ambos sentidos.
async function contractStress() {
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(P, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(P, 'index.html'), 'utf8');

  const collect = (src, re) => { const set = new Set(); for (const m of src.matchAll(re)) set.add(m[1]); return set; };

  // ---- Canales IPC ----
  const invoked = collect(preload, /ipcRenderer\.(?:invoke|send|on)\(\s*'([^']+)'/g);
  const handled = collect(mainSrc, /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g);
  const orphan = [...invoked].filter((c) => !handled.has(c));
  const unused = [...handled].filter((c) => !invoked.has(c));

  ok(`S13 · el preload invoca un conjunto real de canales (${invoked.size})`, invoked.size >= 12, String(invoked.size));
  ok('S13 · TODOS los canales del preload tienen handler en main.js', orphan.length === 0, orphan.join(', '));
  ok('S13 · ningún handler de main.js queda sin usar desde el preload', unused.length === 0, unused.join(', '));

  // ---- Puente window.lorevinci ----
  const bridgeStart = preload.indexOf("exposeInMainWorld('lorevinci'");
  ok('S13 · el preload expone el puente lorevinci', bridgeStart > 0);
  const bridgeBlock = preload.slice(bridgeStart);
  const KEYWORDS = new Set(['if', 'return', 'else', 'for', 'while', 'switch', 'catch', 'function', 'const', 'let', 'var', 'await', 'async']);
  const exposed = new Set();
  for (const m of bridgeBlock.matchAll(/^\s{2,4}([a-zA-Z][A-Za-z0-9_]*)\s*[,:]/gm)) if (!KEYWORDS.has(m[1])) exposed.add(m[1]);
  for (const m of bridgeBlock.matchAll(/^\s{2,4}([a-zA-Z][A-Za-z0-9_]*)\s*\(/gm)) if (!KEYWORDS.has(m[1])) exposed.add(m[1]);
  const usedBridge = collect(appSrc, /window\.lorevinci\.([a-zA-Z][A-Za-z0-9_]*)/g);
  const missingBridge = [...usedBridge].filter((k) => !exposed.has(k));

  ok(`S13 · el renderer usa ${usedBridge.size} métodos del puente`, usedBridge.size >= 10, String(usedBridge.size));
  ok('S13 · TODOS los métodos del puente que usa el renderer están expuestos', missingBridge.length === 0, missingBridge.join(', '));

  // ---- Scripts de index.html: existen y en el orden correcto ----
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const absent = scripts.filter((src) => !fs.existsSync(path.join(P, src)));
  ok(`S13 · index.html referencia ${scripts.length} scripts locales`, scripts.length >= 5, String(scripts.length));
  ok('S13 · TODOS los scripts referenciados existen en disco', absent.length === 0, absent.join(', '));

  // app-kernel.js define LoreKernel, que app.js usa en el ámbito superior del
  // fichero (el logger raíz y el puente web). Si el orden se invierte, la app no
  // arranca: ReferenceError por zona muerta temporal.
  const order = ['app-config.js', 'app-kernel.js', 'dom-safe.js', 'seed-data.js', 'rpg-engine.js', 'app.js'];
  const positions = order.map((f) => scripts.indexOf(f));
  ok('S13 · los seis módulos propios están en index.html', positions.every((p) => p >= 0), positions.join(','));
  ok('S13 · app.js se carga AL FINAL (depende de los otros cinco)', positions[5] === Math.max(...positions), positions.join(','));
  ok('S13 · app-kernel.js se carga ANTES que app.js', positions[1] < positions[5], `${positions[1]} vs ${positions[5]}`);
  ok('S13 · los módulos compartidos van antes que el motor y la app', Math.max(positions[0], positions[1], positions[2], positions[3]) < Math.min(positions[4], positions[5]), positions.join(','));
  // app-config.js no depende de nada y los demás leen LoreConfig: si va después,
  // seed-data.js y app.js revientan con una zona muerta temporal.
  ok('S13 · app-config.js se carga ANTES que el kernel y la semilla', positions[0] < Math.min(positions[1], positions[3]), positions.join(','));

  // ---- Ninguna URL remota fuera del módulo de configuración ----
  // Regresión que protege el refactor completo: si alguien vuelve a pegar un
  // extremo en main.js o en app.js, la suite lo detecta. Se buscan solo las URLs
  // entre comillas o backticks, para no contar las que aparezcan en un
  // comentario. Las regex se construyen desde string: escritas como literal
  // escapado dentro de un parche, la secuencia de barras se corrompe con
  // facilidad y el resultado puede parsear "por accidente".
  const URL_IN_CODE = new RegExp(`['"\`](https?://[a-zA-Z0-9._-]+)`, 'g');
  const URL_ANY = new RegExp('https?://[a-zA-Z0-9._/?=&#%-]+', 'g');
  const configSrc = fs.readFileSync(path.join(P, 'app-config.js'), 'utf8');
  const sources = {
    'main.js': mainSrc,
    'renderer/app.js': appSrc,
    'renderer/seed-data.js': fs.readFileSync(path.join(P, 'seed-data.js'), 'utf8'),
    'renderer/app-kernel.js': fs.readFileSync(path.join(P, 'app-kernel.js'), 'utf8'),
    'renderer/rpg-engine.js': fs.readFileSync(path.join(P, 'rpg-engine.js'), 'utf8'),
    'renderer/dom-safe.js': fs.readFileSync(path.join(P, 'dom-safe.js'), 'utf8')
  };
  const stray = [];
  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(URL_IN_CODE)) stray.push(`${file} → ${m[1]}`);
  }
  ok('S13 · ninguna URL remota vive fuera de app-config.js', stray.length === 0, stray.join(' | '));
  const configUrls = new Set([...configSrc.matchAll(URL_ANY)].map((m) => m[0].replace(/[.,);]+$/, '')));
  ok('S13 · app-config.js concentra los 13 extremos remotos', configUrls.size === 13, String(configUrls.size));
  ok('S13 · la configuración es inmutable (no se puede mutar en caliente)', (() => {
    const cfg = require(path.join(P, 'app-config.js'));
    const before = cfg.AI.DEFAULT_BASE_URL;
    try { cfg.AI.DEFAULT_BASE_URL = 'http://malicioso.example'; } catch { /* freeze en modo estricto lanza */ }
    return cfg.AI.DEFAULT_BASE_URL === before;
  })());
  ok('S13 · los presets de proveedor están congelados en profundidad', (() => {
    const cfg = require(path.join(P, 'app-config.js'));
    const before = cfg.AI_PROVIDER_PRESETS.openai.model;
    try { cfg.AI_PROVIDER_PRESETS.openai.model = 'otro'; } catch { /* idem */ }
    return cfg.AI_PROVIDER_PRESETS.openai.model === before;
  })());
  ok('S13 · los constructores de URL codifican la consulta', (() => {
    const cfg = require(path.join(P, 'app-config.js'));
    return cfg.wikipediaSearchUrl('a b&c=d', 3).includes('srsearch=a%20b%26c%3Dd')
      && cfg.duckDuckGoSearchUrl('x?y').includes('q=x%3Fy')
      && cfg.wikipediaArticleUrl('El hobbit').endsWith('El_hobbit');
  })());
  ok('S13 · el límite de resultados se propaga al constructor', (() => {
    const cfg = require(path.join(P, 'app-config.js'));
    return cfg.wikipediaSearchUrl('x', 10).includes('srlimit=10') && cfg.openLibrarySearchUrl('x', 6).includes('limit=6');
  })());

  // ---- El puente web debe ser intercambiable con el de preload ----
  // preload.js expone N métodos; el puente que app.js instala en el navegador
  // debe ofrecer el MISMO conjunto. Si falta uno, ese código funciona en la app
  // de escritorio y revienta con un TypeError en el preview web. Lo detectó
  // tsc --checkJs; esta aserción lo fija para que no vuelva a ocurrir.
  const preloadKeys = new Set();
  const bridgeBlockSrc = preload.slice(bridgeStart);
  for (const m of bridgeBlockSrc.matchAll(/^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*[:,(]/gm)) if (!KEYWORDS.has(m[1])) preloadKeys.add(m[1]);
  const webBridge = makeApp({});
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const webKeys = new Set(Object.keys(webBridge.w.lorevinci));
  const missingInWeb = [...preloadKeys].filter((k) => !webKeys.has(k));
  const extraInWeb = [...webKeys].filter((k) => !preloadKeys.has(k));
  ok(`S13 · preload expone ${preloadKeys.size} métodos del puente`, preloadKeys.size >= 15, String(preloadKeys.size));
  ok('S13 · el puente web implementa TODOS los métodos de preload', missingInWeb.length === 0, missingInWeb.join(', '));
  ok('S13 · el puente web no inventa métodos que preload no tenga', extraInWeb.length === 0, extraInWeb.join(', '));
  ok('S13 · el puente web se declara como no-escritorio', webBridge.w.lorevinci.isDesktop === false);
  ok('S13 · onAppEvent del puente web devuelve una función de desuscripción',
    typeof webBridge.w.lorevinci.onAppEvent('app:save-failed', () => {}) === 'function');
  webBridge.w.close();



  // ---- Los assets de terceros también, que son los que rompen PDF y OCR ----
  const vendor = ['vendor/pdfjs/pdf.min.js', 'vendor/tesseract/tesseract.min.js'];
  ok('S13 · las librerías de PDF y OCR están presentes', vendor.every((v) => fs.existsSync(path.join(P, v))), vendor.join(', '));
  ok('S13 · ninguna librería de terceros está vacía o truncada',
    vendor.every((v) => fs.statSync(path.join(P, v)).size > 50000), vendor.map((v) => `${v}=${fs.statSync(path.join(P, v)).size}`).join(', '));

  // ---- Thenables de otro realm: el bug que perf.test.js destapó ----
  // El renderer vive en una ventana (Chromium, o jsdom en los tests) con su
  // PROPIO constructor Promise. Una promesa creada allí tiene `.then` pero no
  // pasa `instanceof Promise` visto desde Node. Mientras `attempt` usó
  // `instanceof`, esa promesa pendiente se envolvía en un Result YA resuelto: la
  // escritura parecía terminada y el núcleo lanzaba la siguiente, rompiendo la
  // garantía de "una sola escritura en vuelo a la vez".
  // Thenable que cumple el contrato completo: recibe resolve Y reject, como
  // cualquier promesa. La primera versión de este test solo pasaba `resolve` y
  // por eso el caso de rechazo reventaba con "resolve is not a function".
  const makeForeignThenable = (value, delayMs = 0) => ({
    then: (resolve, _reject) => { setTimeout(() => resolve(value), delayMs); }
  });
  const makeForeignRejection = (reason, delayMs = 0) => ({
    then: (_resolve, reject) => { setTimeout(() => reject(reason), delayMs); }
  });

  await (async () => {
    const foreign = makeForeignThenable('valor-foráneo');
    ok('S13 · un thenable ajeno al realm no pasa instanceof Promise (premisa del bug)',
      !(foreign instanceof Promise));

    const handled = K.attempt(() => foreign);
    ok('S13 · attempt devuelve una promesa nativa ante un thenable ajeno (no lo envuelve)',
      handled instanceof Promise && typeof handled.then === 'function');
    const settled = await handled;
    ok('S13 · attempt aguarda al thenable ajeno y entrega su valor',
      settled.isOk === true && settled.value === 'valor-foráneo', JSON.stringify(settled && settled.toJSON ? settled.toJSON() : settled));

    const rejected = K.attempt(() => makeForeignRejection(new Error('fallo foráneo')));
    const settledRejection = await rejected;
    ok('S13 · el rechazo de un thenable ajeno se convierte en Result erróneo, no en excepción',
      settledRejection.isErr === true && /fallo foráneo/.test(String(settledRejection.error.message)));

    const syncResult = K.attempt(() => 42);
    ok('S13 · una función síncrona sigue devolviendo un Result inmediato (no una promesa)',
      !(syncResult instanceof Promise) && syncResult.isOk === true && syncResult.value === 42);

    // runCleanup admite liberación síncrona o asíncrona; con un thenable ajeno
    // antes informaba el Result sin esperar a que el recurso se liberara.
    let released = false;
    const foreignRelease = {
      then: (resolve) => { setTimeout(() => { released = true; resolve('liberado'); }, 5); }
    };
    const cleanup = K.runCleanup('recurso-foráneo', () => foreignRelease);
    ok('S13 · runCleanup espera a un thenable ajeno antes de dar por hecha la limpieza',
      cleanup instanceof Promise && typeof cleanup.then === 'function');
    const cleanupResult = await cleanup;
    ok('S13 · runCleanup propaga el resultado de la liberación asíncrona',
      cleanupResult.isOk === true && released === true);

    // attemptAsync: el contrato asíncrono explícito.
    const asyncResult = await K.attemptAsync(async () => 'asíncrono');
    ok('S13 · attemptAsync resuelve Result con el valor de una función async',
      asyncResult.isOk === true && asyncResult.value === 'asíncrono');
    const asyncFailure = await K.attemptAsync(async () => { throw new Error('rechazo async'); });
    ok('S13 · attemptAsync convierte el rechazo en Result erróneo',
      asyncFailure.isErr === true && /rechazo async/.test(String(asyncFailure.error.message)));
    const syncViaAsync = await K.attemptAsync(() => 'síncrono-en-async');
    ok('S13 · attemptAsync también acepta una función síncrona',
      syncViaAsync.isOk === true && syncViaAsync.value === 'síncrono-en-async');
  })();
}

// ============================================================
// S14. Verificación estática: tsc --checkJs en cero errores
// ============================================================
// Por qué esto vive en la suite de estrés y no solo en un script de npm:
// `npm run typecheck` se ejecuta cuando alguien se acuerda. Dentro de la suite
// se ejecuta SIEMPRE, y un error nuevo rompe la build igual que lo haría un
// test funcional. Es lo que convierte la verificación de tipos en una garantía
// y no en una intención.
//
// La verificación ya demostró su valor: encontró el método `onAppEvent` que el
// preload exponía y el puente web no, es decir código que funcionaba en
// escritorio y lanzaba TypeError en el navegador. También encontró el `@returns`
// desactualizado de `ingestFilesIntoList`. Ninguno de los dos lo cubría un test.
function typecheckStorm() {
  const ROOT_DIR = ROOT;
  const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.json');
  ok('S14 · existe tsconfig.json', fs.existsSync(tsconfigPath));
  if (!fs.existsSync(tsconfigPath)) return;

  // JSON con comentarios: tsconfig los admite, así que se limpian antes de parsear.
  const raw = fs.readFileSync(tsconfigPath, 'utf8');
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1'));
  const co = cfg.compilerOptions || {};
  ok('S14 · checkJs está ACTIVADO (se verifica el JavaScript real, no solo los .ts)', co.checkJs === true);
  ok('S14 · allowJs está activado', co.allowJs === true);
  ok('S14 · noEmit: el compilador verifica y no genera artefactos', co.noEmit === true);
  ok('S14 · strict no está silenciado por omisión (aparece explícito en el fichero)', /"strict"\s*:/.test(raw));

  // Cobertura: si un fichero fuente queda fuera del include, se "verifica" sin
  // verificarlo. Se comprueba fichero a fichero contra los patrones declarados.
  const includes = cfg.include || [];
  const sources = ['main.js', 'preload.js', 'renderer/app.js', 'renderer/app-kernel.js',
    'renderer/app-config.js', 'renderer/seed-data.js', 'renderer/dom-safe.js', 'renderer/rpg-engine.js'];
  const uncovered = sources.filter((f) => !includes.some((g) => {
    // El centinela es texto y no un carácter de control: la versión anterior
    // usaba \u0000 y eslint lo rechazaba (no-control-regex) con razón.
    const rx = new RegExp('^' + g
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '@@GLOBSTAR@@')
      .replace(/\*/g, '[^/]*')
      .replace(/@@GLOBSTAR@@/g, '.*') + '$');
    return rx.test(f);
  }));
  ok(`S14 · los ${sources.length} ficheros fuente están cubiertos por include`, uncovered.length === 0, uncovered.join(', '));
  const excludes = cfg.exclude || [];
  ok('S14 · node_modules y vendor quedan excluidos (no se verifica código ajeno)',
    excludes.some((e) => e.includes('node_modules')) && excludes.some((e) => e.includes('vendor')));

  // Las declaraciones globales son lo que permite tipar window.LoreConfig como
  // `typeof import(...)` en vez de `any`: sin ellas no hay verificación real.
  const globalsPath = path.join(ROOT_DIR, 'types', 'globals.d.ts');
  ok('S14 · existe types/globals.d.ts', fs.existsSync(globalsPath));
  const globalsSrc = fs.existsSync(globalsPath) ? fs.readFileSync(globalsPath, 'utf8') : '';
  const typedGlobals = ['LoreConfig', 'LoreKernel', 'LoreSeed', 'LoreDomSafe', 'LoreRpgEngine'];
  // Se exige `typeof import(...)` y no `any`: con `any` el compilador calla y la
  // "verificación de tipos" pasaría a ser decorativa justo en los módulos propios.
  const looselyTyped = typedGlobals.filter((g) => !new RegExp(g + '\\s*:\\s*typeof import\\(').test(globalsSrc));
  ok('S14 · los 5 módulos propios están tipados con typeof import (no como any)', looselyTyped.length === 0, looselyTyped.join(', '));
  ok('S14 · el puente lorevinci tiene interfaz propia', /interface LoreBridge\b/.test(globalsSrc));

  // Contrato de npm: el script y la dependencia deben existir o la verificación
  // no es reproducible fuera de esta máquina.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  ok('S14 · package.json expone npm run typecheck', Boolean(pkg.scripts && pkg.scripts.typecheck));
  ok('S14 · verify encadena lint + typecheck + tests', /typecheck/.test(String(pkg.scripts && pkg.scripts.verify)));
  ok('S14 · typescript es una devDependency declarada', Boolean(pkg.devDependencies && pkg.devDependencies.typescript),
    'sin ella, un clon limpio no puede verificar nada');

  // ---- La compuerta real: ejecutar el compilador ----
  const tscJs = path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tscJs)) {
    ok('S14 · tsc ejecutado con cero errores', false, 'typescript no está instalado: ejecute npm install');
    return;
  }
  const { execFileSync } = require('child_process');
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [tscJs, '-p', tsconfigPath], {
      cwd: ROOT_DIR, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024
    });
  } catch (err) {
    status = typeof err.status === 'number' ? err.status : 1;
    stdout = String(err.stdout || '') + String(err.stderr || '');
  }
  const errors = stdout.split('\n').filter((l) => /error TS\d+:/.test(l));
  ok(`S14 · tsc --checkJs termina sin errores (${errors.length})`, status === 0 && errors.length === 0,
    errors.slice(0, 8).join(' | ') || `exit ${status}`);
  ok('S14 · el compilador no escribe ficheros (noEmit se respeta en la práctica)', status === 0 && !/error TS5055/.test(stdout));

  // Regresión concreta del bug que la verificación encontró: el puente web debe
  // seguir ofreciendo onAppEvent. Se comprueba sobre el fuente para que el test
  // no dependa de tener un DOM cargado.
  const appSrc = fs.readFileSync(path.join(P, 'app.js'), 'utf8');
  ok('S14 · el puente web sigue exponiendo onAppEvent (bug hallado por tsc)', /onAppEvent\s*:/.test(appSrc));
}

// ============================================================
// 15. Longitud de función: la garantía se verifica, no se declara
// ============================================================
/**
 * Comprueba que ninguna función del código de producción supera las 50 líneas.
 *
 * No basta con que el repo esté limpio hoy: sin una regla activa, la próxima
 * función de 300 líneas entra sin que nadie lo note. Esta sección verifica tres
 * cosas distintas, porque fallan por motivos distintos:
 *
 *   1. Que la regla esté ACTIVA en la configuración efectiva (no en el texto del
 *      fichero: se carga con require y se inspecciona qué queda vigente).
 *   2. Que el conjunto de supresiones sea cerrado y esté justificado. Una
 *      directiva eslint-disable es deuda silenciosa si nadie la vigila.
 *   3. Que la regla MUERDA. Un repo limpio no demuestra nada si la regla está
 *      mal configurada: se le pasa por stdin una función de 60 líneas y se exige
 *      que la señale.
 */
function functionLengthStorm() {
  const cfgPath = path.join(ROOT, 'eslint.config.js');
  ok('S15 · existe eslint.config.js', fs.existsSync(cfgPath));
  if (!fs.existsSync(cfgPath)) return;

  const blocks = require(cfgPath);
  const production = blocks.filter((b) => Array.isArray(b.files)
    && b.files.includes('main.js') && b.files.includes('renderer/*.js')
    && b.rules && b.rules['max-lines-per-function']);
  ok('S15 · un bloque activa max-lines-per-function sobre el código de producción',
    production.length === 1, show(production.map((b) => b.files.join(','))));

  const rule = production.length ? production[0].rules['max-lines-per-function'] : null;
  const opts = Array.isArray(rule) ? rule[1] : null;
  ok('S15 · el límite son 50 líneas', Boolean(opts) && opts.max === 50, show(opts));
  ok('S15 · mide código y no documentación (skipBlankLines y skipComments)',
    Boolean(opts) && opts.skipBlankLines === true && opts.skipComments === true, show(opts));
  ok('S15 · los envoltorios de módulo quedan exentos (IIFEs:false)',
    Boolean(opts) && opts.IIFEs === false, show(opts));
  ok('S15 · preload.js también está cubierto',
    production.length === 1 && production[0].files.includes('preload.js'),
    show(production.length ? production[0].files : []));

  // La exclusión de tests/ es una decisión documentada, no un olvido. Si alguien
  // la revoca al reordenar bloques, esta aserción lo señala en vez de dejar que
  // la suite empiece a fallar por guiones lineales.
  const testBlocks = blocks.filter((b) => Array.isArray(b.files) && b.files.some((f) => String(f).startsWith('tests/')));
  ok('S15 · la regla no se aplica a los suites de prueba (decisión documentada)',
    testBlocks.every((b) => !(b.rules && b.rules['max-lines-per-function'])),
    show(testBlocks.map((b) => b.files.join(','))));

  // ---- Supresiones: conjunto cerrado y justificado ----
  const sources = ['main.js', 'preload.js', 'renderer/app.js', 'renderer/app-kernel.js',
    'renderer/app-config.js', 'renderer/seed-data.js', 'renderer/dom-safe.js', 'renderer/rpg-engine.js'];
  const ALLOWED = ['renderer/app-config.js', 'renderer/app-kernel.js', 'renderer/dom-safe.js', 'renderer/seed-data.js'];
  const found = [];
  const unjustified = [];
  for (const rel of sources) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8').split('\n');
    src.forEach((line, i) => {
      if (!/eslint-disable(-next-line)?\s.*max-lines-per-function/.test(line)) return;
      found.push(rel);
      // El motivo debe preceder a la directiva: sin él, quien venga detrás no
      // sabe si la supresión sigue siendo necesaria.
      const prev = src.slice(Math.max(0, i - 8), i).join('\n');
      if (!/UMD|envoltorio|f[aá]brica/i.test(prev)) unjustified.push(rel + ':' + (i + 1));
    });
  }
  const unexpected = found.filter((f) => !ALLOWED.includes(f));
  const missing = ALLOWED.filter((f) => !found.includes(f));
  ok('S15 · las únicas supresiones son las 4 fábricas UMD',
    unexpected.length === 0 && missing.length === 0,
    show({ inesperadas: unexpected, ausentes: missing }));
  ok('S15 · cada supresión lleva su justificación encima', unjustified.length === 0, show(unjustified));

  // ---- La compuerta real: ejecutar ESLint ----
  const eslintBin = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!fs.existsSync(eslintBin)) {
    ok('S15 · eslint ejecutado sobre el código de producción', false, 'eslint no está instalado: ejecute npm install');
    return;
  }
  const { execFileSync } = require('child_process');
  const runEslint = (args, input) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [eslintBin, ...args], {
        cwd: ROOT, encoding: 'utf8', input, timeout: 240000, maxBuffer: 64 * 1024 * 1024
      }) };
    } catch (err) {
      return { status: typeof err.status === 'number' ? err.status : 1, out: String(err.stdout || '') + String(err.stderr || '') };
    }
  };
  const parse = (out) => { try { return JSON.parse(out); } catch (err) { return []; } };

  const real = runEslint(['main.js', 'preload.js', 'renderer', '--format', 'json']);
  const results = parse(real.out);
  const lengthErrors = [];
  const unusedDisables = [];
  for (const r of results) {
    for (const m of (r.messages || [])) {
      if (m.ruleId === 'max-lines-per-function') lengthErrors.push(path.basename(r.filePath) + ':' + m.line);
      if (/Unused eslint-disable/.test(String(m.message || ''))) unusedDisables.push(path.basename(r.filePath) + ':' + m.line);
    }
  }
  ok('S15 · cero funciones de más de 50 líneas en el código de producción',
    real.status === 0 && lengthErrors.length === 0, show(lengthErrors.slice(0, 8)));
  ok('S15 · ninguna supresión quedó obsoleta (todas siguen siendo necesarias)',
    unusedDisables.length === 0, show(unusedDisables.slice(0, 8)));
  ok('S15 · el código de producción pasa eslint sin errores ni avisos',
    results.length > 0 && results.every((r) => (r.errorCount || 0) === 0 && (r.warningCount || 0) === 0),
    show(results.filter((r) => r.errorCount || r.warningCount).map((r) => path.basename(r.filePath))));

  // ---- La regla tiene que morder ----
  // Un repo limpio no prueba que la regla funcione: podría estar mal configurada
  // y no señalar nada jamás. Se le pasa por stdin una función de 60 líneas con
  // nombre de fichero del renderer y se exige exactamente el error de longitud.
  const probeSrc = 'function sonda() {\n'
    + Array.from({ length: 60 }, (unused, i) => '  const v' + i + ' = ' + i + ';').join('\n')
    + '\n}\nmodule.exports = sonda;\n';
  const probe = runEslint(['--stdin', '--stdin-filename', 'renderer/__sonda_longitud.js', '--format', 'json'], probeSrc);
  const probeHits = parse(probe.out).flatMap((r) => (r.messages || []))
    .filter((m) => m.ruleId === 'max-lines-per-function');
  ok('S15 · la regla señala una función de 60 líneas (la compuerta muerde)',
    probe.status !== 0 && probeHits.length === 1,
    show({ exit: probe.status, hallazgos: probeHits.map((m) => m.message) }));
  ok('S15 · y no la señalaría por debajo del límite',
    (() => {
      const small = 'function sonda() {\n'
        + Array.from({ length: 40 }, (unused, i) => '  const v' + i + ' = ' + i + ';').join('\n')
        + '\n}\nmodule.exports = sonda;\n';
      const r = runEslint(['--stdin', '--stdin-filename', 'renderer/__sonda_longitud.js', '--format', 'json'], small);
      return parse(r.out).flatMap((x) => (x.messages || []))
        .filter((m) => m.ruleId === 'max-lines-per-function').length === 0;
    })());

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok('S15 · package.json expone npm run lint', Boolean(pkg.scripts && pkg.scripts.lint));
  ok('S15 · verify encadena lint antes de typecheck y tests',
    /^npm run lint\b/.test(String(pkg.scripts && pkg.scripts.verify)));
  ok('S15 · eslint es una devDependency declarada', Boolean(pkg.devDependencies && pkg.devDependencies.eslint),
    'sin ella, un clon limpio no puede verificar la longitud');
}

// ============================================================
// 16. Preparación para el arranque de escritorio
// ============================================================
/**
 * Verifica las rutas y la configuración con las que Electron lanza la ventana.
 *
 * Las demás suites cargan main.js con un stub cuyo `whenReady()` NUNCA resuelve y
 * cuyo `loadFile()` no hace nada. Eso es correcto para lo que prueban —los
 * handlers IPC—, pero deja sin verificar todo lo que ocurre al crear la ventana.
 * Consecuencia concreta: si alguien renombra `renderer/index.html` o mueve
 * `preload.js`, los 22 suites siguen en verde y la aplicación lanza una ventana
 * en blanco. Aquí `whenReady()` sí resuelve, la ventana se crea contra el stub y
 * se registra todo lo que main.js le pasa.
 *
 * @returns {Promise<void>}
 */
async function desktopLaunchStorm() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-launch-'));
  const recorded = { windows: [], loaded: [], openHandler: 0, navigateListener: 0, menuBarHidden: 0 };
  const appStub = {
    isPackaged: false,
    getPath: () => userData,
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {}
  };
  const BW = function (options) {
    recorded.windows.push(options || {});
    return {
      webContents: {
        openDevTools() {},
        getURL: () => '',
        setWindowOpenHandler() { recorded.openHandler += 1; },
        on(event) { if (event === 'will-navigate') recorded.navigateListener += 1; }
      },
      setMenuBarVisibility(value) { if (value === false) recorded.menuBarHidden += 1; },
      loadFile(target) { recorded.loaded.push(target); },
      on() {}
    };
  };
  BW.getAllWindows = () => [];

  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') {
      return {
        app: appStub,
        BrowserWindow: BW,
        ipcMain: { handle: () => {}, on: () => {} },
        dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
        shell: { openExternal: async () => true },
        clipboard: { writeText: () => {}, readText: () => '' },
        safeStorage: {
          isEncryptionAvailable: () => false,
          encryptString: (value) => Buffer.from('enc:' + value),
          decryptString: (buf) => String(buf).slice(4)
        }
      };
    }
    return realLoad.apply(this, arguments);
  };

  const mainPath = path.join(ROOT, 'main.js');
  const resolved = require.resolve(mainPath);
  // main.js ya se requirió antes en esta suite: sin limpiar la caché, Node
  // devolvería el módulo cacheado y el whenReady() nuevo no ejecutaría nada.
  delete require.cache[resolved];
  const realDebug = console.debug;
  const realError = console.error;
  const noise = [];
  console.debug = () => {};
  console.error = (...args) => { noise.push(args.map(String).join(' ')); };
  try {
    require(mainPath);
    await settleDeep(3); // deja correr el .then() de whenReady y createWindow()
  } finally {
    Module._load = realLoad;
    console.debug = realDebug;
    console.error = realError;
    delete require.cache[resolved];
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (err) { /* ya no existe */ }
  }

  ok('S16 · main.js crea exactamente una ventana al arrancar', recorded.windows.length === 1, show(recorded.windows.length));
  const opts = recorded.windows[0] || {};
  const wp = opts.webPreferences || {};

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok('S16 · package.json apunta a un punto de entrada que existe',
    Boolean(pkg.main) && fs.existsSync(path.join(ROOT, pkg.main)), show(pkg.main));

  ok('S16 · el preload declarado existe en disco', Boolean(wp.preload) && fs.existsSync(String(wp.preload)), show(wp.preload));
  ok('S16 · y es el preload del proyecto, no otra ruta',
    path.resolve(String(wp.preload || '')) === path.resolve(path.join(ROOT, 'preload.js')), show(wp.preload));

  ok('S16 · la ventana cargó exactamente un archivo', recorded.loaded.length === 1, show(recorded.loaded));
  const loaded = String(recorded.loaded[0] || '');
  ok('S16 · ese archivo existe en disco', Boolean(loaded) && fs.existsSync(loaded), show(loaded));
  ok('S16 · y es renderer/index.html, el mismo que audita S13',
    path.resolve(loaded) === path.resolve(path.join(P, 'index.html')), show(loaded));

  ok('S16 · el icono declarado existe', Boolean(opts.icon) && fs.existsSync(String(opts.icon)), show(opts.icon));

  ok('S16 · contextIsolation activado', wp.contextIsolation === true, show(wp));
  ok('S16 · nodeIntegration desactivado', wp.nodeIntegration === false, show(wp));
  ok('S16 · sandbox está declarado de forma explícita (no confiado al valor por defecto)',
    typeof wp.sandbox === 'boolean', show(wp.sandbox));

  // sandbox:false solo es una elección defendible mientras el preload no toque
  // Node. Si algún día importa 'fs', activar el sandbox deja de ser una opción y
  // la ventana queda expuesta sin alternativa. Se fija la precondition para que
  // el endurecimiento siga disponible.
  const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const preloadRequires = [...preloadSrc.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  ok('S16 · el preload solo importa electron (mantiene disponible sandbox:true)',
    preloadRequires.length > 0 && preloadRequires.every((r) => r === 'electron'), show(preloadRequires));
  ok('S16 · el preload no usa globales de Node', !/\b(?:process|Buffer|__dirname)\b/.test(preloadSrc));

  ok('S16 · la apertura de ventanas nuevas está interceptada', recorded.openHandler === 1, String(recorded.openHandler));
  ok('S16 · will-navigate está escuchado', recorded.navigateListener === 1, String(recorded.navigateListener));
  ok('S16 · la barra de menú se oculta', recorded.menuBarHidden === 1, String(recorded.menuBarHidden));

  ok('S16 · la ventana declara dimensiones y mínimos',
    [opts.width, opts.height, opts.minWidth, opts.minHeight].every((n) => typeof n === 'number' && n > 0),
    show({ width: opts.width, height: opts.height, minWidth: opts.minWidth, minHeight: opts.minHeight }));
  ok('S16 · backgroundColor declarado (evita el destello blanco al abrir)',
    typeof opts.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(opts.backgroundColor), show(opts.backgroundColor));
  ok('S16 · el arranque no produjo errores en consola', noise.length === 0, show(noise.slice(0, 3)));
}

// ============================================================
// 17. Autoprueba del modo humo de lanzamiento
// ============================================================
/**
 * Ejercita `runDesktopSmokeTest` de main.js sin necesitar el binario de Electron.
 *
 * `npm run test:launch` es la única comprobación que abre una ventana de verdad, y
 * en un entorno sin binario o sin pantalla reporta SKIP: es honesto, pero deja su
 * lógica sin ejercitar. Aquí se carga main.js con `LOREVINCI_SMOKE=1` contra un
 * stub que controla `executeJavaScript`, `app.exit` y `stdout`, y se recorren los
 * cuatro desenlaces que el modo humo puede tomar.
 *
 * @param {any} snapshots valor o función que devuelve el sondeo del renderer
 * @returns {Promise<{exits:number[], markers:any[], polls:number, failHandlers:any}>}
 */
async function runSmokeScenario(options) {
  const { snapshots, smokeEnv = true, afterBoot = null } = options;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-smoke-'));
  const state = { exits: [], markers: [], polls: 0, failHandlers: {} };
  const appStub = {
    isPackaged: false, getPath: () => userData, whenReady: () => Promise.resolve(),
    on: () => {}, quit: () => {}, exit: (code) => { state.exits.push(code); }
  };
  const BW = function () {
    return {
      webContents: {
        openDevTools() {}, getURL: () => '', setWindowOpenHandler() {}, on() {},
        once(event, fn) { state.failHandlers[event] = fn; },
        executeJavaScript: async () => {
          state.polls += 1;
          return typeof snapshots === 'function' ? snapshots() : snapshots;
        }
      },
      setMenuBarVisibility() {}, loadFile() {}, on() {}
    };
  };
  BW.getAllWindows = () => [];

  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') {
      return {
        app: appStub, BrowserWindow: BW, ipcMain: { handle: () => {}, on: () => {} },
        dialog: {}, shell: { openExternal: async () => true },
        clipboard: { writeText: () => {}, readText: () => '' },
        safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from('enc:' + v), decryptString: (b) => String(b).slice(4) }
      };
    }
    return realLoad.apply(this, arguments);
  };
  const realWrite = process.stdout.write;
  const realDebug = console.debug;
  const realError = console.error;
  const previousEnv = process.env.LOREVINCI_SMOKE;
  // Solo se activa cuando el escenario lo pide: comprobar que main.js NO entra
  // en modo humo por su cuenta es lo que garantiza que un arranque normal no
  // termine con app.exit().
  if (smokeEnv) process.env.LOREVINCI_SMOKE = '1'; else delete process.env.LOREVINCI_SMOKE;
  process.stdout.write = function (chunk) {
    const text = String(chunk);
    if (text.startsWith('LOREVINCI_SMOKE ')) {
      try { state.markers.push(JSON.parse(text.slice('LOREVINCI_SMOKE '.length))); } catch (err) { state.markers.push({ ok: false, step: 'bad-json' }); }
      return true;
    }
    return realWrite.apply(process.stdout, arguments);
  };
  console.debug = () => {};
  console.error = () => {};
  const mainPath = path.join(ROOT, 'main.js');
  const resolved = require.resolve(mainPath);
  delete require.cache[resolved];
  try {
    require(mainPath);
    await new Promise((resolve) => setTimeout(resolve, 900)); // el sondeo va cada 250 ms
    if (typeof afterBoot === 'function') {
      afterBoot(state);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  } finally {
    Module._load = realLoad;
    process.stdout.write = realWrite;
    console.debug = realDebug;
    console.error = realError;
    if (previousEnv === undefined) delete process.env.LOREVINCI_SMOKE; else process.env.LOREVINCI_SMOKE = previousEnv;
    delete require.cache[resolved];
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (err) { /* ya no existe */ }
  }
  return state;
}

async function desktopSmokeSelfTest() {
  // ---- 1. Arranque correcto ----
  const ready = await runSmokeScenario({ snapshots: { cards: 3, bridgeMethods: 17, bootError: null } });
  ok('S17 · con la biblioteca pintada y el puente expuesto, el humo aprueba',
    ready.exits.length === 1 && ready.exits[0] === 0, show({ exits: ready.exits, markers: ready.markers }));
  ok('S17 · informa ok:true y el paso "ready"',
    ready.markers.length === 1 && ready.markers[0].ok === true && ready.markers[0].step === 'ready', show(ready.markers));
  ok('S17 · incluye la instantánea del renderer en el informe',
    Boolean(ready.markers[0] && ready.markers[0].snapshot && ready.markers[0].snapshot.cards === 3), show(ready.markers[0]));

  // ---- 2. El renderer arrancó pero dejó el banner de error ----
  const broken = await runSmokeScenario({ snapshots: { cards: 0, bridgeMethods: 17, bootError: 'LoreVinci no pudo cargar tus datos. TypeError' } });
  ok('S17 · un banner de arranque se reporta como fallo con código 1',
    broken.exits.length === 1 && broken.exits[0] === 1, show(broken.exits));
  ok('S17 · y nombra el paso "boot" con el texto del banner',
    broken.markers.length === 1 && broken.markers[0].step === 'boot'
    && /no pudo cargar/.test(String(broken.markers[0].detail)), show(broken.markers));

  // ---- 3. El archivo no carga ----
  // El disparo se hace dentro de runSmokeScenario, mientras stdout sigue
  // interceptado: hacerlo fuera escribiría al stdout real y la aserción no
  // vería ningún marcador aunque el código de salida fuera correcto.
  const failed = await runSmokeScenario({
    snapshots: { cards: 0, bridgeMethods: 0, bootError: null },
    afterBoot: (state) => {
      if (typeof state.failHandlers['did-fail-load'] === 'function') {
        state.failHandlers['did-fail-load']({}, -6, 'ERR_FILE_NOT_FOUND');
      }
    }
  });
  ok('S17 · main.js registra did-fail-load', typeof failed.failHandlers['did-fail-load'] === 'function',
    show(Object.keys(failed.failHandlers)));
  ok('S17 · did-fail-load termina con código 1 y el motivo',
    failed.exits.includes(1) && failed.markers.some((m) => m.step === 'did-fail-load' && /ERR_FILE_NOT_FOUND/.test(String(m.detail))),
    show({ exits: failed.exits, markers: failed.markers }));

  // ---- 4. Arranque incompleto: no debe darse por bueno ----
  const incomplete = await runSmokeScenario({ snapshots: { cards: 0, bridgeMethods: 17, bootError: null } });
  ok('S17 · sin historias pintadas no aprueba aunque el puente exista',
    incomplete.exits.length === 0 && incomplete.markers.length === 0, show({ exits: incomplete.exits, markers: incomplete.markers }));
  ok('S17 · y sigue sondeando (no se rinde a la primera)', incomplete.polls >= 2, show(incomplete.polls));

  // ---- 5. El modo humo no se activa solo ----
  // El renderer estaría listo para aprobar, así que si el modo humo se activara
  // solo, este escenario terminaría con exit(0): la app real se cerraría al
  // arrancar. Es la propiedad que más daño haría si se rompiera en silencio.
  const quiet = await runSmokeScenario({ snapshots: { cards: 3, bridgeMethods: 17, bootError: null }, smokeEnv: false });
  ok('S17 · sin la variable de entorno, main.js no entra en modo humo (un arranque normal no se auto-cierra)',
    quiet.exits.length === 0 && quiet.markers.length === 0, show({ exits: quiet.exits, markers: quiet.markers }));

  // ---- 6. El lanzador está cableado ----
  ok('S17 · existe scripts/smoke-launch.js', fs.existsSync(path.join(ROOT, 'scripts', 'smoke-launch.js')));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok('S17 · package.json expone npm run test:launch', Boolean(pkg.scripts && pkg.scripts['test:launch']),
    show(pkg.scripts && pkg.scripts['test:launch']));
  const launcher = fs.existsSync(path.join(ROOT, 'scripts', 'smoke-launch.js'))
    ? fs.readFileSync(path.join(ROOT, 'scripts', 'smoke-launch.js'), 'utf8') : '';
  ok('S17 · el lanzador distingue SKIP de FAIL (no convierte un entorno limitado en fallo)',
    /function skip\(/.test(launcher) && /function fail\(/.test(launcher) && /process\.exit\(0\)/.test(launcher));
  ok('S17 · el lanzador detecta la ausencia de binario y de pantalla',
    /node_modules', 'electron|node_modules\/electron/.test(launcher) && /DISPLAY/.test(launcher));
}

// ============================================================
// 9. Cierre: integridad del proceso y presupuesto global
// ============================================================
async function integrity() {
  await settleDeep(10);
  ok('S12 · CERO rechazos de promesa sin manejar en toda la suite', unhandled.length === 0, unhandled.slice(0, 4).join(' | '));
  ok('S12 · CERO excepciones no capturadas en toda la suite', uncaught.length === 0, uncaught.slice(0, 4).join(' | '));

  const heapMb = Math.round(process.memoryUsage().heapUsed / 1048576);
  ok(`S12 · el heap del proceso de pruebas queda por debajo de 700 MB (${heapMb} MB)`, heapMb < 700, `${heapMb} MB`);

  const totalMs = Date.now() - SUITE_START;
  ok(`S12 · la suite de estrés completa termina en menos de 5 min (${Math.round(totalMs / 1000)} s)`, totalMs < 300000, `${totalMs} ms`);
}

(async () => {
  selfTestDiagnostics();
  await editStorm();
  await hostileTransport();
  await cleanupStorm();

  const main = loadMainProcess();
  try {
    await hostilePromptPayloads(main);
    await concurrencyStorm(main);
    await backupRotationStorm(main);
    await webSearchStorm(main);
    await clipboardAndLimitsStorm(main);
  } finally {
    main.dispose();
  }

  await volumeStress();
  await quotaStress();
  await engineStress();
  await contractStress();
  typecheckStorm();
  functionLengthStorm();
  await desktopLaunchStorm();
  await desktopSmokeSelfTest();
  await integrity();

  R.done();
})().catch((error) => {
  // Registrar el fallo ANTES de cerrar: si solo se imprime por stderr, el
  // recuento de aserciones queda igual y la suite puede parecer que pasó.
  R.crash(error);
});
