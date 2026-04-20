require('dotenv').config();
const mysql = require('mysql2/promise');

async function initDB() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT || 3306
    });

    const dbName = process.env.DB_NAME || 'decasa_bot';

    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
    console.log(`✅ Base de datos '${dbName}' creada o verificada`);

    await connection.query(`USE ${dbName}`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        telefono VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla usuarios creada o verificada');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS conversaciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id INT NOT NULL,
        role ENUM('user', 'assistant') NOT NULL,
        contenido TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
        INDEX idx_usuario_fecha (usuario_id, created_at)
      )
    `);
    console.log('✅ Tabla conversaciones creada o verificada');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS estado_usuario (
        usuario_id INT PRIMARY KEY,
        categoria_actual VARCHAR(50),
        producto_pendiente JSON,
        carrito JSON,
        transferido BOOLEAN DEFAULT FALSE,
        greeting_sent BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Tabla estado_usuario creada o verificada');

    console.log('\n🎉 Base de datos lista!\n');
    
  } catch (error) {
    console.error('❌ Error inicializando BD:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  initDB();
}

module.exports = { initDB };