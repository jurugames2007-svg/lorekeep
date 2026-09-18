/**
 * LoreDomSafe — capa única de seguridad de salida (escape + sanitizado + URLs).
 *
 * Por qué existe este módulo:
 *  LoreVinci inyecta HTML que no controla: prosa devuelta por modelos de IA,
 *  respaldos `.json` importados de otras personas, texto extraído de PDFs y
 *  páginas web capturadas. Confiar en "sanitizar al guardar" no es suficiente
 *  porque hay rutas (importación, migraciones antiguas, ficheros editados a
 *  mano) que escriben directamente en el almacén. La regla del proyecto es:
 *  **todo HTML ajeno se sanitiza en el momento en que toca el DOM**, y este
 *  archivo es el único sitio donde esa política se implementa.
 *
 *  Se usa desde el renderer (window.LoreDomSafe) y desde Node en las pruebas
 *  (module.exports), por eso el cierre UMD.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LoreDomSafe = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /** Etiquetas que sobreviven al sanitizado (whitelist estricta). */
  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'HR', 'SPAN', 'DIV', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE',
    'SMALL', 'SUB', 'SUP', 'MARK', 'ABBR', 'Q', 'CITE', 'CODE', 'PRE', 'BLOCKQUOTE',
    'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'FIGURE',
    'FIGCAPTION', 'IMG', 'RUBY', 'RT', 'TIME', 'SECTION', 'ARTICLE', 'ASIDE',
    'NAV', 'HEADER', 'FOOTER', 'MAIN', 'DETAILS', 'SUMMARY'
  ]);

  /** Atributos permitidos por etiqueta. Nada de `style`, `srcdoc` ni `formaction`. */
  const ALLOWED_ATTRS = {
    '*': ['title', 'lang', 'dir', 'align'],
    A: ['href', 'rel', 'target'],
    IMG: ['src', 'alt', 'width', 'height', 'loading'],
    TD: ['colspan', 'rowspan'],
    TH: ['colspan', 'rowspan', 'scope'],
    OL: ['start', 'type'],
    TIME: ['datetime'],
    ABBR: ['title'],
    DETAILS: ['open']
  };

  const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i;
  const DANGEROUS_SCHEME = /^(?:javascript|vbscript|data|blob|file):/i;
  const MAX_IMAGE_DATA_URL = 8 * 1024 * 1024; // ~8 MB de base64

  /**
   * Escape seguro para **atributos** y texto. A diferencia de la versión antigua
   * (que delegaba en `div.innerHTML` y no escapaba comillas), aquí se cubren
   * `"` y `'` para que un id con comillas no pueda romper un atributo.
   */
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** URL apta para `href`/`src`: http(s), mailto, rutas relativas y anclas. */
  function safeUrl(value) {
    const url = String(value ?? '').trim().replace(/[\u0000-\u001f\s]/g, '');
    if (!url) return '';
    if (DANGEROUS_SCHEME.test(url)) return '';
    if (!/^(?:https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url) && /^[a-z][a-z0-9+.-]*:/i.test(url)) return '';
    return url.slice(0, 2048);
  }

  /**
   * Imagen apta para avatar/portada/fondo. Se acepta HTTPS y `data:image/*`,
   * **excepto SVG**: un SVG es un documento XML con `<script>` propio y es el
   * vector clásico de XSS cuando se sirve como `data:`.
   */
  function safeImageUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url.slice(0, 2048);
    if (IMAGE_DATA_URL.test(url) && url.length <= MAX_IMAGE_DATA_URL) return url;
    return '';
  }

  /** Convierte una URL validada en un `url()` de CSS sin riesgo de inyección. */
  function safeCssImageUrl(value) {
    const url = safeImageUrl(value);
    if (!url) return 'none';
    return `url("${url.replace(/["\\]/g, '')}")`;
  }

  function isAllowedAttr(tag, name) {
    return (ALLOWED_ATTRS['*'] || []).includes(name) || (ALLOWED_ATTRS[tag] || []).includes(name);
  }

  /**
   * Limpieza sin DOM para entornos Node (proceso principal de Electron y pruebas):
   * elimina por completo los bloques ejecutables y despliega las etiquetas no
   * permitidas conservando su texto. No reemplaza al sanitizado del navegador,
   * pero garantiza que ningún HTML hostil llegue a escribirse en disco.
   */
  const VOID_TAGS = new Set(['BR', 'HR', 'IMG', 'INPUT', 'AREA', 'BASE', 'COL', 'EMBED', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);

  function stripDangerousBlocks(source) {
    return String(source)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\s*(script|style|template|iframe|object|embed|svg|math|form|noscript|frame|frameset|applet)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<\s*(script|style|template|iframe|object|embed|svg|math|form|noscript|frame|frameset|applet)\b[^>]*\/?>/gi, ' ');
  }

  function attributeIsSafe(name, value, tag) {
    if (name.startsWith('on') || name.includes(':')) return false;
    if (!isAllowedAttr(tag, name)) return false;
    if (name === 'href') return safeUrl(value) !== '';
    if (name === 'src') return (tag === 'IMG' ? safeImageUrl(value) : safeUrl(value)) !== '';
    return true;
  }

  function sanitizeWithoutDom(source) {
    return stripDangerousBlocks(source)
      .replace(/<\s*\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (match, rawTag, rawAttrs) => {
        const closing = match.trim().startsWith('</');
        const tag = rawTag.toUpperCase();
        if (!ALLOWED_TAGS.has(tag)) return ' ';
        if (closing) return VOID_TAGS.has(tag) ? '' : `</${tag.toLowerCase()}>`;
        const kept = [];
        const attrRx = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        let attr;
        while ((attr = attrRx.exec(rawAttrs)) !== null) {
          const name = attr[1].toLowerCase();
          const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
          if (attributeIsSafe(name, value, tag)) kept.push(`${name}="${escapeHtml(value)}"`);
        }
        if (tag === 'A') kept.push('rel="noopener noreferrer nofollow"');
        return VOID_TAGS.has(tag) ? `<${tag.toLowerCase()}${kept.length ? ' ' + kept.join(' ') : ''}>` : `<${tag.toLowerCase()}${kept.length ? ' ' + kept.join(' ') : ''}>`;
      })
      .replace(/\s{3,}/g, '  ');
  }

  /**
   * Sanitiza HTML no confiable usando el parser del navegador pero con
   * `parseFromString`, que **nunca ejecuta scripts ni carga recursos** durante
   * el parseo (a diferencia de asignar `innerHTML` en un nodo vivo). Sin DOM
   * (proceso principal, pruebas) aplica la misma política por expresiones
   * regulares: la regla es idéntica en ambos mundos.
   */
  function sanitizeHtml(html) {
    const source = String(html ?? '');
    if (!source) return '';
    if (typeof DOMParser === 'undefined') return sanitizeWithoutDom(source);

    const doc = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
    const body = doc.body;

    body.querySelectorAll('script,iframe,object,embed,link,meta,base,style,form,input,button,select,textarea,option,svg,math,template,portal,frame,frameset,applet,marquee,blink,audio,video,source,track').forEach((node) => node.remove());

    body.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toUpperCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Se conserva el texto (una novela no puede perder prosa) pero no la etiqueta.
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value ?? '');
        if (name.startsWith('on') || name.startsWith('data-on') || name.includes(':')) {
          el.removeAttribute(attr.name);
          return;
        }
        if (!isAllowedAttr(tag, name)) {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === 'href' || name === 'src') {
          const clean = name === 'src' && tag === 'IMG' ? safeImageUrl(value) : safeUrl(value);
          if (clean) el.setAttribute(name, clean);
          else el.removeAttribute(name);
        }
      });
      if (tag === 'A') {
        el.setAttribute('rel', 'noopener noreferrer nofollow');
        if (!el.getAttribute('href')) el.removeAttribute('target');
      }
      if (tag === 'IMG' && !el.getAttribute('alt')) el.setAttribute('alt', '');
    });

    return body.innerHTML;
  }

  /**
   * Texto plano a partir de HTML. Usa regex en vez de crear un nodo vivo: en el
   * editor se llama en cada pulsación y parsear el capítulo completo con el DOM
   * cuesta decenas de milisegundos en manuscritos largos.
   */
  function htmlToText(html) {
    return String(html ?? '')
      .replace(/<\s*(?:script|style|template)\b[\s\S]*?<\s*\/\s*(?:script|style|template)\s*>/gi, ' ')
      .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/gi, "'")
      .replace(/[ \t\r\f\v]+/g, ' ')
      .trim();
  }

  const WORD_CACHE_LIMIT = 120;
  const wordCache = new Map();

  /** Conteo de palabras con memoización LRU (mismo HTML ⇒ mismo resultado). */
  function wordCount(html) {
    const source = String(html ?? '');
    if (!source) return 0;
    if (wordCache.has(source)) {
      const cached = wordCache.get(source);
      wordCache.delete(source);
      wordCache.set(source, cached); // refresca recencia
      return cached;
    }
    const text = htmlToText(source);
    const count = text ? text.split(/\s+/).length : 0;
    wordCache.set(source, count);
    if (wordCache.size > WORD_CACHE_LIMIT) wordCache.delete(wordCache.keys().next().value);
    return count;
  }

  /** Convierte un campo de texto plano (título, nombre, nota) en texto seguro. */
  function sanitizePlainText(value, limit = 4000) {
    return htmlToText(String(value ?? '')).slice(0, limit);
  }

  return {
    escapeHtml,
    sanitizeHtml,
    sanitizeWithoutDom,
    sanitizePlainText,
    safeUrl,
    safeImageUrl,
    safeCssImageUrl,
    htmlToText,
    wordCount,
    ALLOWED_TAGS,
    ALLOWED_ATTRS
  };
});
