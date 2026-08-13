#!/usr/bin/env node
// Ejecuta todas las suites y resume el resultado.
const { execFileSync } = require('child_process');
const path = require('path');
const suites = ['core.test.js','ingest.test.js','generation.test.js','api.test.js','marathon.test.js','ocr.test.js'];
let total = 0, passed = 0, failedSuites = [];
for (const s of suites) {
  process.stdout.write(s.replace('.test.js','').padEnd(14));
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 600000 });
    const m = out.match(/TOTAL: (\d+)\s+PASS: (\d+)\s+FAIL: (\d+)/);
    if (m) { total += +m[1]; passed += +m[2]; console.log(`${m[2]}/${m[1]} ✔`); }
    else { console.log('sin resultado'); failedSuites.push(s); }
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    const m = out.match(/TOTAL: (\d+)\s+PASS: (\d+)\s+FAIL: (\d+)/);
    if (m) { total += +m[1]; passed += +m[2]; console.log(`${m[2]}/${m[1]} ✘`); }
    else console.log('ERROR');
    failedSuites.push(s);
    const fails = out.split('\n').filter(l => l.startsWith('FAIL')).slice(0, 5);
    fails.forEach(f => console.log('   ' + f));
  }
}
console.log('\n' + '='.repeat(40));
console.log(`TOTAL ${passed}/${total} pruebas`);
if (failedSuites.length) { console.log('Suites con fallos: ' + failedSuites.join(', ')); process.exit(1); }
console.log('Todas las suites en verde.');
