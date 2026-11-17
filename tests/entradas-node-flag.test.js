/**
 * Flag ENTRADAS_NODE (Fase 4): extrae las funciones reales de index.html, las
 * corre en node:vm con fetch/DOM simulados y verifica ambos caminos.
 * Sin dependencias ni red. Uso: node tests/entradas-node-flag.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extraerFuncion(nombre) {
  let ini = SRC.indexOf('\nasync function ' + nombre + '(');
  if (ini < 0) ini = SRC.indexOf('\nfunction ' + nombre + '(');
  assert.ok(ini >= 0, 'No se encontró la función ' + nombre);
  let i = SRC.indexOf('{', ini), prof = 0, q = null;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if ((c === '"' || c === "'" || c === '`') && !(SRC[j - 1] === '/' && SRC[j + 1] === '/')) { q = c; continue; }
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return SRC.slice(ini + 1, j + 1); }
  }
  throw new Error('Llaves desbalanceadas en ' + nombre);
}
const FUNCIONES = ['mensajeErrorEntradasNode', 'fetchEntradasNode', 'cargarEntradas', 'guardarEntrada', 'toggleAgotado',
  'actualizarEntradaLocal', 'eliminarEntrada', 'eliminarEntradaLocal'];

// Respuestas programables por (método + ruta). Todo lo que se pida queda en `pedidos`.
function crearEntorno({ flag, respuestas = {}, campos = {}, rolSesion = 'admin' } = {}) {
  const pedidos = []; const toasts = []; const estado = { modalCerrado: 0, cargas: 0, renders: 0 };
  const valores = Object.assign({ meId: '', meSucursal: '14 ROCA', meNombre: 'Evento X', mePrecio: '1500', meFecha: '2026-12-31', meObs: 'o', meLugar: 'Estadio' }, campos);
  const els = {};
  const el = (id) => (els[id] = els[id] || { innerHTML: '', classList: { toggle() {} }, get value() { return valores[id] || ''; }, checked: !!valores['chk_' + id], focus() {} });
  const ctx = {
    API_URL: 'https://script.google.com/macros/s/FAKE/exec', HORARIOS_BACKEND_URL: 'https://api.test',
    getTokenPanel: () => 'TOKEN123', sesionRol: rolSesion, entradasData: {},
    document: { getElementById: el },
    toast: (m, t) => toasts.push([m, t]),
    renderEntradas: () => { estado.renders++; },
    cerrarModalEntrada: () => { estado.modalCerrado++; },
    confirm: () => true,
    fetch: async (url, opts) => {
      pedidos.push({ url, metodo: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {}, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
      const clave = ((opts && opts.method) || 'GET') + ' ' + url.replace('https://api.test/api/entradas', '');
      const r = respuestas[clave];
      if (r === 'RED') throw new Error('network');
      if (r === undefined) return { status: 200, json: async () => ({ ok: true, entradas: {} }) }; // GAS por defecto
      return { status: r.status, json: async () => r.data };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`var ENTRADAS_NODE = ${flag};` + FUNCIONES.map(extraerFuncion).join('\n'), ctx);
  // cargarEntradas real se pisa DESPUÉS de definir guardar/eliminar para contar recargas, pero la real se conserva para sus pruebas
  ctx.__cargarReal = ctx.cargarEntradas;
  return { ctx, pedidos, toasts, estado, valores, setCargar() { ctx.cargarEntradas = () => { estado.cargas++; }; } };
}
const hayGas = (p) => p.some(x => x.url.includes('script.google.com'));
const hayNode = (p) => p.some(x => x.url.includes('api.test'));
const OK = (extra) => ({ status: 200, data: Object.assign({ ok: true }, extra) });

let n = 0;
async function caso(nombre, fn) {
  n++;
  try { await fn(); console.log(`ok   ${n}. ${nombre}`); }
  catch (e) { console.error(`FAIL ${n}. ${nombre}`); console.error(e); process.exitCode = 1; }
}

(async () => {
  await caso('ENTRADAS_NODE está ACTIVADO en index.html (rama de activación)', () => {
    assert.match(SRC, /\nvar ENTRADAS_NODE = true;/);
  });

  // ── flag apagado: camino GAS intacto ──
  await caso('flag OFF: cargar/guardar/agotado/eliminar usan SOLO GAS (nunca Node)', async () => {
    const e = crearEntorno({ flag: false });
    e.setCargar();
    await e.ctx.__cargarReal();
    e.valores.meId = ''; await e.ctx.guardarEntrada();
    e.valores.meId = 'ENT-1'; await e.ctx.toggleAgotado({ id: 'ENT-1', agotado: false, nombre: 'n', precio: 1 }, '14 ROCA');
    await e.ctx.eliminarEntrada();
    assert.ok(e.pedidos.length >= 4); assert.ok(hayGas(e.pedidos)); assert.ok(!hayNode(e.pedidos));
    assert.ok(e.pedidos.some(p => p.url.includes('accion=obtenerEntradas')));
    assert.ok(e.pedidos.some(p => p.url.includes('accion=guardarEntrada')));
    assert.ok(e.pedidos.some(p => p.url.includes('accion=eliminarEntrada')));
  });
  await caso('flag OFF: el "guardado local" histórico de GAS se conserva (no se tocó)', async () => {
    const e = crearEntorno({ flag: false, respuestas: {} });
    e.ctx.fetch = async () => { throw new Error('caído'); };
    await e.ctx.guardarEntrada();
    assert.ok(e.toasts.some(t => /Guardada localmente/.test(t[0])));
  });

  // ── flag encendido: lectura ──
  await caso('flag ON: cargar hace GET /api/entradas con Bearer y NO toca GAS', async () => {
    const data = { '14 ROCA': [{ id: 'ENT-1', nombre: 'x' }] };
    const e = crearEntorno({ flag: true, respuestas: { 'GET ': OK({ entradas: data }) } });
    await e.ctx.cargarEntradas();
    assert.strictEqual(e.pedidos.length, 1);
    assert.strictEqual(e.pedidos[0].url, 'https://api.test/api/entradas'); assert.strictEqual(e.pedidos[0].metodo, 'GET');
    assert.strictEqual(e.pedidos[0].headers.Authorization, 'Bearer TOKEN123');
    assert.deepStrictEqual(e.ctx.entradasData, data); assert.ok(!hayGas(e.pedidos));
  });
  await caso('flag ON: error 401/403/502/red al cargar -> aviso con el motivo, SIN fallback a GAS', async () => {
    for (const [r, re] of [[{ status: 401, data: { error: 'x' } }, /sesión venció/], [{ status: 403, data: { error: 'x' } }, /permiso/], [{ status: 502, data: { ok: false, error: 'detalle interno' } }, /No se pudo completar/], ['RED', /No se pudieron cargar/]]) {
      const e = crearEntorno({ flag: true, respuestas: { 'GET ': r } });
      e.ctx.entradasData = { viejo: [1] };
      await e.ctx.cargarEntradas();
      assert.ok(e.toasts.some(t => re.test(t[0]) && t[1] === 'error'), JSON.stringify(e.toasts));
      assert.ok(!hayGas(e.pedidos)); assert.ok(!e.toasts.some(t => /detalle interno/.test(t[0])));
    }
  });

  // ── flag encendido: alta / edición ──
  await caso('flag ON: alta -> POST sin id, precio NUMÉRICO, whitelist de campos; cierra modal y recarga', async () => {
    const e = crearEntorno({ flag: true, respuestas: { 'POST ': OK({ id: 'ENT-9' }) }, campos: { mePrecio: '1500,5' } });
    e.setCargar();
    await e.ctx.guardarEntrada();
    const p = e.pedidos[0];
    assert.strictEqual(p.metodo, 'POST'); assert.strictEqual(p.url, 'https://api.test/api/entradas');
    assert.deepStrictEqual(p.body, { sucursal: '14 ROCA', nombre: 'Evento X', precio: 1500.5, fecha: '2026-12-31', obs: 'o', agotado: false, lugar: 'Estadio' });
    assert.strictEqual(p.headers['Content-Type'], 'application/json');
    assert.strictEqual(e.estado.modalCerrado, 1); assert.strictEqual(e.estado.cargas, 1); assert.ok(!hayGas(e.pedidos));
  });
  await caso('flag ON: edición -> PUT /:id (el id va en la URL, no en el body)', async () => {
    const e = crearEntorno({ flag: true, respuestas: { 'PUT /ENT-5': OK({ id: 'ENT-5' }) }, campos: { meId: 'ENT-5' } });
    e.setCargar(); await e.ctx.guardarEntrada();
    assert.strictEqual(e.pedidos[0].metodo, 'PUT'); assert.strictEqual(e.pedidos[0].url, 'https://api.test/api/entradas/ENT-5');
    assert.ok(!('id' in e.pedidos[0].body));
  });
  await caso('flag ON: si Node rechaza (400/403/409/502/red) el modal QUEDA ABIERTO, se muestra el error y NO hay guardado local ni GAS', async () => {
    for (const r of [{ status: 400, data: { ok: false, error: 'Falta el lugar del evento' } }, { status: 403, data: {} }, { status: 409, data: { error: 'Conflicto X' } }, { status: 503, data: {} }, { status: 502, data: { error: 'interno' } }, 'RED']) {
      const e = crearEntorno({ flag: true, respuestas: { 'POST ': r } });
      e.setCargar(); await e.ctx.guardarEntrada();
      assert.strictEqual(e.estado.modalCerrado, 0, JSON.stringify(r)); assert.strictEqual(e.estado.cargas, 0);
      assert.ok(e.toasts.length === 1 && e.toasts[0][1] === 'error', JSON.stringify(e.toasts));
      assert.deepStrictEqual(e.ctx.entradasData, {}); assert.ok(!hayGas(e.pedidos));
      assert.ok(!e.toasts.some(t => /localmente/.test(t[0])));
    }
    const e = crearEntorno({ flag: true, respuestas: { 'POST ': { status: 400, data: { error: 'Falta el lugar del evento' } } } });
    await e.ctx.guardarEntrada(); assert.match(e.toasts[0][0], /Falta el lugar del evento/); // 4xx muestra el mensaje de validación
  });
  await caso('flag ON: validaciones del front (lugar, nombre, precio inválido) frenan ANTES de pedir nada', async () => {
    for (const campos of [{ meLugar: '' }, { meNombre: '' }, { mePrecio: '' }, { mePrecio: 'abc' }, { mePrecio: '-5' }]) {
      const e = crearEntorno({ flag: true, campos }); await e.ctx.guardarEntrada();
      assert.strictEqual(e.pedidos.length, 0, JSON.stringify(campos)); assert.strictEqual(e.estado.modalCerrado, 0);
    }
  });

  // ── agotado ──
  await caso('flag ON: agotado -> PATCH /:id/agotado con {agotado:boolean} únicamente (sirve en registros viejos sin lugar)', async () => {
    const e = crearEntorno({ flag: true, respuestas: { 'PATCH /ENT-1/agotado': OK({ agotado: true }) } });
    const ent = { id: 'ENT-1', agotado: false, nombre: 'Viejo', precio: 1, lugar: '' };
    e.ctx.entradasData = { '14 ROCA': [ent] };
    await e.ctx.toggleAgotado(ent, '14 ROCA');
    assert.deepStrictEqual(e.pedidos.map(p => [p.metodo, p.url]), [['PATCH', 'https://api.test/api/entradas/ENT-1/agotado']]);
    assert.deepStrictEqual(e.pedidos[0].body, { agotado: true });
    assert.strictEqual(e.ctx.entradasData['14 ROCA'][0].agotado, true);
    assert.ok(e.toasts.some(t => /agotado/.test(t[0])));
  });
  await caso('flag ON: si el PATCH falla se REVIERTE el cambio optimista y se avisa (no queda un falso "agotado")', async () => {
    for (const r of [{ status: 403, data: {} }, { status: 502, data: {} }, 'RED']) {
      const e = crearEntorno({ flag: true, respuestas: { 'PATCH /ENT-1/agotado': r } });
      const ent = { id: 'ENT-1', agotado: false, nombre: 'V', precio: 1 };
      e.ctx.entradasData = { '14 ROCA': [ent] };
      await e.ctx.toggleAgotado(ent, '14 ROCA');
      assert.strictEqual(e.ctx.entradasData['14 ROCA'][0].agotado, false, JSON.stringify(r));
      assert.ok(e.toasts.some(t => t[1] === 'error')); assert.ok(!hayGas(e.pedidos));
    }
  });

  // ── eliminar ──
  await caso('flag ON: eliminar -> DELETE /:id; ok cierra y recarga; error deja el modal abierto y NO borra localmente', async () => {
    let e = crearEntorno({ flag: true, respuestas: { 'DELETE /ENT-3': OK({ id: 'ENT-3' }) }, campos: { meId: 'ENT-3' } });
    e.setCargar(); await e.ctx.eliminarEntrada();
    assert.deepStrictEqual([e.pedidos[0].metodo, e.pedidos[0].url], ['DELETE', 'https://api.test/api/entradas/ENT-3']);
    assert.strictEqual(e.estado.modalCerrado, 1); assert.strictEqual(e.estado.cargas, 1);
    for (const r of [{ status: 403, data: {} }, { status: 404, data: { error: 'Entrada no encontrada' } }, { status: 502, data: {} }, 'RED']) {
      e = crearEntorno({ flag: true, respuestas: { 'DELETE /ENT-3': r }, campos: { meId: 'ENT-3' } });
      e.ctx.entradasData = { '14 ROCA': [{ id: 'ENT-3' }] }; e.setCargar();
      await e.ctx.eliminarEntrada();
      assert.strictEqual(e.estado.modalCerrado, 0); assert.strictEqual(e.ctx.entradasData['14 ROCA'].length, 1);
      assert.ok(e.toasts[0][1] === 'error'); assert.ok(!hayGas(e.pedidos));
    }
  });
  await caso('flag ON: el ID se codifica en la URL (no permite inyectar rutas)', async () => {
    const e = crearEntorno({ flag: true, respuestas: {}, campos: { meId: '../x?y=1' } });
    await e.ctx.eliminarEntrada();
    assert.strictEqual(e.pedidos[0].url, 'https://api.test/api/entradas/..%2Fx%3Fy%3D1');
  });

  console.log(process.exitCode ? '\nHAY FALLOS' : `\n${n} ok, 0 fallos`);
})();
