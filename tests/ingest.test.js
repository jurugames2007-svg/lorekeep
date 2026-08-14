// Ingesta multi-PDF con extracción real de texto, clasificación y deduplicación.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeApp, makeSeed, reporter, writePdf } = require('./harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-ingest-'));
writePdf(path.join(tmp, 'A_Manual_Canon_Oficial.pdf'), ['Manual canon oficial del universo principal','La IA Mentor habita el sector 7 y no puede mentir','Creada en 2147 para custodiar la memoria colectiva']);
writePdf(path.join(tmp, 'B_What_If_Universo_Alterno.pdf'), ['Escenario what if en un universo alterno','Y si Mentor hubiera podido mentir','Realidad alterna divergente del canon']);
writePdf(path.join(tmp, 'C_Fichas_Personaje.pdf'), ['Ficha de personaje: Mara Quell','Perfil: archivista obsesiva con la verdad','Rol protagonista del elenco']);
writePdf(path.join(tmp, 'D_Cronologia.pdf'), ['Cronologia y linea temporal de la saga','Timeline: fundacion en 2100, disenso en 2147','Calendario de eventos canonicos']);

const { w } = makeApp({ seed: makeSeed(), withPdf: true });
const R = reporter('ingest');
const mk = (p) => new w.File([new Uint8Array(fs.readFileSync(p))], path.basename(p), { type: 'application/pdf' });

setTimeout(async () => {
  const ok = R.ok, probe = w.__probe;
  w.__files = ['A_Manual_Canon_Oficial','B_What_If_Universo_Alterno','C_Fichas_Personaje','D_Cronologia'].map(n => mk(path.join(tmp, n + '.pdf')));
  const storyId = probe('DATA.stories[0].id');
  const stats = await probe('ingestFilesIntoList(window.__files, DATA.stories[0].attachedDocs, {targetName:"T", storyId: DATA.stories[0].id, useProgressUI:true})');

  ok('4 PDFs en un solo lote', stats.added === 4, JSON.stringify(stats));
  ok('sin fallos', stats.failed === 0);
  const docs = probe('DATA.stories[0].attachedDocs');
  const A = docs.find(d => d.name.startsWith('A_')), B = docs.find(d => d.name.startsWith('B_'));
  const C = docs.find(d => d.name.startsWith('C_')), D = docs.find(d => d.name.startsWith('D_'));
  ok('texto REAL extraído del PDF', A && A.content.includes('sector 7'), A && A.content.slice(0, 60));
  ok('saltos de línea preservados', A && A.content.includes('\n'));
  ok('páginas contabilizadas', A && A.pageCount === 1);
  ok('tipo pdf registrado', A && A.fileKind === 'pdf');
  ok('A → canon oficial', A && A.subtype === 'canon-oficial', A && A.subtype);
  ok('B → what-if', B && B.subtype === 'what-if', B && B.subtype);
  ok('B → verso alterno', B && ['alterno','multiverso'].includes(B.verse), B && B.verse);
  ok('C → fichas', C && C.subtype === 'personajes', C && C.subtype);
  ok('D → cronología', D && D.subtype === 'cronologia', D && D.subtype);
  ok('storyId asignado', [A,B,C,D].every(d => d && d.storyId === storyId));
  ok('ninguno requiere OCR', [A,B,C,D].every(d => d && !d.needsOcr));
  ok('primero es canon primario', A && A.priorityLevel === 'primary' && B.priorityLevel === 'derived');

  w.__f2 = [mk(path.join(tmp, 'A_Manual_Canon_Oficial.pdf'))];
  const st2 = await probe('ingestFilesIntoList(window.__f2, DATA.stories[0].attachedDocs, {targetName:"T", useProgressUI:false})');
  ok('duplicado bloqueado', st2.duplicates === 1 && st2.added === 0, JSON.stringify(st2));

  probe("sourceFilters={search:'2147',story:'all',subtype:'all',verse:'all',canon:'all'};");
  ok('búsqueda full-text sobre PDF', probe('applySourceFilters(DATA.stories[0].attachedDocs).length') >= 1);
  probe("sourceFilters={search:'',story:'all',subtype:'all',verse:'all',canon:'all'};");

  const dg = probe('buildSourceDigest(DATA.stories[0], "Mentor sector 7 cronologia personaje", 12000)');
  ok('digest usa varias fuentes', dg.used.length >= 4, 'used=' + dg.used.length);
  ok('digest con texto real', dg.text.includes('custodiar la memoria'));
  ok('digest etiqueta verso', dg.text.includes('verso:'));
  ok('progreso por archivo', w.document.querySelectorAll('#uploadProgressLog .up-line').length >= 4);

  probe('activeStudioBookId = DATA.stories[0].id; renderNotebookLMStudio();');
  ok('Studio pinta 4 fuentes', w.document.querySelectorAll('#nblmSourcesList .source-card-item').length === 4);
  ok('chips de sub-tipo', !!w.document.querySelector('#nblmSourcesList .tag-subtype'));
  ok('chips de verso', !!w.document.querySelector('#nblmSourcesList .tag-verse'));
  fs.rmSync(tmp, { recursive: true, force: true });
  R.done();
}, 2500);
