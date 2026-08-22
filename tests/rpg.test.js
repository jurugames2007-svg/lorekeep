// Regresión del modo RPG: 100 reglas, fórmulas, tiradas, turnos y salida segura.
const fs = require('fs');
const path = require('path');
const { makeApp, makeSeed, reporter, P } = require('./harness');

// Cargar el motor puro sin DOM real.
const engineSource = fs.readFileSync(path.join(P, 'rpg-engine.js'), 'utf8');
const fakeWindow = { crypto: { getRandomValues: a => { a[0] = 19; return a; } } };
new Function('window', engineSource)(fakeWindow);
const E = fakeWindow.LoreRpgEngine;
const R = reporter('rpg');
const ok = R.ok;

const numbered = Array.from({ length: 100 }, (_, i) => `${i + 1}. Regla de prueba ${i + 1}: condición persistente.`).join('');
const formulas = `
[Energía Maldita Máxima (PEM)] = 100 + (Atributo Reserva * 15)
[Vida Máxima (Puntos de Impacto)] = 50 + (Atributo Resistencia * 10)
[Iniciativa de Combate] = Dado D20 + Atributo Agilidad + Modificador de Alerta
[Capacidad de Carga de Herramientas] = 2 + (Atributo Fuerza / 2)
[Rango de Percepción Maldita] = (Atributo Control + Atributo Flujo) * 5 metros
[Recuperación de PEM por Turno de Descanso] = 15 + Atributo Reserva`;
const compiled100 = E.compileRules(numbered + formulas);
ok('lee 100 reglas aunque estén pegadas', compiled100.rules.length === 100, '' + compiled100.rules.length);
ok('lee fórmulas tras reglas largas', compiled100.formulas.length === 6, '' + compiled100.formulas.length);
ok('sin recorte fijo de 4.000', compiled100.sourceLength > 4000);

const story = { projectMode:'rpg', rpg:{ player:{
  name:'Akira', age:18, occupation:'Chamán', grade:'4', motivation:'Proteger a su hermana',
  equipment:'Katana Grado 4', innateTechnique:'Desgarro Vectorial', heavenlyRestriction:false,
  attributes:{ strength:4, agility:5, resistance:3, control:8, flow:7, reserve:2 },
  resources:{ pemCurrent:130, hpCurrent:80 }, conditions:[]
}}};
E.ensureStory(story);
const d = E.derivedStats(story.rpg.player);
ok('PEM máximo usa Reserva', d.maxPem === 130, '' + d.maxPem);
ok('Vida máxima usa Resistencia', d.maxHp === 80, '' + d.maxHp);
ok('percepción usa Control + Flujo', d.perceptionRange === 75, '' + d.perceptionRange);
ok('recuperación usa 15 + Reserva', d.recoveryPem === 17, '' + d.recoveryPem);

const evals = E.evaluateFormulas(compiled100, story.rpg.player);
ok('fórmula PEM evaluada localmente', evals.find(x => /Energía Maldita Máxima/.test(x.formula.name)).result.value === 130);
ok('fórmula Vida evaluada localmente', evals.find(x => /Vida Máxima/.test(x.formula.name)).result.value === 80);

ok('sintaxis // es acción', E.parseInput('// Ataco').type === 'action');
ok('sintaxis — es diálogo', E.parseInput('— No pasarás').type === 'dialogue');
ok('sintaxis [] es fuera de personaje', E.parseInput('[¿Qué regla aplica?]').type === 'ooc');

let result = E.resolveAction(story, E.parseInput('// Ataco con mi técnica maldita CD 15'), { forcedRoll:12 });
ok('ataque maldito usa Flujo + Control', result.total === 27, '' + result.total);
ok('técnica básica cuesta 10 PEM', result.pemCost === 10);
ok('daño maldito se calcula, no se delega a la IA', result.damage === 26, '' + result.damage);
E.applyResolution(story, result);
ok('gasto se aplica una sola vez', story.rpg.player.resources.pemCurrent === 120, '' + story.rpg.player.resources.pemCurrent);

result = E.resolveAction(story, E.parseInput('// Abro mi expansión de dominio'), { forcedRoll:15 });
ok('Dominio bloqueado a Grado 4', result.possible === false && /Grado 1/.test(result.reasons.join(' ')));
ok('acción imposible no pide IA', result.needsAi === false);

story.rpg.player.grade = '1'; story.rpg.player.attributes.control = 20; story.rpg.player.resources.pemCurrent = 100;
result = E.resolveAction(story, E.parseInput('// Abro mi expansión de dominio'), { forcedRoll:15 });
ok('Dominio permitido con grado y Control', result.possible === true);
ok('Dominio calcula 80% PEM actual', result.pemCost === 80, '' + result.pemCost);
ok('Dominio no inventa tirada de activación', result.roll === null);
E.applyResolution(story, result);
ok('Dominio persiste con duración', story.rpg.player.conditions.includes('dominio-activo') && story.rpg.session.domainTurnsRemaining === 2);

story.rpg.player.grade = '4'; story.rpg.player.attributes.control = 8; story.rpg.player.resources.pemCurrent = 100;
result = E.resolveAction(story, E.parseInput('// Golpeo a la maldición con mi katana imbuida'), { forcedRoll:20 });
ok('20 natural habilita Zona', result.updates.conditionsAdd.includes('zone-3'));
ok('Destello Negro queda explicado, no forzado a mano', /Destello Negro/.test(result.reasons.join(' ')));
ok('Destello Negro multiplica daño por 2,5', result.damage === 20, '' + result.damage);
let advantage = E.resolveAction(story, E.parseInput('// Ataco con ventaja desde una emboscada'), { forcedRolls:[4,17] });
ok('Ventaja tira dos D20 y conserva el mayor', advantage.naturalRoll === 17 && advantage.rolls.length === 2);
let fumble = E.resolveAction(story, E.parseInput('// Golpeo con fuerza'), { forcedRoll:1 });
ok('Pifia calcula mitad del daño propio', fumble.updates.hpDelta === -(fumble.damage / 2));
const noPemWeapon = E.resolveAction(story, E.parseInput('// Golpeo a la maldición con un palo común'), { forcedRoll:14 });
ok('arma sin PEM no daña permanentemente maldiciones', noPemWeapon.damage === 0 && /arma sin PEM/i.test(noPemWeapon.reasons.join(' ')));
const restricted = { projectMode:'rpg', rpg:{ player:{ ...E.defaultPlayer(), heavenlyRestriction:true, attributes:{ strength:4, agility:5, resistance:3, control:8, flow:7, reserve:2 } } } };
E.ensureStory(restricted);
ok('Restricción Celestial deja PEM en cero', restricted.rpg.player.resources.pemCurrent === 0);
ok('Restricción Celestial duplica físicos', E.derivedStats(restricted.rpg.player).attributes.strength === 8);
ok('Restricción Celestial bloquea técnica maldita', E.resolveAction(restricted, E.parseInput('// Uso mi técnica maldita'), { forcedRoll:10 }).possible === false);
const curse = { projectMode:'rpg', rpg:{ player:{ ...E.defaultPlayer(), occupation:'Maldición', resources:{ pemCurrent:100, hpCurrent:50 } } } };
E.ensureStory(curse);
const regen = E.resolveAction(curse, E.parseInput('// Regenero 12 puntos de vida'));
ok('maldición regenera Vida con PEM 1 a 1', regen.pemCost === 12 && regen.updates.hpDelta === 12 && regen.roll === null);

const contradictory = E.compileRules(`12. Recuperación: Se recuperan 15 PEM por descanso.
39. Choque de Dominios: gana el que tenga más atributo de Control.
[Recuperación de PEM por Turno de Descanso] = 15 + Atributo Reserva
[Resolución de Choque de Dominios] = Tirada Enfrentada: (Dado D20 + Control) vs (Dado D20 + Control)`);
ok('detecta contradicción de recuperación', contradictory.issues.some(i => i.code === 'pem-recovery'));
ok('detecta contradicción de choque', contradictory.issues.some(i => i.code === 'domain-clash'));

ok('bloquea razonamiento interno en inglés', E.auditModelOutput('The user wants me to continue. I need to analyze it.').ok === false);
ok('bloquea narración visible mayormente inglesa', E.auditModelOutput('Rain falls over the temple and the soldier moves into the forest.').ok === false);
ok('bloquea diálogo inglés dentro de narración española', E.auditModelOutput('La lluvia golpea el templo. El soldado grita: “Stop right there and put your hands up”.').ok === false);
ok('bloquea razonamiento meta también en español', E.auditModelOutput('El usuario quiere que continúe. Necesito analizar la situación actual.').ok === false);
ok('bloquea al GM si decide por el jugador', E.auditGmOutput('Tú decides correr y atacas sin mirar atrás.').ok === false);
ok('bloquea control implícito sin pronombre', E.auditGmOutput('Levantas el arma y corres hacia el bosque.').ok === false);
const normalized = E.normalizeGmOutput('{"narracion":"La lluvia golpea el templo.","pregunta":"¿Qué haces?"}');
ok('normaliza JSON visible del GM', normalized.ok && /¿Qué haces\?/.test(normalized.text));

// Integración UI: una fuga se repara, la partida no crea capítulos y sí persiste estado.
const rules100 = Array.from({ length: 100 }, (_, i) => `${i + 1}. Regla ${i + 1}: mantener el turno y el canon.\n`).join('') + formulas;
const seed = makeSeed();
seed.stories[0].projectMode = 'rpg';
seed.stories[0].rules = rules100;
seed.stories[0].attachedDocs = [{ id:'src-rpg', name:'Manual Spider-Man RPG.txt', content:'Peter Parker protege su identidad secreta. La telaraña requiere cartuchos.', priorityLevel:'primary' }];
seed.stories[0].rpg = { player:{
  name:'Akira', age:18, occupation:'Chamán', grade:'4', motivation:'Proteger a su hermana',
  equipment:'Katana Grado 4', innateTechnique:'Desgarro Vectorial', heavenlyRestriction:false,
  attributes:{ strength:4, agility:5, resistance:3, control:8, flow:7, reserve:2 },
  resources:{ pemCurrent:130, hpCurrent:80 }, conditions:[]
}};
seed.settings.ai.apiKey = 'sk-' + 'x'.repeat(40);
seed.settings.ai.verifiedAt = Date.now();
const calls = [];
const bridge = { aiGenerate: async payload => {
  calls.push(payload);
  if (calls.length === 1) return { ok:true, text:'The user wants me to continue the story. I need to analyze the current situation.' };
  return { ok:true, text:'{"narracion":"La maldición retrocede cuando la energía corta el aire; el templo cruje alrededor del impacto.","pregunta":"¿Qué haces ahora?"}' };
}};
const app = makeApp({ seed, bridge });

setTimeout(async () => {
  const w = app.w, probe = w.__probe, doc = w.document;
  const sid = probe('DATA.stories[0].id');
  probe(`openStoryEditor("${sid}")`);
  const before = probe('DATA.stories[0].chapters.length');
  doc.getElementById('openRpgTableBtn').click();
  ok('Mesa RPG abre en proyecto RPG', doc.getElementById('rpgTableModalBackdrop').classList.contains('active'));
  ok('auditoría UI leyó 100 reglas', /100 reglas/.test(doc.getElementById('rpgRulesAudit').textContent), doc.getElementById('rpgRulesAudit').textContent);

  doc.getElementById('rpgTurnInput').value = '// Ataco con mi técnica maldita CD 15';
  doc.getElementById('rpgSendTurnBtn').click();
  await new Promise(r => setTimeout(r, 250));

  ok('fuga provoca una reparación', calls.length === 2, '' + calls.length);
  ok('prompt obliga español y no controlar jugador', /SIEMPRE español/.test(calls[0].messages[0].content) && /Nunca controles/.test(calls[0].messages[0].content));
  ok('prompt cita fuente RPG', calls[0].messages[0].content.includes('Manual Spider-Man RPG.txt'));
  ok('respuesta inglesa nunca se muestra', !/The user wants|I need to/.test(doc.getElementById('rpgTurnLog').textContent));
  ok('respuesta reparada visible en español', /La maldición retrocede/.test(doc.getElementById('rpgTurnLog').textContent));
  ok('turno conserva tirada pública', /D20/.test(doc.getElementById('rpgTurnLog').textContent));
  ok('turno descuenta PEM', probe('DATA.stories[0].rpg.player.resources.pemCurrent') === 120);
  ok('chat RPG no crea capítulos', probe('DATA.stories[0].chapters.length') === before);
  ok('historial de sesión persistido', probe('DATA.stories[0].rpg.session.turns.length') >= 3);

  // Acción imposible se bloquea antes de llamar a la IA.
  const callCount = calls.length;
  doc.getElementById('rpgTurnInput').value = '// Abro mi expansión de dominio';
  doc.getElementById('rpgSendTurnBtn').click();
  await new Promise(r => setTimeout(r, 80));
  ok('acción imposible no llama al modelo', calls.length === callCount);
  ok('motivo de bloqueo visible', /solo Grado 1 o Especial/.test(doc.getElementById('rpgTurnLog').textContent));
  ok('acción bloqueada tampoco crea capítulo', probe('DATA.stories[0].chapters.length') === before);

  R.done();
}, 2500);
