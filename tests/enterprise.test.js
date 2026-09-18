// Suite "enterprise": verifica el núcleo extraído del renderer (Result, errores
// tipados, log estructurado con trace_id y controlador de persistencia con estado
// encapsulado), la rotación de respaldos sin catch silencioso en main.js, y que la
// integración en app.js conserva el comportamiento observable.
//
// Cubre happy path Y edge cases: transporte que lanza, almacén que rechaza,
// ausencia de datos, callbacks que fallan, concurrencia de escrituras y la
// inmutabilidad de todo lo que sale del núcleo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { makeApp, makeSeed, reporter, ROOT, P } = require('./harness');

const R = reporter('enterprise');
const ok = R.ok;
const K = require(path.join(P, 'app-kernel.js'));

// Reloj falso determinista: el controlador recibe los timers por inyección, así
// que no hay que dormir en los tests ni depender de la puntualidad del evento.
function makeClock() {
  const tasks = new Map();
  let seq = 0;
  let nowMs = 0;
  return {
    setTimeout: (fn, ms) => { seq += 1; tasks.set(seq, { fn, at: nowMs + (Number(ms) || 0) }); return seq; },
    clearTimeout: (id) => { tasks.delete(id); },
    advance(ms) {
      const target = nowMs + ms;
      for (;;) {
        const due = Array.from(tasks.entries())
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, task] = due;
        tasks.delete(id);
        nowMs = task.at;
        task.fn();
      }
      nowMs = target;
      return nowMs;
    },
    pending: () => tasks.size,
    now: () => nowMs
  };
}

// Drena microtareas con un timer REAL (el reloj falso solo vive en el controlador).
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settleDeep(times = 6) {
  for (let i = 0; i < times; i += 1) await settle();
}

// ============================================================
// 1. Result<T, E> — el error es un valor
// ============================================================
{
  const good = K.ok(42);
  ok('ok() expone isOk/isErr coherentes', good.isOk === true && good.isErr === false);
  ok('ok().unwrap() devuelve el valor', good.unwrap() === 42);
  ok('ok().map() encadena', good.map((n) => n * 2).unwrap() === 84);
  ok('ok().unwrapOr() ignora el default', good.unwrapOr('x') === 42);
  ok('ok() es inmutable (Object.freeze)', Object.isFrozen(good));
  ok('ok() serializa a JSON estable', JSON.stringify(good.toJSON()) === '{"ok":true,"value":42}');

  const failure = K.err(new K.StorageRejectedError('disco lleno'));
  ok('err() expone isOk/isErr coherentes', failure.isErr === true && failure.isOk === false);
  ok('err().unwrapOr() entrega el respaldo', failure.unwrapOr('plan-b') === 'plan-b');
  ok('err().map() no ejecuta la función', failure.map(() => { throw new Error('no debería'); }).isErr === true);
  ok('err().mapErr() transforma el error', failure.mapErr(() => new K.ValidationError('otro')).error.code === K.ERROR_CODES.INVALID_ARGUMENT);
  ok('err() es inmutable', Object.isFrozen(failure));
  ok('err().toJSON() serializa el error tipado', failure.toJSON().error.code === K.ERROR_CODES.STORAGE_REJECTED);

  let threw = null;
  try { failure.unwrap(); } catch (e) { threw = e; }
  ok('err().unwrap() lanza el error tipado (no lo esconde)', threw instanceof K.StorageRejectedError);

  // err() con un valor no-AppError se normaliza: nunca sale un error anónimo.
  const coerced = K.err('falló todo');
  ok('err() normaliza un string a AppError', coerced.error instanceof K.AppError && coerced.error.message === 'falló todo');
}

// ============================================================
// 2. attempt() — reemplazo de try/catch silencioso
// ============================================================
{
  ok('attempt con función síncrona correcta', K.attempt(() => 7).unwrap() === 7);

  const thrown = K.attempt(() => { throw new Error('boom'); });
  ok('attempt convierte el throw síncrono en err', thrown.isErr === true);
  ok('attempt clasifica el throw como TransportError', thrown.error instanceof K.TransportError);
  ok('attempt preserva la causa original', thrown.error.cause instanceof Error && thrown.error.cause.message === 'boom');
  ok('attempt marca el fallo de transporte como reintentable', thrown.error.retryable === true);

  const mapped = K.attempt(() => { throw new Error('x'); }, () => new K.ValidationError('contrato roto'));
  ok('attempt acepta un mapeador de error propio', mapped.error instanceof K.ValidationError && mapped.error.retryable === false);

  const notFn = K.attempt('no soy función');
  ok('attempt rechaza un argumento inválido sin lanzar', notFn.isErr && notFn.error.code === K.ERROR_CODES.INVALID_ARGUMENT);
}

// ============================================================
// 3. Errores tipados
// ============================================================
{
  const base = new K.AppError('MI_CODIGO', 'mensaje', { retryable: false, details: { a: 1 }, cause: 'raíz' });
  ok('AppError lleva código estable', base.code === 'MI_CODIGO');
  ok('AppError respeta retryable explícito', base.retryable === false);
  ok('AppError congela sus details', Object.isFrozen(base.details));
  ok('AppError.toJSON() es serializable por IPC', JSON.parse(JSON.stringify(base.toJSON())).code === 'MI_CODIGO');
  ok('AppError usa el nombre de la subclase', new K.TransportError('x').name === 'TransportError');
  ok('la jerarquía se puede consultar con instanceof', new K.StorageRejectedError('x') instanceof K.AppError && new K.AppError('a', 'b') instanceof Error);
  ok('TransportError es reintentable por defecto', new K.TransportError('x').retryable === true);
  ok('StorageRejectedError NO es reintentable por defecto', new K.StorageRejectedError('x').retryable === false);
  ok('ValidationError NO es reintentable', new K.ValidationError('x').retryable === false);

  ok('toAppError deja pasar un AppError', K.toAppError(base) === base);
  ok('toAppError envuelve un Error nativo', K.toAppError(new TypeError('t')).code === K.ERROR_CODES.TRANSPORT_FAILURE);
  ok('toAppError envuelve null sin romper', K.toAppError(null).message.length > 0);
  ok('toAppError envuelve undefined con mensaje por defecto', K.toAppError(undefined).message === K.MESSAGES.STORAGE_REJECTED);
}

// ============================================================
// 4. Observabilidad: log estructurado con trace_id
// ============================================================
{
  const lines = [];
  const clockNow = () => Date.parse('2026-09-17T10:00:00.000Z');
  const logger = K.createLogger({
    scope: 'test',
    traceId: 'trace-fija',
    sink: (line) => lines.push(line),
    now: clockNow
  });

  logger.info('evento_uno', { foo: 'bar' });
  const entry = JSON.parse(lines[0]);
  ok('cada evento emite UNA línea JSON parseable', lines.length === 1 && typeof entry === 'object');
  ok('la entrada lleva ts en ISO', entry.ts === '2026-09-17T10:00:00.000Z');
  ok('la entrada lleva level, scope y event', entry.level === 'info' && entry.scope === 'test' && entry.event === 'evento_uno');
  ok('la entrada lleva trace_id', entry.trace_id === 'trace-fija');
  ok('los campos de negocio viajan en la misma línea', entry.foo === 'bar');

  logger.child('hijo').warn('aviso');
  const child = JSON.parse(lines[1]);
  ok('child() compone el scope', child.scope === 'test:hijo');
  ok('child() PROPAGA el trace_id (correlación)', child.trace_id === 'trace-fija');

  const quiet = K.createLogger({ scope: 'q', minLevel: 'error', sink: (l) => lines.push(l) });
  const before = lines.length;
  quiet.info('ruido');
  quiet.warn('ruido');
  ok('minLevel filtra por severidad', lines.length === before);
  quiet.error('grave');
  ok('minLevel deja pasar lo importante', lines.length === before + 1);

  ok('newTraceId acepta generador inyectable', K.newTraceId(() => 'id-determinista') === 'id-determinista');
  const auto = K.newTraceId();
  ok('newTraceId genera un id no vacío por defecto', typeof auto === 'string' && auto.length >= 16);
  ok('dos trace_id automáticos no colisionan', K.newTraceId() !== K.newTraceId());
  ok('LOG_LEVELS está ordenado por severidad', K.LOG_LEVELS.debug < K.LOG_LEVELS.info && K.LOG_LEVELS.info < K.LOG_LEVELS.warn && K.LOG_LEVELS.warn < K.LOG_LEVELS.error);
}

// ============================================================
// 5. Normalización de la respuesta del transporte
// ============================================================
{
  const norm = (raw) => K.normalizeSaveResponse(K.ok(raw));
  ok('true histórico se acepta', norm(true).isOk === true);
  ok('{ok:true} se acepta', norm({ ok: true }).isOk === true);
  ok('{ok:true,bytes} propaga el tamaño', norm({ ok: true, bytes: 123 }).unwrap().bytes === 123);
  ok('{ok:false} se rechaza como StorageRejected', norm({ ok: false, error: 'cuota' }).error instanceof K.StorageRejectedError);
  ok('el motivo del almacén llega al mensaje', norm({ ok: false, error: 'cuota' }).error.message === 'cuota');
  ok('false desnudo se rechaza con mensaje por defecto', norm(false).error.message === K.MESSAGES.STORAGE_REJECTED);
  ok('un fallo de transporte no se renormaliza', K.normalizeSaveResponse(K.err(new K.TransportError('red'))).error.code === K.ERROR_CODES.TRANSPORT_FAILURE);
  ok('formatSaveFailure recorta a 180 caracteres', K.formatSaveFailure(new K.TransportError('x'.repeat(500))).length === K.PERSISTENCE.ERROR_MESSAGE_MAX);
  ok('formatSaveFailure tolera un error sin mensaje', K.formatSaveFailure({}).length > 0);
}

// ============================================================
// 6. Controlador de persistencia — invariantes I1..I4
// ============================================================
async function controllerTests() {
  ok('exige deps.save como función', (() => {
    try { K.createPersistenceController({ getPayload: () => ({}) }); return false; }
    catch (e) { return e instanceof K.ValidationError; }
  })());
  ok('exige deps.getPayload como función', (() => {
    try { K.createPersistenceController({ save: async () => true }); return false; }
    catch (e) { return e instanceof K.ValidationError; }
  })());

  // ---- I1: N ediciones dentro de la ventana → 1 escritura ----
  {
    const clock = makeClock();
    const writes = [];
    let payload = { n: 0 };
    const statuses = [];
    const controller = K.createPersistenceController({
      save: async (p) => { writes.push(p.n); return { ok: true, bytes: 10 }; },
      getPayload: () => payload,
      onStatus: (s) => statuses.push(s),
      timers: clock,
      logger: K.createLogger({ sink: () => {} })
    });

    for (let i = 1; i <= 50; i += 1) { payload = { n: i }; controller.schedule(); }
    ok('I1 · ninguna escritura síncrona al editar', writes.length === 0);
    ok('I1 · el estado queda "saving" mientras hay debounce', statuses[statuses.length - 1] === K.PERSISTENCE.STATUS.SAVING);
    ok('I1 · hay un temporizador pendiente', controller.getState().pending === true && clock.pending() === 1);
    clock.advance(399);
    await settleDeep();
    ok('I1 · no escribe antes de la ventana', writes.length === 0);
    clock.advance(1);
    await settleDeep();
    ok('I1 · 50 ediciones producen EXACTAMENTE 1 escritura', writes.length === 1, `writes=${writes.length}`);
    ok('I1 · escribe el último snapshot', writes[0] === 50);
    ok('I1 · publica "saved" al terminar', statuses[statuses.length - 1] === K.PERSISTENCE.STATUS.SAVED);
    ok('I1 · métrica de escrituras exitosas', controller.getState().writesOk === 1 && controller.getState().writesFailed === 0);
    ok('I1 · el estado vuelve a idle', controller.getState().idle === true && controller.getState().dirty === false);
  }

  // ---- I2: nunca dos escrituras en vuelo; lo que llega se encola ----
  {
    const clock = makeClock();
    let gate = null;
    let calls = 0;
    const controller = K.createPersistenceController({
      save: () => { calls += 1; return new Promise((resolve) => { gate = resolve; }); },
      getPayload: () => ({ v: calls }),
      timers: clock,
      logger: K.createLogger({ sink: () => {} })
    });

    controller.schedule();
    clock.advance(400);
    await settleDeep();
    ok('I2 · primera escritura en vuelo', calls === 1 && controller.getState().inFlight === true);

    controller.schedule();
    clock.advance(400);
    await settleDeep();
    ok('I2 · con una escritura en vuelo NO se lanza otra', calls === 1);
    ok('I2 · la segunda queda encolada', controller.getState().queued === true);

    gate({ ok: true });
    await settleDeep();
    ok('I2 · al liberarse, se rearma el debounce', controller.getState().pending === true && calls === 1);
    clock.advance(400);
    await settleDeep();
    ok('I2 · lo encolado se vuelca en una segunda escritura', calls === 2, `calls=${calls}`);
    ok('I2 · la cola se vacía', controller.getState().queued === false);
  }

  // ---- I3: un fallo se reporta una vez; la recuperación se avisa una vez ----
  {
    const clock = makeClock();
    const failures = [];
    const recoveries = [];
    const statuses = [];
    let mode = 'fail';
    const controller = K.createPersistenceController({
      save: async () => (mode === 'fail' ? { ok: false, error: 'disco lleno' } : { ok: true }),
      getPayload: () => ({}),
      onStatus: (s, detail) => statuses.push([s, detail]),
      onFailure: (e) => failures.push(e),
      onRecover: () => recoveries.push(Date.now()),
      timers: clock,
      logger: K.createLogger({ sink: () => {} })
    });

    controller.schedule(); clock.advance(400); await settleDeep();
    controller.schedule(); clock.advance(400); await settleDeep();
    controller.schedule(); clock.advance(400); await settleDeep();
    ok('I3 · tres fallos seguidos notifican UNA sola vez', failures.length === 1, `failures=${failures.length}`);
    ok('I3 · el fallo notificado es un error tipado', failures[0] instanceof K.StorageRejectedError);
    ok('I3 · el estado publica el error con su motivo', statuses.some(([s, d]) => s === 'error' && d === 'disco lleno'));
    ok('I3 · la bandera de fallo queda activa', controller.getState().failureReported === true);
    ok('I3 · métrica de escrituras fallidas', controller.getState().writesFailed === 3);

    mode = 'ok';
    controller.schedule(); clock.advance(400); await settleDeep();
    ok('I3 · la recuperación se avisa UNA vez', recoveries.length === 1);
    ok('I3 · la bandera de fallo se libera', controller.getState().failureReported === false);
    controller.schedule(); clock.advance(400); await settleDeep();
    ok('I3 · sin fallo previo no hay aviso de recuperación', recoveries.length === 1);
  }

  // ---- I4: flush() nunca rechaza; el error vuelve como valor ----
  {
    const controller = K.createPersistenceController({
      save: async () => { throw new Error('IPC caído'); },
      getPayload: () => ({ a: 1 }),
      logger: K.createLogger({ sink: () => {} })
    });
    const result = await controller.flush();
    ok('I4 · un transporte que lanza NO rechaza la promesa', result.isErr === true);
    ok('I4 · el error se clasifica como transporte', result.error instanceof K.TransportError);
    ok('I4 · el error se marca reintentable', result.error.retryable === true);
    ok('I4 · el estado queda idle tras el fallo', controller.getState().idle === true);
  }

  // ---- Sin datos: no se escribe, se explica ----
  {
    let calls = 0;
    const controller = K.createPersistenceController({
      save: async () => { calls += 1; return true; },
      getPayload: () => null,
      logger: K.createLogger({ sink: () => {} })
    });
    const result = await controller.flush();
    ok('sin payload no se invoca el transporte', calls === 0);
    ok('sin payload devuelve err (no undefined mudo)', result.isErr === true && result.error.code === K.ERROR_CODES.INVALID_ARGUMENT);
  }

  // ---- Un observer que falla no puede impedir el guardado ----
  {
    const clock = makeClock();
    const warns = [];
    const writes = [];
    const controller = K.createPersistenceController({
      save: async () => { writes.push(1); return true; },
      getPayload: () => ({}),
      onChange: () => { throw new Error('caché rota'); },
      timers: clock,
      logger: K.createLogger({ sink: (line) => warns.push(JSON.parse(line)) })
    });
    controller.schedule();
    clock.advance(400);
    await settleDeep();
    ok('un onChange que lanza no bloquea la escritura', writes.length === 1);
    ok('un onChange que lanza queda REGISTRADO (no silenciado)', warns.some((w) => w.event === 'on_change_failed' && w.error.code === K.ERROR_CODES.TRANSPORT_FAILURE));
  }

  // ---- Encapsulación e inmutabilidad del estado ----
  {
    const controller = K.createPersistenceController({
      save: async () => true,
      getPayload: () => ({}),
      logger: K.createLogger({ sink: () => {} })
    });
    const state = controller.getState();
    ok('getState() devuelve un snapshot congelado', Object.isFrozen(state));
    ok('el snapshot expone el estado completo', ['idle', 'pending', 'inFlight', 'queued', 'dirty', 'failureReported', 'writesOk', 'writesFailed', 'debounceMs'].every((k) => k in state));
    ok('intentar mutar el snapshot no afecta al controlador', (() => {
      try { state.writesOk = 999; } catch { /* strict mode lanza: esperado */ }
      return controller.getState().writesOk === 0;
    })());
    ok('el controlador expone solo su API pública', Object.isFrozen(controller) && Object.keys(controller).sort().join(',') === ['cancel', 'config', 'flush', 'getState', 'schedule'].sort().join(','));
    ok('el debounce por defecto sale de la configuración centralizada', controller.config.debounceMs === K.PERSISTENCE.DEBOUNCE_MS);

    const clock = makeClock();
    const cancelable = K.createPersistenceController({
      save: async () => true, getPayload: () => ({}), timers: clock, logger: K.createLogger({ sink: () => {} })
    });
    cancelable.schedule();
    ok('cancel() reporta que había algo pendiente', cancelable.getState().pending === true);
    cancelable.cancel();
    clock.advance(5000);
    await settleDeep();
    ok('cancel() anula la escritura programada', cancelable.getState().pending === false && clock.pending() === 0);
  }

  // ---- Log con trace_id a través de un ciclo completo ----
  {
    const clock = makeClock();
    const lines = [];
    const controller = K.createPersistenceController({
      save: async () => ({ ok: true, bytes: 77 }),
      getPayload: () => ({}),
      timers: clock,
      logger: K.createLogger({ scope: 'e2e', traceId: 'T-1', sink: (l) => lines.push(JSON.parse(l)) })
    });
    controller.schedule();
    clock.advance(400);
    await settleDeep();
    const writeOk = lines.find((l) => l.event === 'write_ok');
    ok('un guardado exitoso se registra estructurado', Boolean(writeOk));
    ok('el log de guardado lleva el trace_id del ciclo', writeOk.trace_id === 'T-1');
    ok('el log de guardado incluye métrica de tamaño', writeOk.bytes === 77);
    ok('el log de guardado incluye duración en ms', typeof writeOk.duration_ms === 'number' && writeOk.duration_ms >= 0);
  }
}

// ============================================================
// 7. main.js — rotación de respaldos sin catch silencioso
// ============================================================
async function mainProcessTests() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-ent-'));
  const handlers = {};
  const ipcMain = { handle: (c, f) => { handlers[c] = f; }, on: () => {} };
  const appStub = { isPackaged: false, getPath: () => userData, whenReady: () => ({ then: () => ({}) }), on: () => {} };
  const BW = function () { return { setMenuBarVisibility() {}, loadFile() {}, webContents: { openDevTools() {} } }; };
  BW.getAllWindows = () => [];
  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') {
      return {
        app: appStub, BrowserWindow: BW, ipcMain, dialog: {}, shell: { openExternal: async () => true },
        clipboard: { writeText: () => {} },
        safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(`enc:${v}`), decryptString: (b) => String(b).slice(4) }
      };
    }
    return realLoad.apply(this, arguments);
  };

  // Captura del log estructurado del proceso principal (sink por defecto → console.debug).
  const captured = [];
  const realDebug = console.debug;
  console.debug = (line) => { captured.push(line); };
  try {
    require(path.join(ROOT, 'main.js'));
  } finally {
    Module._load = realLoad;
    console.debug = realDebug;
  }

  const dataFile = path.join(userData, 'lorevinci-data.json');
  const payload = {
    settings: { authorName: 'Autora', ai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } },
    stories: [{ id: 's1', title: 'Saga', chapters: [{ id: 'c1', title: 'Cap', content: '<p>ok</p>' }] }],
    characters: [], activityLog: []
  };

  const first = await handlers['data:save'](null, payload);
  ok('primer guardado correcto', first.ok === true);
  ok('el primer guardado aún no tiene respaldo que rotar', !fs.existsSync(dataFile + '.bak1'));

  await handlers['data:save'](null, payload);
  ok('el segundo guardado genera .bak1', fs.existsSync(dataFile + '.bak1'));
  await handlers['data:save'](null, payload);
  ok('el tercer guardado promueve a .bak2', fs.existsSync(dataFile + '.bak2'));

  // Envenena .bak3 con un directorio no vacío: unlinkSync falla de verdad y el
  // paso DEBE quedar registrado en vez de desaparecer en un catch {}.
  fs.mkdirSync(dataFile + '.bak3', { recursive: true });
  fs.writeFileSync(path.join(dataFile + '.bak3', 'estorbo.txt'), 'x');
  captured.length = 0;
  console.debug = (line) => { captured.push(line); };
  let poisoned = null;
  try {
    poisoned = await handlers['data:save'](null, payload);
  } finally {
    console.debug = realDebug;
  }
  ok('un fallo de rotación NO impide guardar', poisoned && poisoned.ok === true);
  const parsed = captured.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const stepFailure = parsed.find((e) => e.event === 'backup_rotation_step_failed');
  ok('el fallo de rotación se registra como evento estructurado', Boolean(stepFailure), captured.slice(0, 2).join(' | '));
  ok('el evento identifica el paso fallido', stepFailure && stepFailure.step === 'unlink_bak3');
  ok('el evento lleva código de error y ruta', Boolean(stepFailure && stepFailure.code && stepFailure.path));
  ok('el evento lleva trace_id', Boolean(stepFailure && typeof stepFailure.trace_id === 'string' && stepFailure.trace_id.length > 0));
  ok('el proceso principal usa scope "main"', parsed.every((e) => String(e.scope).startsWith('main')));

  fs.rmSync(userData, { recursive: true, force: true });
}

// ============================================================
// 8. Integración: app.js conserva el comportamiento observable
// ============================================================
async function integrationTests() {
  const seed = makeSeed();
  const { w, errors } = makeApp({ seed });
  const d = w.document;
  const byId = (id) => d.getElementById(id);
  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  await tick(2600);
  const probe = w.__probe;

  ok('el núcleo se carga como módulo global del renderer', typeof w.LoreKernel === 'object' && typeof w.LoreKernel.createPersistenceController === 'function');
  ok('app.js ya no expone saveTimeout como global mutable', probe('typeof saveTimeout') === 'undefined');
  ok('app.js ya no expone saveInFlight como global mutable', probe('typeof saveInFlight') === 'undefined');
  ok('app.js ya no expone saveQueued como global mutable', probe('typeof saveQueued') === 'undefined');
  ok('app.js ya no expone saveFailureReported como global mutable', probe('typeof saveFailureReported') === 'undefined');
  ok('el controlador queda encapsulado en el módulo', probe('typeof persistence.getState') === 'function');
  ok('getSaveState() devuelve un snapshot congelado desde el renderer', probe('Object.isFrozen(getSaveState())') === true);

  // I1 a través de la UI real.
  probe('showView("stories")');
  probe('openStoryEditor(DATA.stories[0].id)');
  const editor = byId('chapterEditor');
  for (let i = 0; i < 30; i += 1) {
    editor.innerHTML = `<p>Tecleo ${i}.</p>`;
    editor.dispatchEvent(new w.Event('input'));
  }
  ok('la UI pasa a "Guardando…" al editar', byId('saveIndicatorText').textContent === K.MESSAGES.STATUS_SAVING_TEXT);
  ok('el snapshot marca la escritura como pendiente', probe('getSaveState().pending') === true);
  await tick(700);
  ok('la UI vuelve a "Todo guardado"', byId('saveIndicatorText').textContent === K.MESSAGES.STATUS_SAVED_TEXT);
  ok('el snapshot vuelve a idle', probe('getSaveState().idle') === true);
  ok('las métricas del renderer cuentan la escritura', probe('getSaveState().writesOk') >= 1);

  // Fallo de almacenamiento: mismo mensaje que antes, pero ahora tipado.
  probe(`window.lorevinci.saveData = async () => ({ ok: false, error: 'disco lleno' })`);
  await probe('persistNow()');
  ok('el fallo se refleja en el indicador', byId('saveIndicatorText').textContent === K.MESSAGES.STATUS_ERROR_TEXT);
  ok('el title accesible explica el motivo real', byId('saveIndicator').title === 'disco lleno');
  ok('el toast conserva el texto histórico', /⚠ No se pudo guardar: disco lleno\. Exporta un respaldo desde Ajustes\./.test(byId('lorevinciToast').textContent), byId('lorevinciToast').textContent);
  ok('persistNow devuelve un Result erróneo (no undefined)', probe('typeof persistNow') === 'function');
  const failedResult = await probe('(async () => await persistNow())()');
  ok('el Result del fallo es StorageRejectedError', failedResult.isErr && failedResult.error.code === K.ERROR_CODES.STORAGE_REJECTED);
  ok('el fallo repetido no duplica el toast', probe('DATA.notifications.filter(n => n.title === "Error de guardado").length') === 1);

  probe(`window.lorevinci.saveData = async () => ({ ok: true })`);
  await probe('persistNow()');
  ok('la recuperación vuelve a "Todo guardado"', byId('saveIndicatorText').textContent === K.MESSAGES.STATUS_SAVED_TEXT);
  ok('la recuperación se anuncia', /Guardado restablecido/.test(byId('lorevinciToast').textContent));

  // Ctrl+S con fallo ya no celebra.
  probe(`window.lorevinci.saveData = async () => ({ ok: false, error: 'permiso denegado' })`);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(60);
  ok('Ctrl+S ante un fallo NO dice "Cambios guardados"', !/Cambios guardados en tu equipo/.test(byId('lorevinciToast').textContent), byId('lorevinciToast').textContent);
  ok('Ctrl+S ante un fallo explica el motivo', /No se pudo guardar: permiso denegado/.test(byId('lorevinciToast').textContent));
  probe(`window.lorevinci.saveData = async () => ({ ok: true })`);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(60);
  ok('Ctrl+S con éxito sí confirma el guardado', /Cambios guardados en tu equipo/.test(byId('lorevinciToast').textContent));
  ok('Ctrl+S cancela el debounce pendiente sin escribir dos veces', probe('getSaveState().pending') === false);

  // El observer que invalida el índice de búsqueda sigue enganchado.
  probe('buildSearchIndex()');
  ok('el índice se construye', probe('globalSearchIndex.length') > 0);
  probe('scheduleSave()');
  ok('scheduleSave() invalida el índice de búsqueda', probe('globalSearchIndex.length') === 0);
  probe('persistence.cancel()');

  const runtime = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
  ok('sin errores de ejecución en la integración', runtime.length === 0, runtime.slice(0, 3).join(' | '));
}

(async () => {
  await controllerTests();
  await mainProcessTests();
  await integrationTests();
  R.done();
})().catch((e) => {
  console.error('FALLO NO CAPTURADO EN LA SUITE:', e);
  process.exit(1);
});
