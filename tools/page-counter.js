#!/usr/bin/env node
/* global require, module, process, console */
'use strict';

// Conteo determinista para texto plano. La paginación PDF final debe validarse
// después de exportar, pero esta herramienta evita vender una estimación como
// garantía y permite comprobar si el manuscrito se acerca al objetivo.
const fs = require('fs');
function countPages(text, options = {}) {
  const charsPerLine = options.charsPerLine || 82;
  const linesPerPage = options.linesPerPage || 46;
  const lines = String(text || '').split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return { pages: Math.max(1, Math.ceil(lines / linesPerPage)), lines, charsPerLine, linesPerPage };
}
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Uso: node tools/page-counter.js manuscrito.txt'); process.exit(2); }
  console.log(JSON.stringify(countPages(fs.readFileSync(file, 'utf8')), null, 2));
}
module.exports = { countPages };
