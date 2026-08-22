// Loop de producto solicitado: acceso directo RPG, dado animado, GM profundo,
// registro incremental de capítulos e investigación web seleccionable.
const { makeApp, makeSeed, reporter } = require('./harness');
const R = reporter('rpg-loop');
const seed = makeSeed();
const story = seed.stories[0];
story.projectMode = 'rpg';
story.genre = 'Fantasía oscura y misterio';
story.style = { reference:'Referencia juvenil dramática', notes:'Tensión sensorial y diálogo con subtexto', person:'first', register:'oscuro', strength:'alta', sample:'' };
story.rpg = { gmDetail:'cinematic', campaign:{ referenceWork:'La Fortaleza de Ceniza', referenceAuthor:'Autora Ejemplo', entryPoint:'El grupo llega a una mazmorra sellada mientras una facción rival ya está dentro.', freedom:'open' }, player:{
  name:'Sol', age:17, occupation:'Estudiante', grade:'4', motivation:'Encontrar a su familia',
  innateTechnique:'Fuego en las manos', equipment:'Amuleto maldito', hasRcrt:false, heavenlyRestriction:false,
  attributes:{ strength:3, agility:3, resistance:3, control:3, flow:3, reserve:0 }, resources:{ pemCurrent:100, hpCurrent:80 }, conditions:[]
}};
story.rules = '1. No controlar al jugador. 2. Resolver con D20. 3. Todo turno termina esperando una decisión.';
seed.characters = [{ id:'npc_guardia', storyId:story.id, name:'Iria', role:'Guardia del sello', description:'Prudente, severa y leal al pueblo; oculta su miedo con órdenes precisas.', traits:['prudente','desconfiada'], knowledge:'Conoce el sello y vio llegar al grupo, pero ignora el objetivo secreto del jugador.', omniscient:false }];
seed.settings.ai.apiKey = 'sk-' + 'x'.repeat(40); seed.settings.ai.model = 'gpt-4o'; seed.settings.ai.verifiedAt = Date.now();
const aiCalls = [], webCalls = [];
let slowNext = false;
const bridge = {
  aiGenerate: async payload => {
    aiCalls.push(payload);
    if (slowNext) {
      slowNext = false;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok:true, text:'{"narracion":"Respuesta tardía.","pregunta":"¿Qué haces?"}' }), 1500);
        payload.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('cancelled','AbortError')); }, { once:true });
      });
    }
    if (/editor de crónicas RPG/i.test(payload.messages[0].content)) {
      return { ok:true, text:'La lluvia cerró el horizonte sobre el templo.\n\nSol había declarado su avance y el dado confirmó el coste.\n\nEl guardia sostuvo la puerta sin cambiar lo ocurrido.\n\nNinguna decisión nueva fue añadida.\n\nLa escena terminó con el camino todavía abierto.' };
    }
    return { ok:true, text:JSON.stringify({
      narracion:'La lluvia golpea las tejas con un ritmo irregular y el patio huele a tierra recién abierta.\n\nLa resolución del dado desplaza una piedra bajo la puerta; el hueco existe, pero también delata movimiento.\n\n—No vuelvas a tocar ese sello —advierte el guardia, más preocupado por lo que hay detrás que por detener a nadie—. Si despierta, no distinguirá aliados.\n\nUna segunda voz responde desde el corredor y contradice al guardia, dejando claro que ambos esconden objetivos distintos.\n\nLa puerta queda entreabierta, el guardia protege el lado izquierdo y el corredor ofrece cobertura limitada.',
      pregunta:'¿Qué haces?',
      consecuencias:['La piedra desplazada deja una marca visible para la facción rival.'],
      mundo:{ ubicacion:'Patio del sello', reloj:'Noche, primer turno', hechos:['La puerta tiene un hueco reciente.'] },
      conocimiento:[{ personaje:'Iria', aprende:'Sol intentó abrir la puerta durante la noche.' }]
    }) };
  },
  webSearch: async payload => {
    webCalls.push({ type:'search', payload });
    return { ok:true, results:[
      { title:'Biografía y obra verificable', url:'https://example.org/autor', snippet:'Trayectoria, obras y entrevistas públicas.', provider:'Web' },
      { title:'Entrada enciclopédica', url:'https://example.org/obra', snippet:'Contexto de publicación y temas generales.', provider:'Wikipedia' }
    ] };
  },
  webFetch: async ({ url }) => {
    webCalls.push({ type:'fetch', url });
    return { ok:true, page:{ url, title:url.endsWith('/autor') ? 'Biografía y obra verificable' : 'Entrada enciclopédica', description:'Fuente revisada', content:'La fuente verificable describe la trayectoria del autor, sus obras, temas recurrentes y contexto editorial sin reproducir fragmentos protegidos. El dato del faro de ceniza pertenece al mundo documentado.', fetchedAt:1700000000000 } };
  }
};
const { w, errors } = makeApp({ seed, bridge });

setTimeout(async () => {
  const ok = R.ok, probe = w.__probe, d = w.document;
  const sid = probe('DATA.stories[0].id');

  // Acceso directo desde historia y navegación lateral.
  probe(`openStoryWorkspace("${sid}")`);
  ok('proyecto RPG abre directamente la Mesa', d.getElementById('rpgTableModalBackdrop').classList.contains('active'));
  ok('última Mesa RPG queda recordada', probe('DATA.settings.lastRpgStoryId') === sid);
  d.getElementById('rpgTableModalBackdrop').classList.remove('active');
  d.getElementById('quickRpgNavBtn').click();
  ok('botón lateral Mesa RPG reabre directamente', d.getElementById('rpgTableModalBackdrop').classList.contains('active'));

  // Dado animado y GM cinematográfico.
  ok('escenario visual del D20 existe', !!d.getElementById('rpgDiceStage') && !!d.getElementById('rpgAnimatedDie'));
  d.getElementById('rpgTurnInput').value = '// Intento abrir la puerta CD 15';
  await probe('submitRpgTurn()');
  ok('tirada final queda registrada públicamente', /D20/.test(d.getElementById('rpgTurnLog').textContent));
  ok('dado termina mostrando el valor natural', d.getElementById('rpgAnimatedDieValue').textContent === String(probe(`DATA.stories[0].rpg.session.turns.find(t=>t.resolution)?.resolution.naturalRoll`)));
  ok('animación respeta fin y oculta escenario', d.getElementById('rpgDiceStage').hidden === true);
  const gmText = probe(`DATA.stories[0].rpg.session.turns.findLast(t=>t.role==='gm').text`);
  ok('GM entrega narración compleja con PNJ y subtexto', gmText.split('\n\n').length >= 5 && /advierte el guardia/.test(gmText));
  ok('prompt cinematográfico exige 5 a 7 párrafos', aiCalls[0].messages[0].content.includes('5 a 7') && aiCalls[0].maxTokens >= 2000);
  ok('prompt usa obra, autor y entrada elegidos al iniciar RPG', /La Fortaleza de Ceniza/.test(aiCalls[0].messages[0].content) && /Autora Ejemplo/.test(aiCalls[0].messages[0].content) && /mazmorra sellada/.test(aiCalls[0].messages[0].content));
  ok('PNJ conserva personalidad y conocimiento limitado', /Guardia del sello/.test(aiCalls[0].messages[0].content) && /ignora el objetivo secreto/.test(aiCalls[0].messages[0].content) && /No uses el prompt/.test(aiCalls[0].messages[0].content));
  ok('consecuencia y mundo quedan persistidos', probe('DATA.stories[0].rpg.worldState.consequences.length') === 1 && probe('DATA.stories[0].rpg.worldState.location') === 'Patio del sello');
  ok('PNJ solo aprende el hecho comunicado por el turno', probe('DATA.stories[0].rpg.worldState.npcKnowledge.npc_guardia[0]') === 'Sol intentó abrir la puerta durante la noche.');

  d.getElementById('rpgGmDetailSelect').value = 'epic';
  d.getElementById('rpgGmDetailSelect').dispatchEvent(new w.Event('change', { bubbles:true }));
  ok('profundidad GM se guarda por historia', probe('DATA.stories[0].rpg.gmDetail') === 'epic');
  const epic = probe(`buildRpgPrompt(DATA.stories[0], LoreRpgEngine.parseInput('// observo'), LoreRpgEngine.resolveAction(DATA.stories[0], LoreRpgEngine.parseInput('// observo'), {forcedRoll:10}))`);
  ok('perfil épico amplía a 7–10 párrafos', epic.system.includes('7 a 10') && epic.gmProfile.maxTokens === 4000);

  // Cancelación transaccional: nunca deja el resto de comandos en deadlock.
  const pemBeforeCancel = probe('DATA.stories[0].rpg.player.resources.pemCurrent');
  slowNext = true;
  d.getElementById('rpgTurnInput').value = '// Uso mi técnica maldita contra el sello';
  const pendingTurn = probe('submitRpgTurn()');
  await new Promise(r => setTimeout(r, 20));
  ok('botón Cancelar aparece mientras un comando está en vuelo', d.getElementById('rpgCancelTurnBtn').hidden === false);
  d.getElementById('rpgCancelTurnBtn').click();
  await pendingTurn;
  ok('cancelación libera bloqueo y restaura controles', !probe('rpgRequestInFlight') && !d.getElementById('rpgSendTurnBtn').disabled && d.getElementById('rpgCancelTurnBtn').hidden);
  ok('turno cancelado no aplica PEM ni consecuencias', probe('DATA.stories[0].rpg.player.resources.pemCurrent') === pemBeforeCancel && /no se aplicaron gastos/.test(d.getElementById('rpgTurnLog').textContent));
  d.getElementById('rpgTurnInput').value = '— Seguimos adelante.';
  await probe('submitRpgTurn()');
  ok('un comando posterior funciona después de cancelar', probe(`DATA.stories[0].rpg.session.turns.filter(t=>t.role==='gm').length`) >= 2);

  // Registro incremental de capítulos.
  const beforeChapters = probe('DATA.stories[0].chapters.length');
  d.getElementById('rpgCaptureChapterBtn').click();
  ok('registro abre modal con tramo no capturado', d.getElementById('rpgChapterCaptureBackdrop').classList.contains('active') && /Turnos/.test(d.getElementById('rpgCaptureRangeText').textContent));
  d.getElementById('rpgCaptureTitle').value = 'La puerta bajo la lluvia';
  d.getElementById('rpgCaptureMode').value = 'chronicle';
  await probe('captureRpgChapter()');
  ok('registro crea exactamente un capítulo', probe('DATA.stories[0].chapters.length') === beforeChapters + 1);
  const captured = probe('DATA.stories[0].chapters[DATA.stories[0].chapters.length-1]');
  ok('capítulo guarda rango y sesión de origen', captured.rpgCapture && captured.rpgCapture.sessionId && captured.rpgCapture.to > captured.rpgCapture.from);
  ok('tramo registrado no vuelve a aparecer como nuevo', d.getElementById('rpgCaptureChapterBtn').disabled && /0 turnos nuevos/.test(d.getElementById('rpgUncapturedTurns').textContent));
  ok('registro de capítulos aparece dentro de Mesa RPG', /La puerta bajo la lluvia/.test(d.getElementById('rpgChapterRegistry').textContent));

  // Nuevo tramo convertido en prosa con Muse, sin cambiar hechos.
  d.getElementById('rpgTurnInput').value = '— ¿Qué hay detrás del sello?';
  await probe('submitRpgTurn()');
  d.getElementById('rpgCaptureChapterBtn').click();
  d.getElementById('rpgCaptureTitle').value = 'El sello responde';
  d.getElementById('rpgCaptureMode').value = 'prose';
  await probe('captureRpgChapter()');
  const prose = probe('DATA.stories[0].chapters[DATA.stories[0].chapters.length-1]');
  ok('Muse registra tramo posterior como prosa', prose.rpgCapture.mode === 'prose' && /lluvia cerró el horizonte/i.test(prose.content));
  ok('segundo registro no duplica el primer rango', prose.rpgCapture.from >= captured.rpgCapture.to);

  // Investigación web: el usuario elige una de dos fuentes.
  probe(`openWebResearch("${sid}", "referencia autor obra")`);
  await probe('runWebResearch()');
  ok('buscador muestra resultados de varios proveedores', d.querySelectorAll('#webResearchResults .web-result').length === 2);
  d.querySelector('#webResearchResults .web-result').click();
  ok('selección es explícita antes de adjuntar', /1 seleccionada/.test(d.getElementById('webSelectionCount').textContent));
  await probe('attachSelectedWebSources()');
  const webDocs = probe('DATA.stories[0].attachedDocs.filter(d=>d.webSource)');
  ok('solo la fuente seleccionada se incorpora', webDocs.length === 1);
  ok('fuente guarda URL, fecha y texto extraído', webDocs[0].url === 'https://example.org/autor' && webDocs[0].fetchedAt === 1700000000000 && webDocs[0].content.includes('faro de ceniza'));
  ok('fuente web entra como Referencia Auxiliar', webDocs[0].priorityLevel === 'reference');
  const sourcedPrompt = probe(`buildRpgPrompt(DATA.stories[0], LoreRpgEngine.parseInput('// investigo el faro de ceniza'), LoreRpgEngine.resolveAction(DATA.stories[0], LoreRpgEngine.parseInput('// investigo el faro de ceniza'), {forcedRoll:12}))`);
  ok('fuente web seleccionada alimenta al GM', sourcedPrompt.system.includes('Biografía y obra verificable') && sourcedPrompt.system.includes('faro de ceniza'));

  // URL libre: revisar antes de incorporar.
  probe(`openWebResearch("${sid}", "")`);
  d.getElementById('webDirectUrl').value = 'https://example.org/obra';
  await probe('reviewDirectWebUrl()');
  ok('URL directa se revisa y selecciona antes de adjuntar', /URL verificada/.test(d.getElementById('webResearchStatus').textContent) && /1 seleccionada/.test(d.getElementById('webSelectionCount').textContent));
  await probe('attachSelectedWebSources()');
  ok('usuario puede incorporar libremente una URL concreta', probe('DATA.stories[0].attachedDocs.filter(d=>d.webSource).length') === 2);

  // Investigación desde referencia de estilo prepara consulta, no copia automática.
  d.getElementById('webResearchModalBackdrop').classList.remove('active');
  probe(`openStoryConfigModal("${sid}", 'style')`);
  d.getElementById('cfgStyleRef').value = 'Autora de referencia';
  d.getElementById('cfgResearchStyleBtn').click();
  ok('botón de estilo abre investigación web con consulta preparada', d.getElementById('webResearchModalBackdrop').classList.contains('active') && /Autora de referencia/.test(d.getElementById('webResearchQuery').value));

  const runtime = errors.filter(e => !/Not implemented|Could not parse CSS/i.test(e));
  ok('loop completo sin errores de ejecución', runtime.length === 0, runtime.slice(0,3).join(' | '));
  R.done();
}, 2500);
