const knowledge = require('./knowledge.json');

// ─────────────────────────────────────────────
// INVENTARIO
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// BÚSQUEDAS DE PRODUCTO
// ─────────────────────────────────────────────

function buscarMasBarato(categoria) {
  const inventario = knowledge.inventario || {};
  const productos = inventario[categoria]?.productos;
  if (!productos || productos.length === 0) return null;
  const sorted = [...productos].sort((a, b) => {
    const precioA = parseInt(String(a.precio).replace(/[^0-9]/g, '')) || 0;
    const precioB = parseInt(String(b.precio).replace(/[^0-9]/g, '')) || 0;
    return precioA - precioB;
  });
  return sorted[0];
}

function buscarMasBaratoGlobal() {
  const inventario = knowledge.inventario || {};
  let masBarato = null;
  let precioMin = Infinity;
  for (const cat of Object.values(inventario)) {
    for (const prod of (cat.productos || [])) {
      const precio = parseInt(String(prod.precio).replace(/[^0-9]/g, '')) || 0;
      if (precio > 0 && precio < precioMin) {
        precioMin = precio;
        masBarato = prod;
      }
    }
  }
  return masBarato;
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

// ─────────────────────────────────────────────
// DETECCIÓN DE CATEGORÍA
// ─────────────────────────────────────────────

function detectarCategoriaEnMensaje(mensaje) {
  const msg = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Orden importa: más específico primero
  if (msg.includes('sofa cama') || msg.includes('sofacama') || msg.includes('sofas cama')) return 'sofas_camas';
  if (msg.includes('sofa modular') || msg.includes('modular')) return 'sofas_modulares';
  if (msg.includes('mesa noche') || msg.includes('mesa de noche')) return 'mesas_noche';
  if (msg.includes('mesa tv') || msg.includes('mesa de tv') || msg.includes('mesa television') || msg.includes('mesa tele')) return 'mesas_tv';
  if (msg.includes('mesa centro') || msg.includes('mesa de centro') || msg.includes('mesa sala') || msg.includes('mesa de sala')) return 'mesas_centro';
  if (msg.includes('mesa auxiliar') || msg.includes('mesas auxiliar')) return 'mesas_auxiliares';

  const tieneSilla = msg.includes('silla') || msg.includes('sillas') || msg.includes('asiento');
  const tieneComedor = msg.includes('comedor') || msg.includes('comida') || msg.includes('para comer') || msg.includes('comer');
  const tieneSala = msg.includes('sala') || msg.includes('auxiliar') || msg.includes('rededora');
  const tieneBarra = msg.includes('barra') || msg.includes('alto') || msg.includes('meson') || msg.includes('cocina');

  if (tieneSilla && tieneComedor) return 'sillas_comedor';
  if (tieneSilla && tieneSala) return 'sillas_auxiliares';
  if (tieneSilla && tieneBarra) return 'sillas_barra';

  if (msg.includes('silla auxiliar') || msg.includes('sillon') || msg.includes('sillón')) return 'sillas_auxiliares';
  if (msg.includes('silla barra') || msg.includes('silla de barra')) return 'sillas_barra';
  if (msg.includes('silla comedor') || msg.includes('silla de comedor')) return 'sillas_comedor';

  if (msg.includes('comedor') || msg.includes('comedores') || (msg.includes('base') && !msg.includes('cama'))) return 'bases_comedores';
  if (msg.includes('cama') || msg.includes('camas')) return 'camas';
  if (msg.includes('sofa') || msg.includes('sofas')) return 'sofas';
  if (msg.includes('colchon') || msg.includes('colchones')) return 'colchones';
  if (msg.includes('escritorio') || msg.includes('escritorios')) return 'escritorios';
  if (msg.includes('cajonero') || msg.includes('cajones') || msg.includes('bife') || msg.includes('bifes')) return 'cajoneros_bifes';

  return null;
}

// ─────────────────────────────────────────────
// DETECCIÓN DE OBJECIÓN DE PRECIO
// ─────────────────────────────────────────────

/**
 * Detecta cuando el usuario expresa que el precio es muy alto
 */
function detectarObjecionPrecio(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const patrones = [
    /muy caro/i,
    /demasiado caro/i,
    /es caro/i,
    /esta caro/i,
    /\bcaro\b/i,
    /costoso/i,
    /no tengo tanto/i,
    /no me alcanza/i,
    /muy costoso/i,
    /muy elevado/i,
    /precio alto/i,
    /sale mucho/i,
    /sale muy/i,
    /mas barato/i,
    /mas economico/i,
    /mas barata/i,
    /mas economica/i,
    /algo mas economico/i,
    /algo mas barato/i,
    /hay algo menor/i,
    /menor precio/i,
    /opcion economica/i,
    /opcion barata/i,
    /presupuesto ajustado/i,
    /no llego a ese precio/i,
    /fuera de mi presupuesto/i,
    /excede mi presupuesto/i,
    /no cuento con tanto/i,
    /no tengo ese dinero/i,
    /muy elevado/i
  ];
  return patrones.some(p => p.test(msg));
}

/**
 * Genera respuesta automática cuando el usuario objeta el precio,
 * buscando la alternativa más barata en la misma categoría.
 */
function generarRespuestaObjecion(categoriaActual, productoActual) {
  if (!categoriaActual) return null;

  const inventario = knowledge.inventario || {};
  const cat = inventario[categoriaActual];
  if (!cat || !cat.productos || cat.productos.length === 0) return null;

  const productoActualNombre = productoActual?.nombre || '';
  const precioActual = parseInt(String(productoActual?.precio || '0').replace(/[^0-9]/g, '')) || Infinity;

  // Buscar productos más baratos que el actual
  const masBaratos = cat.productos
    .filter(p => {
      const precio = parseInt(String(p.precio).replace(/[^0-9]/g, '')) || 0;
      return precio < precioActual && p.nombre !== productoActualNombre && precio > 0;
    })
    .sort((a, b) => {
      const pA = parseInt(String(a.precio).replace(/[^0-9]/g, '')) || 0;
      const pB = parseInt(String(b.precio).replace(/[^0-9]/g, '')) || 0;
      return pA - pB;
    });

  if (masBaratos.length === 0) {
    // No hay más baratos, mostrar el más barato de la categoría
    const masBaratoGeneral = buscarMasBarato(categoriaActual);
    if (!masBaratoGeneral || masBaratoGeneral.nombre === productoActualNombre) {
      return `Entiendo tu preocupación. ${productoActualNombre ? `La ${productoActualNombre}` : 'Este producto'} es nuestra opción más accesible en esta categoría. Te puedo conectar con un asesor para ver si hay alguna promoción disponible. ¿Te interesa? 😊`;
    }
    return null;
  }

  const alternativa = masBaratos[0];
  const segunda = masBaratos[1];

  let respuesta = `Entiendo! Te muestro opciones más accesibles 😊\n\n`;
  respuesta += `💡 *Opción económica:*\n`;
  respuesta += `📌 ${alternativa.nombre} - ${alternativa.precio}\n`;
  if (alternativa.material) respuesta += `🪵 Material: ${alternativa.material}\n`;
  if (alternativa.medidas) respuesta += `📏 Medidas: ${alternativa.medidas}\n`;

  if (segunda) {
    respuesta += `\n📌 ${segunda.nombre} - ${segunda.precio}\n`;
    if (segunda.material) respuesta += `🪵 Material: ${segunda.material}\n`;
  }

  respuesta += `\n¿Alguna de estas te interesa? 😊`;
  return respuesta;
}

// ─────────────────────────────────────────────
// VALIDACIÓN DE RESPUESTA DE GEMINI
// ─────────────────────────────────────────────

/**
 * Detecta si Gemini está siendo poco confiable en su respuesta
 */
function respuestaGeminiEsConfiable(texto) {
  if (!texto) return false;

  const señalesDeIncertidumbre = [
    'no tengo información',
    'no tengo esa información',
    'no cuento con',
    'posiblemente',
    'creo que',
    'podría ser',
    'quizás',
    'no estoy segura de',
    'no puedo confirmar',
    'no tengo certeza',
    'podría costar',
    'aproximadamente',
    'tal vez cueste',
    'debería costar'
  ];

  const textoLower = texto.toLowerCase();
  return !señalesDeIncertidumbre.some(s => textoLower.includes(s));
}

/**
 * Detecta si Gemini inventó un precio que no está en el inventario
 */
function detectarPrecioInventado(texto) {
  // Busca patrones de precio en el texto
  const preciosEnTexto = [];
  const matchesPrecio = texto.matchAll(/\$[\d.,]+/g);
  for (const m of matchesPrecio) {
    const num = parseInt(m[0].replace(/[^0-9]/g, ''));
    if (num > 0) preciosEnTexto.push(num);
  }

  if (preciosEnTexto.length === 0) return false;

  // Verificar que esos precios existan en el inventario
  const preciosInventario = new Set();
  for (const cat of Object.values(knowledge.inventario || {})) {
    for (const prod of (cat.productos || [])) {
      const precio = parseInt(String(prod.precio).replace(/[^0-9]/g, '')) || 0;
      if (precio > 0) preciosInventario.add(precio);
    }
  }

  // Si algún precio mencionado no existe en inventario, puede ser inventado
  return preciosEnTexto.some(p => !preciosInventario.has(p));
}

module.exports = {
  generarInventarioTexto,
  buscarMasBarato,
  buscarMasBaratoGlobal,
  buscarProductosRelacionados,
  buscarProductoEnHistorial,
  detectarCategoriaEnMensaje,
  detectarObjecionPrecio,
  generarRespuestaObjecion,
  respuestaGeminiEsConfiable,
  detectarPrecioInventado
};
