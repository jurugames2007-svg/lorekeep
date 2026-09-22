#!/usr/bin/env node
// Prueba de humo del lanzamiento REAL de Electron.
//
// Las 22 suites cargan main.js con Electron simulado: ejercitan toda la lógica y
// todo el cableado IPC, pero ninguna abre una ventana de verdad. Este script sí la
// abre, espera a que el renderer termine de arrancar y comprueba que el puente
// existe y que la biblioteca pintó al menos una historia.
//
// Termina con 0 en dos casos distintos y los distingue en la salida:
//   PASS   — la ventana arrancó y el renderer completó el inicio.
//   SKIP   — el entorno no puede lanzar Electron (binario no descargado o sin
//            pantalla). No es un fallo del proyecto: es una limitación del
//            entorno, y se informa con el comando que la resolvería.
// Termina con 1 solo si el lanzamiento se intentó y falló.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKER = 'LOREVINCI_SMOKE ';

function skip(reason, hint) {
  process.stdout.write(`SKIP — ${reason}\n`);
  if (hint) process.stdout.write(`       ${hint}\n`);
  process.exit(0);
}

function fail(detail, extra) {
  process.stdout.write(`FAIL — ${detail}\n`);
  if (extra) process.stdout.write(`       ${extra}\n`);
  process.exit(1);
}

// ---- 1. El binario tiene que estar descargado ----
// require('electron') desde Node no devuelve el módulo: devuelve la ruta al
// binario, y lanza si el paquete no completó su postinstall.
let electronPath = null;
try {
  electronPath = require(path.join(ROOT, 'node_modules', 'electron'));
} catch (err) {
  skip(`el binario de Electron no está instalado (${String(err.message).split('\n')[0]})`,
    'Ejecute `npm install` (o `npm rebuild electron`) en una máquina con acceso a release-assets.githubusercontent.com.');
}
if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
  skip('el binario de Electron no existe en disco', 'Ejecute `npm rebuild electron`.');
}

// ---- 2. Linux necesita un servidor gráfico ----
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  skip('no hay servidor gráfico (DISPLAY ni WAYLAND_DISPLAY)',
    'Ejecute `xvfb-run -a npm run test:launch`, o lance esto en un escritorio real.');
}

// ---- 3. Lanzar ----
// --no-sandbox: en contenedores el sandbox de Chromium necesita user namespaces
// que suelen estar desactivados. --disable-gpu y --disable-dev-shm-usage evitan
// fallos por GPU ausente y por /dev/shm pequeño, que no son defectos de la app.
const args = ['.', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
const result = spawnSync(electronPath, args, {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, LOREVINCI_SMOKE: '1' }
});
const stdout = String(result.stdout || '');
const stderr = String(result.stderr || '');
const line = stdout.split('\n').find((l) => l.startsWith(MARKER));
if (!line) {
  fail('Electron no informó el resultado del arranque',
    (stderr.split('\n').slice(0, 6).join('\n       ') || `código de salida ${result.status}`));
}
let payload = null;
try { payload = JSON.parse(line.slice(MARKER.length)); } catch (err) { payload = null; }
if (!payload) fail('la respuesta del modo humo no es JSON válido', line.slice(0, 300));
if (!payload.ok) fail(`el arranque falló en "${payload.step}": ${payload.detail || 'sin detalle'}`, JSON.stringify(payload.snapshot || {}));

const snap = payload.snapshot || {};
process.stdout.write(`PASS — la ventana cargó renderer/index.html y el renderer arrancó\n`);
process.stdout.write(`       historias pintadas: ${snap.cards} · métodos del puente lorevinci: ${snap.bridgeMethods}\n`);
process.exit(0);
