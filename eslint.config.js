// Configuración plana de ESLint 9.
// El proyecto no tiene paso de build: los scripts del renderer se cargan con
// <script> en orden (dom-safe → seed-data → rpg-engine → app), así que comparten
// un ámbito global. Por eso los módulos UMD y los helpers entre archivos se
// declaran como globales de solo lectura en vez de tratarlos como "no definidos".
const js = require('@eslint/js');
const globals = require('globals');

// Módulos UMD del renderer: se consumen como globales del navegador, pero en
// Node (main.js y las pruebas) se exportan con `module.exports`.
const umdGlobals = { module: 'readonly', exports: 'writable', require: 'readonly' };

module.exports = [
  {
    ignores: [
      'renderer/vendor/**',
      'node_modules/**',
      'dist/**',
      '.tmp-audit/**',
      'release/**',
      'OS/**'
    ]
  },
  js.configs.recommended,
  {
    // Proceso principal (Node + Electron).
    files: ['main.js', 'preload.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2021 }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'warn'
    }
  },
  {
    // Renderer: scripts clásicos de navegador con ámbito global compartido.
    files: ['renderer/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...umdGlobals }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'warn',
      // app.js define helpers que otros scripts del renderer consumen por ámbito
      // global; declararlos aquí daría falsos "no definido" en cada archivo.
      'no-redeclare': 'off',
      // Se buscan caracteres de control a propósito (\u0000 en texto extraído de
      // PDF) para neutralizarlos antes de pintarlos.
      'no-control-regex': 'off',
      // `eval` queda prohibido: es la vía clásica de ejecución remota en Electron.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  },
  {
    // Longitud máxima por función en el código de producción.
    //
    // `skipBlankLines` y `skipComments` hacen que la regla mida código, no
    // documentación: un JSDoc que explique por qué una función hace lo que hace
    // no debe contar en su contra. `IIFEs:false` exime los envoltorios de módulo,
    // cuyo largo es estructural y no indica acoplamiento.
    //
    // Quedan fuera `tests/` a propósito. Los suites son guiones lineales que
    // montan un escenario, lo ejercitan y afirman sobre él; partirlos en
    // funciones de 50 líneas dispersaría cada escenario entre varios cuerpos y
    // los haría más difíciles de leer, que es justo lo contrario de lo que busca
    // la regla. Aquí se aplica donde una función larga sí señala acoplamiento:
    // el código que se ejecuta en producción.
    files: ['main.js', 'preload.js', 'renderer/*.js', 'scripts/**/*.js'],
    ignores: ['renderer/vendor/**'],
    rules: {
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true, IIFEs: false }]
    }
  },
  {
    // El arnés de pruebas inyecta `window.__probe = (c) => eval(c)` a propósito:
    // es la única forma de inspeccionar el estado interno de la app bajo jsdom.
    files: ['tests/harness.js'],
    rules: { 'no-eval': 'off', 'no-implied-eval': 'off' }
  }
];
