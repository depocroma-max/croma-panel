/**
 * Regresión XSS del módulo Entradas (croma-panel-main/index.html).
 *
 * Sin dependencias: extrae las funciones de render del index.html real,
 * las corre en node:vm con un `document` mínimo y les pasa datos maliciosos.
 *
 * Idea central (test de propiedad): el HTML generado con datos maliciosos
 * debe tener EXACTAMENTE la misma estructura (mismos tags y mismos nombres de
 * atributo, en el mismo orden) que el generado con datos inocuos. Si un payload
 * lograra inyectar un tag, un atributo o un handler, la estructura cambiaría.
 *
 * Uso: node tests/entradas-xss.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ── Extrae `function nombre(...) { ... }` del index.html por conteo de llaves ──
function extraerFuncion(nombre) {
  const ini = SRC.indexOf('\nfunction ' + nombre + '(');
  assert.ok(ini >= 0, 'No se encontró la función ' + nombre + ' en index.html');
  let i = SRC.indexOf('{', ini), prof = 0, q = null;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if ((c === '"' || c === "'" || c === '`') && !(SRC[j - 1] === '/' && SRC[j + 1] === '/')) { q = c; continue; } // /'/ es una regex, no un string
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return SRC.slice(ini + 1, j + 1); }
  }
  throw new Error('Llaves desbalanceadas en ' + nombre);
}

const FUNCIONES = [
  'escEnt', 'normEnt', 'eventoKey', 'fmtFechaCortaEnt', 'hoyEnt', 'entVencida', 'entActivas', 'entArchivadas', 'getEntFiltradas', 'buscarEntradaEnt', 'htmlItemEnt', 'agruparEventosEnt',
  'asegurarListenerEntradasGrid', 'renderEntradasSucursal', 'renderEntradasEvento',
  'renderEntradasSidebar',
];

// ── Entorno simulado ──
function crearEntorno() {
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    innerHTML: '', textContent: '', listeners: {},
    addEventListener(tipo, fn) { this.listeners[tipo] = fn; },
    contains() { return true; },
  });
  const llamadas = [];
  const ctx = {
    document: { getElementById: el },
    icon: (n) => '<svg class="ic"><path d="p"/></svg>',
    SUCURSALES_ENT: ['01 PASEO', '05 WAVE', '10 PERITO MORENO', '12 CENTENARIO', '14 ROCA'],
    SUC_COLORS: {},
    entradasData: {}, entFiltro: '', entVerArchivo: false, sesionRol: 'admin', sesionSucursal: '',
    abrirModalEntrada: (e, s) => llamadas.push(['abrir', e, s]),
    toggleAgotado: (e, s) => llamadas.push(['toggle', e, s]),
  };
  vm.createContext(ctx);
  vm.runInContext(FUNCIONES.map(extraerFuncion).join('\n'), ctx);
  return { ctx, el, llamadas };
}

// ── Tokenizador mínimo de HTML: devuelve la secuencia de tags + nombres de atributo ──
function estructura(html) {
  const out = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let consumido = 0, m;
  while ((m = re.exec(html))) {
    // Todo lo que queda entre tags debe ser texto sin '<' (si no, hay un tag mal formado/inyectado)
    const texto = html.slice(consumido, m.index);
    assert.ok(!/[<>]/.test(texto), 'Texto con < o > crudo entre tags: ' + JSON.stringify(texto));
    consumido = m.index + m[0].length;
    const sinValores = m[3].replace(/="[^"]*"/g, ''); // los espacios dentro de un valor no son atributos
    const attrs = [...sinValores.matchAll(/\s+([^\s"'<>\/=]+)/g)].map((a) => a[1]);
    out.push((m[1] ? '/' : '') + m[2].toLowerCase() + '[' + attrs.join(',') + ']');
  }
  const resto = html.slice(consumido);
  assert.ok(!/[<>]/.test(resto), 'Resto con < o > crudo: ' + JSON.stringify(resto));
  return out;
}

// Atributos que NUNCA deben aparecer (handlers inline), salvo los 3 estáticos del HTML original
// Se mira solo el nombre de atributo real de cada tag: un `onerror=` escapado dentro
// de un título o de un texto es inofensivo y no debe contarse.
const HANDLER = { test: (html) => estructura(html).some((tk) => /\[(.*,)?on[a-z]+(,|\])/i.test(tk)) };

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<script>window.__pwned=1</script>',
  '"><svg onload=alert(1)>',
  '&quot;,x:alert(1),&quot;',
  "' onmouseover='alert(1)",
  '" onmouseover="alert(1)',
  '\\',
  "\\'); alert(1);//",
  '</div></span><b>x</b>',
  '<a href="javascript:alert(1)">x</a>',
  '&lt;b&gt; &amp; &#39;',
];
const LEGITIMOS = ['O\'Neill', '"Big" & Co', 'Café <VIP> 50% & más', 'Rock & Roll "En vivo"', "Día d'été \\ barra"];

function dataset(texto, ids) {
  // Misma forma para inocuo y malicioso: solo cambian los textos
  const mk = (id, suc, extra) => Object.assign({
    id: id, sucursal: suc, nombre: texto, precio: 1000, fecha: '2026-12-15',
    lugar: texto, obs: texto, agotado: false,
  }, extra || {});
  return {
    '01 PASEO': [mk(ids[0], '01 PASEO'), mk(ids[1], '01 PASEO', { agotado: true })],
    '05 WAVE': [mk(ids[2], '05 WAVE', { lugar: '' })], // legacy sin lugar
  };
}

let ok = 0, fallos = 0;
function t(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (e) { fallos++; console.error('  FAIL ' + nombre + '\n       ' + (e && e.message)); }
}

function renderTodo(env) {
  env.ctx.renderEntradasSucursal();
  env.ctx.renderEntradasEvento();
  env.ctx.renderEntradasSidebar();
  return {
    grid: env.el('entradasGrid').innerHTML,
    evt: env.el('entradasEvtList').innerHTML,
    side: env.el('entSidebarEvt').innerHTML,
  };
}

console.log('Entradas — regresión XSS');

// Baseline con datos inocuos
const base = crearEntorno();
base.ctx.entradasData = dataset('Evento normal', ['ENT-1', 'ENT-2', 'ENT-3']);
const baseHtml = renderTodo(base);
const baseEstr = { grid: estructura(baseHtml.grid), evt: estructura(baseHtml.evt), side: estructura(baseHtml.side) };

t('baseline: sin handlers inline con datos en la grilla', () => {
  assert.ok(!/onclick="[^"]*(abrirModalEntrada|toggleAgotado)/.test(baseHtml.grid), 'quedó un onclick con datos');
  assert.ok(!HANDLER.test(baseHtml.grid), 'la grilla no debe tener handlers inline');
  assert.ok(/data-ent-id="ENT-1"/.test(baseHtml.grid) && /data-suc="01 PASEO"/.test(baseHtml.grid));
});

PAYLOADS.concat(LEGITIMOS).forEach((p) => {
  const esMalicioso = PAYLOADS.includes(p);
  t((esMalicioso ? 'payload ' : 'legítimo ') + JSON.stringify(p).slice(0, 48), () => {
    const env = crearEntorno();
    // id también malicioso en una de las entradas
    env.ctx.entradasData = dataset(p, ['ENT-1', p, 'ENT-3']);
    const h = renderTodo(env);
    // 1) misma estructura que el baseline (nadie inyectó tags ni atributos)
    assert.deepStrictEqual(estructura(h.grid), baseEstr.grid, 'cambió la estructura de la grilla');
    assert.deepStrictEqual(estructura(h.evt).length > 0, true);
    estructura(h.side);
    // 2) sin handlers inline
    assert.ok(!HANDLER.test(h.grid), 'handler inline en la grilla');
    assert.ok(!HANDLER.test(h.evt) && !HANDLER.test(h.side), 'handler inline en vistas por evento/lateral');
    // 3) el payload nunca aparece crudo
    if (/[<>"']/.test(p)) {
      [h.grid, h.evt, h.side].forEach((s) => assert.ok(!s.includes(p), 'payload crudo en el HTML'));
    }
  });
});

t('buscador: el texto buscado se escapa en "Sin resultados"', () => {
  const env = crearEntorno();
  env.ctx.entradasData = dataset('Evento normal', ['ENT-1', 'ENT-2', 'ENT-3']);
  env.ctx.entFiltro = '<img src=x onerror=alert(1)>';
  env.ctx.renderEntradasSucursal();
  const h = env.el('entradasGrid').innerHTML;
  assert.ok(!h.includes('<img src=x'), 'filtro crudo en el HTML');
  estructura(h);
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'), 'el texto debe verse literal');
});

t('delegado: editar abre el modal con el objeto real (sin serializar), también con payloads', () => {
  const env = crearEntorno();
  const mal = '"\'><img src=x onerror=alert(1)>&quot;\\';
  env.ctx.entradasData = dataset(mal, ['ENT-1', 'ENT-2', 'ENT-3']);
  env.ctx.renderEntradasSucursal();
  const listener = env.el('entradasGrid').listeners.click;
  assert.strictEqual(typeof listener, 'function', 'no se registró el listener delegado');
  const item = { get: (a) => ({ 'data-ent-id': 'ENT-1', 'data-suc': '01 PASEO' }[a]) };
  const target = {
    closest: (sel) => (sel === '.ent-add-btn' ? null : sel.startsWith('.ent-item') ? { getAttribute: item.get } : sel === '.ent-toggle-agotado' ? null : null),
  };
  listener({ target });
  assert.strictEqual(env.llamadas.length, 1);
  assert.strictEqual(env.llamadas[0][0], 'abrir');
  assert.strictEqual(env.llamadas[0][1].nombre, mal, 'el nombre debe llegar intacto, sin escapar ni truncar');
  assert.strictEqual(env.llamadas[0][2], '01 PASEO');
});

t('delegado: marcar agotado llama toggleAgotado (no abre el modal)', () => {
  const env = crearEntorno();
  env.ctx.entradasData = dataset('x', ['ENT-1', 'ENT-2', 'ENT-3']);
  env.ctx.renderEntradasSucursal();
  const listener = env.el('entradasGrid').listeners.click;
  const item = { getAttribute: (a) => ({ 'data-ent-id': 'ENT-2', 'data-suc': '01 PASEO' }[a]) };
  listener({ target: { closest: (sel) => (sel === '.ent-toggle-agotado' ? {} : sel.startsWith('.ent-item') ? item : null) } });
  assert.deepStrictEqual(env.llamadas.map((c) => c[0]), ['toggle']);
  assert.strictEqual(env.llamadas[0][1].id, 'ENT-2');
});

t('delegado: agregar entrada usa data-suc de la sucursal', () => {
  const env = crearEntorno();
  env.ctx.renderEntradasSucursal();
  const listener = env.el('entradasGrid').listeners.click;
  const btn = { getAttribute: (a) => (a === 'data-suc' ? '05 WAVE' : null) };
  listener({ target: { closest: (sel) => (sel === '.ent-add-btn' ? btn : null) } });
  assert.deepStrictEqual(env.llamadas[0], ['abrir', null, '05 WAVE']);
});

t('delegado: un id desconocido o inyectado no abre nada', () => {
  const env = crearEntorno();
  env.ctx.entradasData = dataset('x', ['ENT-1', 'ENT-2', 'ENT-3']);
  env.ctx.renderEntradasSucursal();
  const listener = env.el('entradasGrid').listeners.click;
  const item = { getAttribute: (a) => ({ 'data-ent-id': 'NO-EXISTE', 'data-suc': '01 PASEO' }[a]) };
  listener({ target: { closest: (sel) => (sel.startsWith('.ent-item') ? item : null) } });
  assert.strictEqual(env.llamadas.length, 0);
});

t('permisos: encargado de otra sucursal no recibe ítems editables ni botón agregar', () => {
  const env = crearEntorno();
  env.ctx.sesionRol = 'encargado'; env.ctx.sesionSucursal = '05 WAVE';
  env.ctx.entradasData = dataset('x', ['ENT-1', 'ENT-2', 'ENT-3']);
  const h = renderTodo(env).grid;
  const paseo = h.slice(h.indexOf('01 PASEO'), h.indexOf('05 WAVE'));
  assert.ok(!/class="ent-item editable/.test(paseo), 'ítems de otra sucursal marcados como editables');
  assert.ok(!/ent-toggle-agotado/.test(paseo) && !/ent-add-btn/.test(paseo));
  const wave = h.slice(h.indexOf('05 WAVE'));
  assert.ok(/ent-item editable/.test(wave) && /ent-add-btn/.test(wave), 'su sucursal sí debe ser editable');
});

t('listener se registra una sola vez aunque se renderice varias veces', () => {
  const env = crearEntorno();
  let registros = 0;
  const grid = env.el('entradasGrid');
  const orig = grid.addEventListener.bind(grid);
  grid.addEventListener = (...a) => { registros++; orig(...a); };
  env.ctx.renderEntradasSucursal(); env.ctx.renderEntradasSucursal(); env.ctx.renderEntradasSucursal();
  assert.strictEqual(registros, 1);
});

t('index.html: el bloque Entradas ya no usa onclick con datos ni concatena nombre/obs sin escapar', () => {
  const ini = SRC.indexOf('// ── ENTRADAS ──'), fin = SRC.indexOf('// ── STOCK (croma-api) ──');
  const bloque = SRC.slice(ini, fin);
  assert.ok(!/onclick="abrirModalEntrada\(' *\+/.test(bloque) && !/eData/.test(bloque), 'quedó serialización en onclick');
  assert.ok(!/title="' \+ (e|ev)\.(nombre|obs)/.test(bloque), 'title sin escapar');
  assert.ok(!/' \+ (e|ev)\.(nombre|obs) \+/.test(bloque), 'nombre/obs concatenados sin escEnt');
});

console.log('\n' + ok + ' ok, ' + fallos + ' fallos');
process.exit(fallos ? 1 : 0);
