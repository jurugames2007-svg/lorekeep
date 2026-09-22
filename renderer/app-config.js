/**
 * LoreConfig — extremos remotos y ajustes de proveedor (UMD: navegador y Node).
 *
 * Por qué existe este fichero: las URLs de los servicios remotos estaban
 * repartidas entre main.js, renderer/app.js y renderer/seed-data.js, y varias
 * aparecían DOS veces en procesos distintos (`https://api.openai.com/v1` en
 * main.js:503 y en cinco sitios de app.js; los extremos de Wikipedia en main.js
 * y en app.js; `http://localhost:20128/v1` en siete sitios). Dos fuentes de
 * verdad para el mismo extremo es la forma clásica de que el proceso principal y
 * el renderer acaben hablando con sitios distintos tras un cambio.
 *
 * Reglas de este módulo:
 *   · Solo datos. Ni lógica de red, ni fetch, ni dependencias de otros módulos.
 *   · Todo congelado con Object.freeze, incluidos los objetos anidados: un
 *     preset de proveedor mutado en caliente cambiaría el comportamiento de
 *     toda la aplicación sin dejar rastro.
 *   · Se carga ANTES que app-kernel.js, seed-data.js y app.js, y main.js lo
 *     requiere igual que requiere el kernel.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LoreConfig = api;
  // La fábrica UMD se exime de max-lines-per-function a propósito y es la ÚNICA
  // excepción del proyecto: este `function () { … }` no es una unidad de lógica
  // sino el cuerpo del módulo, así que su longitud es la del fichero entero y no
  // se puede reducir sin dividir el módulo en varios. La regla sí aplica a todas
  // las funciones declaradas dentro (que es donde la longitud indica acoplamiento),
  // y tests/stress.test.js verifica que no exista ninguna otra supresión.
  // eslint-disable-next-line max-lines-per-function
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /** Congela en profundidad: los presets son objetos de dos niveles. */
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.keys(value).forEach((key) => deepFreeze(value[key]));
    }
    return value;
  }

  // ==========================================================
  // 1. Identidad de la aplicación ante servicios de terceros
  // ==========================================================

  /**
   * Un User-Agent identificable no es cortesía: varios de los servicios que se
   * consultan (Wikipedia, Open Library) bloquean o limitan a los clientes que no
   * se identifican, y es la única forma de que puedan contactar si algo falla.
   * @readonly
   */
  const APP = Object.freeze({
    /** Sitio público del proyecto. Se usa como referer y como contacto en el UA. */
    SITE_URL: 'https://lorevinci.app',
    /** User-Agent de las peticiones de investigación web. */
    USER_AGENT_RESEARCH: 'LoreVinci/1.0 Research (+https://lorevinci.app)',
    /** Cabecera HTTP-Referer que piden algunos proveedores de IA (OpenRouter). */
    HTTP_REFERER: 'https://lorevinci.app'
  });

  // ==========================================================
  // 2. Proveedores de IA
  // ==========================================================

  /**
   * Presets de proveedor. `AI_PROVIDER_PRESETS` en app.js era una copia literal
   * de este mapa; ahora es el mismo objeto, así que añadir un proveedor se hace
   * en un único sitio y el proceso principal lo ve igual.
   * @readonly
   */
  const AI_PROVIDER_PRESETS = deepFreeze({
    llamacpp: { baseUrl: 'http://localhost:8080/v1', model: 'qwen2.5-7b-instruct' },
    omniroute: { baseUrl: 'http://localhost:20128/v1', model: 'auto' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
    groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
    lmstudio: { baseUrl: 'http://localhost:1234/v1', model: 'local-model' }
  });

  /**
   * Extremos de IA que no son un preset seleccionable: el valor por defecto, el
   * OmniRoute local y los enlaces de ayuda que se abren en el navegador externo.
   * @readonly
   */
  const AI = Object.freeze({
    /** Extremo por defecto cuando el usuario no configuró ninguno. */
    DEFAULT_BASE_URL: AI_PROVIDER_PRESETS.openai.baseUrl,
    /** OmniRoute local: raíz del API y del panel. */
    OMNIROUTE_LOCAL_BASE_URL: AI_PROVIDER_PRESETS.omniroute.baseUrl,
    OMNIROUTE_DASHBOARD_URL: 'http://localhost:20128',
    OMNIROUTE_DOCS_URL: 'https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.50/docs/getting-started/QUICK-START.md',
    /** Página de claves de OpenRouter, para el enlace "conseguir clave". */
    OPENROUTER_KEYS_URL: 'https://openrouter.ai/keys'
  });

  // ==========================================================
  // 3. Fuentes de investigación web
  // ==========================================================

  /**
   * Extremos de búsqueda. Se guardan las RAÍCES, no las URLs completas con
   * parámetros: la construcción de la consulta sigue en el sitio que la usa, que
   * es quien conoce los parámetros. Lo que se centraliza es el host y la ruta.
   * @readonly
   */
  const SEARCH = Object.freeze({
    /** API de búsqueda de Wikipedia en español. */
    WIKIPEDIA_API: 'https://es.wikipedia.org/w/api.php',
    /** Base para construir el enlace a un artículo de Wikipedia. */
    WIKIPEDIA_ARTICLE: 'https://es.wikipedia.org/wiki/',
    /** Búsqueda de Open Library. */
    OPENLIBRARY_SEARCH: 'https://openlibrary.org/search.json',
    /** Base para convertir una clave (`/works/OL…`) en URL navegable. */
    OPENLIBRARY_BASE: 'https://openlibrary.org',
    /** HTML de DuckDuckGo, que es lo que se parsea cuando no hay API. */
    DUCKDUCKGO_HTML: 'https://html.duckduckgo.com/html/',
    /** Base para resolver los enlaces de redirección (`uddg=`) de DuckDuckGo. */
    DUCKDUCKGO_BASE: 'https://duckduckgo.com'
  });

  /**
   * Construye la consulta de búsqueda de Wikipedia.
   *
   * Estaba duplicada literalmente en main.js y en app.js, con una diferencia
   * sutil entre ambas (main.js añadía `&srlimit=6`, app.js no): el mismo
   * servicio devolvía distinto número de resultados según el proceso que
   * preguntara. Ahora hay una sola construcción.
   *
   * @param {string} query Texto de búsqueda (ya recortado por quien llama).
   * @param {number} [limit=6] Máximo de resultados.
   * @returns {string} URL completa de la API.
   */
  function wikipediaSearchUrl(query, limit = 6) {
    return `${SEARCH.WIKIPEDIA_API}?action=query&list=search&srsearch=${encodeURIComponent(String(query || ''))}`
      + `&utf8=1&format=json&origin=*&srlimit=${Number.isFinite(limit) ? limit : 6}`;
  }

  /**
   * Enlace al artículo de Wikipedia correspondiente a un título.
   * @param {string} title Título tal y como lo devuelve la API.
   * @returns {string}
   */
  function wikipediaArticleUrl(title) {
    return `${SEARCH.WIKIPEDIA_ARTICLE}${encodeURIComponent(String(title || '').replace(/ /g, '_'))}`;
  }

  /**
   * Consulta de búsqueda de Open Library.
   * @param {string} query
   * @param {number} [limit=6]
   * @returns {string}
   */
  function openLibrarySearchUrl(query, limit = 6) {
    return `${SEARCH.OPENLIBRARY_SEARCH}?q=${encodeURIComponent(String(query || ''))}&limit=${Number.isFinite(limit) ? limit : 6}`
      + '&fields=key,title,author_name,first_publish_year,subject';
  }

  /**
   * Consulta de búsqueda web en el HTML de DuckDuckGo.
   * @param {string} query
   * @returns {string}
   */
  function duckDuckGoSearchUrl(query) {
    return `${SEARCH.DUCKDUCKGO_HTML}?q=${encodeURIComponent(String(query || ''))}`;
  }

  /**
   * Convierte una clave de Open Library (`/works/OL123W`) en URL navegable.
   * @param {string} key
   * @returns {string}
   */
  function openLibraryUrl(key) {
    return `${SEARCH.OPENLIBRARY_BASE}${String(key || '')}`;
  }

  return Object.freeze({
    APP,
    AI,
    AI_PROVIDER_PRESETS,
    SEARCH,
    wikipediaSearchUrl,
    wikipediaArticleUrl,
    openLibrarySearchUrl,
    openLibraryUrl,
    duckDuckGoSearchUrl
  });
});
