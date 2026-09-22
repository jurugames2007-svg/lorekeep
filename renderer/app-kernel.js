/**
 * LoreVinci — núcleo de aplicación (UMD: navegador y Node).
 *
 * Propósito: sacar del renderer la lógica de negocio que vivía mezclada con el
 * DOM y con estado global mutable. Aquí no hay una sola referencia a `document`,
 * `window` ni a un selector CSS: es código puro, inyectable y testeable.
 *
 * Cuatro piezas:
 *   1. `Result`            — manejo de errores semántico (no `throw` suelto).
 *   2. `AppError` + hijos  — errores tipados con código, causa y `retryable`.
 *   3. `createLogger`      — logs estructurados JSON con `trace_id`.
 *   4. `createPersistenceController` — orquestación de guardado con el estado
 *      mutable ENCERRADO en un clausura y expuesto solo como snapshot congelado.
 *
 * Patrones: Factory (constructores con dependencias inyectadas), Strategy (el
 * transporte de guardado y los efectos de UI son estrategias intercambiables),
 * Observer (suscriptores de estado) e Inmutabilidad defensiva (Object.freeze).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LoreKernel = api;
  // La fábrica UMD se exime de max-lines-per-function a propósito y es la ÚNICA
  // excepción del proyecto: este `function () { … }` no es una unidad de lógica
  // sino el cuerpo del módulo, así que su longitud es la del fichero entero y no
  // se puede reducir sin dividir el módulo en varios. La regla sí aplica a todas
  // las funciones declaradas dentro (que es donde la longitud indica acoplamiento),
  // y tests/stress.test.js verifica que no exista ninguna otra supresión.
  // eslint-disable-next-line max-lines-per-function
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // ==========================================================
  // 0. Configuración centralizada — ni un string ni un número mágico suelto
  // ==========================================================

  /** @readonly */
  const PERSISTENCE = Object.freeze({
    /** Milisegundos de debounce entre la última edición y la escritura. */
    DEBOUNCE_MS: 400,
    /** Longitud máxima del mensaje de error que se muestra al usuario. */
    ERROR_MESSAGE_MAX: 180,
    /** Estados posibles del indicador de guardado. */
    STATUS: Object.freeze({ SAVING: 'saving', SAVED: 'saved', ERROR: 'error' })
  });

  /** Textos de interfaz: un solo lugar donde cambiarlos. */
  const MESSAGES = Object.freeze({
    STATUS_SAVING_TEXT: 'Guardando…',
    STATUS_SAVING_TITLE: 'Guardando cambios en tu equipo',
    STATUS_SAVED_TEXT: 'Todo guardado',
    STATUS_SAVED_TITLE: 'Todos los cambios están en tu equipo',
    STATUS_ERROR_TEXT: 'Sin guardar',
    STATUS_ERROR_TITLE_FALLBACK: 'No se pudo guardar. Exporta un respaldo desde Ajustes.',
    SAVE_FAILED_TOAST_PREFIX: '⚠ No se pudo guardar: ',
    SAVE_FAILED_TOAST_SUFFIX: '. Exporta un respaldo desde Ajustes.',
    SAVE_RECOVERED_TOAST: 'Guardado restablecido: tus cambios vuelven a quedar en disco.',
    SAVE_ERROR_NOTIFICATION_TITLE: 'Error de guardado',
    STORAGE_REJECTED: 'El almacenamiento rechazó los datos.'
  });

  /** Códigos de error estables: permiten decidir sin comparar mensajes. */
  const ERROR_CODES = Object.freeze({
    STORAGE_REJECTED: 'STORAGE_REJECTED',
    TRANSPORT_FAILURE: 'TRANSPORT_FAILURE',
    NO_PAYLOAD: 'NO_PAYLOAD',
    INVALID_ARGUMENT: 'INVALID_ARGUMENT'
  });

  // ==========================================================
  // 1. Errores tipados
  // ==========================================================

  /**
   * Error de aplicación. A diferencia de `new Error(msg)`, lleva un `code`
   * estable (comparable, localizable) y una marca explícita de si tiene sentido
   * reintentar.
   */
  class AppError extends Error {
    /**
     * @param {string} code      Código estable de {@link ERROR_CODES}.
     * @param {string} message   Mensaje legible.
     * @param {{ cause?: unknown, retryable?: boolean, details?: Record<string, unknown> }} [options]
     */
    constructor(code, message, options = {}) {
      super(message);
      this.name = new.target.name;
      this.code = code;
      this.retryable = options.retryable !== false;
      this.details = Object.freeze({ ...(options.details || {}) });
      if (options.cause !== undefined) this.cause = options.cause;
    }

    /** Serialización estructurada para logs y para el IPC. */
    toJSON() {
      return {
        name: this.name,
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        details: this.details,
        cause: this.cause instanceof AppError ? this.cause.toJSON() : String(this.cause ?? '')
      };
    }
  }

  /** El transporte (IPC/HTTP/fs) falló: red, proceso caído, timeout. */
  class TransportError extends AppError {
    constructor(message, options = {}) {
      super(ERROR_CODES.TRANSPORT_FAILURE, message, { retryable: true, ...options });
    }
  }

  /** El almacén respondió, pero rechazó los datos (disco lleno, permiso, cuota). */
  class StorageRejectedError extends AppError {
    constructor(message, options = {}) {
      super(ERROR_CODES.STORAGE_REJECTED, message, { retryable: false, ...options });
    }
  }

  /** Un argumento no cumple el contrato. Error de programación: no se reintenta. */
  class ValidationError extends AppError {
    constructor(message, options = {}) {
      super(ERROR_CODES.INVALID_ARGUMENT, message, { retryable: false, ...options });
    }
  }

  /**
   * Normaliza cualquier valor lanzado a un `AppError`.
   * Evita el `String(err && err.message || err)` repetido por todo el código.
   * @param {unknown} thrown
   * @param {string} [fallbackMessage]
   * @returns {AppError}
   */
  function toAppError(thrown, fallbackMessage = MESSAGES.STORAGE_REJECTED) {
    if (thrown instanceof AppError) return thrown;
    if (thrown instanceof Error) {
      return new TransportError(thrown.message || fallbackMessage, { cause: thrown });
    }
    return new TransportError(String(thrown ?? fallbackMessage) || fallbackMessage, { cause: thrown });
  }

  // ==========================================================
  // 2. Result<T, E> — el error es un valor, no una excepción
  // ==========================================================

  const OK_TAG = Object.freeze({ tag: 'ok' });
  const ERR_TAG = Object.freeze({ tag: 'err' });

  /**
   * `Result<T>`: un valor O un error tipado. Nunca una excepción.
   *
   * Se declara como typedef porque el JSDoc de `ok`, `err` y `attempt` lo
   * referencia: sin esta definición el compilador no resuelve el nombre y todo
   * el contrato del núcleo queda sin verificar, que es justo lo que se quiere
   * evitar al activar `checkJs`.
   *
   * @template T
   * @typedef {Readonly<{
   *   isOk: boolean,
   *   isErr: boolean,
   *   value?: T,
   *   error?: AppError,
   *   unwrap(): any,
   *   unwrapOr(defaultValue: any): any,
   *   map(fn: Function): Result<any>,
   *   mapErr(fn: Function): Result<any>,
   *   toJSON(): object
   * }>} Result
   */

  /**
   * @template T
   * @param {T} value
   * @returns {Readonly<{ isOk: true, isErr: false, value: T, unwrap(): T, unwrapOr(defaultValue: T): T, map<U>(fn: (v: T) => U): Result<U>, mapErr(fn: (e: AppError) => AppError): Result<T>, toJSON(): object }>}
   */
  function ok(value) {
    return Object.freeze({
      ...OK_TAG,
      isOk: true,
      isErr: false,
      value,
      unwrap: () => value,
      unwrapOr: () => value,
      map: (fn) => ok(fn(value)),
      mapErr: () => ok(value),
      toJSON: () => ({ ok: true, value })
    });
  }

  /**
   * @param {AppError} error
   * @returns {Readonly<{ isOk: false, isErr: true, error: AppError, unwrap(): never, unwrapOr<T>(defaultValue: T): T, map(fn: Function): Result<never>, mapErr(fn: (e: AppError) => AppError): Result<never>, toJSON(): object }>}
   */
  function err(error) {
    const failure = error instanceof AppError ? error : toAppError(error);
    return Object.freeze({
      ...ERR_TAG,
      isOk: false,
      isErr: true,
      error: failure,
      unwrap: () => { throw failure; },
      unwrapOr: (defaultValue) => defaultValue,
      map: () => err(failure),
      mapErr: (fn) => err(fn(failure)),
      toJSON: () => ({ ok: false, error: failure.toJSON() })
    });
  }

  /**
   * Ejecuta `fn` convirtiendo cualquier excepción en un `Result` erróneo.
   * Es el reemplazo directo de `try { … } catch {}`: nada se traga en silencio.
   * @template T
   * @param {() => T} fn
   * @param {(thrown: unknown) => AppError} [mapError]
   * @returns {Result<T>} Para funciones ASÍNCRONAS usa `attemptAsync`.
   *
   * Por qué no un tipo condicional (`T extends Promise<infer U> ? …`), que sería
   * lo más expresivo: en cuanto `T` se infiere como `any` —y `JSON.parse`
   * devuelve `any`— TypeScript resuelve el condicional a la UNIÓN de sus dos
   * ramas. El resultado es que `attempt(() => JSON.parse(x)).isOk` deja de
   * compilar aunque el código sea correcto. Se probó y rompía 15 sitios.
   *
   * La alternativa honesta es separar los dos contratos en dos funciones: esta
   * para síncronas y `attemptAsync` para asíncronas. En tiempo de ejecución
   * `attempt` sigue normalizando una promesa si se le pasa una (no se rompe
   * nada), pero el tipo ya no miente sobre lo que quien llama va a recibir.
   */
  /**
   * ¿Es `value` un thenable? Se comprueba por estructura y NO con
   * `instanceof Promise`, a propósito.
   *
   * El renderer se ejecuta dentro de un realm distinto (la ventana de Chromium,
   * o la de jsdom en los tests), y ese realm tiene su propio constructor
   * `Promise`. Una promesa creada allí es perfectamente válida y, aun así,
   * `instanceof Promise` evaluado desde Node da `false`.
   *
   * El fallo era silencioso y grave: `attempt` creía haber recibido un valor
   * corriente y envolvía la promesa —todavía pendiente— en un `Result` ya
   * resuelto. Quien esperaba "una sola escritura en vuelo a la vez" veía la
   * escritura como terminada de inmediato y lanzaba la siguiente. Lo reprodujo
   * perf.test.js en cuanto el `Promise.resolve(...)` defensivo que enmascaraba
   * el problema salió del ejecutor de persistencia.
   *
   * @param {unknown} value
   * @returns {boolean}
   */
  function isThenable(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    return typeof /** @type {{ then?: unknown }} */ (value).then === 'function';
  }

  function attempt(fn, mapError = toAppError) {
    if (typeof fn !== 'function') {
      return /** @type {any} */ (err(new ValidationError('attempt() requiere una función.')));
    }
    let produced;
    try {
      produced = fn();
    } catch (thrown) {
      return /** @type {any} */ (err(mapError(thrown)));
    }
    if (isThenable(produced)) {
      // `Promise.resolve` además trae el thenable al realm local, de modo que la
      // cadena que recibe quien llama es una promesa nativa y no una foránea.
      return /** @type {any} */ (
        Promise.resolve(produced).then((value) => ok(value), (reason) => err(mapError(reason)))
      );
    }
    return /** @type {any} */ (ok(produced));
  }

  /**
   * Variante asíncrona de `attempt`: el rechazo de la promesa también se
   * convierte en un `Result` erróneo, nunca en una excepción sin manejar.
   *
   * Existe porque `await attempt(fnAsync)` funciona en tiempo de ejecución pero
   * el compilador no puede saberlo: `attempt` declara `Result<T>`, así que quien
   * llama se queda sin verificación justo en el caso más fácil de equivocar —el
   * que devuelve una promesa y se usa sin `await`, donde `.isOk` vale `undefined`
   * en silencio y la rama correcta nunca se ejecuta.
   *
   * @template T
   * @param {() => (T | Promise<T>)} fn
   * @param {(thrown: unknown) => AppError} [mapError]
   * @returns {Promise<Result<T>>}
   */
  async function attemptAsync(fn, mapError = toAppError) {
    // `attempt` tipa su devolución como `Result<T | Promise<T>>`, pero al
    // retornarlo desde una función `async` la promesa interna se desenvuelve
    // sola: lo que recibe quien llama es siempre `Result<T>`. El cast documenta
    // ese desenvolvimiento, que el compilador no puede deducir de la firma.
    return /** @type {Result<T>} */ (/** @type {unknown} */ (attempt(fn, mapError)));
  }

  // ==========================================================
  // 3. Observabilidad — logs estructurados con trace_id
  // ==========================================================

  /** Niveles en orden de severidad creciente. */
  const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

  /**
   * Crea un logger que emite UNA línea JSON por evento.
   *
   * `trace_id` se propaga a los hijos con `child()`, de modo que todo lo que
   * ocurre dentro de un ciclo de guardado se puede correlacionar en el log.
   *
   * @param {{ scope?: string, traceId?: string, minLevel?: keyof typeof LOG_LEVELS, sink?: (line: string, entry: object) => void, now?: () => number, id?: () => string }} [options]
   */
  function createLogger(options = {}) {
    const scope = options.scope || 'app';
    const traceId = options.traceId || (options.id ? options.id() : newTraceId(options.id));
    const minLevel = LOG_LEVELS[options.minLevel] ?? LOG_LEVELS.info;
    const now = options.now || (() => Date.now());
    const sink = options.sink || defaultSink;

    /** @param {keyof typeof LOG_LEVELS} level */
    const emit = (level, event, fields) => {
      if (LOG_LEVELS[level] < minLevel) return null;
      const entry = Object.freeze({
        ts: new Date(now()).toISOString(),
        level,
        scope,
        trace_id: traceId,
        event,
        ...(fields || {})
      });
      sink(JSON.stringify(entry), entry);
      return entry;
    };

    const logger = Object.freeze({
      scope,
      traceId,
      debug: (event, fields) => emit('debug', event, fields),
      info: (event, fields) => emit('info', event, fields),
      warn: (event, fields) => emit('warn', event, fields),
      error: (event, fields) => emit('error', event, fields),
      /** Deriva un logger que comparte el `trace_id` y añade contexto. */
      child: (extraScope, extraFields) => createLogger({
        ...options,
        scope: extraScope ? `${scope}:${extraScope}` : scope,
        traceId,
        sink: extraFields
          ? (line, entry) => sink(JSON.stringify({ ...entry, ...extraFields }), { ...entry, ...extraFields })
          : sink
      })
    });
    return logger;
  }

  /** Sink por defecto: `console` si existe, y nunca lanza. */
  function defaultSink(line) {
    if (typeof console !== 'undefined' && typeof console.debug === 'function') console.debug(line);
  }

  /**
   * Identificador de traza: 16 bytes hex sin depender de `crypto.randomUUID`
   * (no existe en todos los contextos donde corre este módulo).
   * @param {(() => string)} [idFn] Generador inyectable (tests deterministas).
   */
  function newTraceId(idFn) {
    if (typeof idFn === 'function') return idFn();
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ==========================================================
  // 4. Controlador de persistencia — estado mutable encapsulado
  // ==========================================================

  /**
   * Dependencias ya validadas y normalizadas del controlador de persistencia.
   *
   * Estaban tipadas como `Readonly<object>`, que no dice nada: el compilador no
   * podía verificar ninguna de las llamadas internas y `createStatusPublisher`
   * recibía un argumento de tipo opaco. Ahora cada campo tiene su firma.
   *
   * @typedef {Readonly<{
   *   save: (payload: any) => any,
   *   getPayload: () => any,
   *   onStatus: (status: string, message?: string) => void,
   *   onFailure: (error: AppError) => void,
   *   onRecover: () => void,
   *   onChange: () => void,
   *   logger: ReturnType<typeof createLogger>,
   *   debounceMs: number,
   *   timers: Readonly<{
   *     setTimeout: (fn: () => void, ms: number) => any,
   *     clearTimeout: (id: any) => void
   *   }>
   * }>} PersistenceDeps
   */

  /**
   * Valida y normaliza las dependencias del controlador.
   * Todo lo inyectable se resuelve AQUÍ: el resto del módulo no vuelve a
   * preguntar por opcionales.
   * @param {object} deps
   * @returns {PersistenceDeps} Dependencias normalizadas.
   */
  function resolvePersistenceDeps(deps) {
    if (!deps || typeof deps.save !== 'function') {
      throw new ValidationError('createPersistenceController requiere deps.save como función.');
    }
    if (typeof deps.getPayload !== 'function') {
      throw new ValidationError('createPersistenceController requiere deps.getPayload como función.');
    }
    const noop = () => {};
    const logger = deps.logger || createLogger({ scope: 'persistence' });
    return Object.freeze({
      save: deps.save,
      getPayload: deps.getPayload,
      onStatus: deps.onStatus || noop,
      onFailure: deps.onFailure || noop,
      onRecover: deps.onRecover || noop,
      onChange: deps.onChange || noop,
      logger: logger.child('persistence'),
      debounceMs: Number.isFinite(deps.debounceMs) ? Math.max(0, deps.debounceMs) : PERSISTENCE.DEBOUNCE_MS,
      // Se envuelven las funciones nativas: pasarlas sin ligar rompe en algunos
      // entornos (Illegal invocation).
      timers: deps.timers || Object.freeze({
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
        clearTimeout: (id) => globalThis.clearTimeout(id)
      })
    });
  }

  /**
   * Caja de estado del guardado: la única pieza mutable del módulo.
   *
   * Los campos son privados y solo se tocan a través de mutadores con nombre
   * (`markQueued`, `consumeQueue`…). Sustituye a las cuatro variables de módulo
   * (`saveTimeout`, `saveInFlight`, `saveQueued`, `saveFailureReported`) que
   * antes se leían y escribían desde varios puntos del renderer, donde
   * cualquier función podía dejar la máquina de estados en una combinación
   * imposible.
   */
  function createPersistenceState() {
    let timer = null;
    let inFlight = null;
    let queued = false;
    let failureReported = false;
    let dirty = false;
    let writesOk = 0;
    let writesFailed = 0;

    return Object.freeze({
      setTimer: (id) => { timer = id; },
      clearTimer: () => { timer = null; },
      hasTimer: () => timer !== null,
      /** Cancela el temporizador pendiente con la función de limpieza inyectada. */
      cancelTimer: (clearFn) => {
        if (timer === null) return false;
        clearFn(timer);
        timer = null;
        return true;
      },
      setInFlight: (promise) => { inFlight = promise; },
      clearInFlight: () => { inFlight = null; },
      isInFlight: () => inFlight !== null,
      markQueued: () => { queued = true; },
      /** @returns {boolean} true si había una escritura encolada (y la consume). */
      consumeQueue: () => { const had = queued; queued = false; return had; },
      markDirty: () => { dirty = true; },
      clearDirty: () => { dirty = false; },
      /** @returns {boolean} true si este es el primer fallo de la racha. */
      reportFailureOnce: () => { const first = !failureReported; failureReported = true; return first; },
      /** @returns {boolean} true si había un fallo reportado (y lo libera). */
      recoverFailureOnce: () => { const had = failureReported; failureReported = false; return had; },
      recordWriteOk: () => { writesOk += 1; },
      recordWriteFailed: () => { writesFailed += 1; },
      /** Snapshot congelado: la única ventana de lectura al estado interno. */
      snapshot: (debounceMs) => Object.freeze({
        idle: timer === null && inFlight === null,
        pending: timer !== null,
        inFlight: inFlight !== null,
        queued,
        dirty,
        failureReported,
        writesOk,
        writesFailed,
        debounceMs
      })
    });
  }

  /**
   * Ejecutor: UN intento de escritura. Devuelve siempre un `Result` resuelto.
   *
   * Patrón Strategy para el transporte (`deps.save`) y Observer para los efectos
   * (`onStatus`, `onFailure`, `onRecover`): el núcleo no sabe que existe el DOM.
   *
   * @param {Readonly<object>} deps      Dependencias normalizadas.
   * @param {object} state               Caja de estado.
   * @param {{ schedule: Function }} link Rearme tardío (el ejecutor y el planificador se necesitan mutuamente).
   */
  function createWriteExecutor(deps, state, link) {
    /** @returns {Promise<object>} Result<{bytes: number|null}> — nunca rechaza. */
    const flush = () => {
      const payload = deps.getPayload();
      if (payload === null || payload === undefined) {
        deps.logger.warn('flush_skipped', { reason: ERROR_CODES.NO_PAYLOAD });
        return Promise.resolve(err(new ValidationError('No hay datos que guardar todavía.', {
          details: { code: ERROR_CODES.NO_PAYLOAD }
        })));
      }

      // Se deriva del logger inyectado (no se crea uno nuevo) para conservar el
      // sink, el nivel mínimo y el scope del propietario.
      const trace = deps.logger.child('write');
      const startedAt = Date.now();
      state.clearDirty();

      const write = attemptAsync(() => deps.save(payload), toAppError)
        .then(normalizeSaveResponse)
        .then((result) => {
          applyWriteOutcome(deps, state, result, trace, Date.now() - startedAt);
          return result;
        });

      const tracked = write.finally(() => {
        state.clearInFlight();
        if (state.consumeQueue()) {
          trace.debug('flush_queued_write');
          link.schedule();
        }
      });
      state.setInFlight(tracked);
      return tracked;
    };

    return Object.freeze({ flush });
  }

  /**
   * Aplica el resultado de una escritura al estado y a los observadores.
   * Función pura respecto del DOM: solo toca la caja de estado y los callbacks.
   * @param {Readonly<object>} deps
   * @param {object} state
   * @param {object} result  `Result` del intento.
   * @param {object} trace   Logger del ciclo (comparte trace_id).
   * @param {number} elapsed Milisegundos del intento.
   */
  function applyWriteOutcome(deps, state, result, trace, elapsed) {
    if (result.isOk) {
      state.recordWriteOk();
      deps.onStatus(PERSISTENCE.STATUS.SAVED, '');
      trace.info('write_ok', { bytes: result.value.bytes, duration_ms: elapsed });
      if (state.recoverFailureOnce()) {
        trace.info('write_recovered', { duration_ms: elapsed });
        deps.onRecover();
      }
      return;
    }
    state.recordWriteFailed();
    deps.onStatus(PERSISTENCE.STATUS.ERROR, result.error.message);
    trace.error('write_failed', { code: result.error.code, duration_ms: elapsed, error: result.error.toJSON() });
    if (state.reportFailureOnce()) deps.onFailure(result.error); // I3
  }

  /**
   * Planificador: debounce + cola. Garantiza que N ediciones dentro de la
   * ventana produzcan una sola escritura y que nunca haya dos en vuelo.
   * @param {Readonly<object>} deps
   * @param {object} state
   * @param {{ flush: Function }} executor
   */
  function createWriteScheduler(deps, state, executor) {
    /** Invalida cachés derivadas; un fallo aquí no puede impedir guardar. */
    const notifyChange = () => {
      try {
        deps.onChange(deps.getPayload());
      } catch (thrown) {
        deps.logger.warn('on_change_failed', { error: toAppError(thrown).toJSON() });
      }
    };

    const onDebounceElapsed = () => {
      state.clearTimer();
      if (state.isInFlight()) {
        state.markQueued();
        deps.logger.debug('write_deferred', { reason: 'in_flight' });
        return;
      }
      executor.flush();
    };

    const schedule = () => {
      state.markDirty();
      notifyChange();
      state.cancelTimer(deps.timers.clearTimeout);
      deps.onStatus(PERSISTENCE.STATUS.SAVING, '');
      state.setTimer(deps.timers.setTimeout(onDebounceElapsed, deps.debounceMs));
      return undefined;
    };

    /** Anula el debounce pendiente sin escribir (p. ej. al cerrar la app). */
    const cancel = () => {
      state.cancelTimer(deps.timers.clearTimeout);
      state.consumeQueue();
      return state.snapshot(deps.debounceMs);
    };

    return Object.freeze({ schedule, cancel });
  }

  /**
   * Orquesta el guardado automático.
   *
   * Invariantes que se garantizan y se prueban (tests/enterprise.test.js):
   *   I1 — N pulsaciones dentro de la ventana de debounce → 1 escritura.
   *   I2 — Nunca hay dos escrituras en vuelo a la vez; lo que llegue se encola.
   *   I3 — Un fallo se reporta UNA vez; la recuperación se avisa UNA vez.
   *   I4 — `flush()` siempre resuelve a un `Result` (nunca rechaza).
   *
   * @param {object} deps Ver {@link resolvePersistenceController}.
   * @returns {Readonly<{ schedule: Function, flush: Function, cancel: Function, getState: Function, config: object }>}
   */
  /**
   * Publica el estado del indicador de guardado SOLO cuando cambia de verdad.
   *
   * Sin esta deduplicación cada pulsación de tecla emitía un aviso idéntico
   * ("Guardando…") y el renderer reescribía el mismo texto en el DOM. Medido en
   * la suite de estrés: 5000 ediciones dentro de una misma ventana de debounce
   * provocaban 5001 avisos para UNA sola escritura, es decir ~25 000 mutaciones
   * de DOM inútiles (2 classList.toggle + setAttribute + textContent + title por
   * aviso). Re-fijar `aria-live` en cada pulsación además agita a los lectores
   * de pantalla, que reanuncian un estado que no ha cambiado.
   *
   * La clave incluye el detalle: dos errores con mensajes distintos SÍ se
   * publican, porque el usuario debe ver el motivo actualizado.
   *
   * @param {{ onStatus: (status: string, message?: string) => void }} deps
   * @returns {(status: string, message?: string) => boolean} true si publicó.
   */
  function createStatusPublisher(deps) {
    let lastKey = null;
    return function publishStatus(status, message = '') {
      const key = `${status}\u0000${message}`;
      if (key === lastKey) return false;
      lastKey = key;
      deps.onStatus(status, message);
      return true;
    };
  }

  function createPersistenceController(deps) {
    const resolved = resolvePersistenceDeps(deps);
    // Se sustituye onStatus por el publicador con deduplicación: ni el ejecutor
    // ni el planificador tienen que saber que los avisos repetidos se filtran.
    const observable = Object.freeze({ ...resolved, onStatus: createStatusPublisher(resolved) });
    const state = createPersistenceState();
    // Enlace tardío: ejecutor y planificador se necesitan mutuamente (el
    // ejecutor rearma la cola; el planificador dispara el ejecutor).
    const link = { schedule: () => {} };
    const executor = createWriteExecutor(observable, state, link);
    const scheduler = createWriteScheduler(observable, state, executor);
    link.schedule = scheduler.schedule;

    return Object.freeze({
      schedule: scheduler.schedule,
      flush: executor.flush,
      cancel: scheduler.cancel,
      getState: () => state.snapshot(resolved.debounceMs),
      config: Object.freeze({ debounceMs: resolved.debounceMs })
    });
  }

  /**
   * Ejecuta una limpieza de recurso que NO debe romper el flujo principal
   * (`pdf.destroy()`, `worker.terminate()`, `reader.cancel()`).
   *
   * Es el sustituto directo de `try { await x.destroy(); } catch {}`. Que la
   * limpieza no pueda romper el flujo es correcto; que su fallo sea invisible no
   * lo es: un `destroy()` que falla suele ser un worker o un handle que queda
   * vivo, es decir, una fuga de memoria que solo se ve al rato.
   *
   * @param {string} label           Identificador del recurso (aparece en el log).
   * @param {() => unknown} releaseFn Función de liberación (síncrona o async).
   * @param {{ warn?: Function }} [logger] Logger estructurado; si se omite, no se registra.
   * @returns {object|Promise<object>} `Result` del intento (awaitable si la limpieza era async).
   */
  function runCleanup(label, releaseFn, logger) {
    // Único sitio del núcleo que admite una liberación síncrona o asíncrona sin
    // obligar a quien llama a elegir: el cast es deliberado y está acotado aquí.
    const result = /** @type {Result<any> | Promise<Result<any>>} */ (
      attempt(releaseFn, (thrown) => toAppError(thrown, `Limpieza de ${label} fallida`))
    );
    const report = (settled) => {
      if (settled.isErr && logger && typeof logger.warn === 'function') {
        logger.warn('cleanup_failed', {
          resource: label,
          code: settled.error.code,
          reason: settled.error.message
        });
      }
      return settled;
    };
    // Mismo criterio que en `attempt`: una liberación puede devolver un thenable
    // de otro realm, y `instanceof` no lo vería.
    return isThenable(result) ? Promise.resolve(result).then(report) : report(result);
  }

  /**
   * Convierte la respuesta del transporte en un `Result`.
   * El contrato histórico del puente admite tres formas: `{ok:true}`,
   * `{ok:false,error}` y `true`/falsy. Se normalizan aquí, una sola vez.
   * @param {Result<any>} transportResult `Result` del intento de transporte.
   */
  function normalizeSaveResponse(transportResult) {
    if (transportResult.isErr) return transportResult; // el transporte lanzó
    const raw = transportResult.value;
    if (raw === false) {
      return err(new StorageRejectedError(MESSAGES.STORAGE_REJECTED));
    }
    if (raw && typeof raw === 'object' && raw.ok === false) {
      return err(new StorageRejectedError(String(raw.error || MESSAGES.STORAGE_REJECTED), {
        details: { bytes: raw.bytes ?? null }
      }));
    }
    return ok({ bytes: raw && typeof raw === 'object' ? raw.bytes ?? null : null });
  }

  /**
   * Formatea un error de guardado para mostrarlo, con el tope de longitud.
   * Única implementación del recorte que antes estaba duplicado en dos sitios.
   * @param {AppError} error
   * @returns {string}
   */
  function formatSaveFailure(error) {
    const message = String(error && error.message ? error.message : MESSAGES.STORAGE_REJECTED);
    return message.slice(0, PERSISTENCE.ERROR_MESSAGE_MAX);
  }

  return Object.freeze({
    PERSISTENCE,
    MESSAGES,
    ERROR_CODES,
    LOG_LEVELS,
    AppError,
    TransportError,
    StorageRejectedError,
    ValidationError,
    toAppError,
    ok,
    err,
    attempt,
    attemptAsync,
    isThenable,
    createLogger,
    newTraceId,
    createPersistenceController,
    normalizeSaveResponse,
    formatSaveFailure,
    runCleanup,
    createStatusPublisher
  });
});
