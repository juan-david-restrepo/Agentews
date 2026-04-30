require('dotenv').config();
const mysql = require('mysql2/promise');

function parseJSONField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'decasa_bot',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function getOrCreateUsuario(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT * FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  let usuario;
  if (usuarios.length > 0) {
    await pool.query(
      'UPDATE usuarios SET last_interaction = NOW() WHERE id = ?',
      [usuarios[0].id]
    );
    usuario = usuarios[0];
  } else {
    const [result] = await pool.query(
      'INSERT INTO usuarios (telefono, created_at, last_interaction) VALUES (?, NOW(), NOW())',
      [telefonoLimpio]
    );
    const [nuevoUsuario] = await pool.query(
      'SELECT * FROM usuarios WHERE id = ?',
      [result.insertId]
    );
    usuario = nuevoUsuario[0];
  }

  const [estados] = await pool.query(
    'SELECT 1 FROM estado_usuario WHERE usuario_id = ?',
    [usuario.id]
  );
  if (estados.length === 0) {
    await pool.query(
      'INSERT INTO estado_usuario (usuario_id) VALUES (?)',
      [usuario.id]
    );
  }

  return usuario;
}

async function getHistorial(telefono, limite = 12) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) {
    return [];
  }

  const usuarioId = usuarios[0].id;

  const [mensajes] = await pool.query(
    `SELECT role, contenido FROM conversaciones 
     WHERE usuario_id = ? 
     ORDER BY created_at DESC LIMIT ?`,
    [usuarioId, limite]
  );

  return mensajes.reverse().map(m => ({
    role: m.role,
    content: m.contenido
  }));
}

async function addMensaje(telefono, role, contenido) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) {
    const usuario = await getOrCreateUsuario(telefono);
    await pool.query(
      'INSERT INTO conversaciones (usuario_id, role, contenido, created_at) VALUES (?, ?, ?, NOW())',
      [usuario.id, role, contenido]
    );
  } else {
    await pool.query(
      'INSERT INTO conversaciones (usuario_id, role, contenido, created_at) VALUES (?, ?, ?, NOW())',
      [usuarios[0].id, role, contenido]
    );
  }
}

async function getEstado(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) {
    return {
      categoria_actual: null,
      producto_pendiente: null,
      carrito: [],
      transferido: false,
      greeting_sent: false
    };
  }

  const [estados] = await pool.query(
    'SELECT * FROM estado_usuario WHERE usuario_id = ?',
    [usuarios[0].id]
  );

  if (estados.length === 0) {
    return {
      categoria_actual: null,
      producto_pendiente: null,
      carrito: [],
      transferido: false,
      greeting_sent: false,
      agendando_cita: false,
      paso_agenda: 0,
      datos_agenda: null
    };
  }

  const estado = estados[0];
  return {
    categoria_actual: estado.categoria_actual,
    producto_pendiente: parseJSONField(estado.producto_pendiente),
    ultimo_producto: parseJSONField(estado.ultimo_producto),
    carrito: parseJSONField(estado.carrito),
    transferido: !!estado.transferido,
    greeting_sent: !!estado.greeting_sent,
    tiene_pedido: !!estado.tiene_pedido,
    agendando_cita: !!estado.agendando_cita,
    paso_agenda: estado.paso_agenda || 0,
    datos_agenda: parseJSONField(estado.datos_agenda),
    candidatos_pendientes: parseJSONField(estado.candidatos_pendientes)
  };
}

async function updateEstado(telefono, datos) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) {
    await getOrCreateUsuario(telefono);
    return updateEstado(telefono, datos);
  }

  const usuarioId = usuarios[0].id;
  const campos = [];
  const valores = [];

  if (datos.categoria_actual !== undefined) {
    campos.push('categoria_actual = ?');
    valores.push(datos.categoria_actual);
  }

  if (datos.producto_pendiente !== undefined) {
    campos.push('producto_pendiente = ?');
    valores.push(datos.producto_pendiente ? JSON.stringify(datos.producto_pendiente) : null);
  }

  if (datos.carrito !== undefined) {
    campos.push('carrito = ?');
    valores.push(JSON.stringify(datos.carrito));
  }

  if (datos.transferido !== undefined) {
    campos.push('transferido = ?');
    valores.push(datos.transferido);
  }

  if (datos.greeting_sent !== undefined) {
    campos.push('greeting_sent = ?');
    valores.push(datos.greeting_sent);
  }

  if (datos.tiene_pedido !== undefined) {
    campos.push('tiene_pedido = ?');
    valores.push(datos.tiene_pedido);
  }

  if (datos.agendando_cita !== undefined) {
    campos.push('agendando_cita = ?');
    valores.push(datos.agendando_cita);
  }

  if (datos.paso_agenda !== undefined) {
    campos.push('paso_agenda = ?');
    valores.push(datos.paso_agenda);
  }

  if (datos.datos_agenda !== undefined) {
    campos.push('datos_agenda = ?');
    valores.push(datos.datos_agenda ? JSON.stringify(datos.datos_agenda) : null);
  }

  if (datos.candidatos_pendientes !== undefined) {
    campos.push('candidatos_pendientes = ?');
    valores.push(datos.candidatos_pendientes ? JSON.stringify(datos.candidatos_pendientes) : null);
  }

  if (campos.length === 0) return;

  valores.push(usuarioId);

  await pool.query(
    `UPDATE estado_usuario SET ${campos.join(', ')} WHERE usuario_id = ?`,
    valores
  );
}

async function agregarAlCarrito(telefono, producto, precio, cantidad = 1) {
  const estado = await getEstado(telefono);
  const carrito = estado.carrito || [];
  
  const itemExistente = carrito.find(item => item.producto === producto);
  if (itemExistente) {
    itemExistente.cantidad = (itemExistente.cantidad || 1) + cantidad;
  } else {
    carrito.push({ producto, precio, cantidad });
  }
  
  await updateEstado(telefono, { carrito });
  return true;
}

async function verCarrito(telefono) {
  const estado = await getEstado(telefono);
  return estado.carrito || [];
}

async function limpiarCarrito(telefono) {
  await updateEstado(telefono, { carrito: [] });
}

async function guardarProductoPendiente(telefono, producto, precio, cantidad = null) {
  await updateEstado(telefono, { producto_pendiente: { producto, precio, cantidad } });
}

async function getProductoPendiente(telefono) {
  const estado = await getEstado(telefono);
  return estado.producto_pendiente;
}

async function clearProductoPendiente(telefono) {
  await updateEstado(telefono, { producto_pendiente: null });
}

async function setTransferenciaMedidaPendiente(telefono, producto) {
  await updateEstado(telefono, { transferencia_medida_pendiente: producto });
}

async function getTransferenciaMedidaPendiente(telefono) {
  const estado = await getEstado(telefono);
  return estado.transferencia_medida_pendiente;
}

async function clearTransferenciaMedidaPendiente(telefono) {
  await updateEstado(telefono, { transferencia_medida_pendiente: null });
}

async function guardarCandidatosPendientes(telefono, candidatos, mensajeOriginal) {
  await updateEstado(telefono, { candidatos_pendientes: { candidatos, mensajeOriginal, timestamp: Date.now() } });
}

async function getCandidatosPendientes(telefono) {
  const estado = await getEstado(telefono);
  return estado.candidatos_pendientes;
}

async function clearCandidatosPendientes(telefono) {
  await updateEstado(telefono, { candidatos_pendientes: null });
}

async function estaTransferida(telefono) {
  const estado = await getEstado(telefono);
  return estado.transferido;
}

async function marcarTransferida(telefono) {
  await updateEstado(telefono, { transferido: true });
}

async function haEnviadoSaludo(telefono) {
  const estado = await getEstado(telefono);
  return estado.greeting_sent;
}

async function marcarSaludoEnviado(telefono) {
  await updateEstado(telefono, { greeting_sent: true });
}

async function getCategoriaActual(telefono) {
  const estado = await getEstado(telefono);
  return estado.categoria_actual;
}

async function setCategoriaActual(telefono, categoria) {
  const catString = typeof categoria === 'string' ? categoria : (categoria?.nombre || categoria?.categoria || String(categoria) || null);
  await updateEstado(telefono, { categoria_actual: catString });
}

async function getUltimoProducto(telefono) {
  const estado = await getEstado(telefono);
  return estado.ultimo_producto;
}

async function setUltimoProducto(telefono, producto) {
  await updateEstado(telefono, { ultimo_producto: producto });
}

async function guardarPedido(telefono, producto, precio, cantidad = 1) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;
  
  await pool.query(
    'INSERT INTO pedidos (usuario_id, producto, precio, cantidad) VALUES (?, ?, ?, ?)',
    [usuarios[0].id, producto, precio, cantidad]
  );
  
  return true;
}

async function getPedidos(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return [];
  
  const [pedidos] = await pool.query(
    'SELECT producto, precio, cantidad, estado, created_at FROM pedidos WHERE usuario_id = ? ORDER BY created_at DESC',
    [usuarios[0].id]
  );
  
  return pedidos;
}

async function limpiarConversaciones(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;
  
  await pool.query(
    'DELETE FROM conversaciones WHERE usuario_id = ?',
    [usuarios[0].id]
  );
  
  return true;
}

async function tienePedido(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;
  
  const [estados] = await pool.query(
    'SELECT tiene_pedido FROM estado_usuario WHERE usuario_id = ?',
    [usuarios[0].id]
  );

  if (estados.length === 0) return false;
  return !!estados[0].tiene_pedido;
}

async function marcarPedidoConfirmado(telefono) {
  await updateEstado(telefono, { tiene_pedido: true });
}

async function resetearEstadoSinPedido(telefono) {
  await updateEstado(telefono, {
    categoria_actual: null,
    producto_pendiente: null,
    carrito: [],
    greeting_sent: false,
    tiene_pedido: false,
    agendando_cita: false,
    paso_agenda: 0,
    datos_agenda: null,
    candidatos_pendientes: null
  });
}

async function verificarYLimpiarInactividad(telefono, timeoutMinutos = 20) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id, last_interaction FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return;
  
  const usuario = usuarios[0];
  const ultimaInteraccion = new Date(usuario.last_interaction);
  const ahora = new Date();
  
  const diffMinutos = (ahora - ultimaInteraccion) / (1000 * 60);
  
  if (diffMinutos >= timeoutMinutos) {
    const tienePedidoConfirmado = await tienePedido(telefono);
    
    if (!tienePedidoConfirmado) {
      await limpiarConversaciones(telefono);
      await resetearEstadoSinPedido(telefono);
      console.log(`🧹 Limpiando conversaciones inactivas para ${telefonoLimpio} (${diffMinutos.toFixed(1)} min sin compra)`);
    } else {
      console.log(`⏭️ Usuario ${telefonoLimpio} inactivo ${diffMinutos.toFixed(1)} min pero tiene pedidos - no se limpia`);
    }
  }
}

async function actualizarLastInteraction(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return;
  
  await pool.query(
    'UPDATE usuarios SET last_interaction = NOW() WHERE id = ?',
    [usuarios[0].id]
  );
}

async function limpiarConversacionesInactivas(timeoutMinutos = 10) {
  try {
    const [usuarios] = await pool.query(
      `SELECT telefono FROM usuarios 
       WHERE last_interaction < NOW() - INTERVAL ? MINUTE`,
      [timeoutMinutos]
    );
    
    for (const usuario of usuarios) {
      await verificarYLimpiarInactividad(usuario.telefono, timeoutMinutos);
    }
    
    if (usuarios.length > 0) {
      console.log(`🧹 Limpieza programada: ${usuarios.length} usuarios inactivos procesados`);
    }
  } catch (error) {
    console.error('Error en limpieza programada:', error.message);
  }
}

async function iniciarAgendacion(telefono) {
  await updateEstado(telefono, { agendando_cita: true, paso_agenda: 1, datos_agenda: { nombre: '', ubicacion: null, dia: '', hora: '', razon: '', esSabado: false } });
}

async function cancelarAgendacion(telefono) {
  await updateEstado(telefono, { agendando_cita: false, paso_agenda: 0, datos_agenda: null });
}

async function getEstaAgendando(telefono) {
  const estado = await getEstado(telefono);
  return !!estado.agendando_cita;
}

async function getPasoAgendacion(telefono) {
  const estado = await getEstado(telefono);
  return estado.paso_agenda || 0;
}

async function setPasoAgendacion(telefono, paso) {
  await updateEstado(telefono, { paso_agenda: paso });
}

async function getDatosAgendacion(telefono) {
  const estado = await getEstado(telefono);
  return estado.datos_agenda || { nombre: '', ubicacion: null, dia: '', hora: '', razon: '', esSabado: false };
}

async function guardarDatosAgendacion(telefono, datos) {
  await updateEstado(telefono, { datos_agenda: datos });
}

async function guardarCita(telefono, datos) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');
  
  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;
  
  await pool.query(
    `INSERT INTO citas (usuario_id, telefono, nombre, dia, hora, razon, ubicacion) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [usuarios[0].id, telefonoLimpio, datos.nombre, datos.dia, datos.hora, datos.razon, datos.ubicacion]
  );
  
  await cancelarAgendacion(telefono);
  return true;
}

module.exports = {
  pool,
  getOrCreateUsuario,
  getHistorial,
  addMensaje,
  getEstado,
  updateEstado,
  agregarAlCarrito,
  verCarrito,
  limpiarCarrito,
  guardarProductoPendiente,
  getProductoPendiente,
  clearProductoPendiente,
  estaTransferida,
  marcarTransferida,
  haEnviadoSaludo,
  marcarSaludoEnviado,
  getCategoriaActual,
  setCategoriaActual,
  getUltimoProducto,
  setUltimoProducto,
  guardarPedido,
  getPedidos,
  limpiarConversaciones,
  tienePedido,
  marcarPedidoConfirmado,
  resetearEstadoSinPedido,
  verificarYLimpiarInactividad,
  actualizarLastInteraction,
  iniciarAgendacion,
  cancelarAgendacion,
  getEstaAgendando,
  getPasoAgendacion,
  setPasoAgendacion,
  getDatosAgendacion,
  guardarDatosAgendacion,
  guardarCita,
  limpiarConversacionesInactivas,
  setTransferenciaMedidaPendiente,
  getTransferenciaMedidaPendiente,
  clearTransferenciaMedidaPendiente,
  guardarCandidatosPendientes,
  getCandidatosPendientes,
  clearCandidatosPendientes
};
