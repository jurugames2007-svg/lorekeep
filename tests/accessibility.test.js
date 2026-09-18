// Accesibilidad verificable sin navegador gráfico: nombres accesibles, diálogos
// operables por teclado, foco atrapado y restaurado, y avisos anunciados.
const fs = require('fs');
const { makeApp, makeSeed, reporter, P } = require('./harness');

const R = reporter('accessibility');
const ok = R.ok;
const seed = makeSeed();
const { w, errors } = makeApp({ seed });

function key(k, opts = {}) {
  return new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts));
}

setTimeout(() => {
  const d = w.document;
  const probe = w.__probe;
  const byId = (id) => d.getElementById(id);

  // ---- Estructura básica ----
  const skip = byId('content-area');
  ok('existe el destino del enlace de salto', Boolean(skip));
  const skipLink = d.querySelector('a.skip-link');
  ok('enlace "saltar al contenido" presente y apuntando al main', Boolean(skipLink) && skipLink.getAttribute('href') === '#content-area');
  ok('el main tiene id para recibir el salto', skip && skip.id === 'content-area');
  ok('idioma del documento declarado', d.documentElement.getAttribute('lang') === 'es');

  // ---- Nombres accesibles ----
  const unnamedControls = [...d.querySelectorAll('input,select,textarea')]
    .filter((c) => c.type !== 'hidden')
    .filter((c) => {
      const id = c.id;
      const labelled = (id && d.querySelector(`label[for="${id}"]`)) || c.closest('label')
        || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || c.getAttribute('title');
      return !labelled;
    });
  ok('todos los controles de formulario tienen nombre accesible', unnamedControls.length === 0, unnamedControls.map((c) => c.id || c.tagName).join(','));

  const unnamedButtons = [...d.querySelectorAll('button')]
    .filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('title')));
  ok('todos los botones tienen nombre accesible', unnamedButtons.length === 0, unnamedButtons.map((b) => b.id || b.className).join(','));

  const avatar = byId('profileAvatarBtn');
  ok('el avatar del perfil es un <button> enfocable', avatar && avatar.tagName === 'BUTTON');
  ok('el avatar anuncia que abre un diálogo', avatar && avatar.getAttribute('aria-haspopup') === 'dialog');

  // ---- Diálogos ----
  const backdrops = [...d.querySelectorAll('.modal-backdrop')];
  ok('la app declara más de 10 diálogos', backdrops.length >= 10, String(backdrops.length));
  const unnamedDialogs = backdrops.filter((b) => !(b.getAttribute('aria-label') || b.getAttribute('aria-labelledby')));
  ok('todos los diálogos tienen nombre accesible', unnamedDialogs.length === 0, unnamedDialogs.map((b) => b.id).join(','));
  ok('todos los diálogos son role=dialog + aria-modal', backdrops.every((b) => b.getAttribute('role') === 'dialog' && b.getAttribute('aria-modal') === 'true'));

  // ---- Avisos anunciados a lectores de pantalla ----
  const toast = byId('lorevinciToast');
  ok('el toast es una región viva', toast && toast.getAttribute('role') === 'status' && toast.getAttribute('aria-live') === 'polite');
  probe('showToast("Mensaje de prueba")');
  ok('showToast escribe en la región viva', toast.textContent === 'Mensaje de prueba' && toast.classList.contains('active'));

  // ---- Escape cierra cualquier diálogo ----
  // El gestor se engancha con un MutationObserver, cuyos registros se entregan en
  // microtareas: cada aserto sobre la pila se hace después de ceder el turno.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  (async () => {
    probe('openStoryModal()');
    ok('el diálogo de nueva historia se abre', byId('storyModalBackdrop').classList.contains('active'));
    await tick();
    ok('el diálogo abierto queda registrado en la pila', probe('openModalStack.length') >= 1, String(probe('openModalStack.length')));
    d.dispatchEvent(key('Escape'));
    ok('Escape cierra el diálogo', !byId('storyModalBackdrop').classList.contains('active'));
    ok('la pila se vacía de forma síncrona al cerrar', probe('openModalStack.length') === 0);
    ok('cerrar libera el bloqueo del fondo', !d.body.classList.contains('modal-open'));

    // El diálogo de confirmación resuelve aunque se cierre con Escape
    probe(`window.__confirmValue = null; showConfirm({ title: 'T', text: 'x', okLabel: 'Ok' }).then(v => { window.__confirmValue = v; })`);
    ok('el diálogo de confirmación se abre', byId('confirmModalBackdrop').classList.contains('active'));
    d.dispatchEvent(key('Escape'));
    await tick();
    ok('Escape resuelve la confirmación como false (sin promesa colgada)', w.__confirmValue === false, String(w.__confirmValue));

    // Clic fuera del diálogo también lo cierra
    probe('openCharModal(null)');
    const charModal = byId('charModalBackdrop');
    ok('diálogo de personaje abierto', charModal.classList.contains('active'));
    await tick();
    const focusables = probe(`modalFocusables(document.getElementById('charModalBackdrop')).length`);
    ok('el diálogo expone controles enfocables', focusables > 2, String(focusables));
    const trapInfo = probe(`(function(){
      const bd = document.getElementById('charModalBackdrop');
      const f = modalFocusables(bd);
      f[f.length - 1].focus();
      const ev = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      trapFocus(bd, ev);
      return { prevented: ev.defaultPrevented, moved: document.activeElement === f[0] };
    })()`);
    ok('Tab en el último control vuelve al primero', trapInfo.prevented === true && trapInfo.moved === true);

    // Shift+Tab en el primero lleva al último
    const backInfo = probe(`(function(){
      const bd = document.getElementById('charModalBackdrop');
      const f = modalFocusables(bd);
      f[0].focus();
      const ev = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      trapFocus(bd, ev);
      return { prevented: ev.defaultPrevented, moved: document.activeElement === f[f.length - 1] };
    })()`);
    ok('Shift+Tab en el primer control lleva al último', backInfo.prevented === true && backInfo.moved === true);

    probe('closeModal(document.getElementById("charModalBackdrop"))');
    ok('cerrar el diálogo lo saca de la pila', probe('openModalStack.length') === 0);
    ok('cerrar el diálogo libera el bloqueo del fondo', !d.body.classList.contains('modal-open'));
    await tick();
    ok('el observador no vuelve a registrar un diálogo cerrado', probe('openModalStack.length') === 0);

    // ---- Estado de guardado anunciado ----
    probe('setSaveStatus("error", "disco lleno")');
    const indicator = byId('saveIndicator');
    ok('el indicador de guardado refleja el error', indicator.classList.contains('error') && byId('saveIndicatorText').textContent === 'Sin guardar');
    ok('el indicador explica el error en su title', /disco lleno/.test(indicator.title));
    probe('setSaveStatus("saved")');
    ok('el indicador vuelve a "Todo guardado"', byId('saveIndicatorText').textContent === 'Todo guardado' && !indicator.classList.contains('error'));

    // ---- Búsqueda por teclado ----
    probe('showView("home")');
    const search = byId('globalSearch');
    ok('la búsqueda es un combobox anunciado', search.getAttribute('role') === 'combobox' && search.getAttribute('aria-controls') === 'searchResults');
    ok('la búsqueda tiene etiqueta asociada', Boolean(d.querySelector('label[for="globalSearch"]')));
    ok('la lista de resultados es un listbox', byId('searchResults').getAttribute('role') === 'listbox');

    // ---- Movimiento reducido ----
    const css = fs.readFileSync(P + 'styles.css', 'utf8');
    ok('movimiento reducido cubre toda la interfaz', /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{/.test(css));
    ok('existe estilo de foco visible', /:focus-visible\s*\{[^}]*outline/.test(css));
    ok('existe clase .sr-only para texto oculto accesible', /\.sr-only\s*\{[^}]*clip-path/.test(css));
    ok('el tema claro define color-scheme', /body\.theme-paper[^}]*color-scheme: light/.test(css));

    // ---- Barra del editor ----
    const editor = byId('chapterEditor');
    ok('el editor se anuncia como caja de texto multilínea', editor.getAttribute('role') === 'textbox' && editor.getAttribute('aria-multiline') === 'true');
    ok('el editor tiene ayuda contextual para teclado', Boolean(editor.getAttribute('aria-describedby')) && Boolean(byId('chapterEditorHelp')));
    ok('deshacer y rehacer tienen botones visibles', Boolean(byId('editorUndoBtn')) && Boolean(byId('editorRedoBtn')));

    const runtime = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
    ok('sin errores de ejecución en accesibilidad', runtime.length === 0, runtime.slice(0, 3).join(' | '));
    R.done();
  })();
}, 2600);
