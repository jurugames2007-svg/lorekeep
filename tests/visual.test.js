// Aceptación visual/estructural sin navegador gráfico: controles visibles, modales,
// responsive CSS, nombres accesibles y ausencia de IDs duplicados.
const fs=require('fs');
const {makeApp,makeSeed,reporter,P}=require('./harness');
const seed=makeSeed();seed.stories[0].projectMode='rpg';seed.stories[0].rpg={role:'player',player:{name:'Sol',age:18,occupation:'Explorador',grade:'4',motivation:'Aprender',equipment:'Linterna',attributes:{strength:3,agility:3,resistance:3,control:3,flow:3,reserve:0},resources:{pemCurrent:100,hpCurrent:80},conditions:[]}};
const {w,errors}=makeApp({seed});const R=reporter('visual');
setTimeout(()=>{const d=w.document,ok=R.ok,probe=w.__probe,sid=probe('DATA.stories[0].id');
  const ids=[...d.querySelectorAll('[id]')].map(x=>x.id);ok('sin IDs duplicados',new Set(ids).size===ids.length,ids.filter((x,i)=>ids.indexOf(x)!==i).join(','));
  const unnamed=[...d.querySelectorAll('button')].filter(b=>!(b.textContent.trim()||b.getAttribute('aria-label')||b.getAttribute('title')));
  ok('todos los botones tienen nombre accesible',unnamed.length===0,unnamed.map(x=>x.id).join(','));
  const worldInputs=['worldToolType','worldToolName','worldToolDetail','worldToolValue'].map(id=>d.getElementById(id));
  ok('herramientas del mundo tienen etiquetas accesibles',worldInputs.every(x=>x&&x.getAttribute('aria-label')));
  probe(`openStoryEditor("${sid}");openRpgTable()`);
  ok('Mesa RPG se muestra como diálogo modal',d.getElementById('rpgTableModalBackdrop').classList.contains('active')&&d.getElementById('rpgTableModalBackdrop').getAttribute('aria-modal')==='true');
  ok('cabecera mantiene Rol, Idioma y Detalle GM',!d.getElementById('rpgRoleSelect').hidden&&!d.getElementById('rpgLanguageSelect').hidden&&!d.getElementById('rpgGmDetailSelect').hidden);
  d.getElementById('rpgSessionZeroBtn').click();ok('Sesión cero abre con cuatro bloques visibles',d.getElementById('sessionZeroBackdrop').classList.contains('active')&&d.querySelectorAll('.session-zero-progress span').length===4);
  ok('Sesión cero ofrece Jugador y Director',d.getElementById('szRole').options.length===2);
  d.getElementById('sessionZeroBackdrop').classList.remove('active');d.getElementById('rpgWorldDashboardBtn').click();
  ok('panel de mundo muestra nueve sistemas',d.getElementById('worldDashboardBackdrop').classList.contains('active')&&d.querySelectorAll('#worldDashboardGrid .world-system-card').length===9);
  d.getElementById('worldDashboardBackdrop').classList.remove('active');
  probe(`openWebResearch("${sid}","mundo")`);ok('investigación web expone buscador, URL y selección',!!d.getElementById('webResearchQuery')&&!!d.getElementById('webDirectUrl')&&!!d.getElementById('attachWebSourcesBtn'));
  const css=fs.readFileSync(P+'styles.css','utf8');
  ok('Mesa usa layout flexible sin altura rígida',/\.rpg-table-modal[^}]*display:flex[^}]*flex-direction:column/s.test(css)&&/\.rpg-table-layout[^}]*flex:1 1 auto/s.test(css));
  ok('responsive no oculta selectores críticos',!/@media\s*\(max-width:760px\)[\s\S]{0,500}\.rpg-detail-label\s*\{\s*display:none/.test(css));
  ok('dashboard baja a una columna en pantalla estrecha',/@media\(max-width:560px\)[^{]*\{[^}]*\.world-dashboard-grid\{grid-template-columns:1fr\}/.test(css));
  ok('animaciones respetan movimiento reducido',/@media \(prefers-reduced-motion:reduce\)/.test(css));
  const runtime=errors.filter(e=>!/Not implemented|Could not parse CSS/i.test(e));ok('sin errores de ejecución visual',runtime.length===0,runtime.join(' | '));
  R.done();
},2500);
