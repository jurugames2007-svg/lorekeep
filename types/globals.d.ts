/**
 * Declaraciones globales del renderer de LoreVinci.
 *
 * Por qué existe este fichero: los módulos propios se cargan como scripts UMD y
 * se cuelgan de `window`, así que TypeScript no los ve y cada acceso a
 * `window.LoreKernel.*` daba "Property does not exist on type Window" (199 de los
 * 218 errores del primer `tsc --checkJs`). La tentación es declararlos como
 * `any` y silenciar el compilador; eso dejaría el tipado como decoración.
 *
 * Aquí se hace lo contrario: cada módulo propio se declara con
 * `typeof import(...)`, de modo que el compilador usa la firma REAL inferida del
 * fichero JS. Si mañana alguien llama a `runCleanup` con los argumentos
 * cambiados de orden, `tsc` falla. Eso es un contrato, no un comentario.
 *
 * Lo único que queda como `any` son las dos librerías de terceros sin tipos
 * (`pdfjsLib` y `Tesseract`), que se cargan desde `renderer/vendor/` y no tienen
 * paquete `@types` instalado. Está señalado explícitamente más abajo.
 */

/** Respuesta del puente con sobre de estado: `{ ok, error?, ...datos }`. */
interface LoreBridgeResponse {
  ok: boolean;
  error?: string;
  /**
   * El resto del sobre varía por operación: `text` y `usage` en aiGenerate,
   * `results` en webSearch, `page` en webFetch, `models` en aiModels. Tipar cada
   * respuesta con su propia interfaz sería lo ideal y queda pendiente; mientras
   * tanto el índice es `any` y no `unknown`, que obligaba a un cast por cada
   * acceso legítimo sin aportar ninguna garantía a cambio.
   */
  [key: string]: any;
}

/**
 * Puente entre el renderer y el mundo exterior.
 *
 * En escritorio lo expone `preload.js` sobre IPC; en el navegador (preview web o
 * pruebas) lo construye `app.js` sobre localStorage con la MISMA forma, de modo
 * que el resto de la aplicación no necesita saber dónde está corriendo.
 */
interface LoreBridge {
  /** Datos completos de la aplicación, ya normalizados. */
  loadData(): Promise<any>;
  saveData(data: unknown): Promise<LoreBridgeResponse | boolean>;
  exportFile(data: unknown): Promise<LoreBridgeResponse>;
  importFile(): Promise<LoreBridgeResponse>;
  openExternal(url: string): Promise<unknown>;
  aiGenerate(payload: Record<string, unknown>): Promise<LoreBridgeResponse>;
  aiModels(payload?: Record<string, unknown>): Promise<LoreBridgeResponse>;
  aiVerify(payload?: Record<string, unknown>): Promise<LoreBridgeResponse>;
  omniRouteStatus(payload?: Record<string, unknown>): Promise<LoreBridgeResponse>;
  webSearch(payload: Record<string, unknown>): Promise<LoreBridgeResponse>;
  webFetch(payload: Record<string, unknown>): Promise<LoreBridgeResponse>;
  secretsGet(): Promise<LoreBridgeResponse>;
  secretsSet(apiKey: string): Promise<LoreBridgeResponse>;
  secretsStatus(): Promise<LoreBridgeResponse>;
  clipboardWrite(text: string): Promise<LoreBridgeResponse>;
  systemScanHardware(): Promise<LoreBridgeResponse>;
  onAppEvent(channel: string, callback: (payload: unknown) => void): () => void;
  /** true solo en Electron; ausente o false en el navegador. */
  isDesktop?: boolean;
}

interface Window {
  /** Puente de datos (Electron vía preload, o localStorage en el navegador). */
  lorevinci: LoreBridge;

  // Módulos propios: tipados con su firma REAL, no con `any`.
  /** Configuración de extremos remotos (renderer/app-config.js). */
  LoreConfig: typeof import('../renderer/app-config.js');
  /** Núcleo de aplicación: Result, errores tipados, log, persistencia. */
  LoreKernel: typeof import('../renderer/app-kernel.js');
  /** Datos semilla compartidos con el proceso principal. */
  LoreSeed: typeof import('../renderer/seed-data.js');
  /** Sanitizado y seguridad de salida al DOM. */
  LoreDomSafe: typeof import('../renderer/dom-safe.js');
  /** Motor de campaña RPG. */
  LoreRpgEngine: typeof import('../renderer/rpg-engine.js');

  // Librerías de terceros sin paquete @types: se cargan desde renderer/vendor/.
  // Tiparlas de verdad exigiría instalar pdfjs-dist y tesseract.js como
  // dependencias de desarrollo; mientras tanto el contrato es `any` y queda
  // señalado aquí en vez de escondido en un @ts-ignore repartido por el código.
  /** pdf.js (renderer/vendor/pdfjs/pdf.min.js). */
  pdfjsLib: any;
  /** Tesseract.js (renderer/vendor/tesseract/tesseract.min.js). */
  Tesseract: any;
}
