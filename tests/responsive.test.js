// Pruebas automatizadas de diseño responsivo y fluidez en cualquier resolución de pantalla:
// móviles, tablets, ventanas divididas (split-screen), laptops y monitores de alta densidad.
const fs = require('fs');
const { makeApp, makeSeed, reporter, P } = require('./harness');

const seed = makeSeed();
const { w, errors } = makeApp({ seed });
const R = reporter('responsive');

setTimeout(() => {
  const d = w.document;
  const ok = R.ok;
  const probe = w.__probe;

  // 1. Elementos de navegación responsiva en el DOM
  const mobileBtn = d.getElementById('mobileMenuBtn');
  ok('botón de menú móvil existe', Boolean(mobileBtn));
  ok('botón de menú móvil tiene etiqueta accesible', Boolean(mobileBtn && (mobileBtn.getAttribute('aria-label') || mobileBtn.getAttribute('title'))));
  ok('botón de menú móvil está agrupado con el crumb', Boolean(mobileBtn && mobileBtn.closest('.top-nav-left')));

  const backdrop = d.getElementById('sidebarBackdrop');
  ok('telón de fondo (backdrop) del panel móvil existe', Boolean(backdrop));

  const sidebar = d.getElementById('mainSidebar');
  ok('panel lateral principal existe', Boolean(sidebar));

  // 2. Interacciones del menú móvil
  if (mobileBtn && sidebar && backdrop) {
    mobileBtn.click();
    ok('clic en menú móvil despliega el panel lateral', sidebar.classList.contains('mobile-open'));
    ok('clic en menú móvil activa el telón de fondo', backdrop.classList.contains('active'));

    backdrop.click();
    ok('clic en telón de fondo cierra el panel lateral', !sidebar.classList.contains('mobile-open'));
    ok('clic en telón de fondo desactiva el telón', !backdrop.classList.contains('active'));

    // Reabrir y verificar que showView cierra el panel
    mobileBtn.click();
    ok('reapertura de panel lateral confirmada', sidebar.classList.contains('mobile-open'));

    probe('showView("characters")');
    ok('navegar a otra vista cierra automáticamente el panel móvil', !sidebar.classList.contains('mobile-open'));
    ok('navegar a otra vista retira el telón activo', !backdrop.classList.contains('active'));
    ok('vista seleccionada queda activa', d.getElementById('view-characters').classList.contains('active'));
  }

  // 3. Inspección estática del CSS para fluidez y no-deformación
  const css = fs.readFileSync(P + 'styles.css', 'utf8');

  // Media queries clave
  ok('CSS define adaptación móvil a 768px', /@media\s*\(\s*max-width:\s*768px\s*\)/.test(css));
  ok('CSS define adaptación compacta a 600px', /@media\s*\(\s*max-width:\s*600px\s*\)/.test(css));
  ok('CSS define adaptación tablet a 900px o 1024px', /@media\s*\(\s*max-width:\s*(900|1024)px\s*\)/.test(css));
  ok('CSS preserva sidebar colapsado en desktop >= 769px', /@media\s*\(\s*min-width:\s*769px\s*\)/.test(css));

  // Modales fluidos con clamp/min y límites en unidades de viewport
  ok('modales estándar no exceden el ancho de pantalla', /\.modal\s*\{[^}]*width:\s*min\(/s.test(css));
  ok('modal de perfil de autor tiene ancho adaptable min()', /\.author-profile-modal\s*\{[^}]*width:\s*min\(/s.test(css));
  ok('modal de configuración de libro tiene ancho adaptable min()', /\.story-config-modal\s*\{[^}]*width:\s*min\(/s.test(css));
  ok('modal de captura RPG tiene ancho adaptable min()', /\.rpg-capture-modal\s*\{[^}]*width:\s*min\(/s.test(css));
  ok('modal de onboarding tiene ancho adaptable min()', /\.onboarding-modal\s*\{[^}]*width:\s*min\(/s.test(css));
  ok('modal de ayuda tiene ancho adaptable min()', /\.help-modal\s*\{[^}]*width:\s*min\(/s.test(css));

  // Grids fluidas auto-fit / auto-fill
  ok('cuadrícula de historias usa auto-fill con minmax seguro', /\.story-grid[^{]*\{[^}]*minmax\(min\(196px,\s*100%\)/s.test(css));
  ok('cuadrícula de perfiles de hardware es fluida', /\.hardware-profiles-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/s.test(css));
  ok('cuadrícula de diagnóstico de hardware es fluida', /\.hardware-diagnostics-box\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/s.test(css));

  // Editor y paneles laterales en modo responsivo
  ok('panel lateral derecho del editor se adapta en tablet/móvil', /@media\s*\(max-width:\s*1024px\)[\s\S]*?\.side-panel/s.test(css));
  ok('panel de capítulos del editor se adapta en tablet/móvil', /@media\s*\(max-width:\s*768px\)[\s\S]*?\.chapter-panel/s.test(css));
  ok('barra de herramientas del editor permite flex-wrap', /\.editor-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s.test(css));

  // Búsqueda superior y widgets flotantes
  ok('campo de búsqueda superior usa clamp para ancho fluido', /\.top-actions\s+input\s*\{[^}]*width:\s*clamp\(/s.test(css));
  ok('telón de fondo tiene animación y desenfoque', /\.sidebar-backdrop\s*\{[^}]*backdrop-filter:\s*blur/s.test(css));

  // 4. Ausencia de errores de ejecución
  const runtime = errors.filter(e => !/Not implemented|Could not parse CSS/i.test(e));
  ok('sin errores de ejecución en pruebas responsivas', runtime.length === 0, runtime.join(' | '));

  R.done();
}, 2500);
