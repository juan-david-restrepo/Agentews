-- Script para actualizar la base de datos de DeCasa Bot
-- Ejecutar este script si ya tienes la BD y solo necesitas añadir la funcionalidad de citas

-- Añadir columnas a estado_usuario si no existen
ALTER TABLE estado_usuario ADD COLUMN IF NOT EXISTS agendando_cita BOOLEAN DEFAULT FALSE;
ALTER TABLE estado_usuario ADD COLUMN IF NOT EXISTS paso_agenda INT DEFAULT 0;
ALTER TABLE estado_usuario ADD COLUMN IF NOT EXISTS datos_agenda JSON;

-- Crear tabla citas si no existe
CREATE TABLE IF NOT EXISTS citas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    nombre VARCHAR(100),
    dia VARCHAR(20),
    hora VARCHAR(20),
    razon TEXT,
    ubicacion INT,
    estado ENUM('pendiente', 'confirmada', 'cancelada') DEFAULT 'pendiente',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Verificar que se crearon correctamente
DESCRIBE estado_usuario;
DESCRIBE citas;