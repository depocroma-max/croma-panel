/**
 * Bloqueo de escritura de Entradas en GAS (code.js): con la propiedad
 * ENTRADAS_ESCRITURA_BLOQUEADA=true, guardarEntrada y eliminarEntrada NO tocan la hoja;
 * sin ella (o con otro valor) se comportan como siempre. obtenerEntradas no se ve afectada.
 * Corre code.js real en node:vm con SpreadsheetApp/PropertiesService simulados.
 * Uso: node tests/entradas-gas-bloqueo.test.js
 */
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');

function entorno(props, throwProps) {
  const toques = { escrituras: 0, lecturas: 0 };
  const hoja = {
    getLastRow: () => 2, getDataRange: () => ({ getValues: () => { toques.lecturas++; return [['ID', 'SUCURSAL', 'NOMBRE'], ['ENT-1', '14 ROCA', 'A', 1, '', '', '', '', 'L']]; } }),
    getRange: () => ({ setValue() { toques.escrituras++; return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, getValue: () => 'LUGAR' }),
    appendRow: () => { toques.escrituras++; }, deleteRow: () => { toques.escrituras++; }, setFrozenRows() {},
  };
  const ctx = {
    SHEET_ID: 'x', HOJA_ENTRADAS: 'ENTRADAS',
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => hoja, insertSheet: () => hoja }) },
    PropertiesService: { getScriptProperties: () => { if (throwProps) throw new Error('sin permiso'); return { getProperty: (k) => props[k] }; } },
    Utilities: { formatDate: () => '2026-12-31' }, Logger: { log() {} }, console,
  };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { ctx, toques };
}
const alta = { sucursal: '14 ROCA', nombre: 'X', precio: 1, lugar: 'L' };
let n = 0; function caso(nombre, fn) { n++; try { fn(); console.log(`ok   ${n}. ${nombre}`); } catch (e) { console.error(`FAIL ${n}. ${nombre}`); console.error(e); process.exitCode = 1; } }

caso('bloqueado=true: guardarEntrada (alta y edición) y eliminarEntrada devuelven error y NO escriben', () => {
  for (const v of ['true', 'TRUE', ' true ']) {
    const { ctx, toques } = entorno({ ENTRADAS_ESCRITURA_BLOQUEADA: v.trim() });
    for (const r of [ctx.guardarEntrada(alta), ctx.guardarEntrada(Object.assign({ id: 'ENT-1' }, alta)), ctx.eliminarEntrada('ENT-1', '14 ROCA')]) {
      assert.strictEqual(r.ok, false); assert.match(r.error, /deshabilitada/);
    }
    assert.strictEqual(toques.escrituras, 0); assert.strictEqual(toques.lecturas, 0);
  }
});
caso('sin propiedad, con "false" o vacía: se comporta como siempre (escribe)', () => {
  for (const props of [{}, { ENTRADAS_ESCRITURA_BLOQUEADA: 'false' }, { ENTRADAS_ESCRITURA_BLOQUEADA: '' }]) {
    const { ctx, toques } = entorno(props);
    assert.strictEqual(ctx.guardarEntrada(alta).ok, true); assert.ok(toques.escrituras > 0);
    const e2 = entorno(props); assert.strictEqual(e2.ctx.eliminarEntrada('ENT-1', '14 ROCA').ok, true);
  }
});
caso('si PropertiesService falla, NO bloquea (comportamiento previo) en vez de romper el módulo', () => {
  const { ctx } = entorno({}, true); assert.strictEqual(ctx.guardarEntrada(alta).ok, true);
});
caso('obtenerEntradas (lectura) sigue funcionando con el bloqueo activo', () => {
  const { ctx } = entorno({ ENTRADAS_ESCRITURA_BLOQUEADA: 'true' });
  const r = ctx.obtenerEntradas(''); assert.strictEqual(r.ok, true); assert.strictEqual(Object.values(r.entradas).flat().length, 1);
});
caso('el bloqueo solo toca Entradas: otras funciones de escritura de code.js no lo referencian', () => {
  const usos = SRC.split('entradasEscrituraBloqueada()').length - 1; // 1 definición/llamadas: guardar + eliminar
  assert.strictEqual((SRC.match(/entradasEscrituraBloqueada\(\)/g) || []).length, 3); // definición + 2 guardas
  assert.ok(usos >= 2);
});
console.log(process.exitCode ? '\nHAY FALLOS' : `\n${n} ok, 0 fallos`);
