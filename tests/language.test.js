// Idioma por obra/campaña y asistente de texto realmente insertable.
const fs = require('fs');
const path = require('path');
const { makeApp, makeSeed, reporter, P } = require('./harness');
const fakeWindow = {};
new Function('window', fs.readFileSync(path.join(P,'rpg-engine.js'),'utf8'))(fakeWindow);
const E = fakeWindow.LoreRpgEngine;
const R = reporter('language');
const ok = R.ok;

ok('inglés visible es válido cuando se eligió EN', E.auditModelOutput('Rain strikes the gate while the guard watches from the tower.', {language:'en'}).ok);
ok('fuga meta inglesa sigue bloqueada aunque el idioma sea EN', !E.auditModelOutput('The user wants me to continue. I need to analyze it.', {language:'en'}).ok);
ok('español bloquea narración mayormente inglesa', !E.auditModelOutput('Rain strikes the gate and the soldier runs into the forest.', {language:'es'}).ok);
const englishTurn = E.normalizeGmOutput('The gate opens without deciding the player action.', {language:'en'});
ok('GM inglés añade pregunta inglesa si falta', englishTurn.ok && /What do you do\?$/.test(englishTurn.text));

const seed = makeSeed();
const story = seed.stories[0];
story.projectMode = 'rpg'; story.outputLanguage = 'en'; story.assistantMode = 'insert';
story.rpg = { language:'en', player:{ name:'Sol', age:18, occupation:'Student', grade:'4', motivation:'Find the lost party', equipment:'Cursed amulet', innateTechnique:'Ember', attributes:{strength:3,agility:3,resistance:3,control:3,flow:3,reserve:0}, resources:{pemCurrent:100,hpCurrent:80}, conditions:[] } };
story.chapters[0].content = '<p>The corridor narrows beneath the ruined keep. A bell rings beyond the sealed gate.</p>';
seed.settings.ai.apiKey = 'sk-'+'x'.repeat(40); seed.settings.ai.model='gpt-4o'; seed.settings.ai.verifiedAt=Date.now();
const calls=[];
const bridge={ aiGenerate:async payload => {
  calls.push(payload);
  const sys=payload.messages[0].content;
  if (/Game Master/.test(sys)) return {ok:true,text:'{"narracion":"Rain beats against the gate. The guard keeps his distance and lowers his voice.\\n\\n—Someone crossed this hall before you —he says—, but I never saw their face.","pregunta":"What do you do?","consecuencias":["The guard now knows someone is investigating the gate."],"mundo":{"ubicacion":"Sealed gate","reloj":"Midnight","hechos":[]},"conocimiento":[]}' };
  if (/coescritor/.test(sys)) return {ok:true,text:'A thread of cold air slipped through the stones, carrying the faint smell of smoke from somewhere below.'};
  if (/editor de LoreVinci/.test(sys)) return {ok:true,text:'Strengthen the immediate consequence of the bell so the scene changes rather than merely describing tension.'};
  return {ok:true,text:'Safe English output.'};
}};
const app=makeApp({seed,bridge});
setTimeout(async()=>{
  const w=app.w,d=w.document,probe=w.__probe;
  const sid=probe('DATA.stories[0].id');
  probe(`openStoryEditor("${sid}")`);
  ok('editor carga modo predeterminado texto insertable', d.getElementById('realtimeSuggestionMode').value==='insert' && /Texto listo/.test(d.getElementById('rsbTitle').textContent));

  probe('openRpgTable()');
  ok('Mesa refleja idioma EN', d.getElementById('rpgLanguageSelect').value==='en');
  d.getElementById('rpgTurnInput').value='// I inspect the sealed gate CD 15';
  await probe('submitRpgTurn()');
  const gm=probe(`DATA.stories[0].rpg.session.turns.findLast(t=>t.role==='gm').text`);
  ok('GM entrega diálogo y pregunta en inglés', /Someone crossed/.test(gm) && /What do you do\?/.test(gm));
  ok('prompt exige idioma elegido', /natural English/.test(calls[0].messages[0].content));
  ok('inglés solicitado no provoca llamada de reparación', calls.length===1, ''+calls.length);

  probe(`currentChapterId=DATA.stories[0].chapters[0].id; renderChapterContent()`);
  await probe('triggerRealtimeSuggestion()');
  ok('asistente entrega párrafo final, no una idea', /thread of cold air/.test(d.getElementById('rsbContent').textContent) && !/suggest|could|idea/i.test(d.getElementById('rsbContent').textContent));
  const insertCall=calls.find(c=>/coescritor/.test(c.messages[0].content));
  ok('prompt pide texto listo para pegar en inglés', /listo para pegar/.test(insertCall.messages[0].content) && /natural English/.test(insertCall.messages[0].content));
  d.getElementById('applyRsbBtn').click();
  ok('botón inserta realmente el mensaje en el capítulo', /thread of cold air/.test(probe('DATA.stories[0].chapters[0].content')));

  d.getElementById('realtimeSuggestionMode').value='editorial';
  d.getElementById('realtimeSuggestionMode').dispatchEvent(new w.Event('change',{bubbles:true}));
  await probe('triggerRealtimeSuggestion()');
  ok('modo editorial sigue disponible de forma opcional', /Strengthen the immediate/.test(d.getElementById('rsbContent').textContent) && probe('DATA.stories[0].assistantMode')==='editorial');

  d.getElementById('rpgLanguageSelect').value='pt';
  d.getElementById('rpgLanguageSelect').dispatchEvent(new w.Event('change',{bubbles:true}));
  ok('idioma puede cambiarse desde la Mesa y persiste por obra', probe('DATA.stories[0].outputLanguage')==='pt' && probe('DATA.stories[0].rpg.language')==='pt');
  R.done();
},2500);
