// LoreVinci RPG Engine
// Motor local y determinista: interpreta ficha, reglas, fórmulas y tiradas sin delegar
// la aritmética al modelo de lenguaje. No usa eval ni Function.
(function exposeLoreRpgEngine(global) {
  'use strict';

  const now = () => Date.now();
  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
  const normalize = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const decode = (value) => String(value || '')
    .replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&amp;/gi, '&');

  function defaultPlayer() {
    return {
      name: '', age: 18, occupation: 'Estudiante', grade: '4', lineage: '',
      motivation: '', innateTechnique: '', equipment: 'Arma común de Grado 4',
      heavenlyRestriction: false, hasRcrt: false,
      attributes: { strength: 3, agility: 3, resistance: 3, control: 3, flow: 3, reserve: 0 },
      resources: { pemCurrent: 100, hpCurrent: 80 },
      conditions: []
    };
  }

  function ensureStory(story) {
    if (!story) return story;
    if (!story.projectMode) story.projectMode = 'novel';
    if (!story.rpg || typeof story.rpg !== 'object') story.rpg = {};
    const rpg = story.rpg;
    const supportedLanguages = ['es','en','pt','fr','de','it'];
    rpg.language = supportedLanguages.includes(story.outputLanguage) ? story.outputLanguage : supportedLanguages.includes(rpg.language) ? rpg.language : 'es';
    story.outputLanguage = rpg.language;
    rpg.strictTurns = rpg.strictTurns !== false;
    rpg.syntaxEnabled = rpg.syntaxEnabled !== false;
    rpg.gmDetail = ['balanced','cinematic','epic'].includes(rpg.gmDetail) ? rpg.gmDetail : 'cinematic';
    rpg.role = ['player','director'].includes(rpg.role) ? rpg.role : 'player';
    rpg.experience = ['beginner','intermediate','advanced'].includes(rpg.experience) ? rpg.experience : 'beginner';
    rpg.mentorMode = rpg.mentorMode !== false;
    rpg.campaign = rpg.campaign && typeof rpg.campaign === 'object' ? rpg.campaign : {};
    rpg.campaign.referenceWork = String(rpg.campaign.referenceWork || story.title || 'Mundo original');
    rpg.campaign.referenceAuthor = String(rpg.campaign.referenceAuthor || 'No especificado');
    rpg.campaign.entryPoint = String(rpg.campaign.entryPoint || story.synopsis || 'Inicio por definir');
    rpg.campaign.freedom = ['open','canon','alternate'].includes(rpg.campaign.freedom) ? rpg.campaign.freedom : 'open';
    rpg.campaign.tone = String(rpg.campaign.tone || story.genre || 'Aventura y descubrimiento');
    rpg.campaign.difficulty = ['story','balanced','challenging','brutal'].includes(rpg.campaign.difficulty) ? rpg.campaign.difficulty : 'balanced';
    rpg.campaign.lethality = ['safe','heroic','dangerous','lethal'].includes(rpg.campaign.lethality) ? rpg.campaign.lethality : 'dangerous';
    rpg.campaign.limits = Array.isArray(rpg.campaign.limits) ? rpg.campaign.limits : [];
    rpg.worldState = rpg.worldState && typeof rpg.worldState === 'object' ? rpg.worldState : {};
    rpg.worldState.location = String(rpg.worldState.location || 'Escena inicial por establecer');
    rpg.worldState.clock = String(rpg.worldState.clock || 'Inicio de campaña');
    rpg.worldState.consequences = Array.isArray(rpg.worldState.consequences) ? rpg.worldState.consequences : [];
    rpg.worldState.facts = Array.isArray(rpg.worldState.facts) ? rpg.worldState.facts : [];
    rpg.worldState.events = Array.isArray(rpg.worldState.events) ? rpg.worldState.events : [];
    rpg.worldState.npcKnowledge = rpg.worldState.npcKnowledge && typeof rpg.worldState.npcKnowledge === 'object' ? rpg.worldState.npcKnowledge : {};
    ['factions','quests','inventory','wounds','clues','clocks','locations','rumors'].forEach(key => {
      rpg.worldState[key] = Array.isArray(rpg.worldState[key]) ? rpg.worldState[key] : [];
    });
    rpg.worldState.relationships = rpg.worldState.relationships && typeof rpg.worldState.relationships === 'object' ? rpg.worldState.relationships : {};
    rpg.player = { ...defaultPlayer(), ...(rpg.player || {}) };
    rpg.player.attributes = { ...defaultPlayer().attributes, ...((rpg.player || {}).attributes || {}) };
    rpg.player.resources = { ...defaultPlayer().resources, ...((rpg.player || {}).resources || {}) };
    rpg.player.conditions = Array.isArray(rpg.player.conditions) ? rpg.player.conditions : [];
    rpg.session = rpg.session && typeof rpg.session === 'object' ? rpg.session : {};
    rpg.session.id = rpg.session.id || `session_${now()}`;
    rpg.session.title = rpg.session.title || 'Sesión 1';
    rpg.session.turns = Array.isArray(rpg.session.turns) ? rpg.session.turns : [];
    rpg.session.round = Math.max(1, Number(rpg.session.round) || 1);
    rpg.session.combatTurns = Math.max(0, Number(rpg.session.combatTurns) || 0);
    rpg.session.lastCapturedTurnIndex = Math.max(0, Number(rpg.session.lastCapturedTurnIndex) || 0);
    rpg.session.startedAt = rpg.session.startedAt || now();
    rpg.ruleEngine = rpg.ruleEngine && typeof rpg.ruleEngine === 'object' ? rpg.ruleEngine : null;
    syncResourceBounds(rpg.player);
    return story;
  }

  function effectiveAttributes(player) {
    const a = { ...defaultPlayer().attributes, ...((player || {}).attributes || {}) };
    Object.keys(a).forEach(k => { a[k] = clamp(a[k], 0, 100); });
    if (player && player.heavenlyRestriction) {
      a.strength *= 2; a.agility *= 2; a.resistance *= 2;
    }
    if (player && Array.isArray(player.conditions) && player.conditions.includes('fatiga-10')) {
      a.strength = Math.round(a.strength * .9 * 100) / 100;
      a.agility = Math.round(a.agility * .9 * 100) / 100;
      a.resistance = Math.round(a.resistance * .9 * 100) / 100;
    }
    if (player && Array.isArray(player.conditions) && player.conditions.includes('zone-3')) {
      a.control = Math.round(a.control * 1.2 * 100) / 100;
      a.flow = Math.round(a.flow * 1.2 * 100) / 100;
    }
    return a;
  }

  function derivedStats(player) {
    const p = { ...defaultPlayer(), ...(player || {}) };
    const a = effectiveAttributes(p);
    const raw = { ...defaultPlayer().attributes, ...((p || {}).attributes || {}) };
    return {
      maxPem: p.heavenlyRestriction ? 0 : Math.max(0, Math.round(100 + clamp(raw.reserve, 0, 100) * 15)),
      maxHp: Math.max(1, Math.round(50 + a.resistance * 10)),
      initiative: a.agility,
      carryingCapacity: Math.max(0, Math.floor(2 + a.strength / 2)),
      perceptionRange: Math.max(0, Math.round((clamp(raw.control, 0, 100) + clamp(raw.flow, 0, 100)) * 5)),
      recoveryPem: p.heavenlyRestriction ? 0 : Math.max(0, Math.round(15 + clamp(raw.reserve, 0, 100))),
      attributes: a
    };
  }

  function syncResourceBounds(player) {
    const d = derivedStats(player);
    if (!player.resources) player.resources = {};
    if (player.heavenlyRestriction) player.resources.pemCurrent = 0;
    else player.resources.pemCurrent = clamp(player.resources.pemCurrent, 0, d.maxPem);
    player.resources.hpCurrent = clamp(player.resources.hpCurrent, 0, d.maxHp);
    return d;
  }

  function splitRulesAndFormulas(rawText) {
    let text = decode(rawText).replace(/\r/g, '\n');
    // Reglamentos pegados en una sola línea: crea límites solo ante "N. Mayúscula".
    text = text.replace(/(^|[^0-9])(\d{1,3})\.\s*(?=[A-ZÁÉÍÓÚÑ¿¡"“])/g, '$1\n$2. ');
    // Fórmulas pegadas una detrás de otra.
    text = text.replace(/\s+(?=\[[^\]\n]{3,120}\]\s*=)/g, '\n');

    const rules = [];
    const ruleRx = /(?:^|\n)\s*(\d{1,3})\.\s*([\s\S]*?)(?=\n\s*\d{1,3}\.\s|\n\s*\[[^\]\n]+\]\s*=|$)/g;
    let match;
    while ((match = ruleRx.exec(text))) {
      const content = match[2].replace(/\s+/g, ' ').trim();
      if (content) rules.push({ number: Number(match[1]), text: content });
    }

    const formulas = [];
    text.split('\n').forEach(line => {
      const m = line.trim().match(/^\[([^\]]+)\]\s*=\s*(.+)$/);
      if (!m) return;
      formulas.push({ name: m[1].trim(), expression: m[2].trim(), normalizedName: normalize(m[1]) });
    });
    return { rules, formulas, normalizedText: text };
  }

  function hashText(rawText) {
    const text = String(rawText || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function compileRules(rawText) {
    const parsed = splitRulesAndFormulas(rawText);
    const issues = [];
    const byNumber = new Map();
    parsed.rules.forEach(rule => {
      if (byNumber.has(rule.number) && normalize(byNumber.get(rule.number)) !== normalize(rule.text)) {
        issues.push({ level: 'error', code: 'duplicate-rule', message: `La regla ${rule.number} tiene dos definiciones distintas.` });
      } else byNumber.set(rule.number, rule.text);
    });

    const all = normalize(rawText);
    const formulaText = parsed.formulas.map(f => `${f.normalizedName} ${normalize(f.expression)}`).join(' ');
    if (/choque de dominios/.test(all) && /gana el que tenga mas atributo de control/.test(all) &&
        /resolucion de choque de dominios/.test(formulaText) && /dado d20/.test(formulaText)) {
      issues.push({ level: 'warn', code: 'domain-clash', message: 'Choque de Dominios: una regla decide solo por Control, pero la fórmula usa D20 + Control. El motor aplicará la fórmula explícita.' });
    }
    if (/se recuperan 15 pem/.test(all) && /recuperacion de pem/.test(formulaText) && /atributo reserva/.test(formulaText)) {
      issues.push({ level: 'warn', code: 'pem-recovery', message: 'Recuperación: la regla fija 15 PEM, pero la fórmula suma Reserva. El motor aplicará 15 + Reserva por ser más específica.' });
    }
    if (/solo personajes de grado 1 o especial/.test(all) && /requisito de activacion de dominio/.test(formulaText) && /control 15/.test(formulaText)) {
      issues.push({ level: 'info', code: 'domain-extra-requirement', message: 'Dominio: la fórmula añade Control > 15 al requisito de Grado 1/Especial. Se exigirán ambas condiciones.' });
    }
    if (/grado de la maldicion 100/.test(formulaText) || /grado de la maldicion 150/.test(formulaText)) {
      issues.push({ level: 'warn', code: 'grade-scale', message: 'Las fórmulas de enemigos multiplican el número de grado: Grado 4 resultaría más fuerte que Grado 1. Define una escala numérica antes de usarlas.' });
    }
    if (!parsed.rules.length) issues.push({ level: 'info', code: 'no-numbered-rules', message: 'No se detectaron reglas numeradas; se conservarán como instrucciones narrativas.' });
    if (!parsed.formulas.length) issues.push({ level: 'info', code: 'no-formulas', message: 'No se detectaron fórmulas con el formato [Nombre] = expresión.' });

    const executableFormulaPattern = /^(?:energia maldita maxima|vida maxima|vida base|pem base|iniciativa|capacidad de carga|rango de percepcion|tirada de |dano |potencia de |costo de |recuperacion de |ocultamiento|probabilidad de |estado en la zona|pifia critica|bonificador por |sacrificio temporal|resistencia de la pantalla|requisito de activacion|duracion estandar|resolucion de choque|quemadura de tecnica|vida regenerada|curacion a un aliado|estadisticas de shikigami|experiencia necesaria|puntos de atributo|dinero recibido|dificultad de accion|sinergia de ataque)/;
    parsed.formulas.forEach(f => { f.executable = executableFormulaPattern.test(f.normalizedName) && !f.normalizedName.includes('sacrificio permanente'); });

    return {
      version: 1,
      compiledAt: now(),
      rules: parsed.rules,
      formulas: parsed.formulas,
      issues,
      executableCount: parsed.formulas.filter(f => f.executable).length,
      sourceLength: String(rawText || '').length,
      sourceHash: hashText(rawText)
    };
  }

  function tokenizeMath(expression) {
    const tokens = [];
    const rx = /\s*([0-9]+(?:\.[0-9]+)?|[()+\-*/])\s*/gy;
    let index = 0;
    while (index < expression.length) {
      rx.lastIndex = index;
      const m = rx.exec(expression);
      if (!m || m.index !== index) return null;
      tokens.push(m[1]); index = rx.lastIndex;
    }
    return tokens;
  }

  function safeMath(expression) {
    const tokens = tokenizeMath(expression);
    if (!tokens) return null;
    let i = 0;
    const factor = () => {
      const t = tokens[i++];
      if (t === '(') { const v = sum(); if (tokens[i++] !== ')') throw new Error('paren'); return v; }
      if (t === '-') return -factor();
      const n = Number(t); if (!Number.isFinite(n)) throw new Error('number'); return n;
    };
    const product = () => { let v = factor(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++]; const n = factor(); v = op === '*' ? v * n : v / n; } return v; };
    const sum = () => { let v = product(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++]; const n = product(); v = op === '+' ? v + n : v - n; } return v; };
    try { const value = sum(); return i === tokens.length && Number.isFinite(value) ? value : null; } catch { return null; }
  }

  function evaluateFormula(formula, player, options = {}) {
    if (!formula) return { ok: false, reason: 'Fórmula ausente' };
    const d = derivedStats(player);
    const a = d.attributes;
    const formulaName = normalize(formula.name);
    if (formulaName.includes('estado en la zona')) return { ok:true, value:1.2, detail:'multiplicador temporal de Control y Flujo' };
    if (formulaName.includes('probabilidad de destello negro')) {
      if (!Number.isFinite(Number(options.roll))) return { ok:false, reason:'Requiere el D20 natural' };
      return { ok:true, value:Number(options.roll) === 20 ? 1 : 0, detail:Number(options.roll) === 20 ? 'activado' : 'no activado' };
    }
    if (formulaName.includes('pifia critica en combate')) {
      if (!Number.isFinite(Number(options.roll))) return { ok:false, reason:'Requiere el D20 natural' };
      if (Number(options.roll) !== 1) return { ok:true, value:0, detail:'sin pifia' };
      if (!Number.isFinite(Number(options.totalDamage))) return { ok:false, reason:'Requiere el daño del ataque para calcular la mitad' };
      return { ok:true, value:Number(options.totalDamage) / 2, detail:'daño propio' };
    }
    if (formulaName.includes('requisito de activacion de dominio')) {
      const allowed = gradeCanUseDomain(player.grade) && a.control > 15;
      return { ok:true, value:allowed ? 1 : 0, detail:allowed ? 'requisitos cumplidos' : 'requiere Grado 1/Especial y Control > 15' };
    }
    if (formulaName.includes('resolucion de choque de dominios')) {
      if (![options.roll, options.rivalRoll, options.rivalControl].every(v => Number.isFinite(Number(v)))) return { ok:false, reason:'Requiere D20 y Control de ambos contendientes' };
      const own = Number(options.roll) + a.control, rival = Number(options.rivalRoll) + Number(options.rivalControl);
      return { ok:true, value:own - rival, detail:own === rival ? 'empate' : own > rival ? 'gana el jugador' : 'gana el rival' };
    }
    if (formulaName.includes('quemadura de tecnica post dominio')) return { ok:true, value:3, detail:'turnos de bloqueo' };
    if (formulaName.includes('sacrificio temporal')) return { ok:true, value:5, detail:'bonificador a cambio de -20 Vida' };
    if (formulaName.includes('costo de mantenimiento de shikigami')) return { ok:true, value:5, detail:'PEM por turno' };
    if (formulaName.includes('dificultad de accion comun')) {
      const levels = { facil:10, media:15, dificil:20, heroica:25 };
      const value = levels[normalize(options.difficulty)];
      return value ? { ok:true, value, detail:`CD ${options.difficulty}` } : { ok:false, reason:'Elige dificultad: fácil, media, difícil o heroica' };
    }
    let expression = decode(formula.expression);
    if (/solo |requiere|meta fija|tirada enfrentada|si el dado|respecto al valor|por cada turno/i.test(expression)) {
      return { ok: false, reason: 'Requiere condición o decisión de juego' };
    }
    expression = expression.replace(/Atributo Fuerza o Agilidad/gi, String(Math.max(a.strength, a.agility)));
    const gradeValue = (grade) => String(grade).toLowerCase() === 'special' ? 5 : Number(grade);
    const values = {
      'PEM Actuales del Jugador': player.resources.pemCurrent,
      'Atributo Control del Creador': a.control, 'Atributo Control del Usuario': a.control,
      'Atributo Resistencia': a.resistance, 'Atributo Agilidad': a.agility,
      'Atributo Fuerza': a.strength, 'Atributo Control': a.control,
      'Atributo Flujo': a.flow, 'Atributo Reserva': (player.attributes || {}).reserve || 0,
      'Control del Creador': a.control, 'Control del Usuario': a.control,
      'Dado D20 natural': options.roll, 'Dado D20': options.roll,
      'Modificador de Alerta': Number(options.alertModifier) || 0,
      'Modificador de Arma': Number(options.weaponModifier) || 0,
      'PEM Gastados': Number(options.pemSpent),
      'Daño extra deseado': Number(options.extraDamage),
      'Daño Total del Atacante': Number(options.totalDamage),
      'Resultado de Mitigación del Defensor': Number(options.mitigation),
      'Daño Físico o Mágico Total': Number(options.totalDamage),
      'Daño Total de la Técnica': Number(options.totalDamage),
      'Tirada de Ataque': Number(options.attackRoll),
      'Grado de la Maldición': Number(options.curseGrade),
      'Grado Actual': Number.isFinite(Number(options.currentGrade)) ? Number(options.currentGrade) : gradeValue(player.grade),
      'Grado de la Misión': Number(options.missionGrade)
    };
    Object.entries(values).sort((x, y) => y[0].length - x[0].length).forEach(([label, value]) => {
      if (!Number.isFinite(Number(value))) return;
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expression = expression.replace(new RegExp(`\\[?${escaped}\\]?`, 'gi'), String(value));
    });
    if (Number.isFinite(Number(options.allies))) {
      expression = expression.replace(/2\s+por cada aliado/gi, `2 * ${Number(options.allies)}`);
    }
    expression = expression
      .replace(/^Costo de\s+(\d+(?:\.\d+)?)\s+PEM.*$/i, '$1')
      .replace(/^Atributos iguales al\s*/i, '')
      .replace(/\(Fijo\)/gi, '')
      .replace(/\b(PEM|metros?|Puntos? de Estructura|Puntos? Libres|Turnos? de Combate Activos|turnos?|XP|USD)\b/gi, '')
      .replace(/\s+/g, ' ').trim();
    const value = safeMath(expression);
    return value === null ? { ok: false, reason: 'Contiene variables todavía no definidas' } : { ok: true, value };
  }

  function evaluateFormulas(compiled, player, options = {}) {
    return (compiled && compiled.formulas || []).map(formula => ({ formula, result: evaluateFormula(formula, player, options) }));
  }

  function parseInput(raw) {
    const original = String(raw || '').trim();
    if (!original) return { type: 'empty', text: '', original };
    if (/^\[[\s\S]*\]$/.test(original)) return { type: 'ooc', text: original.slice(1, -1).trim(), original };
    if (/^\/\//.test(original)) return { type: 'action', text: original.replace(/^\/\/\s*/, ''), original };
    if (/^(?:--|—)/.test(original)) return { type: 'dialogue', text: original.replace(/^(?:--|—)\s*/, ''), original };
    if (/^\*[^*]+\*$/.test(original)) return { type: 'action', text: original.slice(1, -1).trim(), original };
    return { type: 'intent', text: original, original };
  }

  function secureD20(randomFn) {
    if (typeof randomFn === 'function') return clamp(Math.floor(randomFn() * 20) + 1, 1, 20);
    try {
      const array = new Uint32Array(1);
      global.crypto.getRandomValues(array);
      return (array[0] % 20) + 1;
    } catch { return Math.floor(Math.random() * 20) + 1; }
  }

  function gradeCanUseDomain(grade) {
    return String(grade) === '1' || String(grade).toLowerCase() === 'special';
  }

  function relevantRuleNumbers(text) {
    const n = normalize(text); const out = [];
    const add = (...xs) => xs.forEach(x => { if (!out.includes(x)) out.push(x); });
    if (/dominio/.test(n)) add(36,37,38,39,40,41,42,43,44,45);
    if (/destello|chispa negra/.test(n)) add(16,17,18);
    if (/descans|recuper/.test(n)) add(12);
    if (/ocult|rastro/.test(n)) add(20);
    if (/tecnica|pem|energia maldita/.test(n)) add(11,15,19,21,22);
    if (/barrera|tobari|pantalla/.test(n)) add(23);
    if (/cur|san|rcrt|inversa/.test(n)) add(26,27,29);
    if (/ata|golp|comb|esquiv|defen/.test(n)) add(35,56,57,58,59,60,64,65);
    if (/habl|digo|pregunt/.test(n)) add(96,97,98,99,100);
    return out;
  }

  function resolveAction(story, parsedInput, options = {}) {
    ensureStory(story);
    const player = story.rpg.player;
    const derived = syncResourceBounds(player);
    const a = derived.attributes;
    const session = story.rpg.session;
    const text = normalize(parsedInput.text);
    const resolution = {
      possible: true, needsAi: parsedInput.type !== 'ooc', type: parsedInput.type,
      roll: null, rolls: [], naturalRoll: null, modifier: 0, total: null, cd: null,
      advantage: false, disadvantage: false, damage: null, damageFormula: '',
      pemCost: 0, pemRecovery: 0, hpCost: 0, formula: '',
      reasons: [], ruleNumbers: relevantRuleNumbers(parsedInput.text),
      updates: { pemDelta: 0, hpDelta: 0, combatTurnsDelta: 0, conditionsAdd: [], conditionsRemove: [] }
    };
    if (parsedInput.type === 'empty') { resolution.possible = false; resolution.needsAi = false; resolution.reasons.push('Escribe una acción, diálogo o consulta.'); return resolution; }
    if (parsedInput.type === 'ooc') { resolution.needsAi = true; resolution.formula = 'Consulta fuera de personaje: sin tirada ni gasto.'; return resolution; }
    if (parsedInput.type === 'dialogue') { resolution.formula = 'Diálogo: no requiere tirada salvo engaño, persuasión o amenaza explícita.'; return resolution; }

    const isDomain = /expansion de dominio|abrir (?:mi |el )?dominio|activo (?:mi |el )?dominio/.test(text);
    const isRest = /descans|recuper|medit|reposo/.test(text);
    const isHide = /ocult|borro mi rastro|escondo mi energia/.test(text);
    const isTobari = /tobari|pantalla|tecnica barrera/.test(text);
    const isShikigami = /shikigami|invoc/.test(text);
    const isRcrt = /rcrt|tecnica inversa|sanar|curar|regener/.test(text);
    const isExtension = /extension|derivad/.test(text);
    const isCursed = /tecnica|maldit|pem|energia|flujo|hechizo/.test(text);
    const isDefense = /esquiv|defiend|bloque|resist/.test(text);
    const isInitiative = /iniciativa|quien ataca primero/.test(text);
    const isAttack = /atac|golpe|corto|disparo|peleo|embisto|lanzo/.test(text) || (isCursed && !isRcrt && !isDomain && !isHide && !isTobari && !isShikigami && !isRest);
    const isRanged = /distancia|disparo|arco|proyectil/.test(text);
    const revealsTechnique = /revelo|revelar|explico (?:mi |la )?tecnica/.test(text);
    const combinesTechniques = /sinergia de tecnicas|combino (?:mi |la )?tecnica|tecnicas afines/.test(text);
    const temporalSacrifice = /sacrificio temporal|sacrifico 20|cambio 20 de vida/.test(text);
    const allyMatch = text.match(/(\d+)\s+aliad/);
    const teamAllies = allyMatch ? Math.max(0, Number(allyMatch[1]) || 0) : (/con mi aliado|junto a mi aliado/.test(text) ? 1 : 0);
    const isCurseOccupation = /maldicion/.test(normalize(player.occupation));

    if (isRcrt && !isCurseOccupation && !player.hasRcrt) {
      resolution.possible = false; resolution.needsAi = false;
      resolution.reasons.push('RCRT bloqueada: la ficha no declara el talento médico raro de Técnica Inversa.');
      return resolution;
    }
    if (player.heavenlyRestriction && isCursed) {
      resolution.possible = false; resolution.needsAi = false;
      resolution.reasons.push('La Restricción Celestial fija el PEM en 0: no puedes activar técnicas que gasten energía maldita.');
      return resolution;
    }
    if (isCursed && player.conditions.includes('burnout-domain') && !isRcrt) {
      resolution.possible = false; resolution.needsAi = false;
      resolution.reasons.push(`Quemadura post-Dominio activa: la Técnica Innata sigue bloqueada ${session.burnoutTurnsRemaining || 3} turno(s).`);
      return resolution;
    }
    if (isDomain) {
      resolution.pemCost = Math.ceil(player.resources.pemCurrent * 0.80);
      resolution.formula = `Costo = PEM actuales (${player.resources.pemCurrent}) × 0,80 = ${resolution.pemCost} PEM.`;
      if (!gradeCanUseDomain(player.grade)) resolution.reasons.push('Requisito incumplido: solo Grado 1 o Especial puede manifestar un Dominio.');
      if (a.control <= 15) resolution.reasons.push(`Requisito incumplido: Control ${a.control}; la fórmula exige Control > 15.`);
      if (player.conditions.includes('burnout-domain')) resolution.reasons.push('La técnica innata sigue quemada tras un Dominio anterior.');
      if (resolution.reasons.length) { resolution.possible = false; resolution.needsAi = false; return resolution; }
      resolution.updates.conditionsAdd.push('dominio-activo');
    } else if (isRest) {
      resolution.pemRecovery = derived.recoveryPem;
      resolution.formula = `Recuperación = 15 + Reserva (${(player.attributes || {}).reserve || 0}) = ${resolution.pemRecovery} PEM.`;
      resolution.updates.pemDelta = resolution.pemRecovery;
      resolution.needsAi = true;
      return resolution;
    } else if (isHide) {
      resolution.pemCost = 5; resolution.formula = 'Ocultamiento = 5 PEM por turno.';
    } else if (isTobari) {
      resolution.pemCost = 20; resolution.formula = `Tobari = 20 PEM; estructura = Control (${a.control}) × 50 = ${a.control * 50}.`;
    } else if (isShikigami) {
      resolution.pemCost = 5; resolution.formula = 'Mantenimiento de Shikigami = 5 PEM por turno.';
    } else if (isRcrt) {
      const healMatch = text.match(/(?:sano|curo|regenero|recupero)\s*(\d+)/);
      const heal = healMatch ? Number(healMatch[1]) : 10;
      const healsAlly = /aliad|companero|compañero|otra persona/.test(text);
      resolution.pemCost = isCurseOccupation ? heal : healsAlly ? Math.ceil(heal * 4) : Math.ceil(heal * 3);
      resolution.formula = isCurseOccupation
        ? `Regeneración de maldición: ${heal} de Vida cuesta ${resolution.pemCost} PEM (1 a 1).`
        : healsAlly
          ? `Curación a aliado: sanar ${heal} de Vida cuesta ${resolution.pemCost} PEM (4 por punto).`
          : `RCRT: sanar ${heal} de Vida cuesta ${resolution.pemCost} PEM (3 por punto).`;
      // La Vida solo se suma a esta ficha si el objetivo es el propio personaje.
      if (!healsAlly) resolution.updates.hpDelta = heal;
    } else if (isExtension) {
      const extraMatch = text.match(/dano extra\s*(\d+)/);
      const extraDamage = extraMatch ? Number(extraMatch[1]) : 0;
      resolution.pemCost = 20 + extraDamage * 2;
      resolution.formula = `Técnica de Extensión = 20 PEM + daño extra (${extraDamage}) × 2 = ${resolution.pemCost} PEM.`;
    } else if (isCursed) {
      resolution.pemCost = 10; resolution.formula = 'Técnica básica = 10 PEM; tirada = D20 + Flujo + Control.';
    }

    if (resolution.pemCost > player.resources.pemCurrent) {
      resolution.possible = false; resolution.needsAi = false;
      resolution.reasons.push(`PEM insuficiente: necesitas ${resolution.pemCost} y tienes ${player.resources.pemCurrent}.`);
      return resolution;
    }
    if (isDomain) {
      // Manifestar el Dominio tiene requisitos y coste, pero no una tirada de activación.
      // Las tiradas aparecen solo en un Choque de Dominios explícito.
      resolution.updates.pemDelta = -resolution.pemCost;
      resolution.updates.combatTurnsDelta = 1;
      resolution.reasons.push('Dominio manifestado: dura hasta 3 turnos y después aplica quemadura de técnica por 3 turnos.');
      return resolution;
    }
    if (isRcrt || isTobari || isHide || isShikigami) {
      resolution.updates.pemDelta = -resolution.pemCost;
      resolution.updates.combatTurnsDelta = 1;
      resolution.reasons.push('Efecto activado con su coste fijo; no corresponde inventar una tirada adicional.');
      return resolution;
    }

    if (temporalSacrifice) {
      if (player.resources.hpCurrent <= 20) {
        resolution.possible = false; resolution.needsAi = false;
        resolution.reasons.push('Vida insuficiente para el Sacrificio Temporal de 20 puntos.');
        return resolution;
      }
      resolution.hpCost = 20;
      resolution.updates.hpDelta = (resolution.updates.hpDelta || 0) - 20;
      resolution.reasons.push('Sacrificio Temporal: -20 Vida y +5 a esta acción.');
    }

    resolution.advantage = /ventaja|emboscada|posicion ideal/.test(text) && !/desventaja/.test(text);
    resolution.disadvantage = /desventaja|a ciegas|herido/.test(text);
    const supplied = Array.isArray(options.forcedRolls) ? options.forcedRolls.slice(0, 2) : [];
    if (options.forcedRoll != null) supplied.unshift(options.forcedRoll);
    const rollOne = () => clamp(supplied.length ? supplied.shift() : secureD20(options.randomFn), 1, 20);
    const firstRoll = rollOne();
    const secondRoll = (resolution.advantage || resolution.disadvantage) ? rollOne() : null;
    const natural = resolution.advantage ? Math.max(firstRoll, secondRoll) : resolution.disadvantage ? Math.min(firstRoll, secondRoll) : firstRoll;
    resolution.rolls = secondRoll == null ? [firstRoll] : [firstRoll, secondRoll];
    let modifier = 0;
    if (isInitiative) modifier = a.agility;
    else if (isDefense && /bloque|resist/.test(text)) modifier = a.resistance;
    else if (isDefense) modifier = a.agility;
    else if (isCursed) modifier = a.flow + a.control;
    else if (isAttack) modifier = Math.max(a.strength, a.agility);
    else if (/fuerza|romp|levanto|empujo/.test(text)) modifier = a.strength;
    else if (/agil|corro|salto|sigilo/.test(text)) modifier = a.agility;
    else if (/resist|aguanto/.test(text)) modifier = a.resistance;
    else if (/percib|detecto|siento|investig/.test(text)) modifier = a.control;
    else modifier = Math.max(a.agility, a.control);
    modifier += teamAllies * 2;
    if (temporalSacrifice) modifier += 5;

    resolution.naturalRoll = natural;
    resolution.modifier = modifier;
    resolution.total = natural + modifier;
    const cdMatch = parsedInput.text.match(/\bCD\s*[:=]?\s*(\d+)/i);
    resolution.cd = cdMatch ? Number(cdMatch[1]) : 15;
    const diceLabel = secondRoll == null ? `D20 (${natural})` : `${resolution.advantage ? 'Ventaja' : 'Desventaja'} D20 (${firstRoll}, ${secondRoll}) → ${natural}`;
    resolution.roll = `${diceLabel} + ${modifier} = ${resolution.total} vs CD ${resolution.cd}`;
    if (!resolution.formula) resolution.formula = 'Acción dudosa = D20 + atributo pertinente.';
    if (isAttack) {
      const weaponMatch = parsedInput.text.match(/(?:arma|modificador)\s*\+\s*(\d+)/i);
      const weaponModifier = weaponMatch ? Number(weaponMatch[1]) : 0;
      let baseDamage;
      if (isExtension) {
        baseDamage = a.flow * 4 + resolution.pemCost;
        resolution.damageFormula = `Extensión: Flujo (${a.flow}) × 4 + PEM (${resolution.pemCost})`;
      } else if (isCursed) {
        baseDamage = a.flow * 3 + resolution.pemCost / 2;
        resolution.damageFormula = `Técnica básica: Flujo (${a.flow}) × 3 + PEM/2 (${resolution.pemCost / 2})`;
      } else if (isRanged) {
        baseDamage = a.agility * 1.5 + weaponModifier;
        resolution.damageFormula = `Distancia: Agilidad (${a.agility}) × 1,5 + arma (${weaponModifier})`;
      } else {
        baseDamage = a.strength * 2 + weaponModifier;
        resolution.damageFormula = `Melee: Fuerza (${a.strength}) × 2 + arma (${weaponModifier})`;
      }
      if (revealsTechnique && isCursed) {
        baseDamage *= 1.30;
        resolution.damageFormula += ' × 1,30 por revelar la técnica';
      }
      if (combinesTechniques && isCursed) {
        baseDamage *= 2;
        resolution.damageFormula += ' × 2 por sinergia de técnicas afines';
      }
      if (natural === 20) {
        baseDamage *= 2.5;
        resolution.damageFormula += ' × 2,5 por Destello Negro';
      }
      const targetsCurse = /maldicion/.test(text);
      const hasCursedWeapon = /maldit|imbuid/.test(normalize(`${player.equipment || ''} ${parsedInput.text}`));
      if (targetsCurse && !isCursed && !hasCursedWeapon) {
        resolution.damage = 0;
        resolution.damageFormula += '; arma sin PEM contra una maldición';
        resolution.reasons.push('El impacto puede alterar el entorno, pero un arma sin PEM no inflige daño permanente a una maldición.');
      } else {
        resolution.damage = Math.round(baseDamage * 100) / 100;
      }
    }
    if (natural === 20) {
      if (isAttack) {
        resolution.reasons.push('20 natural en ataque: Destello Negro ×2,5 y estado En la Zona por 3 turnos.');
        resolution.updates.conditionsAdd.push('zone-3');
      } else {
        resolution.reasons.push('20 natural: éxito crítico con información o efecto adicional, sin forzar un Destello Negro.');
      }
    } else if (natural === 1) {
      if (resolution.damage != null) {
        const selfDamage = Math.round(resolution.damage / 2 * 100) / 100;
        resolution.updates.hpDelta -= selfDamage;
        resolution.reasons.push(`1 natural: pifia crítica; el atacante recibe ${selfDamage} de daño (la mitad de su ataque).`);
      } else {
        resolution.reasons.push('1 natural: pifia crítica; el GM debe aplicar una consecuencia catastrófica coherente.');
      }
    } else {
      resolution.reasons.push(resolution.total >= resolution.cd ? 'La tirada supera la dificultad.' : 'La tirada no alcanza la dificultad.');
    }
    if (isAttack && !isCursed && resolution.total < resolution.cd && !player.heavenlyRestriction) {
      const concentrationLoss = Math.min(5, player.resources.pemCurrent);
      resolution.updates.pemDelta -= concentrationLoss;
      resolution.reasons.push(`Ataque físico fallido por desconcentración: -${concentrationLoss} PEM.`);
    }
    if (isAttack && /area|explosion|onda expansiva/.test(text) && /aliad|companero|compañero|equipo/.test(text)) {
      resolution.reasons.push('Fuego amigo activo: la técnica de área también amenaza a los aliados dentro del espacio declarado.');
    }
    resolution.updates.pemDelta -= resolution.pemCost;
    if (isAttack || isDefense || isDomain) resolution.updates.combatTurnsDelta = 1;
    const nextCombatTurn = session.combatTurns + resolution.updates.combatTurnsDelta;
    if (nextCombatTurn >= 5 && !player.conditions.includes('fatiga-10')) {
      resolution.updates.conditionsAdd.push('fatiga-10');
      resolution.reasons.push('Fatiga: tras 5 turnos de combate, los atributos físicos bajan un 10%.');
    }
    return resolution;
  }

  function applyResolution(story, resolution) {
    ensureStory(story);
    if (!resolution || !resolution.possible) return;
    const player = story.rpg.player; const session = story.rpg.session;
    const combatAdvanced = (Number(resolution.updates.combatTurnsDelta) || 0) > 0;
    player.resources.pemCurrent += Number(resolution.updates.pemDelta) || 0;
    player.resources.hpCurrent += Number(resolution.updates.hpDelta) || 0;
    session.combatTurns += Number(resolution.updates.combatTurnsDelta) || 0;
    (resolution.updates.conditionsRemove || []).forEach(c => { player.conditions = player.conditions.filter(x => x !== c); });

    // Avanza estados que ya estaban activos antes de esta resolución.
    let startedBurnoutNow = false;
    if (combatAdvanced && session.domainTurnsRemaining > 0) {
      session.domainTurnsRemaining--;
      if (session.domainTurnsRemaining <= 0) {
        player.conditions = player.conditions.filter(x => x !== 'dominio-activo');
        if (!player.conditions.includes('burnout-domain')) player.conditions.push('burnout-domain');
        session.burnoutTurnsRemaining = 3;
        startedBurnoutNow = true;
      }
    }
    if (combatAdvanced && session.burnoutTurnsRemaining > 0 && !startedBurnoutNow && !resolution.updates.conditionsAdd.includes('dominio-activo')) {
      session.burnoutTurnsRemaining--;
      if (session.burnoutTurnsRemaining <= 0) player.conditions = player.conditions.filter(x => x !== 'burnout-domain');
    }
    if (combatAdvanced && session.zoneTurnsRemaining > 0) {
      session.zoneTurnsRemaining--;
      if (session.zoneTurnsRemaining <= 0) player.conditions = player.conditions.filter(x => x !== 'zone-3');
    }

    (resolution.updates.conditionsAdd || []).forEach(c => {
      if (!player.conditions.includes(c)) player.conditions.push(c);
      // El turno de activación cuenta como el primero de los 3 turnos máximos.
      if (c === 'dominio-activo') session.domainTurnsRemaining = 2;
      if (c === 'zone-3') session.zoneTurnsRemaining = 3;
    });
    syncResourceBounds(player);
    if (!player.heavenlyRestriction && player.resources.pemCurrent === 0) {
      if (!player.conditions.includes('agotamiento-pem')) player.conditions.push('agotamiento-pem');
    } else {
      player.conditions = player.conditions.filter(c => c !== 'agotamiento-pem');
    }
  }

  function describeResolution(resolution) {
    if (!resolution) return '';
    const lines = [];
    lines.push(resolution.possible ? '✓ Acción posible según el estado actual.' : '✕ Acción bloqueada por las reglas.');
    if (resolution.roll) lines.push(`Tirada pública: ${resolution.roll}.`);
    if (resolution.formula) lines.push(resolution.formula);
    if (resolution.damage != null) lines.push(`Daño base resuelto: ${resolution.damage}. ${resolution.damageFormula}. La mitigación del objetivo se resta después.`);
    if (resolution.pemCost) lines.push(`Gasto confirmado: ${resolution.pemCost} PEM.`);
    if (resolution.pemRecovery) lines.push(`Recuperación confirmada: +${resolution.pemRecovery} PEM.`);
    if (resolution.hpCost) lines.push(`Coste confirmado: -${resolution.hpCost} Vida.`);
    resolution.reasons.forEach(r => lines.push(r));
    if (resolution.ruleNumbers.length) lines.push(`Reglas relacionadas: ${resolution.ruleNumbers.join(', ')}.`);
    return lines.join('\n');
  }

  function campaignId(prefix) {
    return `${prefix}_${now()}_${Math.random().toString(36).slice(2,7)}`;
  }

  function parseCampaignCommand(raw) {
    const input = String(raw || '').trim();
    if (!input.startsWith('/') || input.startsWith('//')) return { handled:false };
    const match = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled:true, ok:false, command:'', args:'', error:'Comando inválido.' };
    return { handled:true, command:normalize(match[1]), args:String(match[2] || '').trim() };
  }

  function campaignStatus(story) {
    ensureStory(story);
    const s = story.rpg.worldState;
    return `Mundo: ${story.rpg.campaign.referenceWork}\nUbicación: ${s.location}\nReloj: ${s.clock}\nMisiones: ${s.quests.filter(q=>q.status !== 'completed' && q.status !== 'failed').length} activas\nFacciones: ${s.factions.length}\nInventario: ${s.inventory.length} objetos\nPistas: ${s.clues.length}\nHeridas: ${s.wounds.filter(w=>w.status !== 'healed').length}\nConsecuencias: ${s.consequences.length}`;
  }

  function executeCampaignCommand(story, raw) {
    const parsed = parseCampaignCommand(raw);
    if (!parsed.handled) return parsed;
    ensureStory(story);
    const s = story.rpg.worldState;
    const text = parsed.args;
    const add = (collection, item) => { s[collection].push({ id:campaignId(collection.slice(0,-1)), createdAt:now(), ...item }); };
    const directorOnly = () => story.rpg.role === 'director' ? null : { handled:true, ok:false, command:parsed.command, message:'Este cambio directo del mundo requiere modo Director. En modo Jugador, decláralo como acción para que el GM resuelva sus consecuencias.' };
    switch (parsed.command) {
      case 'ayuda': case 'help': return { handled:true, ok:true, command:parsed.command, message:'Comandos: /estado, /reloj, /inventario, /mision, /faccion, /relacion, /pista, /herida, /rumor, /tiempo. Usa “+ texto” para añadir y “- texto” para retirar cuando corresponda.' };
      case 'estado': case 'status': return { handled:true, ok:true, command:parsed.command, message:campaignStatus(story) };
      case 'reloj': {
        if (!text) return { handled:true, ok:true, command:'reloj', message:s.clocks.length ? s.clocks.map(c=>`${c.name}: ${c.value}/${c.max}`).join('\n') : 'No hay relojes activos.' };
        const tick = text.match(/^(.+?)\s+([+-]\d+)$/);
        if (tick) {
          const guard=directorOnly(); if(guard)return guard;
          const clock=s.clocks.find(c=>normalize(c.name)===normalize(tick[1])); if(!clock)return{handled:true,ok:false,command:'reloj',message:'No existe ese reloj.'};
          clock.value=clamp(clock.value+Number(tick[2]),0,clock.max); clock.updatedAt=now();
          return {handled:true,ok:true,changed:true,command:'reloj',message:`${clock.name}: ${clock.value}/${clock.max}`};
        }
        const create=text.match(/^\+?\s*(.+?)(?:\s+(\d+)\/(\d+))?$/); const guard=directorOnly(); if(guard)return guard;
        add('clocks',{name:create[1].trim(),value:Number(create[2])||0,max:Number(create[3])||6});
        return {handled:true,ok:true,changed:true,command:'reloj',message:`Reloj creado: ${create[1].trim()}.`};
      }
      case 'inventario': {
        if (!text) return {handled:true,ok:true,command:'inventario',message:s.inventory.length?s.inventory.map(i=>`${i.quantity||1}× ${i.name}`).join('\n'):'Inventario vacío.'};
        const guard=directorOnly(); if(guard)return guard;
        if (/^-\s*/.test(text)) { const name=text.replace(/^-\s*/,''); const i=s.inventory.findIndex(x=>normalize(x.name)===normalize(name)); if(i<0)return{handled:true,ok:false,command:'inventario',message:'Objeto no encontrado.'}; s.inventory.splice(i,1); return{handled:true,ok:true,changed:true,command:'inventario',message:`Retirado: ${name}.`}; }
        const name=text.replace(/^\+\s*/,''); add('inventory',{name,quantity:1,owner:story.rpg.player.name||'grupo'}); return{handled:true,ok:true,changed:true,command:'inventario',message:`Añadido al inventario: ${name}.`};
      }
      case 'mision': case 'misión': {
        if (!text) return {handled:true,ok:true,command:'mision',message:s.quests.length?s.quests.map(q=>`[${q.status}] ${q.title}`).join('\n'):'No hay misiones.'};
        const guard=directorOnly(); if(guard)return guard;
        const done=text.match(/^(?:completar|complete)\s+(.+)$/i); if(done){const q=s.quests.find(x=>normalize(x.id)===normalize(done[1])||normalize(x.title)===normalize(done[1]));if(!q)return{handled:true,ok:false,command:'mision',message:'Misión no encontrada.'};q.status='completed';q.updatedAt=now();return{handled:true,ok:true,changed:true,command:'mision',message:`Misión completada: ${q.title}.`};}
        const title=text.replace(/^\+\s*/,''); add('quests',{title,status:'active',objective:title}); return{handled:true,ok:true,changed:true,command:'mision',message:`Misión registrada: ${title}.`};
      }
      case 'faccion': case 'facción': {
        if (!text) return {handled:true,ok:true,command:'faccion',message:s.factions.length?s.factions.map(f=>`${f.name}: ${f.goal} (${f.progress||0}%)`).join('\n'):'No hay facciones.'};
        const guard=directorOnly(); if(guard)return guard;
        const [name,goal='Objetivo por definir']=text.replace(/^\+\s*/,'').split('|').map(x=>x.trim()); add('factions',{name,goal,progress:0,attitude:0,resources:'No especificados'}); return{handled:true,ok:true,changed:true,command:'faccion',message:`Facción creada: ${name}.`};
      }
      case 'relacion': case 'relación': {
        if (!text) return {handled:true,ok:true,command:'relacion',message:Object.keys(s.relationships).length?Object.entries(s.relationships).map(([n,v])=>`${n}: ${v}`).join('\n'):'No hay relaciones registradas.'};
        const guard=directorOnly(); if(guard)return guard;
        const m=text.match(/^(.+?)\s+([+-]\d+)$/); if(!m)return{handled:true,ok:false,command:'relacion',message:'Usa /relacion Nombre +2 o -1.'}; const key=m[1].trim();s.relationships[key]=clamp((Number(s.relationships[key])||0)+Number(m[2]),-100,100);return{handled:true,ok:true,changed:true,command:'relacion',message:`Relación con ${key}: ${s.relationships[key]}.`};
      }
      case 'pista': case 'herida': case 'rumor': {
        const guard=directorOnly(); if(guard)return guard;
        const map={pista:'clues',herida:'wounds',rumor:'rumors'}; const collection=map[parsed.command]; const value=text.replace(/^\+\s*/,''); if(!value)return{handled:true,ok:false,command:parsed.command,message:'Escribe el contenido a registrar.'}; add(collection,collection==='wounds'?{name:value,status:'active',severity:'moderate'}:{text:value,status:'active'});return{handled:true,ok:true,changed:true,command:parsed.command,message:`${parsed.command} registrada: ${value}.`};
      }
      case 'tiempo': {
        const guard=directorOnly(); if(guard)return guard;
        if(!text)return{handled:true,ok:true,command:'tiempo',message:s.clock}; s.clock=text;return{handled:true,ok:true,changed:true,command:'tiempo',message:`Tiempo actualizado: ${text}.`};
      }
      default:return{handled:true,ok:false,command:parsed.command,message:`Comando desconocido: /${parsed.command}. Usa /ayuda.`};
    }
  }

  function auditModelOutput(text, options = {}) {
    const raw = String(text || '').trim();
    const language = options.language || 'es';
    const patterns = [
      /\bThe user wants\b/i, /\bI need to\b/i, /\bLet me (?:analyze|write|continue)\b/i,
      /\bKey elements\b/i, /\bcurrent situation\b/i, /\bThe last word is\b/i,
      /\blooking at this more carefully\b/i, /\bI should continue\b/i,
      /\bEl usuario (?:quiere|pide|me (?:pide|está pidiendo))\b/i,
      /\b(?:Necesito|Voy a) (?:analizar|continuar|escribir|responder|revisar)\b/i,
      /\b(?:Elementos clave|Situación actual|La última palabra es|El texto proporcionado)\b/i,
      /<think>[\s\S]*?<\/think>/i, /\b(system prompt|developer message|prompt del sistema|mensaje del desarrollador)\b/i
    ];
    const leaks = patterns.filter(rx => rx.test(raw)).map(rx => rx.source);
    const startsEnglish = /^(?:The|I |Let |Key |Current |However,|Looking )/i.test(raw);
    const words = normalize(raw).split(/\s+/).filter(Boolean);
    const englishWords = new Set(['the','and','you','your','with','from','that','this','into','when','what','where','does','do','is','are','was','were','can','will','would','should','rain','soldier','character','player','story','continue','attack','move','stop','right','there','put','hands','run','east','forest','river','now','here','come','get','out','stay','back','down','open','door']);
    const spanishWords = new Set(['el','la','los','las','y','que','con','desde','cuando','donde','es','son','fue','puede','hara','debes','lluvia','soldado','personaje','jugador','historia','continua','ataca','alto','aqui','corre','bosque','rio','ahora','manos','puerta']);
    const languageScore = (fragment) => {
      const ws = normalize(fragment).split(/\s+/).filter(Boolean);
      const en = ws.filter(w => englishWords.has(w)).length;
      const es = ws.filter(w => spanishWords.has(w)).length;
      return { words: ws.length, en, es, english: ws.length >= 4 && en >= 2 && en > es * 1.5 };
    };
    const totalLanguage = languageScore(raw);
    const mostlyEnglish = totalLanguage.words >= 6 && totalLanguage.en >= 3 && totalLanguage.en > totalLanguage.es * 1.5;
    const spokenSegments = [
      ...(raw.match(/["“][^"”\n]{4,}["”]/g) || []),
      ...(raw.match(/(?:^|\n)\s*—[^\n]{4,}/g) || [])
    ];
    const englishDialogue = spokenSegments.some(segment => languageScore(segment).english);
    const enforceSpanish = language === 'es';
    const languageMismatch = enforceSpanish && (startsEnglish || mostlyEnglish || englishDialogue);
    return { ok: Boolean(raw) && leaks.length === 0 && !languageMismatch, leaks, startsEnglish, mostlyEnglish, englishDialogue, languageMismatch, language, empty: !raw };
  }

  function extractJson(text) {
    let raw = String(text || '').trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {
      try { return JSON.parse(raw.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
    }
  }

  function auditGmOutput(text, options = {}) {
    const base = auditModelOutput(text, options);
    const raw = String(text || '');
    const controlPatterns = [
      /\b(?:tú|tu personaje)\s+(?:decides|eliges|piensas|sientes|dices|respondes|corres|avanzas|atacas|te mueves|aceptas|rechazas|levantas|saltas|tomas|abres|entras|caminas|usas|lanzas|golpeas|esquivas|huyes|gritas)\b/i,
      /(?:^|[.!?:"“]\s*)(?:Decides|Eliges|Piensas|Sientes|Dices|Respondes|Corres|Avanzas|Atacas|Aceptas|Rechazas|Levantas|Saltas|Tomas|Abres|Entras|Caminas|Usas|Lanzas|Golpeas|Esquivas|Huyes|Gritas)\b/i,
      /\bno puedes evitar (?:pensar|sentir|decir|hacer)\b/i,
      /\b(?:te obliga|te hace|te fuerza) a (?:huir|atacar|decir|aceptar|caminar|entrar|moverte)\b/i,
      /\bpones palabras en (?:tu|la) boca\b/i,
      /\b(?:you|your character)\s+(?:decide|choose|think|feel|say|answer|run|advance|attack|move|accept|refuse|raise|jump|take|open|enter|walk|use|throw|strike|dodge|flee|shout)s?\b/i,
      /(?:^|[.!?:"“]\s*)(?:You decide|You choose|You think|You feel|You say|You run|You attack|You enter|You flee)\b/i
    ];
    const controlsPlayer = controlPatterns.some(rx => rx.test(raw));
    return { ...base, ok: base.ok && !controlsPlayer, controlsPlayer };
  }

  function normalizeGmOutput(text, options = {}) {
    const language = options.language || 'es';
    const audit = auditGmOutput(text, { language });
    if (!audit.ok) return { ok: false, error: audit.empty ? 'Respuesta vacía' : audit.controlsPlayer ? 'El GM intentó controlar al personaje del jugador.' : 'El proveedor expuso razonamiento interno o respondió fuera del formato seguro.', audit };
    const parsed = extractJson(text);
    let narrative = parsed ? String(parsed.narracion || parsed.narrative || '').trim() : String(text || '').trim();
    let question = parsed ? String(parsed.pregunta || parsed.question || '').trim() : '';
    narrative = narrative.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```\w*\s*|```$/g, '').trim();
    const questions = { es:'¿Qué haces?', en:'What do you do?', pt:'O que você faz?', fr:'Que faites-vous ?', de:'Was tust du?', it:'Che cosa fai?' };
    if (!question && !/[?¿]\s*$/.test(narrative)) question = options.question || questions[language] || questions.es;
    const output = [narrative, question].filter(Boolean).join('\n\n');
    return { ok: Boolean(narrative), text: output, narrative, question, parsed };
  }

  global.LoreRpgEngine = {
    defaultPlayer, ensureStory, effectiveAttributes, derivedStats, syncResourceBounds,
    compileRules, splitRulesAndFormulas, hashText, evaluateFormula, evaluateFormulas, safeMath,
    parseInput, secureD20, resolveAction, applyResolution, describeResolution,
    parseCampaignCommand, executeCampaignCommand, campaignStatus,
    auditModelOutput, auditGmOutput, normalizeGmOutput, relevantRuleNumbers, normalize
  };
})(window);
