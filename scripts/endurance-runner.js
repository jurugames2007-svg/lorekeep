#!/usr/bin/env node
'use strict';

// Prueba de endurance controlada. Nunca ejecuta 24 horas por accidente:
// duración explícita (--duration=2h) o variable ENDURANCE_DURATION_MS.
const fs = require('fs');
const os = require('os');
const path = require('path');

function durationMs() {
  const arg = process.argv.find(a => a.startsWith('--duration='));
  const raw = arg ? arg.split('=')[1] : process.env.ENDURANCE_DURATION_MS || '10000';
  const match = String(raw).match(/^(\d+)(ms|s|m|h)?$/i);
  if (!match) throw new Error('Duración inválida. Usa 30s, 2m, 2h o milisegundos.');
  const unit = (match[2] || 'ms').toLowerCase();
  const factor = { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
  const value = Number(match[1]) * factor;
  if (!Number.isSafeInteger(value) || value < 100 || value > 24 * 3600000) throw new Error('La duración debe estar entre 100 ms y 24 horas.');
  return value;
}
function checksum(data) { return JSON.stringify(data).length; }
function assertIntegrity(data) {
  if (!data || !Array.isArray(data.stories) || !Array.isArray(data.activityLog)) throw new Error('Estructura de datos inválida');
  if (data.stories.some(s => !s.id || !Array.isArray(s.chapters))) throw new Error('Historia corrupta');
  JSON.stringify(data);
}
async function main() {
  const duration = durationMs();
  const started = Date.now();
  const data = { version: 1, stories: [], activityLog: [], iterations: 0 };
  let writes = 0;
  const file = path.join(os.tmpdir(), `lorevinci-endurance-${process.pid}.json`);
  while (Date.now() - started < duration) {
    const id = `story-${data.iterations % 50}`;
    let story = data.stories.find(s => s.id === id);
    if (!story) { story = { id, chapters: [] }; data.stories.push(story); }
    story.chapters.push({ id: `chapter-${data.iterations}`, content: `Turno ${data.iterations}` });
    if (story.chapters.length > 100) story.chapters.shift();
    data.activityLog.push({ at: new Date().toISOString(), action: 'turn' });
    if (data.activityLog.length > 500) data.activityLog.shift();
    data.iterations += 1;
    assertIntegrity(data);
    fs.writeFileSync(file, JSON.stringify(data));
    writes += 1;
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertIntegrity(disk);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const final = JSON.parse(fs.readFileSync(file, 'utf8'));
  assertIntegrity(final);
  fs.rmSync(file, { force: true });
  console.log(JSON.stringify({ ok: true, durationMs: Date.now() - started, iterations: final.iterations, writes, checksum: checksum(final) }));
}
main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
