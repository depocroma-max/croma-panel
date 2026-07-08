// ============================================================
//  CROMA — Sistema de Rotación y Reposición
//  Code.gs — Servidor principal
// ============================================================

var SHEET_ID         = '1sk1e9YHCGDV86xyNBGAbTrZ2zCEsnUyPF3nT6HAA5vo';
var SHEET_ID_JORNADA = '1xEV_SoGcezbS1KTWsFfXMETiiP87gkImC47XuEC_U7U';
var HOJA_PEDIDOS     = 'Pedidos';
var HOJA_ESTADOS     = 'Estados';

// ------------------------------------------------------------
// ROUTER — maneja páginas HTML y llamadas API desde GitHub Pages
// ------------------------------------------------------------
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var accion = params.accion || '';
  var page   = params.page   || 'form';

  // ── Llamadas API desde GitHub Pages ──────────────────────
  if (accion === 'obtenerPedidos') {
    var dias = parseInt(params.dias || '30', 10);
    return jsonResponse(obtenerPedidos(dias));
  }
  if (accion === 'actualizarEstado') {
    return jsonResponse(actualizarEstado(
      params.id, params.cod, params.talle, params.estado, params.obsExtra || ''
    ));
  }
  if (accion === 'obtenerCajas') {
    return jsonResponse(obtenerCajas(params.fecha || ''));
  }
  if (accion === 'obtenerEmpleados') {
    return jsonResponse(obtenerEmpleados(e.parameter));
  }
  if (accion === 'obtenerTodosEmpleados') {
    return jsonResponse(obtenerTodosEmpleados());
  }
  if (accion === 'obtenerHorarios') {
    return jsonResponse(obtenerHorarios(e.parameter));
  }
  if (accion === 'guardarHorario') {
    try {
      var datos = JSON.parse(params.datos || '{}');
      return jsonResponse(guardarHorario(datos));
    } catch(err) {
      return jsonResponse({ ok: false, error: 'JSON inválido: ' + err.message });
    }
  }
  if (accion === 'guardarPedido') {
    try {
      var datos = JSON.parse(params.datos || '{}');
      return jsonResponse(guardarPedido(datos));
    } catch(e) {
      return jsonResponse({ ok: false, error: 'JSON inválido: ' + e.message });
    }
  }
  if (accion === 'obtenerEntradas') {
    return jsonResponse(obtenerEntradas(params.sucursal || ''));
  }
  if (accion === 'guardarEntrada') {
    try {
      var datos = JSON.parse(params.datos || '{}');
      return jsonResponse(guardarEntrada(datos));
    } catch(err) {
      return jsonResponse({ ok: false, error: 'JSON inválido: ' + err.message });
    }
  }
  if (accion === 'eliminarEntrada') {
    return jsonResponse(eliminarEntrada(params.id || '', params.sucursal || ''));
  }

  // ── Páginas HTML (Apps Script interno) ───────────────────
  if (page === 'panel') {
    return HtmlService.createTemplateFromFile('Panel')
      .evaluate()
      .setTitle('Panel Rotación · Croma')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('Formulario')
    .evaluate()
    .setTitle('Cierre de Caja · Croma')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ------------------------------------------------------------
// doPost — maneja llamadas POST desde GitHub Pages
// ------------------------------------------------------------
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.accion === 'guardarHorario') return jsonResponse(guardarHorario(payload));
    return jsonResponse({ ok: false, error: 'Acción no reconocida' });
  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// Devuelve JSON con headers CORS para que GitHub Pages pueda leer la respuesta
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// GUARDAR PEDIDO — llamado desde el Formulario vía fetch
// ------------------------------------------------------------
function guardarPedido(datos) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var hoja = obtenerOCrearHoja(ss, HOJA_PEDIDOS);

    // Encabezados si la hoja está vacía
    if (hoja.getLastRow() === 0) {
      hoja.appendRow([
        'ID', 'Timestamp', 'Fecha', 'Sucursal', 'Encargado',
        'Tipo', 'Num', 'COD', 'Talle', 'Color', 'Cantidad', 'Observacion',
        'Remitos', 'Salidas', 'Diferencia_Cupon',
        'Mantenimiento', 'Ausente', 'Franquero', 'GustoFranquero'
      ]);
      hoja.setFrozenRows(1);
      hoja.getRange(1, 1, 1, 19).setFontWeight('bold')
        .setBackground('#8B1A1A').setFontColor('white');
    }

    var timestamp = new Date();
    var fechaForm = datos.fecha || Utilities.formatDate(timestamp, 'America/Argentina/Neuquen', 'yyyy-MM-dd');
    var id = 'CR-' + timestamp.getTime();

    // Campos generales del cierre
    var generales = {
      id: id,
      ts: timestamp,
      fecha: fechaForm,
      sucursal: datos.sucursal,
      encargado: datos.encargado,
      remitos: datos.remitos,
      salidas: datos.salidas,
      diferencia: datos.diferencia,
      mantenimiento: datos.mantenimiento || '',
      ausente: datos.ausente || '',
      franquero: datos.franqueros ? datos.franqueros.map(function(f){ return f.nombre + (f.eval ? ' ('+f.eval+')' : ''); }).join(' | ') : (datos.franquero || ''),
      gustoFranquero: ''
    };

    var filas = [];

    // Procesar pedidos (tipo PEDIDO)
    var pedidos = datos.pedidos || [];
    pedidos.forEach(function(p, i) {
      if (p.cod && p.cod.trim() !== '') {
        filas.push([
          generales.id, generales.ts, generales.fecha,
          generales.sucursal, generales.encargado,
          'PEDIDO', i + 1,
          p.cod.trim().toUpperCase(), p.talle || '', p.color || '', p.cantidad || 1, p.obs || '',
          generales.remitos, generales.salidas, generales.diferencia,
          generales.mantenimiento, generales.ausente, generales.franquero, generales.gustoFranquero
        ]);
      }
    });

    // Procesar reposiciones (tipo REPOSICION)
    var repos = datos.reposiciones || [];
    repos.forEach(function(r, i) {
      if (r.cod && r.cod.trim() !== '') {
        filas.push([
          generales.id, generales.ts, generales.fecha,
          generales.sucursal, generales.encargado,
          'REPOSICION', i + 1,
          r.cod.trim().toUpperCase(), r.talle || '', r.color || '', r.cantidad || 1, r.obs || '',
          generales.remitos, generales.salidas, generales.diferencia,
          generales.mantenimiento, generales.ausente, generales.franquero, generales.gustoFranquero
        ]);
      }
    });

    // Si no hay artículos, igual guardar una fila de cierre general
    if (filas.length === 0) {
      filas.push([
        generales.id, generales.ts, generales.fecha,
        generales.sucursal, generales.encargado,
        'CIERRE', 0, '', '', '', 0, '',
        generales.remitos, generales.salidas, generales.diferencia,
        generales.mantenimiento, generales.ausente, generales.franquero, generales.gustoFranquero
      ]);
    }

    filas.forEach(function(fila) { hoja.appendRow(fila); });

    return { ok: true, id: id, filas: filas.length };

  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// OBTENER PEDIDOS POR RANGO — llamado desde el Panel
// ------------------------------------------------------------
function obtenerPedidos(dias) {
  try {
    var tz = 'America/Argentina/Neuquen';
    var ss = SpreadsheetApp.openById(SHEET_ID);

    var hojaPedidos = ss.getSheetByName(HOJA_PEDIDOS);
    var hojaEstados = ss.getSheetByName(HOJA_ESTADOS);
    if (!hojaPedidos || hojaPedidos.getLastRow() <= 1) return { ok: true, pedidos: [] };

    // Construir mapa de estados en memoria (una sola lectura)
    var mapaEstados = {};
    if (hojaEstados && hojaEstados.getLastRow() > 1) {
      var dataEstados = hojaEstados.getDataRange().getValues();
      for (var e = 1; e < dataEstados.length; e++) {
        var key = dataEstados[e][0] + '|' + dataEstados[e][1] + '|' + dataEstados[e][2];
        mapaEstados[key] = { estado: dataEstados[e][3] || 'SinVer', obsExtra: dataEstados[e][5] || '' };
      }
    }

    // Calcular fecha límite
    var ahora = new Date();
    var limite = new Date(ahora.getTime() - (dias * 24 * 60 * 60 * 1000));
    var fechaLimite = Utilities.formatDate(limite, tz, 'yyyy-MM-dd');

    var datos = hojaPedidos.getDataRange().getValues();
    var pedidos = [];

    for (var i = 1; i < datos.length; i++) {
      var fila = datos[i];
      if (fila[5] === 'CIERRE' || fila[7] === '') continue;

      var fechaFila = '';
      try {
        fechaFila = fila[2] instanceof Date
          ? Utilities.formatDate(fila[2], tz, 'yyyy-MM-dd')
          : String(fila[2]).substring(0, 10);
      } catch(ex) { fechaFila = String(fila[2]).substring(0, 10); }

      if (fechaFila < fechaLimite) continue;

      var horaStr = '';
      try {
        horaStr = fila[1] instanceof Date
          ? Utilities.formatDate(fila[1], tz, 'HH:mm')
          : '';
      } catch(ex) {}

      var key = fila[0] + '|' + fila[7] + '|' + fila[8];
      var estadoObj = mapaEstados[key] || { estado: 'SinVer', obsExtra: '' };
      var estado   = estadoObj.estado;
      var obsExtra = estadoObj.obsExtra;

      pedidos.push({
        id:        fila[0],
        hora:      horaStr,
        fecha:     fechaFila,
        sucursal:  fila[3],
        encargado: fila[4],
        tipo:      fila[5],
        cod:       fila[7],
        talle:     fila[8],
        color:     fila[9],
        cantidad:  fila[10],
        obs:       fila[11] || '',
        estado:    estado,
        obsExtra:  obsExtra || ''
      });
    }

    return { ok: true, pedidos: pedidos };

  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// ACTUALIZAR ESTADO — llamado desde el Panel
// ------------------------------------------------------------
function actualizarEstado(id, cod, talle, nuevoEstado, obsExtra) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var hoja = obtenerOCrearHoja(ss, HOJA_ESTADOS);

    if (hoja.getLastRow() === 0) {
      hoja.appendRow(['ID', 'COD', 'Talle', 'Estado', 'Timestamp', 'ObsExtra']);
      hoja.setFrozenRows(1);
    }

    var datos = hoja.getDataRange().getValues();
    var key = id + '|' + cod + '|' + talle;
    var encontrado = false;

    for (var i = 1; i < datos.length; i++) {
      var filaKey = datos[i][0] + '|' + datos[i][1] + '|' + datos[i][2];
      if (filaKey === key) {
        hoja.getRange(i + 1, 4).setValue(nuevoEstado);
        hoja.getRange(i + 1, 5).setValue(new Date());
        if (obsExtra) hoja.getRange(i + 1, 6).setValue(obsExtra);
        encontrado = true;
        break;
      }
    }

    if (!encontrado) {
      hoja.appendRow([id, cod, talle, nuevoEstado, new Date(), obsExtra || '']);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// OBTENER CAJAS POR FECHA — llamado desde el Panel
// ------------------------------------------------------------
function obtenerCajas(fechaParam) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var hoja = ss.getSheetByName(HOJA_PEDIDOS);
    if (!hoja || hoja.getLastRow() <= 1) return { ok: true, cajas: [] };

    var tz = 'America/Argentina/Neuquen';
    var fechaBuscar = fechaParam
      ? fechaParam
      : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    var datos = hoja.getDataRange().getValues();
    var mapa = {};

    for (var i = 1; i < datos.length; i++) {
      var fila = datos[i];
      var fechaFila = '';
      try {
        fechaFila = fila[2] instanceof Date
          ? Utilities.formatDate(fila[2], tz, 'yyyy-MM-dd')
          : String(fila[2]).substring(0, 10);
      } catch(e) { fechaFila = String(fila[2]).substring(0, 10); }

      if (fechaFila !== fechaBuscar) continue;

      var suc = fila[3];
      if (!suc) continue;

      if (!mapa[suc]) {
        var horaStr = '';
        try {
          horaStr = fila[1] instanceof Date
            ? Utilities.formatDate(fila[1], tz, 'HH:mm')
            : '';
        } catch(e) {}

        mapa[suc] = {
          sucursal:      suc,
          encargado:     fila[4]  || '',
          hora:          horaStr,
          fecha:         fechaFila,
          remitos:       fila[12] || '',
          salidas:       fila[13] || '',
          diferencia:    fila[14] || '',
          mantenimiento: fila[15] || '',
          ausente:       fila[16] || '',
          franquero:     fila[17] || '',
          gustoFranquero:fila[18] || '',
          alerta: (fila[12] === 'No' || fila[13] === 'No' || fila[14] === 'Si')
        };
      }
    }

    var orden = ['01 PASEO','05 WAVE','09 CIPO SAN MARTIN','10 PERITO MORENO','12 CENTENARIO','14 ROCA'];
    var cajas = orden.map(function(s) {
      return mapa[s] || { sucursal: s, sinCierre: true };
    });

    return { ok: true, cajas: cajas, fecha: fechaBuscar };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// OBTENER EMPLEADOS — lee de DATOS GENERALES filtrando por LOCAL
// ?accion=obtenerEmpleados&sucursal=01 PASEO
// ------------------------------------------------------------
function obtenerEmpleados(params) {
  try {
    var sucursal = params.sucursal || '';
    if (!sucursal) return { ok: false, error: 'Falta sucursal' };

    // Mapear nombre del panel → valor en columna LOCAL de DATOS GENERALES
    var mapaLocal = {
      '01 PASEO':           'PASEO',
      '05 WAVE':            'WAVE',
      '09 CIPO SAN MARTIN': 'CIPO',
      '10 PERITO MORENO':   'PERITO',
      '12 CENTENARIO':      'CENTE',
      '14 ROCA':            'ROCA'
    };
    var localBuscar = mapaLocal[sucursal] || sucursal;

    var ss   = SpreadsheetApp.openById(SHEET_ID_JORNADA);
    var hoja = ss.getSheetByName('DATOS GENERALES');
    if (!hoja) return { ok: false, error: 'No se encontró la hoja DATOS GENERALES' };

    var datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return { ok: true, empleados: [] };

    // Buscar columnas LOCAL y EMPLEADO/A
    var headers  = datos[0].map(function(h){ return String(h).toUpperCase().trim(); });
    var colLocal = headers.indexOf('LOCAL');
    var colEmp   = headers.indexOf('EMPLEADO/A');
    if (colEmp < 0) colEmp = headers.indexOf('EMPLEADO');
    if (colLocal < 0 || colEmp < 0) return { ok: false, error: 'No se encontraron columnas LOCAL o EMPLEADO/A' };

    // Extraer empleados únicos de esa sucursal
    var empleadosSet = {};
    var empleados    = [];
    for (var i = 1; i < datos.length; i++) {
      var local  = String(datos[i][colLocal] || '').trim().toUpperCase();
      if (local !== localBuscar) continue;
      // La columna tiene formato "34 MATI TERUEL" — mantener número
      var nombre = String(datos[i][colEmp] || '').trim();

      if (nombre && !empleadosSet[nombre]) {
        empleadosSet[nombre] = true;
        empleados.push(nombre);
      }
    }

    return { ok: true, empleados: empleados };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// OBTENER TODOS LOS EMPLEADOS — lee DATOS GENERALES sin filtrar por local
// ?accion=obtenerTodosEmpleados
// ------------------------------------------------------------
function obtenerTodosEmpleados() {
  try {
    var ss   = SpreadsheetApp.openById(SHEET_ID_JORNADA);
    var hoja = ss.getSheetByName('DATOS GENERALES');
    if (!hoja) return { ok: false, error: 'No se encontró la hoja DATOS GENERALES' };

    var datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return { ok: true, empleados: [] };

    var headers  = datos[0].map(function(h){ return String(h).toUpperCase().trim(); });
    var colLocal = headers.indexOf('LOCAL');
    var colEmp   = headers.indexOf('EMPLEADO/A');
    if (colEmp < 0) colEmp = headers.indexOf('EMPLEADO');

    var mapaLocal = {
      'PASEO': '01 PASEO', 'WAVE': '05 WAVE', 'CIPO': '09 CIPO SAN MARTIN',
      'PERITO': '10 PERITO MORENO', 'CENTE': '12 CENTENARIO', 'ROCA': '14 ROCA',
      'DEPO': 'DEPO'
    };

    var empleadosSet = {};
    var empleados    = [];
    for (var i = 1; i < datos.length; i++) {
      var nombre = String(datos[i][colEmp] || '').trim();
      if (!nombre) continue;
      var local  = String(datos[i][colLocal] || '').trim().toUpperCase();
      var sucursal = mapaLocal[local] || local;
      if (!empleadosSet[nombre]) {
        empleadosSet[nombre] = true;
        empleados.push({ nombre: nombre, sucursal: sucursal });
      }
    }

    return { ok: true, empleados: empleados };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// OBTENER HORARIOS — lee la hoja HORARIOS filtrada por semana
// ?accion=obtenerHorarios&semana=2026-W22
// ------------------------------------------------------------
function obtenerHorarios(params) {
  try {
    var semana = params.semana || '';
    if (!semana) return { ok: false, error: 'Falta semana' };

    var ss   = SpreadsheetApp.openById(SHEET_ID);
    var hoja = ss.getSheetByName('HORARIOS');
    if (!hoja) return { ok: true, horarios: {} };

    var datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return { ok: true, horarios: {} };

    // Estructura: SEMANA | SUCURSAL | EMPLEADO | LUN | MAR | MIÉ | JUE | VIE | SÁB | DOM | ENCARGADO | TIMESTAMP
    var headers   = datos[0].map(function(h){ return String(h).toUpperCase().trim(); });
    var iSemana   = headers.indexOf('SEMANA');
    var iSucursal = headers.indexOf('SUCURSAL');
    var iEmpleado = headers.indexOf('EMPLEADO');
    var iLun      = headers.indexOf('LUN');
    var iMar      = headers.indexOf('MAR');
    var iMie      = headers.indexOf('MIÉ'); if (iMie < 0) iMie = headers.indexOf('MIE');
    var iJue      = headers.indexOf('JUE');
    var iVie      = headers.indexOf('VIE');
    var iSab      = headers.indexOf('SÁB'); if (iSab < 0) iSab = headers.indexOf('SAB');
    var iDom      = headers.indexOf('DOM');

    var horarios = {};

    for (var i = 1; i < datos.length; i++) {
      var fila = datos[i];
      if (String(fila[iSemana]).trim() !== semana) continue;

      var suc = String(fila[iSucursal] || '').trim();
      var emp = String(fila[iEmpleado] || '').trim();
      if (!suc || !emp) continue;

      if (!horarios[suc]) horarios[suc] = [];
      horarios[suc].push({
        empleado: emp,
        lun: String(fila[iLun] || '').trim(),
        mar: String(fila[iMar] || '').trim(),
        mie: String(fila[iMie] || '').trim(),
        jue: String(fila[iJue] || '').trim(),
        vie: String(fila[iVie] || '').trim(),
        sab: String(fila[iSab] || '').trim(),
        dom: String(fila[iDom] || '').trim()
      });
    }

    return { ok: true, horarios: horarios };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// GUARDAR HORARIO — recibe POST con el horario completo de una sucursal
// Reemplaza todas las filas de esa sucursal+semana y guarda las nuevas
// ------------------------------------------------------------
function guardarHorario(payload) {
  try {
    var semana    = payload.semana    || '';
    var sucursal  = payload.sucursal  || '';
    var encargado = payload.encargado || '';
    var filas     = payload.filas     || [];

    if (!semana || !sucursal) {
      return { ok: false, error: 'Datos incompletos' };
    }

    var ss   = SpreadsheetApp.openById(SHEET_ID);
    var hoja = ss.getSheetByName('HORARIOS');

    // Crear hoja si no existe
    if (!hoja) {
      hoja = ss.insertSheet('HORARIOS');
      hoja.appendRow(['SEMANA','SUCURSAL','EMPLEADO','LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM','ENCARGADO','TIMESTAMP']);
      hoja.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#0d0d0d').setFontColor('#ffffff');
      hoja.setFrozenRows(1);
    }

    var datos     = hoja.getDataRange().getValues();
    var headers   = datos[0].map(function(h){ return String(h).toUpperCase().trim(); });
    var iSemana   = headers.indexOf('SEMANA');
    var iSucursal = headers.indexOf('SUCURSAL');

    // Borrar filas existentes de esta semana+sucursal (de abajo para arriba)
    for (var i = datos.length - 1; i >= 1; i--) {
      if (String(datos[i][iSemana]).trim()   === semana &&
          String(datos[i][iSucursal]).trim()  === sucursal) {
        hoja.deleteRow(i + 1);
      }
    }

    // Insertar nuevas filas
    var timestamp = new Date().toISOString();
    filas.forEach(function(f) {
      hoja.appendRow([
        semana, sucursal, f.empleado || '',
        f.lun || 'LIBRE', f.mar || 'LIBRE', f.mie || 'LIBRE',
        f.jue || 'LIBRE', f.vie || 'LIBRE', f.sab || 'LIBRE',
        f.dom || 'LIBRE', encargado, timestamp
      ]);
    });

    return { ok: true };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// ENTRADAS — catálogo de tickets por sucursal
// Hoja: ENTRADAS  →  ID | SUCURSAL | NOMBRE | PRECIO | FECHA | OBS | TIMESTAMP
// ------------------------------------------------------------
var HOJA_ENTRADAS = 'ENTRADAS';

function asegurarHojaEntradas(ss) {
  var hoja = ss.getSheetByName(HOJA_ENTRADAS);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_ENTRADAS);
    hoja.appendRow(['ID', 'SUCURSAL', 'NOMBRE', 'PRECIO', 'FECHA', 'OBS', 'TIMESTAMP', 'AGOTADO']);
    hoja.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#0d0d0d').setFontColor('#ffffff');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// ?accion=obtenerEntradas  o  ?accion=obtenerEntradas&sucursal=01+PASEO
function obtenerEntradas(sucursalFiltro) {
  try {
    var ss   = SpreadsheetApp.openById(SHEET_ID);
    var hoja = ss.getSheetByName(HOJA_ENTRADAS);
    if (!hoja || hoja.getLastRow() <= 1) return { ok: true, entradas: {} };

    var datos = hoja.getDataRange().getValues();
    var entradas = {};

    for (var i = 1; i < datos.length; i++) {
      var fila = datos[i];
      var id      = String(fila[0] || '').trim();
      var suc     = String(fila[1] || '').trim();
      var nombre  = String(fila[2] || '').trim();
      var precio  = fila[3] || 0;
      var fecha   = '';
      try {
        fecha = fila[4] instanceof Date && fila[4]
          ? Utilities.formatDate(fila[4], 'America/Argentina/Neuquen', 'yyyy-MM-dd')
          : String(fila[4] || '').trim().substring(0, 10);
      } catch(e) {}
      var obs     = String(fila[5] || '').trim();
      var agotado = String(fila[7] || '').trim().toUpperCase() === 'SI';

      if (!id || !nombre) continue;
      if (sucursalFiltro && suc !== sucursalFiltro) continue;

      if (!entradas[suc]) entradas[suc] = [];
      entradas[suc].push({ id: id, sucursal: suc, nombre: nombre, precio: precio, fecha: fecha, obs: obs, agotado: agotado });
    }

    return { ok: true, entradas: entradas };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ?accion=guardarEntrada&datos={id?,sucursal,nombre,precio,fecha?,obs?}
// Sin id → crea nueva fila. Con id → actualiza la existente.
function guardarEntrada(datos) {
  try {
    var ss   = SpreadsheetApp.openById(SHEET_ID);
    var hoja = asegurarHojaEntradas(ss);

    var id       = String(datos.id      || '').trim();
    var sucursal = String(datos.sucursal|| '').trim();
    var nombre   = String(datos.nombre  || '').trim();
    var precio   = parseFloat(datos.precio) || 0;
    var fecha    = String(datos.fecha   || '').trim();
    var obs      = String(datos.obs     || '').trim();
    var agotado  = datos.agotado ? 'SI' : '';
    var ts       = new Date().toISOString();

    if (!sucursal || !nombre) return { ok: false, error: 'Faltan campos obligatorios (sucursal, nombre)' };

    if (id) {
      // Buscar fila existente y actualizar
      var filas = hoja.getDataRange().getValues();
      for (var i = 1; i < filas.length; i++) {
        if (String(filas[i][0]).trim() === id) {
          hoja.getRange(i + 1, 2).setValue(sucursal);
          hoja.getRange(i + 1, 3).setValue(nombre);
          hoja.getRange(i + 1, 4).setValue(precio);
          hoja.getRange(i + 1, 5).setValue(fecha);
          hoja.getRange(i + 1, 6).setValue(obs);
          hoja.getRange(i + 1, 7).setValue(ts);
          hoja.getRange(i + 1, 8).setValue(agotado);
          return { ok: true, id: id };
        }
      }
    }

    // Nueva entrada
    var nuevoId = 'ENT-' + new Date().getTime();
    hoja.appendRow([nuevoId, sucursal, nombre, precio, fecha, obs, ts, agotado]);
    return { ok: true, id: nuevoId };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ?accion=eliminarEntrada&id=ENT-123&sucursal=01+PASEO
function eliminarEntrada(id, sucursal) {
  try {
    if (!id) return { ok: false, error: 'Falta id' };

    var ss   = SpreadsheetApp.openById(SHEET_ID);
    var hoja = ss.getSheetByName(HOJA_ENTRADAS);
    if (!hoja || hoja.getLastRow() <= 1) return { ok: false, error: 'Hoja no encontrada' };

    var filas = hoja.getDataRange().getValues();
    for (var i = filas.length - 1; i >= 1; i--) {
      if (String(filas[i][0]).trim() === id) {
        hoja.deleteRow(i + 1);
        return { ok: true };
      }
    }

    return { ok: false, error: 'Entrada no encontrada' };

  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function obtenerEstado(id, cod, talle) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var hoja = ss.getSheetByName(HOJA_ESTADOS);
    if (!hoja || hoja.getLastRow() <= 1) return 'SinVer';

    var datos = hoja.getDataRange().getValues();
    var key = id + '|' + cod + '|' + talle;

    for (var i = 1; i < datos.length; i++) {
      var filaKey = datos[i][0] + '|' + datos[i][1] + '|' + datos[i][2];
      if (filaKey === key) return datos[i][3] || 'SinVer';
    }
    return 'SinVer';
  } catch(e) { return 'SinVer'; }
}

function obtenerOCrearHoja(ss, nombre) {
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) hoja = ss.insertSheet(nombre);
  return hoja;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}