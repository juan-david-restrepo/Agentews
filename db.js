require('dotenv').config();
const mysql = require('mysql2/promise');

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

  if (usuarios.length > 0) {
    await pool.query(
      'UPDATE usuarios SET last_interaction = NOW() WHERE id = ?',
      [usuarios[0].id]
    );
    return usuarios[0];
  }

  const [result] = await pool.query(
    'INSERT INTO usuarios (telefono, created_at, last_interaction) VALUES (?, NOW(), NOW())',
    [telefonoLimpio]
  );

  const [nuevoUsuario] = await pool.query(
    'SELECT * FROM usuarios WHERE id = ?',
    [result.insertId]
  );

  await pool.query(
    'INSERT INTO estado_usuario (usuario_id) VALUES (?)',
    [result.insertId]
  );

  return nuevoUsuario[0];
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
      greeting_sent: false
    };
  }

  const estado = estados[0];
  return {
    categoria_actual: estado.categoria_actual,
    producto_pendiente: estado.producto_pendiente ? JSON.parse(estado.producto_pendiente) : null,
    carrito: estado.carrito ? JSON.parse(estado.carrito) : [],
    transferido: !!estado.transferido,
    greeting_sent: !!estado.greeting_sent
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

  if (campos.length === 0) return;

  valores.push(usuarioId);

  await pool.query(
    `UPDATE estado_usuario SET ${campos.join(', ')} WHERE usuario_id = ?`,
    valores
  );
}

async function agregarAlCarrito(telefono, producto, precio) {
  const estado = await getEstado(telefono);
  const carrito = estado.carrito || [];
  carrito.push({ producto, precio });
  await updateEstado(telefono, { carrito });
}

async function verCarrito(telefono) {
  const estado = await getEstado(telefono);
  return estado.carrito || [];
}

async function limpiarCarrito(telefono) {
  await updateEstado(telefono, { carrito: [] });
}

async function guardarProductoPendiente(telefono, producto, precio) {
  await updateEstado(telefono, { producto_pendiente: { producto, precio } });
}

async function getProductoPendiente(telefono) {
  const estado = await getEstado(telefono);
  return estado.producto_pendiente;
}

async function clearProductoPendiente(telefono) {
  await updateEstado(telefono, { producto_pendiente: null });
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
  await updateEstado(telefono, { categoria_actual: categoria });
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
  setCategoriaActual
};
