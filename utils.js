const knowledge = require('./knowledge.json');

const generarInventarioTexto = () => {
  let texto = '\n\n=== INVENTARIO DE PRODUCTOS ===\n';

  const categorias = Object.values(knowledge.inventario || {});
  for (const categoria of categorias) {
    texto += `\n${categoria.nombre}:\n`;
    for (const producto of categoria.productos) {
      texto += `- ${producto.nombre} | Material: ${producto.material} | Precio: ${producto.precio}\n`;
    }
  }

  return texto;
};

function buscarMasBarato(categoria) {
  const inventario = knowledge.inventario || {};
  const productos = inventario[categoria]?.productos;
  if (!productos || productos.length === 0) return null;

  const sorted = [...productos].sort((a, b) => {
    const precioA = parseInt(a.precio.replace(/[^0-9]/g, '')) || 0;
    const precioB = parseInt(b.precio.replace(/[^0-9]/g, '')) || 0;
    return precioA - precioB;
  });

  return sorted[0];
}

function buscarProductosRelacionados(categoria, limite = 3) {
  const inventario = knowledge.inventario || {};
  const productos = inventario[categoria]?.productos;
  if (!productos || productos.length === 0) return [];
  return productos.slice(0, limite);
}

function buscarProductoEnHistorial(history, mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  const categorias = Object.values(knowledge.inventario || {});

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      const nombreLower = producto.nombre.toLowerCase();
      if (mensajeLower.includes(nombreLower.substring(0, 8))) {
        return { nombre: producto.nombre, precio: producto.precio };
      }
    }
  }
  return null;
}

function detectarCategoriaEnMensaje(mensaje) {
  const msg = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-záéíóúñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const mapeoCategorias = {
    'sofa cama': 'sofacamas',
    'sofas cama': 'sofacamas',
    'sofacamas': 'sofacamas',
    'sofacama': 'sofacamas',
    'comedor': 'bases_comedores',
    'comedores': 'bases_comedores',
    'base': 'bases_comedores',
    'bases': 'bases_comedores',
    'cama': 'camas',
    'camas': 'camas',
    'silla': null,
    'sillas': null,
    'sofa': 'sofas',
    'sofas': 'sofas',
    'mesa': null,
    'mesas': null,
    'mesa noche': 'mesas_noche',
    'mesa de noche': 'mesas_noche',
    'mesa tv': 'mesas_tv',
    'mesa de tv': 'mesas_tv',
    'mesa centro': 'mesas_centro',
    'mesa de centro': 'mesas_centro',
    'mesa auxiliar': 'mesas_auxiliares',
    'mesa auxiliar': 'mesas_auxiliares',
    'silla auxiliar': 'sillas_auxiliares',
    'silla auxiliar': 'sillas_auxiliares',
    'silla barra': 'sillas_barra',
    'silla de barra': 'sillas_barra'
  };

  const tieneSilla = msg.includes('silla') || msg.includes('sillas');
  const tieneComedor = msg.includes('comedor') || msg.includes('comida') || msg.includes('para comer') || msg.includes('para comer');
  const tieneSala = msg.includes('sala') || msg.includes('auxiliar') || msg.includes('rededora');
  const tieneBarra = msg.includes('barra') || msg.includes('alto') || msg.includes('mesón') || msg.includes('meson');

  if (tieneSilla && tieneComedor) {
    return 'sillas_comedor';
  }
  if (tieneSilla && tieneSala) {
    return 'sillas_auxiliares';
  }
  if (tieneSilla && tieneBarra) {
    return 'sillas_barra';
  }

  for (const [key, value] of Object.entries(mapeoCategorias)) {
    if (msg.includes(key)) {
      return value;
    }
  }

  return null;
}

module.exports = {
  generarInventarioTexto,
  buscarMasBarato,
  buscarProductosRelacionados,
  buscarProductoEnHistorial,
  detectarCategoriaEnMensaje
};
