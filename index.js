process.on('uncaughtException', (err) => {
  console.error('[FATAL] ERROR NO CAPTURADO:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] PROMESA RECHAZADA:', err);
});
process.on('exit', (code) => {
  console.log(`[SERVER] Proceso terminando con código: ${code}`);
});

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { MessagingResponse } = twilio.twiml;
const knowledge = require('./knowledge.json');
const { initDB } = require('./init-db');
const db = require('./db');
const { processRoomImage } = require('./image-processor');
const utils = require('./utils');

// ─────────────────────────────────────────────
// RATE LIMITING  (FIX #1)
// Evita spam de mensajes que disparan múltiples llamadas a Gemini
// ─────────────────────────────────────────────

const _rateLimitMap = new Map(); // telefono -> timestamp último mensaje procesado

function estaEnCooldown(telefono) {
  const ultima = _rateLimitMap.get(telefono) || 0;
  const ahora = Date.now();
  if (ahora - ultima < 1500) return true; // 1.5 segundos entre mensajes
  _rateLimitMap.set(telefono, ahora);
  return false;
}

// Limpiar el map cada hora para no acumular memoria
setInterval(() => {
  const limite = Date.now() - 60 * 60 * 1000;
  for (const [key, ts] of _rateLimitMap.entries()) {
    if (ts < limite) _rateLimitMap.delete(key);
  }
}, 60 * 60 * 1000);

// ─────────────────────────────────────────────
// VALIDACIÓN TWILIO
// ─────────────────────────────────────────────

function validateTwilioRequest(req, res, next) {
  if (!process.env.TWILIO_AUTH_TOKEN) return next();

  const twilioSignature = req.headers['x-twilio-signature'];

  if (!twilioSignature) {
    if (req.body && req.body.From) {
      console.warn('[TWILIO] Invalid signature - rejecting');
      return res.status(403).send('Forbidden');
    }
    return next();
  }

  const host = req.headers['x-forwarded-host'] || req.get('host');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}${req.originalUrl}`;

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    twilioSignature,
    url,
    req.body
  );

  if (!isValid) {
    console.warn('[TWILIO] Invalid signature - rejecting');
    return res.status(403).send('Forbidden');
  }

  next();
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(validateTwilioRequest);

app.use((err, req, res, next) => {
  console.error('[EXPRESS] Error no manejado:', err.message);
  res.status(500).send('Error interno del servidor');
});

// ─────────────────────────────────────────────
// GEMINI
// ─────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.5-flash-lite';

const SALUDO_INICIAL = `Hola! 👋 Soy Elena, tu asesora de DeCasa.

🏠 Especialistas en muebles de madera Flor Morado (más de 200 productos)
📍 Nuestras tiendas en Armenia y Pereira:
   - Av. Bolívar # 16 N 26, Armenia
   - Km 2 vía El Edén, Armenia
   - Km 1 vía Jardines, Armenia
   - CC Unicentro Pereira
   - Cra. 14 #11 - 93, Pereira

📦 Categorías: Sillas, Bases, Camas, Mesas, Sofás
🕐 Horario: L-V 8am-5pm | Sábado 8am-12pm

💬 Estoy para ayudarte a encontrar el mueble perfecto. 
   ¿Qué necesitas? 😊`;

const { generarInventarioTexto: generarInventarioTextoUtils } = utils;
const generarInventarioTexto = generarInventarioTextoUtils;

const SYSTEM_PROMPT = `Eres Elena, una vendedora amable y persuasiva de DeCasa. Tu objetivo es ayudar al cliente a encontrar el mueble perfecto y convencerlo de comprar.

PERFIL DE VENDEDORA:
- Nombre: Elena
- Empresa: DeCasa
- Especialidad: Muebles de madera Flor Morado de alta calidad
- Horario: Lunes a viernes de 8am a 5pm, Sábado 8am a 12pm
- Disponible en Armenia, Quindío y Pereira, Risaralda

DIRECCIONES DE NUESTRAS TIENDAS:
- Avenida Bolívar # 16 N 26, Armenia, Quindío
- Km 2 vía El Edén, Armenia, Quindío
- Km 1 vía Jardines, Armenia, Quindío
- CC Unicentro Pereira, Pereira, Risaralda
- Cra. 14 #11 - 93. Pereira, Risaralda

Cuando el cliente pregunte por ubicación, dirección o dónde están, proporciona las 5 direcciones disponibles y pregunta si desea agendar una visita.

INSTRUCCIONES IMPORTANTES - PRIORIDAD ABSOLUTA:
1. NUNCA inventes información sobre productos, precios o disponibilidad. Si no tienes la información EXACTA del inventario, DEBES decir: "No tengo esa información específica disponible."
2. Cuando no sepas algo, ofrece: "¿Te gustaría que te transfiera a un asesor para aclarar tu duda?"
3. SOLO menciona productos con precios si estás SEGURA de que existen en el inventario.
4. NUNCA des información sobre productos que NO están en el inventario.

REGLAS DE CONSULTA:
- Siempre consulta el inventario primero
- Si el producto NO está en el inventario, no lo menciones como disponible
- Si no sabes el precio exacto, no especules

INSTRUCCIONES DE VENTA:
1. Cuando el cliente pregunte por un producto, SIEMPRE ofrece 2-3 alternativas similares con precios
2. Destaca la calidad: "Madera Flor Morado, resistencia y elegancia"
3. Usa frases persuasivas: "Te recomiendo", "Es nuestra mejor opcion", "Excelente calidad-precio"
4. Cuando menciones productos, incluye el precio
5. Si el cliente duda por el precio, enfoca en la calidad y durabilidad, O sugiere la opción más económica de la categoría
6. Cierra siempre con una pregunta

REGLA IMPORTANTE SOBRE SILLAS Y COMEDORES:
- TODAS las sillas se venden POR UNIDAD, NO en paquetes
- Las sillas se venden POR SEPARADO de las bases de comedor

REGLA IMPORTANTE SOBRE COMPARACIONES:
- Si el cliente está indeciso entre varios productos, compara mostrando nombre, precio, material y medidas
- Recomienda la opción más económica como "mejor relación precio-calidad"

${generarInventarioTexto()}`;

// ─────────────────────────────────────────────
// IMPORTS DE UTILS
// ─────────────────────────────────────────────

const { buscarMasBarato: buscarMasBaratoUtils } = utils;
const buscarMasBarato = buscarMasBaratoUtils;
const { buscarProductosRelacionados: buscarProductosRelacionadosUtils } = utils;
const buscarProductosRelacionados = buscarProductosRelacionadosUtils;
const { buscarProductoEnHistorial: buscarProductoEnHistorialUtils } = utils;
const buscarProductoEnHistorial = buscarProductoEnHistorialUtils;
const { detectarCategoriaEnMensaje: detectarCategoriaEnMensajeUtils } = utils;
const detectarCategoriaEnMensaje = detectarCategoriaEnMensajeUtils;
const { detectarObjecionPrecio, generarRespuestaObjecion, respuestaGeminiEsConfiable, detectarPrecioInventado } = utils;

// ─────────────────────────────────────────────
// CARRITO (helpers)
// ─────────────────────────────────────────────

const MAX_ITEMS_CARRITO = 10;

async function agregarAlCarritoDB(from, producto, precio, cantidad = 1) {
  const items = await db.verCarrito(from);

  if (items.length >= MAX_ITEMS_CARRITO) {
    return { success: false, mensaje: `El carrito tiene máximo ${MAX_ITEMS_CARRITO} productos. Confirma tu compra o elimina algo.` };
  }

  const yaExiste = items.find(item => item.producto === producto);
  if (yaExiste) {
    return { success: false, mensaje: "Este producto ya está en el carrito. ¿Quieres confirmar la compra?" };
  }

  await db.agregarAlCarrito(from, producto, precio, cantidad);
  return { success: true, mensaje: null };
}

async function formatearCarrito(from) {
  const items = await db.verCarrito(from);
  if (!items || items.length === 0) return null;

  let mensaje = "🛒 Tu carrito:\n\n";
  let total = 0;

  items.forEach((item, index) => {
    const cantidad = item.cantidad || 1;
    const precioUnitario = parseInt(String(item.precio).replace(/[^0-9]/g, '')) || 0;
    const precioTotal = precioUnitario * cantidad;
    mensaje += `${index + 1}. ${item.producto} - ${item.precio}`;
    if (cantidad > 1) mensaje += ` (${cantidad} unidades)`;
    mensaje += `\n`;
    total += precioTotal;
  });

  mensaje += `\n─────────────────\n💰 Total: $${total.toLocaleString()}`;
  return { mensaje, total, items };
}

// ─────────────────────────────────────────────
// TRIGGERS DE COMPRA  (FIX #2)
// Eliminados los triggers genéricos como "perfecto", "bien", "muy bien"
// que confundían expresiones de cortesía con intención de compra
// ─────────────────────────────────────────────

const TRIGGERS_COMPRA_EXPLICITOS = [
  'si lo compro',
  'confirmo compra',
  'este me lo llevo',
  'confirmar compra',
  'confirmar pedido',
  'me lo llevo ya',
  'ya me lo llevo',
  'deseo proceder',
  'comprar ahora',
  'finalizar compra',
  'pedido confirmado',
  'ordenar ya',
  'quiero comprar',
  'me gustaría comprar',
  'dámelo',
  'me lo llevo',
  'lo tomo',
  'me quedo con',
  'me gustaría comprarlo',
  'lo quiero comprar',
  'me gustarían',
  'si me gustarían',
  'sí me gustarían'
];

// NOTA: se eliminarion "perfecto", "muy bien", "esta bien", "está bien", "bien", "si quiero", "si deseo"
// porque eran demasiado genéricos y activaban el flujo de compra en respuestas de cortesía

function detectarCompraExplicita(mensaje) {
  const msg = mensaje.toLowerCase();
  return TRIGGERS_COMPRA_EXPLICITOS.some(t => msg.includes(t));
}

// ─────────────────────────────────────────────
// DETECCIONES (sin cambios en las que funcionan bien)
// ─────────────────────────────────────────────

function esPreguntaInformativa(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /por qué/i, /porque/i, /debería/i, /convénzame/i,
    /argumento/i, /razón/i, /para qué/i,
    /me puedes dar/i, /dime por qué/i,
    /te parece que/i, /vale la pena/i, /me conviene/i,
    /\?/, /viene/i, /vienen/i, /incluye/i, /incluyen/i,
    /separado/i, /apart/i, /sale/i, /salen/i, /trae/i, /traen/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarComparacion(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /cual.*mejor/i, /cu(a|á)l.*mejor/i, /cual.*recomiend/i,
    /cual.*me.*conviene/i, /cual.*escojo/i, /cual.*elijo/i,
    /estoy.*entre/i, /no.*me.*decido/i, /no.*se.*cual/i,
    /indecis/i, /duda.*entre/i, /diferencia.*entre/i,
    /comparar/i, /compara/i, /comparacion/i,
    /recomiend/i, /mejor.*opcion/i, /cual.*elegir/i,
    /cual.*compro/i, /ayudame.*elegir/i, /ayudame.*decidir/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarFotoMultiple(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /foto.*de.*(las|los)\s*(dos|ambos|2)/i,
    /foto.*ambos/i, /foto.*ambas/i,
    /foto.*de.*los\s*dos/i, /foto.*de.*las\s*dos/i,
    /fotos.*de.*(ambos|ambas|los\s*dos|las\s*dos)/i,
    /foto.*de.*cada/i, /foto.*de.*tod/i,
    /foto.*de\s*(los|las)\s*(2|dos)/i
  ];
  return patrones.some(p => p.test(msg));
}

function necesitaSubtipo(mensaje, categoria) {
  const msg = mensaje.toLowerCase();

  if (msg.includes('comedor') || msg.includes('comida') || msg.includes('para comer')) {
    if (categoria === 'sillas_comedor' || categoria === null || categoria === 'bases_comedores') {
      return 'sillas_comedor';
    }
  }

  if (categoria === 'sillas_comedor' || categoria === null) {
    if (msg.includes('auxiliar') || msg.includes('rededora') || msg.includes('para sala')) return 'sillas_auxiliares';
    if (msg.includes('barra') || msg.includes('alto') || msg.includes('mesón') || msg.includes('meson')) return 'sillas_barra';
    const tieneSilla = msg.includes('silla') || msg.includes('sillas');
    if (tieneSilla && (msg === 'silla' || msg === 'sillas' || msg.includes('quiero una silla') || msg.includes('busco una silla'))) {
      return 'PEDIR_SUBTIPO';
    }
  }
  if (categoria === 'mesas_centro' || categoria === null) {
    if (msg.includes('centro') || msg.includes('sala')) return 'mesas_centro';
    if (msg.includes('auxiliar')) return 'mesas_auxiliares';
    if (msg.includes('noche')) return 'mesas_noche';
    if (msg.includes('tv') || msg.includes('televisor') || msg.includes('televisión')) return 'mesas_tv';
    const tieneMesa = msg.includes('mesa') || msg.includes('mesas');
    if (tieneMesa && (msg === 'mesa' || msg === 'mesas' || msg.includes('quiero una mesa') || msg.includes('busco una mesa'))) {
      return 'PEDIR_SUBTIPO';
    }
  }
  return null;
}

function formatearPreguntaSubtipo(categoria, mensaje) {
  const msg = mensaje?.toLowerCase() || '';

  if (categoria === 'sillas_comedor' || msg.includes('silla')) {
    return `¿Qué tipo de silla buscas?
• De comedor (para el diario)
• Auxiliares/rededoras (para la sala)
• De barra (para cocina)
¿Cuál te interesa? 😊`;
  }
  if (categoria === 'mesas_centro' || msg.includes('mesa')) {
    return `¿Qué tipo de mesa buscas?
• De centro (para la sala)
• Auxiliar
• De noche
• De TV
¿Cuál te interesa? 😊`;
  }
  return null;
}

function resolverRespuestaSubtipo(mensaje, categoriaPadre) {
  const msg = mensaje.toLowerCase().trim();
  if (categoriaPadre === 'sillas_comedor') {
    if (msg.includes('comedor') || msg.includes('diario')) return 'sillas_comedor';
    if (msg.includes('auxiliar') || msg.includes('rededora') || msg.includes('sala')) return 'sillas_auxiliares';
    if (msg.includes('barra') || msg.includes('alto') || msg.includes('cocina')) return 'sillas_barra';
  }
  if (categoriaPadre === 'mesas_centro') {
    if (msg.includes('centro') || msg.includes('sala')) return 'mesas_centro';
    if (msg.includes('auxiliar')) return 'mesas_auxiliares';
    if (msg.includes('noche')) return 'mesas_noche';
    if (msg.includes('tv') || msg.includes('televisor')) return 'mesas_tv';
  }
  return null;
}

function encontrarCoincidencias(mensaje, categoriaPref = null, categoriaBD = null) {
  const articulos = ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'tu', 'su', 'me', 'te', 'se', 'le', 'lo', 'de', 'del', 'al', 'y', 'o', 'que', 'con', 'sin', 'por', 'para', 'una'];

  let mensajeLimpio = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const palabrasMsg = mensajeLimpio.split(' ').filter(p => p.length > 2 && !articulos.includes(p));
  if (palabrasMsg.length > 0) mensajeLimpio = palabrasMsg.join(' ');
  if (mensajeLimpio.length < 3) return [];

  const categorias = Object.values(knowledge.inventario || {});
  const categoriaDetectada = categoriaPref || detectarCategoriaEnMensaje(mensaje);
  const categoriaPreferida = categoriaDetectada || categoriaBD;

  let coincidencias = [];

  const buscarEnCategoria = (cat, esPreferida = false) => {
    if (!cat.productos) return;
    for (const producto of cat.productos) {
      const nombreLimpio = producto.nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      let score = 0;

      if (mensajeLimpio.length >= 4 && nombreLimpio.includes(mensajeLimpio) && mensajeLimpio.length >= nombreLimpio.length * 0.3) {
        score = 100;
      } else if (nombreLimpio.length >= 4 && mensajeLimpio.includes(nombreLimpio) && nombreLimpio.length >= mensajeLimpio.length * 0.3) {
        score = 90;
      } else if (mensajeLimpio.length >= 4 && nombreLimpio.includes(mensajeLimpio.substring(0, Math.min(mensajeLimpio.length, 8)))) {
        score = 80;
      } else {
        const palabrasMsj = mensajeLimpio.split(' ').filter(p => p.length > 2);
        const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 2);

        for (const pm of palabrasMsj) {
          for (const pp of palabrasProd) {
            if (pp.includes(pm) && pm.length >= pp.length * 0.5) score += 50;
            else if (pm.includes(pp) && pp.length >= pm.length * 0.5) score += 50;
          }
        }

        for (const pm of palabrasMsj) {
          if (palabrasProd.includes(pm)) score += 30;
        }

        if (mensajeLimpio.length >= 4 && nombreLimpio.startsWith(mensajeLimpio.substring(0, 4))) {
          score += 30;
        }
      }

      // FIX: Dar bonus extra a la categoría preferida (antes solo reordenaba al final)
      if (score > 0) {
        if (esPreferida) score += 40;
        coincidencias.push({
          producto, score, nombre: producto.nombre, precio: producto.precio,
          categoria: cat.nombre,
          categoriaKey: Object.keys(knowledge.inventario).find(k => knowledge.inventario[k] === cat),
          esCategoriaPreferida: esPreferida,
          medidas: producto.medidas, material: producto.material, imagen: producto.imagen
        });
      }
    }
  };

  if (categoriaPreferida && knowledge.inventario[categoriaPreferida]) {
    buscarEnCategoria(knowledge.inventario[categoriaPreferida], true);
  }

  for (const categoria of categorias) {
    if (categoriaPreferida && categoria === knowledge.inventario[categoriaPreferida]) continue;
    buscarEnCategoria(categoria, false);
  }

  if (coincidencias.length === 0) return [];

  coincidencias.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.esCategoriaPreferida !== a.esCategoriaPreferida) return b.esCategoriaPreferida ? 1 : -1;
    return 0;
  });

  return coincidencias;
}

function buscarProductoPorNombre(mensaje, categoriaPref = null, categoriaBD = null) {
  const coincidencias = encontrarCoincidencias(mensaje, categoriaPref, categoriaBD);
  if (coincidencias.length === 0) return null;

  const mejorScore = coincidencias[0].score;
  const palabrasSignificativas = mensaje.toLowerCase().split(' ').filter(p =>
    p.length > 3 && !['quiero', 'ver', 'una', 'unos', 'unas', 'este', 'esta', 'estos', 'estas'].includes(p)
  );
  const umbralScore = palabrasSignificativas.length <= 2 ? 50 : 60;
  if (mejorScore < umbralScore) return null;

  const categoriaDetectada = categoriaPref || detectarCategoriaEnMensaje(mensaje);
  const categoriaPreferida = categoriaDetectada || categoriaBD;

  let mismosScore = coincidencias.filter(c => c.score >= mejorScore - 10 && c.score >= 50);

  if (categoriaPreferida) {
    const preferidos = mismosScore.filter(c => c.categoriaKey === categoriaPreferida);
    mismosScore = preferidos.length >= 2 ? preferidos : [coincidencias[0]];
  }

  if (mismosScore.length >= 2) {
    return {
      nombre: coincidencias[0].nombre,
      precio: coincidencias[0].precio,
      categoria: coincidencias[0].categoria,
      medidas: coincidencias[0].medidas,
      material: coincidencias[0].material,
      imagen: coincidencias[0].imagen,
      ambiguo: true,
      candidatos: mismosScore.map(c => ({
        nombre: c.nombre, precio: c.precio, categoria: c.categoria,
        medidas: c.medidas, material: c.material, imagen: c.imagen
      }))
    };
  }

  return {
    nombre: coincidencias[0].nombre,
    precio: coincidencias[0].precio,
    categoria: coincidencias[0].categoria
  };
}

function buscarInfoProducto(nombreProducto, categoriaPref = null, categoriaBD = null) {
  const nombreBuscado = nombreProducto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const categoriaDetectada = categoriaPref || detectarCategoriaEnMensaje(nombreProducto);
  const categoriaPreferida = categoriaDetectada || categoriaBD;
  const categorias = Object.values(knowledge.inventario || {});

  let mejoresCoincidencias = [];

  const buscarEnCategoria = (cat, esPreferida = false) => {
    if (!cat.productos) return;
    for (const producto of cat.productos) {
      const nombreLimpio = producto.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      let score = 0;

      if (nombreBuscado.includes(nombreLimpio) || nombreLimpio.includes(nombreBuscado)) {
        score = 100;
      } else {
        const palabrasMsg = nombreBuscado.split(' ').filter(p => p.length > 2);
        const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 2);
        for (const pm of palabrasMsg) {
          for (const pp of palabrasProd) {
            if (pp.includes(pm) || pm.includes(pp)) score += 25;
          }
        }
        if (nombreBuscado.length >= 4 && nombreLimpio.includes(nombreBuscado.substring(0, 6))) score += 40;
      }

      if (score > 0) {
        const catKey = Object.keys(knowledge.inventario).find(k => knowledge.inventario[k] === cat);
        mejoresCoincidencias.push({ producto, score, esCategoriaPreferida: esPreferida, categoriaKey: catKey });
      }
    }
  };

  if (categoriaPreferida && knowledge.inventario[categoriaPreferida]) {
    buscarEnCategoria(knowledge.inventario[categoriaPreferida], true);
  }

  for (const categoria of categorias) {
    if (categoriaPreferida && categoria === knowledge.inventario[categoriaPreferida]) continue;
    buscarEnCategoria(categoria, false);
  }

  if (mejoresCoincidencias.length === 0) return null;

  mejoresCoincidencias.sort((a, b) => {
    if (b.esCategoriaPreferida !== a.esCategoriaPreferida) return b.esCategoriaPreferida ? 1 : -1;
    return b.score - a.score;
  });

  const mejorScore = mejoresCoincidencias[0].score;
  if (mejorScore < 60) return null;

  let mismosScore = mejoresCoincidencias.filter(c => c.score >= mejorScore - 10 && c.score >= 50);

  if (categoriaPreferida) {
    const preferidos = mismosScore.filter(c => c.categoriaKey === categoriaPreferida);
    mismosScore = preferidos.length >= 2 ? preferidos : [mejoresCoincidencias[0]];
  }

  if (mismosScore.length >= 2) {
    const candidatos = mismosScore.map(c => ({
      nombre: c.producto.nombre, precio: c.producto.precio,
      medidas: c.producto.medidas || 'No disponible',
      material: c.producto.material || 'No disponible',
      imagen: c.producto.imagen || null
    }));
    const prod = mismosScore[0].producto;
    return {
      nombre: prod.nombre, precio: prod.precio,
      medidas: prod.medidas || 'No disponible',
      material: prod.material || 'No disponible',
      imagen: prod.imagen || null,
      ambiguo: true, candidatos
    };
  }

  const prod = mejoresCoincidencias[0].producto;
  return {
    nombre: prod.nombre, precio: prod.precio,
    medidas: prod.medidas || 'No disponible',
    material: prod.material || 'No disponible',
    imagen: prod.imagen || null
  };
}

function formatearMensajeAmbiguo(candidatos) {
  let msg = "Tenemos varios modelos similares. ¿A cuál te refieres?\n\n";
  candidatos.forEach((c, i) => {
    msg += `${i + 1}. *${c.nombre}* - ${c.precio}\n`;
    if (c.medidas) msg += `   📏 Medidas: ${c.medidas}\n`;
    if (c.material) msg += `   🪵 Material: ${c.material}\n`;
    msg += "\n";
  });
  msg += "Responde con el número o el nombre del que te interesa 😊";
  return msg;
}

function resolverCandidatoAmbiguo(mensaje, candidatos) {
  const msgLimpio = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const numMatch = msgLimpio.match(/(?:numero|nro|num|#|el|la|los)?\s*(\d+)/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    if (num >= 1 && num <= candidatos.length) return candidatos[num - 1];
  }

  for (const c of candidatos) {
    const nombreLimpio = c.nombre.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const palabras = nombreLimpio.split(' ').filter(p => p.length > 2);
    for (const palabra of palabras) {
      if (msgLimpio.includes(palabra)) return c;
    }
  }

  return null;
}

function buscarPorDescripcion(descripcion, categoriaActual) {
  if (!descripcion || !categoriaActual) return null;

  const msg = descripcion.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const categoria = knowledge.inventario[categoriaActual];
  if (!categoria || !categoria.productos) return null;

  let mejorCoincidencia = null;
  let mejorScore = 0;

  for (const producto of categoria.productos) {
    const nombreLimpio = producto.nombre.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let score = 0;
    const palabrasMsg = msg.split(' ').filter(p => p.length > 2);
    const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 2);

    for (const pm of palabrasMsg) {
      for (const pp of palabrasProd) {
        if (pp.includes(pm) || pm.includes(pp)) score += 50;
      }
    }

    if (score > mejorScore) {
      mejorScore = score;
      mejorCoincidencia = {
        nombre: producto.nombre, precio: producto.precio,
        medidas: producto.medidas, material: producto.material, imagen: producto.imagen
      };
    }
  }

  return mejorScore > 50 ? mejorCoincidencia : null;
}

function esFraseCompraGenerica(mensaje) {
  const msg = mensaje.toLowerCase();
  const palabrasFiltro = [
    'cama', 'sofa', 'sofá', 'comedor', 'silla', 'mesa', 'base', 'colchon', 'colchón',
    'nido', 'repisa', 'mueble', 'sillon', 'sillón', 'auxiliar', 'barra', 'moderno',
    'clasico', 'madera', 'cuero', 'tela', 'color', 'negro', 'blanco', 'cafe', 'gris',
    'rojo', 'azul', 'verde', 'dorado', 'plateado', 'grande', 'pequeño', 'pequeno',
    'economico', 'barato', 'caro', 'mejor', 'torello', 'valencia', 'monaco', 'torino',
    'milan', 'roma', 'aria', 'luna', 'sol', 'perla', 'diamante', 'cristal', 'oro',
    'plata', 'roble', 'nogal', 'pine', 'pino', 'cedro', 'caoba', 'tropical', 'rustico',
    'lujo', 'premium', 'deluxe', 'ejecutivo', 'estandar', 'doble', 'individual',
    'queen', 'king', 'full', 'seater', 'plaza', 'centro', 'esquina', 'seccional',
    'reclinable', 'puff', 'escritorio', 'estante', 'closet', 'tocador', 'velador',
    'comoda', 'modul', 'infantil', 'juvenil', 'gamer', 'oficina', 'plegable'
  ];
  for (const palabra of palabrasFiltro) {
    if (msg.includes(palabra)) return false;
  }
  return true;
}

const TRIGGERS_ASESOR = [
  'hablar con', 'hablarle a', 'llamar a', 'asesor', 'asesora', 'asesores',
  'humano', 'humana', 'persona real', 'persona de verdad', 'una persona',
  'necesito hablar con', 'quiero hablar con', 'hablar con alguien más',
  'que me atienda alguien', 'atención humana', 'derivame a', 'transferirme a'
];

function detectarCategoriaAmbigua(mensaje) {
  const mensajeLower = mensaje.toLowerCase().replace(/[¿?.,!]/g, '').trim();
  const sinonimosMesa = ['mesa', 'mesas'];
  const sinonimosSilla = ['silla', 'sillas', 'asiento', 'asientos'];

  const esSoloMesa = sinonimosMesa.some(p =>
    mensajeLower === p || mensajeLower === 'una ' + p || mensajeLower === 'un ' + p ||
    mensajeLower === 'ver ' + p || mensajeLower === 'dame ' + p
  );
  const esSoloSilla = sinonimosSilla.some(p =>
    mensajeLower === p || mensajeLower === 'una ' + p || mensajeLower === 'un ' + p ||
    mensajeLower === 'ver ' + p || mensajeLower === 'dame ' + p
  );

  if (esSoloMesa) {
    return "¿Qué tipo de mesa te interesa? Tenemos:\n• Mesa de centro (sala)\n• Mesa auxiliar\n• Mesa de TV\n• Mesa de noche\n\n¿Cuál quieres ver?";
  }
  if (esSoloSilla) {
    return "¿Qué tipo de silla te interesa? Tenemos:\n• Sillas de comedor\n• Sillas auxiliares/sillones\n• Sillas de barra\n\n¿Cuál quieres ver?";
  }
  return null;
}

function detectarUbicacion(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /ubicaci[óa]n/i, /ubicad[oa]s?\b/i, /direcci[óa]n/i, /direcciones/i,
    /d[óa]nde.*est[áa]n/i, /en.*d[óa]nde/i, /puedo.*visitar/i,
    /visitar.*tienda/i, /ir.*tienda/i, /tiendas.*ubic/i, /qu[é].*direcci[óa]n/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarSaludo(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /\bhola\b/i, /\bholis\b/i, /\bholi\b/i, /\bholaa\b/i, /\bholaaa\b/i,
    /\bholas\b/i, /\bola\b/i, /\bolas\b/i, /\bbuenos\s+dias\b/i,
    /\bbuenas\s+dias\b/i, /\bbuenos\s+días\b/i, /\bbuenas\s+días\b/i,
    /\bbuenas\b/i, /\bque\s+tal\b/i, /\bqué\s+tal\b/i, /\bsaludos\b/i,
    /\bhello\b/i, /\bhi\b/i, /\bhey\b/i, /\bbuenas\s+tardes\b/i,
    /\bbuenas\s+noches\b/i, /\bcomo\s+estas\b/i, /\bcómo\s+estás\b/i,
    /\bcomo\s+va\b/i, /\bqué\s+hay\b/i, /\bque\s+hay\b/i,
    /^\s*hola\s*$/i, /^\s*buenas?\s*$/i, /^\s*buenos\s*$/i
  ];
  return patrones.some(p => p.test(msg));
}

function esSoloSaludo(mensaje) {
  const msg = mensaje.trim();
  const palabras = msg.split(/\s+/).length;
  if (palabras > 4) return false;
  if (/[?¿]/.test(msg)) return false;
  const contenidoPatterns = [
    /comedor|cama|sofa|silla|mesa|colch|mueble|catalog|precio|cuanto|costo|valor/i,
    /donde|ubic|tienda|direccion|horario|comprar|venta|pedir|quiero|necesito/i,
    /manej|tienen|tiene|ver|mostrar|info|informacion/i
  ];
  if (contenidoPatterns.some(p => p.test(msg))) return false;
  return detectarSaludo(mensaje);
}

function esConsultaGenericaCategoria(mensaje) {
  const msg = mensaje.trim().toLowerCase();
  const patrones = [
    /^(me\s+gustar[ií]a\s+saber\s+(que|qu[eé])|quiero\s+saber\s+(que|qu[eé]))\s+(sillas|mesas|comedores|camas|sofas|sof[aá]s|colchones|bases|escritorios|cajoneros)\s+(tienen|manejan|hay|ofrecen)/i,
    /^(que|qu[eé])\s+(sillas|mesas|comedores|camas|sofas|sof[aá]s|colchones|bases|escritorios|cajoneros)\s+(tienen|manejan|hay|ofrecen)/i,
    /^(que|qu[eé])\s+(tipos?\s+de\s+)?(sillas|mesas|comedores|camas|sofas|sof[aá]s|colchones|bases|escritorios|cajoneros)\s+(tienen|manejan|hay|ofrecen)/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarAsesor(mensaje) {
  const msg = mensaje.toLowerCase();
  const triggers_exactos = [
    'hablar con un asesor', 'hablar con asesor', 'hablarle al asesor',
    'hablar con una persona', 'hablar con humano', 'hablar con persona real',
    'necesito un asesor', 'necesito una persona', 'necesito un humano',
    'quiero hablar con', 'necesito hablar con',
    'asesor', 'asesora', 'humano', 'humana',
    'persona real', 'persona de verdad',
    'que me atienda', 'derivame', 'transferirme',
    'atencion humana', 'atención humana',
    'mándame con el', 'pasame con el', 'envíame con el',
    'comunico con', 'que me comunique', 'hablar con el asesor',
    'transfiéreme', 'pásame al', 'envíame al',
    'mándame directamente', 'pásame al asesor'
  ];
  if (triggers_exactos.some(t => msg.includes(t))) return true;
  const patrones = [/\bhablar\s+con\b/, /\bhablarle\s+a\b/, /\bllamar\s+a\b/, /\bpersona\b/, /\bhumano\b/];
  return patrones.some(p => p.test(msg));
}

function detectarMedidaPersonalizada(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const esConsultaCatalogo = /que.*tienen/i.test(msg) || /que.*hay/i.test(msg) ||
    /mostrar.*catalogo/i.test(msg) || /ver.*catalogo/i.test(msg) || /saber que/i.test(msg);
  if (esConsultaCatalogo) return false;

  const patrones = [
    /si la medida/i, /cambiar la medida/i, /medida personalizada/i, /otra medida/i,
    /de (\d+) puestos/i, /quiero de (\d+) puestos/i, /lo quiero de (\d+)/i,
    /para (\d+) personas/i, /para (\d+) puestos/i, /medida de/i, /en medida/i,
    /con medida/i, /modificar la medida/i, /ajustar la medida/i, /personalizar.*medida/i,
    /medida diferente/i, /otro tamano/i, /diferente tamano/i, /pero de (\d+)/i,
    /ese de (\d+)/i, /esa de (\d+)/i, /quiero.*de (\d+)/i, /gustaria.*de (\d+)/i,
    /lo quiero de (\d+) puestos/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarPersonalizacion(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const COLORES = ['negro', 'blanco', 'azul', 'rojo', 'verde', 'amarillo', 'gris', 'marron', 'beige', 'cafe', 'crema', 'champan', 'vino', 'burdeos', 'naranja', 'rosa', 'morado', 'lila'];
  const coloresRegex = COLORES.join('|');
  const patrones = [
    new RegExp('en (' + coloresRegex + ')', 'i'),
    new RegExp('color (' + coloresRegex + ')', 'i'),
    /quiero en /i, /lo quiero en /i, /pintado en /i, /con (color|tinte)/i,
    /de (roble|pino|cedro|madera)/i, /en (cuero|tela|trapo|sintetico)/i,
    /personalizado/i, /modificar/i, /cambiar/i, /diferente/i, /especial/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarAgregarProducto(mensaje) {
  const msg = mensaje.toLowerCase();
  return /agregarle|agregar|añadirle|también la|y también|y agrégale|agregame|añade/i.test(msg);
}

// FIX #2 aplicado aquí - usar detectarCompraExplicita en lugar del original detectarCompra
function detectarCompra(mensaje) {
  return detectarCompraExplicita(mensaje);
}

function detectarAgendar(mensaje) {
  const msg = mensaje.toLowerCase();
  return msg.includes('agendar') ||
    (msg.includes('cita') && (msg.includes('quisiera') || msg.includes('quiero') ||
      msg.includes('necesito') || msg.includes('pedir') || msg.includes('reservar')));
}

function detectarCancelarAgendacion(mensaje) {
  const msg = mensaje.toLowerCase();
  return msg === 'cancelar' || msg === 'cancelar agendacion' || msg === 'cancelar agenda' ||
    msg.includes('cancelar la cita') || msg.includes('cancelar agendacion');
}

function esDiaValido(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const diasValidos = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  return diasValidos.some(d => msg === d || msg === 'el ' + d || msg.includes(d));
}

function esSabado(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return msg.includes('sabado') || msg.includes('sábado');
}

function esHoraValida(mensaje, esSabadoDia = false) {
  const msg = mensaje.toLowerCase().replace(/\s+/g, ' ').trim();
  const match = msg.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return false;
  const hora = parseInt(match[1]);
  const minutos = match[2] ? parseInt(match[2]) : 0;
  const horaMin = 8;
  const horaMax = esSabadoDia ? 11 : 16;
  if (hora < horaMin || hora > horaMax) return false;
  if (minutos < 0 || minutos > 59) return false;
  return true;
}

function formatearHora(hora) {
  const msg = hora.trim();
  const match = msg.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return hora;
  const h = parseInt(match[1]);
  const m = match[2] ? parseInt(match[2]) : 0;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function esUbicacionValida(mensaje) {
  const msg = mensaje.trim();
  return msg === '1' || msg === '2' || msg === '3' || msg === '4' || msg === '5';
}

function formatearNombreUbicacion(num) {
  const ubicaciones = {
    1: 'Av. Bolívar # 16 N 26',
    2: 'Km 2 vía El Edén',
    3: 'Km 1 vía Jardines',
    4: 'CC Unicentro Pereira',
    5: 'Cra. 14 #11 - 93. Pereira, Risaralda'
  };
  return ubicaciones[num] || 'No especificada';
}

function detectarConsultaInfo(mensaje) {
  if (detectarAsesor(mensaje)) return false;
  if (detectarCompra(mensaje)) return false;
  if (detectarVerCarrito(mensaje)) return false;
  if (detectarLimpiarCarrito(mensaje)) return false;
  if (detectarAgendar(mensaje)) return false;

  const msg = mensaje.toLowerCase();
  const patronesInfo = [
    /viene con/i, /viene incluido/i, /incluye las sillas/i,
    /cu[á]nto vale/i, /cu[á]nto cuesta/i, /precio del/i, /precio de la/i,
    /qu[é] incluye/i, /qu[é] trae/i, /c[ó]mo funciona/i,
    /son separad/i, /se vende por separad/i, /hay modelos/i, /hay dise[ñ]os/i,
    /qu[é] modelos/i, /m[áa]s informaci[óa]n/i, /m[áa]s info/i, /m[áa]s detalles/i,
    /detalles de/i, /informaci[óa]n del/i, /quisiera saber/i, /quiero saber/i,
    /caracter[íá]sticas/i, /que tiene el/i, /que tiene la/i, /que incluye/i,
    /\binfo\b/i, /\bspecs?\b/i, /de qu[é] material/i, /son de/i, /hfabricad/i,
    /saber m[áa]s/i, /ver.*detalles/i, /ver.*especificac/i,
    /^el\b/i, /^la\b/i, /^\s*el\s+\w+/i, /^\s*la\s+\w+/i
  ];
  if (patrones => patrones.some(p => p.test(msg))) {
    for (const patron of patronesInfo) {
      if (patron.test(msg)) return true;
    }
  }

  const palabrasVer = ['ver', 'mostrar', 'quisiera', 'quiero', 'información', 'info', 'detalles', 'saber', 'conocer'];
  const tienePalabraVer = palabrasVer.some(p => msg.includes(p));
  const tieneCategoria = msg.includes('silla') || msg.includes('comedor') || msg.includes('base') ||
    msg.includes('cama') || msg.includes('mesa') || msg.includes('sof') ||
    msg.includes('catálogo') || msg.includes('precio') || msg.includes('el ') || msg.includes('la ');

  return tienePalabraVer && tieneCategoria;
}

function detectarMasBarato(mensaje) {
  const msg = mensaje.toLowerCase();
  return msg.includes('barato') || msg.includes('barata') ||
    msg.includes('económico') || msg.includes('economica') ||
    msg.includes('más barato') || msg.includes('mas barato') ||
    msg.includes('más económico') || msg.includes('mas economico') ||
    msg.includes('menor precio') || msg.includes('menor costo');
}

function detectarVerCarrito(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /ver.*carrito/i, /mi carrito/i, /\bcarrito\b/i, /que tengo/i, /qué tengo/i,
    /mostrar carrito/i, /dame el carrito/i, /ver mis productos/i,
    /ver\s+mi\s+carrito/i, /ver\s+el\s+carrito/i, /quiero\s+ver.*carrito/i,
    /hay\s+en\s+mi\s+carrito/i, /hay\s+en\s+el\s+carrito/i,
    /que\s+hay\s+en/i, /qué\s+hay\s+en/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarLimpiarCarrito(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /borrar.*carrito/i, /vaciar.*carrito/i, /eliminar.*todo/i,
    /empezar.*de nuevo/i, /limpiar.*carrito/i, /cancelar.*pedido/i,
    /eliminar.*producto/i, /quitar.*carrito/i, /quitar.*producto/i,
    /quitar.*del/i, /borrar.*producto/i, /sacar.*carrito/i, /sacar.*producto/i,
    /\bno\s+lo\s+quiero\b/i, /\bno\s+la\s+quiero\b/i,
    /\bno\s+lo\s+llev[oe]\b/i, /\bno\s+la\s+llev[oe]\b/i,
    /\bno\s+lo\s+compro\b/i, /cambiar.*producto/i, /otro.*producto/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarSolicitudFoto(mensaje) {
  const patrones = [
    /env[ií]ame.*foto/i, /env[ií]ame.*imagen/i, /foto.*del?/i,
    /imagen.*de/i, /c[oó]mo.*se.*ve/i, /m[eé]strame.*foto/i,
    /m[eé]strame.*imagen/i, /ver.*foto/i, /ver.*imagen/i,
    /foto/i, /imagen/i, /picture/i
  ];
  return patrones.some(p => p.test(mensaje));
}

function detectarConsultaPrecio(mensaje) {
  const patrones = [
    /cu[áa]nto.*cuesta/i, /cu[áa]nto.*vale/i, /cu[áa]l.*precio/i,
    /precio.*del/i, /precio.*de/i, /cu[áa]l.*es.*el.*precio/i,
    /valor.*del/i, /valor.*de/i, /cu[áa]l.*es.*el.*valor/i,
    /\bprecio\b/i, /\bvalores\b/i, /\bcuesta\b/i, /\bvale\b/i
  ];
  return patrones.some(p => p.test(mensaje));
}

function detectarCantidad(mensaje) {
  const patrones = [
    /(\d+)\s*(?:unidades?|unds?|uds?|u\.?)?\s*(?:de\s+)?es[ae]s/i,
    /quiero\s*(\d+)/i, /necesito\s*(\d+)/i, /me\s*llevo\s*(\d+)/i,
    /(\d+)\s*de\s*(?:es[ae]s[ae]?s?)/i, /^si\s*(\d+)/i, /^sí\s*(\d+)/i,
    /(\d+)\s+unidades/i
  ];
  for (const patron of patrones) {
    const match = patron.exec(mensaje.toLowerCase());
    if (match) {
      const cantidad = parseInt(match[1]);
      if (cantidad > 0 && cantidad <= 100) return cantidad;
    }
  }
  if (/\b(?:5|cinco)\b/i.test(mensaje)) return 5;
  if (/\b(?:4|cuatro)\b/i.test(mensaje)) return 4;
  if (/\b(?:3|tres)\b/i.test(mensaje)) return 3;
  if (/\b(?:2|dos)\b/i.test(mensaje)) return 2;
  if (/\b(?:1|una?)\b/i.test(mensaje)) return 1;
  return null;
}

function detectarIntentionAddCarrito(mensaje) {
  const msg = mensaje.toLowerCase();
  // FIX #2: eliminado el patrón genérico /\b(lo|la|les)\b/i que era demasiado amplio
  const patrones = [
    /me\s+gustar[ií]a\s+comprar/i, /me\s+gustar[ií]a\s+comprarlo/i,
    /quiero\s+comprar/i, /quiero\s+la\s+/i, /quiero\s+el\s+/i,
    /me\s+llevo/i, /dame\s+el\s+/i, /dame\s+la\s+/i,
    /necesito\s+el\s+/i, /necesito\s+la\s+/i,
    /\bcomprar\b.*\b(silla|base|cama|mesa|sofa)/i,
    /\b(silla|base|cama|mesa|sofa)\b.*\bcomprar\b/i,
    /lo\s+quiero\s+comprar/i, /lo\s+quiero\b/i, /la\s+quiero\b/i,
    /me\s+lo\s+llevo/i, /me\s+la\s+llevo/i,
    /comprar\s+ese/i, /comprar\s+este/i, /comprar\s+la/i, /comprar\s+el/i,
    /agregarle/i, /agregar/i, /y también la/i, /y también el/i,
    /también la/i, /también el/i, /agrégale/i, /agregame/i,
    /añadir.*carrito/i, /meter.*carrito/i, /quisiera\s+(comprar|añadir|agregar)/i,
    /deseo\s+(comprar|añadir|agregar)/i, /quiero\s+(añadir|agregar)/i,
    /me\s+gustar[ií]an/i, /gustar[ií]an\s+de/i, /confirmar.*compra/i,
    /proceder.*compra/i, /si.*confirmo/i, /\bcomprar\b/i, /\bllevar\b/i,
    /\bañadir\b/i, /\bagregar\b/i,
    /me\s+(lo|la)\s+(añad|agreg)/i, /lo\s+(añad|agreg)/i, /la\s+(añad|agreg)/i,
    /si\s+(me|gustaria)/i
  ];
  return patrones.some(p => p.test(msg));
}

function buscarProductosPorCategoria(mensaje) {
  const mensajeLimpio = mensaje.toLowerCase().replace(/[^a-záéíóúñ\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const mapeoCategorias = {
    'sofa cama': 'sofas_camas', 'sofas cama': 'sofas_camas', 'sofacama': 'sofas_camas', 'sofacamas': 'sofas_camas',
    'sofa modular': 'sofas_modulares', 'sofas modulares': 'sofas_modulares', 'modular': 'sofas_modulares',
    'sofa': 'sofas', 'sofas': 'sofas',
    'silla barra': 'sillas_barra', 'sillas barra': 'sillas_barra', 'barra': 'sillas_barra',
    'silla de barra': 'sillas_barra', 'sillas de barra': 'sillas_barra',
    'silla comedor': 'sillas_comedor', 'sillas de comedor': 'sillas_comedor',
    'silla auxiliar': 'sillas_auxiliares', 'sillas auxiliar': 'sillas_auxiliares',
    'comedor': 'bases_comedores', 'comedores': 'bases_comedores',
    'base': 'bases_comedores', 'bases': 'bases_comedores',
    'mesa noche': 'mesas_noche', 'mesa de noche': 'mesas_noche',
    'mesa tv': 'mesas_tv', 'mesa de tv': 'mesas_tv',
    'mesa centro': 'mesas_centro', 'mesa de centro': 'mesas_centro', 'mesa sala': 'mesas_centro',
    'mesa auxiliar': 'mesas_auxiliares', 'auxiliar': 'mesas_auxiliares',
    'colchon': 'colchones', 'colchones': 'colchones',
    'cama': 'camas', 'camas': 'camas',
    'escritorio': 'escritorios', 'escritorios': 'escritorios',
    'cajoneros': 'cajoneros_bifes', 'cajones': 'cajoneros_bifes', 'bifes': 'cajoneros_bifes'
  };

  const inventario = knowledge.inventario || {};

  for (const [palabra, clave] of Object.entries(mapeoCategorias)) {
    if (mensajeLimpio.includes(palabra)) {
      const categoria = inventario[clave];
      if (categoria && categoria.productos) {
        return {
          categoria: clave,
          productos: categoria.productos.map(p => ({ nombre: p.nombre, precio: p.precio, material: p.material }))
        };
      }
    }
  }

  return { categoria: null, productos: [] };
}

function formatearProductosVenta(productos, limite = 5) {
  if (!productos || productos.length === 0) return null;

  const limitados = productos.slice(0, limite);
  const total = productos.length;

  let mensaje = "OPCIONES DISPONIBLES:\n\n";
  limitados.forEach((p, i) => {
    mensaje += `${i + 1}. ${p.nombre}\n   Valor: ${p.precio}\n`;
    if (p.material) mensaje += `   Material: ${p.material}\n`;
    mensaje += "\n";
  });

  if (total > limite) {
    mensaje += `(${limite} de ${total}) ¿Te interesa alguno o prefieres el PDF completo? 😊`;
  } else {
    mensaje += "¿Cuál te interesa? 😊";
  }

  return mensaje;
}

function buscarImagenProducto(mensaje) {
  const categorias = Object.values(knowledge.inventario || {});
  const mensajeLower = mensaje.toLowerCase().replace(/[^a-záéíóúñ\s]/g, ' ');
  const stopWords = ['dos', 'ambos', 'ambas', 'las', 'los', 'del', 'una', 'unos', 'unas', 'que',
    'este', 'esta', 'ese', 'esa', 'otra', 'otro', 'todas', 'todos', 'cada',
    'foto', 'fotos', 'imagen', 'imagenes', 'mandar', 'enviar', 'puedes', 'podrías', 'porfa', 'favor'];
  const productosConImagen = [];

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      if (!producto.imagen) continue;
      const nombreLimpio = producto.nombre.toLowerCase().replace(/[^a-záéíóúñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const palabrasClave = nombreLimpio.split(' ').filter(p => p.length > 2 && !stopWords.includes(p));
      let score = 0;
      for (const palabra of palabrasClave) {
        if (mensajeLower.includes(palabra)) score += palabra.length;
      }
      if (score > 0) {
        productosConImagen.push({ nombre: producto.nombre, imagen: producto.imagen, score, nombreLimpio });
      }
    }
  }

  if (productosConImagen.length === 0) return null;
  productosConImagen.sort((a, b) => b.score - a.score);
  const mejor = productosConImagen[0];

  for (const p of productosConImagen) {
    if (p.nombreLimpio.includes(mejor.nombreLimpio) && p.nombreLimpio !== mejor.nombreLimpio) {
      if (p.score >= mejor.score * 0.8) return { imagen: p.imagen, nombre: p.nombre };
    }
  }

  return { imagen: mejor.imagen, nombre: mejor.nombre };
}

function formatearNombreCategoria(nombre) {
  const mapeo = {
    'cajoneros_bifes': 'cajoneros y bifes', 'sofas_camas': 'sofacamas',
    'sofas_modulares': 'sofas modulares', 'bases_comedores': 'bases de comedores',
    'mesas_auxiliares': 'mesas auxiliares', 'mesas_centro': 'mesas de centro',
    'mesas_noche': 'mesas de noche', 'mesas_tv': 'mesas de televisor',
    'sillas_auxiliares': 'sillas auxiliares', 'sillas_barra': 'sillas de barra'
  };
  return mapeo[nombre] || nombre.replace(/_/g, ' ');
}

function buscarCatalogo(mensaje) {
  const catalogos = knowledge.catalogos || {};
  const inventario = knowledge.inventario || {};
  const mensajeLower = mensaje.toLowerCase();

  const mapeoCategorias = {
    'sofa cama': 'sofas_camas', 'sofacama': 'sofas_camas',
    'sofa modular': 'sofas', 'sofas modulares': 'sofas', 'modular': 'sofas',
    'sofa': 'sofas', 'sofas': 'sofas',
    'silla auxiliar': 'sillas_auxiliares', 'sillon': 'sillas_auxiliares',
    'silla barra': 'sillas_barra', 'silla alta': 'sillas_barra',
    'silla comedor': 'sillas_comedor', 'silla': 'sillas_comedor', 'sillas': 'sillas_comedor',
    'comedor': 'bases_comedores', 'comedores': 'bases_comedores', 'base': 'bases_comedores', 'bases': 'bases_comedores',
    'mesa auxiliar': 'mesas_auxiliares', 'auxiliar': 'mesas_auxiliares',
    'mesa centro': 'mesas_centro', 'mesa de centro': 'mesas_centro',
    'mesa noche': 'mesas_noche', 'mesa de noche': 'mesas_noche',
    'mesa tv': 'mesas_tv', 'mesa de tv': 'mesas_tv',
    'colchon': 'colchones', 'colchones': 'colchones',
    'cama': 'camas', 'camas': 'camas',
    'escritorio': 'escritorios', 'escritorios': 'escritorios',
    'cajonero': 'cajoneros_bifes', 'bifes': 'cajoneros_bifes', 'cajoneros': 'cajoneros_bifes',
    'catalogo': 'todos', 'ver catalogos': 'todos', 'catalogos': 'todos', 'pdf': 'todos'
  };

  for (const [palabra, clave] of Object.entries(mapeoCategorias)) {
    if (mensajeLower.includes(palabra)) {
      if (clave === 'todos') return { todos: true };
      if (clave === 'escritorios' || clave === 'colchones') return { sinPdf: true, categoria: clave };
      const url = catalogos[clave];
      if (url) return { url, categoria: clave };
      if (inventario[clave]?.productos) return { sinPdf: true, categoria: clave, productos: inventario[clave].productos };
    }
  }

  return null;
}

function detectarSolicitudCatalogo(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /\bcat[áa]logos?\b/i, /ver.*el.*cat[áa]logo/i, /cat[áa]logo.*de/i,
    /el.*cat[áa]logo\b/i, /d[áa]me.*el.*cat[áa]logo/i, /m[áa]ndame.*el.*cat[áa]logo/i,
    /env[ií]ame.*el.*cat[áa]logo/i, /ver.*PDF/i, /ver.*pdf/i,
    /\bPDF\b/i, /\bpdf\b/i, /ver pdf\b/i, /dame pdf\b/i,
    /cat[áa]logo.*completo/i, /mostrar.*cat[áa]logo/i, /^cat[áa]logo$/i,
    /ver\s+todos\s+los\s+productos/i, /\bver\s+todo\b/i, /muestrame\s+todo/i
  ];
  return patrones.some(p => p.test(msg));
}

function esMensajeRelevante(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sinonimos = {
    productos: /silla[ s]?|mesa[ s]?|cama[ s]?|sofa[ s]?|sofas?|base[ s]?|cajon[eo][ s]?|colchon[es]?|escritorio[ s]?|mueble[ s]?|sillon|puff|banqueta/,
    compra: /precio|cuesta|val(?:e|er|or)|comprar|llevar|pedido|carrito|confirmar|pagar|ordenar|adquirir/,
    materiales: /madera|flor morado|cedro|roble|laminado|tapizado|chapilla|pintado/,
    servicio: /delivery|envio|entrega|armenia|horario|atencion|contacto|ubicacion|direccion|tienda/,
    redes: /instagram|facebook|tiktok|youtube|redes?|pagina web|pagina oficial|social/,
    general: /catalogo[ s]?|pdf|foto[ s]?|imagen[ s]?|producto[ s]?|ver|mostrar|coleccion/,
    especifico: /flor morado|de casa|decasa/
  };
  for (const patron of Object.values(sinonimos)) {
    if (patron.test(msg)) return true;
  }
  const preguntasIntencion = /cu[áa]nto|cu[áa]l|qu[é]|d[óa]nde|c[óa]mo|cu[áa]ndo|por qu[é]/;
  if (preguntasIntencion.test(msg)) return false;
  return msg.length < 15;
}

function generarMensajeInstagram() {
  return "\n\n📱 Síguenos en Instagram: @muebles_decasa\n🔔 ¡Mantente al día con nuestros nuevos productos y promociones!";
}

function generarMensajeDespedida() {
  return "\n\n📱 Síguenos en Instagram: @muebles_decasa\n🔔 ¡Mantente al día con nuestros productos y ofertas!\n\nQue tengas un lindo día! 😊";
}

function generarRespuestaContactoUbicacion() {
  return `Puedes visitarnos en cualquiera de nuestras cinco tiendas:
📍 **Avenida Bolívar # 16 N 26, Armenia, Quindío**
📍 **Km 2 vía El Edén, Armenia, Quindío**
📍 **Km 1 vía Jardines, Armenia, Quindío**
📍 **CC Unicentro Pereira, Pereira, Risaralda**
📍 **Cra. 14 #11 - 93. Pereira, Risaralda**

📱 Síguenos en Instagram: @muebles_decasa
¿Te gustaría agendar una visita? 😊`;
}

const patronesContactoUbicacion = /donde|ubicacion|tienda|direccion|instagram|redes?|seguir|contacto|telefono|numero|whatsapp|encontrar|localizar/i;

// ─────────────────────────────────────────────
// GEMINI API
// ─────────────────────────────────────────────

async function callGemini(prompt) {
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

  const contents = [];
  for (const msg of prompt.history || []) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  }
  contents.push({ role: 'user', parts: [{ text: prompt.currentMessage }] });

  const { fetchWithRetry } = require('./httpClient');
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.8, maxOutputTokens: 600 }
    })
  }, 2, 15000);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const texto = data.candidates[0].content.parts[0].text;

  // FIX #4: Si Gemini no es confiable o inventó precios, agregar advertencia
  if (!respuestaGeminiEsConfiable(texto) || detectarPrecioInventado(texto)) {
    console.log('[GEMINI] ⚠️ Respuesta no confiable detectada');
    return texto + '\n\n_(Si tienes dudas sobre disponibilidad o precios, puedo transferirte con un asesor 😊)_';
  }

  return texto;
}

async function callGeminiWithHistory(from, currentMessage) {
  const history = await db.getHistorial(from, 12);
  return callGemini({ history, currentMessage });
}

// ─────────────────────────────────────────────
// COMPARACIÓN
// ─────────────────────────────────────────────

async function compararProductos(from, incomingMsg = null) {
  const historial = await db.getHistorial(from, 8);
  const categoriaActual = await db.getCategoriaActual(from);
  const itemsCarrito = await db.verCarrito(from);
  const productosMencionados = [];
  const inventario = knowledge.inventario;
  const nombresEnCarrito = new Set(itemsCarrito.map(item => item.producto.toLowerCase()));

  if (incomingMsg) {
    for (const [catKey, catData] of Object.entries(inventario)) {
      if (categoriaActual && catKey !== categoriaActual) continue;
      for (const prod of catData.productos) {
        if (nombresEnCarrito.has(prod.nombre.toLowerCase())) continue;
        const nombreNormalizado = prod.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const msgNormalizado = incomingMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const palabrasProd = nombreNormalizado.split(/\s+/).filter(p => p.length > 2);
        const coincidencias = palabrasProd.filter(p => msgNormalizado.includes(p));
        if (coincidencias.length >= Math.min(2, palabrasProd.length) && !productosMencionados.find(p => p.nombre === prod.nombre)) {
          productosMencionados.push({ ...prod, categoria: catKey });
        }
      }
    }
  }

  if (productosMencionados.length < 2) {
    for (const msg of historial) {
      if (msg.role === 'assistant') {
        for (const [catKey, catData] of Object.entries(inventario)) {
          if (categoriaActual && catKey !== categoriaActual) continue;
          for (const prod of catData.productos) {
            if (nombresEnCarrito.has(prod.nombre.toLowerCase())) continue;
            if (productosMencionados.find(p => p.nombre === prod.nombre)) continue;
            if (msg.content.includes(prod.nombre)) {
              productosMencionados.push({ ...prod, categoria: catKey });
            }
          }
        }
      }
    }
  }

  const productosRecientes = productosMencionados.slice(-2);
  if (productosRecientes.length >= 2) {
    let comparacion = "📊 *Comparación de productos:*\n\n";
    const productosConPrecio = productosRecientes.map(p => ({
      ...p, precioNumerico: parseInt(String(p.precio).replace(/[^0-9]/g, '')) || 0
    }));
    const ordenados = [...productosConPrecio].sort((a, b) => a.precioNumerico - b.precioNumerico);
    const masBarato = ordenados[0];
    const masCaro = ordenados[ordenados.length - 1];

    productosRecientes.forEach((prod, i) => {
      comparacion += `${i + 1}. *${prod.nombre}*\n`;
      comparacion += `   💰 Precio: ${prod.precio}\n`;
      if (prod.material) comparacion += `   🪵 Material: ${prod.material}\n`;
      if (prod.medidas) comparacion += `   📏 Medidas: ${prod.medidas}\n`;
      comparacion += "\n";
    });

    comparacion += `💡 *Mi recomendación:*\n`;
    comparacion += `• Si buscas la mejor relación precio-calidad: *${masBarato.nombre}* (${masBarato.precio})\n`;
    if (masBarato.nombre !== masCaro.nombre) {
      comparacion += `• Si buscas la opción premium: *${masCaro.nombre}* (${masCaro.precio})\n`;
    }
    comparacion += `\n¿Qué es lo que más te importa? ¿Presupuesto, material, tamaño o diseño? 😊`;

    await db.setComparacionProductos(from, productosRecientes.map(p => ({ nombre: p.nombre, imagen: p.imagen, categoria: p.categoria })));
    return comparacion;
  }

  return null;
}

function detectarRespuestaComparacion(mensaje) {
  const msg = mensaje.toLowerCase();
  const tienePresupuesto = /presupuesto|plata|dinero|tengo|maximo|gastar|hasta\s*\d|mi\s*presupuesto|cuesta|valor/i.test(msg) || /\d{3,}/.test(msg.replace(/[^\d]/g, ''));
  const tieneEstilo = /clasico|moderno|minimalista|rustico|industrial|contemporaneo|sencillo|elegante|vintage|colonia/i.test(msg);
  const tieneEspacio = /sala|comedor|dormitorio|cuarto|cocina|oficina|recibidor|habitacion/i.test(msg);
  return tienePresupuesto || tieneEstilo || tieneEspacio;
}

function extraerPreferencias(mensaje) {
  const msg = mensaje.toLowerCase();
  const prefs = { presupuesto: null, estilo: null, espacio: null, textoCompleto: mensaje };

  const numeros = msg.match(/(\d[\d.]*)/g);
  if (numeros) {
    for (const num of numeros) {
      let valor = parseInt(num.replace(/\./g, ''), 10);
      if (isNaN(valor)) continue;
      if (valor > 100 && valor < 10000000) {
        if (valor < 10000) valor *= 1000;
        prefs.presupuesto = valor;
        break;
      }
    }
  }

  const estilos = [
    { patron: /clasico|colonia/i, valor: 'clasico' },
    { patron: /moderno/i, valor: 'moderno' },
    { patron: /minimalista/i, valor: 'minimalista' },
    { patron: /rustico/i, valor: 'rustico' },
    { patron: /industrial/i, valor: 'industrial' },
    { patron: /elegante/i, valor: 'elegante' },
    { patron: /vintage/i, valor: 'vintage' },
    { patron: /sencillo|simple/i, valor: 'sencillo' }
  ];
  for (const e of estilos) {
    if (e.patron.test(msg)) { prefs.estilo = e.valor; break; }
  }

  const espacios = [
    { patron: /comedor/i, valor: 'comedor' },
    { patron: /sala|estar/i, valor: 'sala' },
    { patron: /dormitorio|cuarto|habitacion|dormir/i, valor: 'dormitorio' },
    { patron: /cocina/i, valor: 'cocina' },
    { patron: /oficina|escritorio|estudio/i, valor: 'oficina' }
  ];
  for (const e of espacios) {
    if (e.patron.test(msg)) { prefs.espacio = e.valor; break; }
  }

  return prefs;
}

function recomendarPorPreferencias(prefs) {
  const inventario = knowledge.inventario;
  let candidatos = [];

  const espacioCategoria = {
    comedor: ['bases_comedores', 'sillas_comedor'],
    sala: ['sofas', 'sofas_camas', 'sofas_modulares', 'mesas_centro', 'mesas_auxiliares', 'sillas_auxiliares'],
    dormitorio: ['camas', 'colchones', 'mesas_noche', 'cajoneros_bifes'],
    cocina: ['sillas_barra', 'mesas_auxiliares'],
    oficina: ['escritorios'],
    recibidor: ['mesas_auxiliares', 'sillas_auxiliares']
  };

  const categoriasBusqueda = (prefs.espacio && espacioCategoria[prefs.espacio])
    ? espacioCategoria[prefs.espacio]
    : Object.keys(inventario);

  for (const catKey of categoriasBusqueda) {
    const cat = inventario[catKey];
    if (!cat?.productos) continue;
    for (const prod of cat.productos) {
      const precioNum = parseInt(String(prod.precio).replace(/[^0-9]/g, '')) || 0;
      if (precioNum === 0) continue;

      let score = 0;
      if (prefs.presupuesto) {
        const rango = prefs.presupuesto * 0.3;
        if (precioNum <= prefs.presupuesto + rango && precioNum >= prefs.presupuesto - rango) score += 100;
        else if (precioNum <= prefs.presupuesto) score += 80;
        else continue;
      }

      if (score > 0) candidatos.push({ ...prod, categoria: catKey, score, precioNumerico: precioNum });
    }
  }

  candidatos.sort((a, b) => b.score - a.score);
  const seleccionados = candidatos.slice(0, 5);

  if (seleccionados.length === 0) return null;

  const masEconomico = [...seleccionados].sort((a, b) => a.precioNumerico - b.precioNumerico)[0];
  const premium = seleccionados.find(p => p.nombre !== masEconomico.nombre);

  let respuesta = "Encontré varias opciones para ti 😊\n\n";
  seleccionados.forEach((prod, i) => {
    respuesta += `${i + 1}. *${prod.nombre}* - ${prod.precio}\n`;
    if (prod.material) respuesta += `   🪵 ${prod.material}\n`;
    if (prod.medidas) respuesta += `   📏 ${prod.medidas}\n`;
    respuesta += "\n";
  });

  respuesta += `💡 *Mi recomendación:*\n`;
  respuesta += `• Mejor precio: *${masEconomico.nombre}* (${masEconomico.precio})\n`;
  if (premium) respuesta += `• Opción premium: *${premium.nombre}* (${premium.precio})\n`;
  respuesta += "\n¿Cuál te llama más la atención? 😊";

  return respuesta;
}

// ─────────────────────────────────────────────
// FOTOS MÚLTIPLES
// ─────────────────────────────────────────────

function extraerFotoMultiple(mensaje, productosComparacion) {
  const msg = mensaje.toLowerCase();
  if (!productosComparacion || productosComparacion.length === 0) return null;

  if (/las\s*dos|los\s*dos|ambos|ambas/i.test(msg)) return productosComparacion;
  if (/primera|primer\b/i.test(msg)) return [productosComparacion[0]];
  if (/segunda|segundo\b/i.test(msg) && productosComparacion.length >= 2) return [productosComparacion[1]];
  if (/ultima|última/i.test(msg)) return [productosComparacion[productosComparacion.length - 1]];

  const palabras = msg.split(/\s+/).filter(p =>
    p.length > 2 && !/foto|imagen|ver|de|las|los|dos|ambos|ambas|porfa|porfavor|please/i.test(p)
  );
  if (palabras.length > 0) {
    const filtrados = productosComparacion.filter(p => palabras.some(pal => p.nombre.toLowerCase().includes(pal)));
    if (filtrados.length > 0) return filtrados;
  }

  return productosComparacion;
}

async function enviarSegundaFoto(from, imagenURL, texto) {
  try {
    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: from,
      body: texto,
      mediaUrl: [imagenURL]
    });
  } catch (e) {
    console.error('[TWILIO] Error enviando segunda foto:', e.message);
  }
}

// ─────────────────────────────────────────────
// NOTIFICACIONES TELEGRAM
// ─────────────────────────────────────────────

async function enviarNotificacionTelegram(telefono, mensaje, historial, tipo = 'asesor', producto = null, tipoPersonalizacion = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('[TELEGRAM] No configurado - omitiendo notificación');
    return;
  }

  const historialTexto = historial.slice(-6).map(m => {
    const rol = m.role === 'user' ? '👤' : '🤖';
    const contenido = m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content;
    return `${rol} ${contenido}`;
  }).join('\n');

  let titulo = '🆘 SOLICITUD DE ASESOR';
  if (tipo === 'pedido') titulo = '📦 NUEVO PEDIDO - DeCasa';
  else if (tipo === 'medida_personalizada' || tipo === 'personalizacion') titulo = '🎨 PERSONALIZACIÓN - DeCasa';
  else if (tipo === 'cita') titulo = '📅 NUEVA CITA - DeCasa';

  const texto = `
<b>${titulo}</b>
━━━━━━━━━━━━━━━━━━━━━━━
📱 <b>Cliente:</b> ${telefono}
${producto ? `📏 <b>Producto:</b> ${producto}\n` : ''}${tipoPersonalizacion ? `🎨 <b>Tipo:</b> ${tipoPersonalizacion}\n` : ''}💬 <b>Mensaje:</b> "${String(mensaje).substring(0, 200)}"
🕐 <b>Hora:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
━━━━━━━━━━━━━━━━━━━━━━━

📋 <b>Historial:</b>
${historialTexto}
━━━━━━━━━━━━━━━━━━━━━━━

💡 <a href="wa.me/${telefono.replace(/\D/g, '')}">Responder por WhatsApp</a>
`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const { fetchWithRetry } = require('./httpClient');

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true })
    }, 2, 10000);
    const result = await response.json();
    if (!response.ok) console.error('[TELEGRAM] Error:', response.status, JSON.stringify(result));
    else console.log(`[TELEGRAM] Notificación ${tipo} enviada`);
  } catch (error) {
    console.error('[TELEGRAM] Error enviando:', error.message);
  }
}

async function enviarNotificacionPedido(telefono, productos, historial) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  let listaProductos = '';
  let total = 0;

  productos.forEach((item, index) => {
    const cantidad = item.cantidad || 1;
    const precioUnitario = parseInt(String(item.precio).replace(/[^0-9]/g, '')) || 0;
    const precioTotal = precioUnitario * cantidad;
    listaProductos += `${index + 1}. ${item.producto} - ${item.precio}`;
    if (cantidad > 1) listaProductos += ` (${cantidad})`;
    listaProductos += `\n`;
    total += precioTotal;
  });

  const historialTexto = historial.slice(-4).map(m => {
    const rol = m.role === 'user' ? '👤' : '🤖';
    const contenido = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
    return `${rol} ${contenido}`;
  }).join('\n');

  const fechaActual = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' });

  const texto = `
📦 <b>NUEVO PEDIDO - DeCasa</b>
━━━━━━━━━━━━━━━━━━━━━━━━
📱 <b>Cliente:</b> ${telefono}
📅 <b>Fecha:</b> ${fechaActual}
━━━━━━━━━━━━━━━━━━━━━━━━

🛒 <b>Productos:</b>
${listaProductos}
💰 <b>Total:</b> $${total.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━

📋 <b>Conversación:</b>
${historialTexto}
━━━━━━━━━━━━━━━━━━━━━━━━

💡 <a href="wa.me/${telefono.replace(/\D/g, '')}">Responder por WhatsApp</a>
`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const { fetchWithRetry } = require('./httpClient');

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true })
    }, 2, 10000);
    if (!response.ok) console.error('[TELEGRAM] Error pedido:', response.status);
    else console.log('[TELEGRAM] Notificación pedido enviada');
  } catch (error) {
    console.error('[TELEGRAM] Error enviando pedido:', error.message);
  }
}

// ─────────────────────────────────────────────
// WEBHOOK PRINCIPAL
// ─────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || 'unknown';

  console.log(`[MSG] ${from}: ${incomingMsg}`);

  if (!incomingMsg) return res.status(200).send('');

  // FIX #1: Rate limiting
  if (estaEnCooldown(from)) {
    console.log(`[RATE] ${from} en cooldown - ignorando mensaje`);
    return res.status(200).send('');
  }

  try {
    await db.verificarYLimpiarInactividad(from);
    await db.getOrCreateUsuario(from);

    // SALUDO PURO → responder y salir
    const esSaludo = detectarSaludo(incomingMsg);
    if (esSaludo && esSoloSaludo(incomingMsg)) {
      console.log('[GREETING] Saludo puro detectado');
      const twiml = new MessagingResponse();
      twiml.message(SALUDO_INICIAL);
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // Limpiar estado de transferencia si el usuario escribe de nuevo
    const estaTransferidoAhora = await db.estaTransferida(from);
    const esTransferencia = detectarAsesor(incomingMsg);
    if (estaTransferidoAhora && !esTransferencia) {
      await db.updateEstado(from, { transferido: false });
    }

    const history = await db.getHistorial(from, 12);
    let response;
    let imagenURL = null;
    const mediaUrl = req.body.MediaUrl0;
    const mediaContentType = req.body.MediaContentType0;

    // ── CATÁLOGO / PDF ────────────────────────────────────────────
    if (detectarSolicitudCatalogo(incomingMsg)) {
      console.log('[CATALOG] Solicitud de catálogo');
      const categoriaGuardada = await db.getCategoriaActual(from);

      if (categoriaGuardada && knowledge.catalogos[categoriaGuardada]) {
        imagenURL = knowledge.catalogos[categoriaGuardada];
        response = `Claro! Aquí tienes el catálogo de ${formatearNombreCategoria(categoriaGuardada)} 😊`;
      } else {
        const catDetectada = buscarCatalogo(incomingMsg);
        if (catDetectada?.url) {
          imagenURL = catDetectada.url;
          response = `Claro! Aquí tienes el catálogo de ${formatearNombreCategoria(catDetectada.categoria)} 😊`;
        } else {
          const categoriasDisponibles = Object.keys(knowledge.catalogos).map(c => formatearNombreCategoria(c)).join(', ');
          response = `¿De qué categoría te gustaría ver el catálogo? 😊\n\nCategorías disponibles:\n${categoriasDisponibles}`;
        }
      }

      await db.addMensaje(from, 'user', incomingMsg);
      await db.addMensaje(from, 'assistant', response);
      await db.actualizarLastInteraction(from);

      const twiml = new MessagingResponse();
      if (imagenURL) {
        twiml.message({ body: response, mediaUrl: [imagenURL] });
      } else {
        twiml.message(response);
      }
      return res.type('text/xml').send(twiml.toString());
    }

    // ── IMAGEN RECIBIDA (foto de sala) ────────────────────────────
    if (mediaUrl && mediaContentType?.startsWith('image/')) {
      console.log('[IMG] Imagen recibida de:', from);

      const twiml = new MessagingResponse();
      twiml.message('⏳ Recibí tu foto! Estoy procesando la imagen para agregar un sofá... ⏳');
      res.type('text/xml').send(twiml.toString());

      try {
        const result = await processRoomImage(mediaUrl);
        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        if (result.success) {
          await twilioClient.messages.create({
            from: req.body.To, to: from,
            body: '¡Aquí tienes tu sala con el nuevo sofá! 😊 ¿Te gustaría ver más opciones de sofás en nuestro catálogo?',
            mediaUrl: [result.imageUrl]
          });
        } else {
          await twilioClient.messages.create({
            from: req.body.To, to: from,
            body: 'Disculpa, tuve un problema procesando tu foto 😊\n\n¿Te gustaría ver nuestro catálogo de sofás? Tenemos más de 15 modelos disponibles. 😊'
          });
        }
      } catch (error) {
        console.error('[IMG] Error procesando imagen:', error);
      }
      return;
    }

    // ── TRANSFERENCIA A ASESOR ────────────────────────────────────
    const esAsesorDetectado = detectarAsesor(incomingMsg);
    const rawTransferencia = await db.getTransferenciaMedidaPendiente(from);
    let transferenciaMedidaPendiente = rawTransferencia
      ? (typeof rawTransferencia === 'object' ? rawTransferencia : { producto: rawTransferencia, solicitud: null })
      : null;

    const msgTrim = incomingMsg.trim().toLowerCase();
    // FIX #2: esAfirmativo más preciso - excluye saludos y expresiones de cortesía
    const esAfirmativo = /^(si|sí|claro|dale|ok|ya|de una|confirmo|por favor|listo|vamos|porfa)(\s|$|,|\.|!)/i.test(msgTrim) &&
      !/^(buenos?|buenas?)\s/i.test(msgTrim) &&
      !/^(si\s+tienes?|si\s+hay|si\s+claro|si\s+me\s+puedes?)/i.test(msgTrim);

    let debeTransferir = esAsesorDetectado;
    let esTransferenciaMedida = false;

    if (transferenciaMedidaPendiente && esAfirmativo) {
      debeTransferir = true;
      esTransferenciaMedida = true;
      console.log(`[TRANSFER] Confirmada transferencia por medida: ${from}`);
    }

    if (!debeTransferir && (detectarMedidaPersonalizada(incomingMsg) || detectarPersonalizacion(incomingMsg))) {
      const productoPendiente = await db.getProductoPendiente(from);
      const ultimoProd = await db.getUltimoProducto(from);
      const producto = productoPendiente?.producto || ultimoProd?.nombre;

      if (producto) {
        await db.setTransferenciaMedidaPendiente(from, { producto, solicitud: incomingMsg });
        response = `Entiendo que necesitas una personalización para ${producto}. ¿Te gustaría que te transfiera con un asesor especializado en diseño a medida? 😊`;

        await db.addMensaje(from, 'assistant', response);
        await db.actualizarLastInteraction(from);
        const twiml = new MessagingResponse();
        twiml.message(response);
        return res.type('text/xml').send(twiml.toString());
      }
    }

    // Verificar si bot ofreció transferencia y usuario confirma
    if (!debeTransferir) {
      const ultimoMensajeBot = history.filter(h => h.role === 'assistant').pop();
      const ofrecioTransferencia = ultimoMensajeBot && (
        ultimoMensajeBot.content.includes('asesor') ||
        ultimoMensajeBot.content.includes('transfiera') ||
        ultimoMensajeBot.content.includes('personalización')
      );

      if (ofrecioTransferencia && esAfirmativo) {
        const telefono = from.replace('whatsapp:', '');
        const esPersonalizacion = ultimoMensajeBot.content.includes('personalización') ||
          ultimoMensajeBot.content.includes('medida') || ultimoMensajeBot.content.includes('diseño a medida');

        if (esPersonalizacion && transferenciaMedidaPendiente?.producto) {
          await enviarNotificacionTelegram(telefono, transferenciaMedidaPendiente.solicitud || incomingMsg,
            history, 'personalizacion', transferenciaMedidaPendiente.producto, 'personalización');
        } else {
          await enviarNotificacionTelegram(telefono, 'Solicitud de transferencia a asesor', history);
        }

        await db.marcarTransferida(from);
        response = "¡Perfecto! Te transfiero con un asesor especializado. Por favor, espera un momento. 😊";

        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);
        await db.addMensaje(from, 'assistant', response);
        await db.actualizarLastInteraction(from);
        const twiml = new MessagingResponse();
        twiml.message(response);
        return res.type('text/xml').send(twiml.toString());
      }
    }

    // Ejecutar transferencia
    if (debeTransferir && !(await db.estaTransferida(from))) {
      const telefono = from.replace('whatsapp:', '');

      if (esTransferenciaMedida) {
        const nombreProducto = transferenciaMedidaPendiente?.producto || 'Producto no especificado';
        const solicitudUsuario = transferenciaMedidaPendiente?.solicitud || incomingMsg;
        const esColor = /en (negro|blanco|azul|rojo|verde)/i.test(solicitudUsuario);
        const esMaterial = /de (roble|pino|cedro|cuero|tela)/i.test(solicitudUsuario);
        const tipoPersonalizacion = esColor ? 'color' : (esMaterial ? 'material' : 'medida');

        await enviarNotificacionTelegram(telefono, solicitudUsuario, history, 'personalizacion', nombreProducto, tipoPersonalizacion);
        await db.marcarTransferida(from);
        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setTransferenciaMedidaPendiente(from, null);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);

        response = `Entiendo! Te transfiero con un asesor especializado en personalización. Él te ayudará con los ajustes que necesitas para ${nombreProducto}. 😊\n\nUn asesor te contactará en breve.`;

      } else {
        const itemsCarrito = await db.verCarrito(from);

        if (itemsCarrito.length > 0) {
          let productosTxt = '';
          let total = 0;
          itemsCarrito.forEach((item, i) => {
            const cant = item.cantidad || 1;
            const precio = parseInt(String(item.precio).replace(/[^0-9]/g, '')) || 0;
            productosTxt += `${i + 1}. ${item.producto} - ${item.precio}`;
            if (cant > 1) productosTxt += ` (${cant} unidades)`;
            productosTxt += '\n';
            total += precio * cant;
          });
          productosTxt += `\n─────────────────\n💰 Total: $${total.toLocaleString()}`;

          response = `📦 Tu pedido ha sido derivado a un asesor:\n\n${productosTxt}\n\nUn asesor te contactará pronto para confirmar entrega y pago. 🎉${generarMensajeInstagram()}`;

          for (const item of itemsCarrito) {
            await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
          }
          await db.marcarPedidoConfirmado(from);
          await enviarNotificacionTelegram(telefono, incomingMsg, history, 'pedido');
          await db.limpiarConversaciones(from);
          await db.setCategoriaActual(from, null);
          await db.limpiarCarrito(from);

        } else {
          await enviarNotificacionTelegram(telefono, incomingMsg, history, 'asesor');
          await db.marcarTransferida(from);
          await db.limpiarConversaciones(from);
          await db.clearProductoPendiente(from);
          await db.setCategoriaActual(from, null);
          await db.limpiarCarrito(from);

          response = `Te transfiero con un asesor, espera un momento 😊\nUn asesor te atenderá personalmente para ayudarte.`;
        }
      }

      imagenURL = null;
    }

    // ── AGENDACIÓN ────────────────────────────────────────────────
    else if (await db.getEstaAgendando(from)) {
      const paso = await db.getPasoAgendacion(from);
      const datos = await db.getDatosAgendacion(from);

      if (detectarCancelarAgendacion(incomingMsg)) {
        await db.cancelarAgendacion(from);
        response = `Has cancelado la agendación de cita.\n\n¿Hay algo más en lo que pueda ayudarte? 😊`;
      } else if (paso === 1) {
        const nombre = incomingMsg.trim();
        if (nombre.length < 2) {
          response = `Por favor ingresa tu nombre completo.\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.nombre = nombre;
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 2);
          response = `Selecciona la sede:\n\n📍 *UBICACIONES:*\n1. Av. Bolívar # 16 N 26, Armenia\n2. Km 2 vía El Edén, Armenia\n3. Km 1 vía Jardines, Armenia\n4. CC Unicentro Pereira\n5. Cra. 14 #11 - 93. Pereira, Risaralda\n\nEjemplo: 1\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 2) {
        if (!esUbicacionValida(incomingMsg)) {
          response = `Por favor ingresa el número de la sede (1, 2, 3, 4 o 5).\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.ubicacion = parseInt(incomingMsg.trim());
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 3);
          response = `¿Qué día te queda disponible?\n\n📅 L-V: 8am-5pm | Sábado: 8am-12pm\n\nEjemplo: lunes o miercoles\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 3) {
        if (!esDiaValido(incomingMsg)) {
          response = `Por favor ingresa un día válido: lunes, martes, miercoles, jueves, viernes o sabado.\n\nPara cancelar escribe "cancelar"`;
        } else {
          const msg = incomingMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').trim().replace(/^el\s+/, '');
          datos.dia = msg.charAt(0).toUpperCase() + msg.slice(1);
          datos.esSabado = esSabado(incomingMsg);
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 4);
          const horarioInfo = datos.esSabado ? '📅 Horario sábado: 8 am a 11 am\n\n' : '📅 Horario: 8 am a 4 pm\n\n';
          response = `${horarioInfo}¿A qué hora deseas visitarnos?\n\nEjemplo: 14 o 14:30\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 4) {
        if (!esHoraValida(incomingMsg, datos.esSabado || false)) {
          response = `Hora no válida.\n\n📅 ${datos.esSabado ? 'Sábado: 8am-11am' : 'L-V: 8am-4pm'}\n\nEjemplo: 14 o 14:30\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.hora = formatearHora(incomingMsg);
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 5);
          response = `¿Cuál es el motivo de tu visita?\n\nEjemplo: ver productos, cotizar una mesa\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 5) {
        const razon = incomingMsg.trim();
        if (razon.length < 3) {
          response = `Por favor ingresa una descripción más completa.\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.razon = razon;
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 6);
          response = `📅 *RESUMEN DE TU CITA*
━━━━━━━━━━━━━━━━━━━━━━━━
👤 Nombre: ${datos.nombre}
📞 Teléfono: ${from.replace('whatsapp:', '')}
📍 Ubicación: ${datos.ubicacion}. ${formatearNombreUbicacion(datos.ubicacion)}
📅 Día: ${datos.dia}
🕐 Hora: ${datos.hora}
📝 Motivo: ${datos.razon}
━━━━━━━━━━━━━━━━━━━━━━━━

¿Confirmas esta cita? Responde "sí" para confirmar

Para cancelar escribe "cancelar"`;
        }
      } else if (paso === 6) {
        const confirm = incomingMsg.toLowerCase().trim();
        if (confirm === 'sí' || confirm === 'si' || confirm === 'confirmar') {
          await db.guardarCita(from, datos);
          const telefonoClean = from.replace('whatsapp:', '');
          response = `¡Cita agendada exitosamente!\n\n📅 *DETALLES*\n👤 ${datos.nombre} | 📅 ${datos.dia} | 🕐 ${datos.hora}\n📍 ${formatearNombreUbicacion(datos.ubicacion)}\n\n¡Te esperamos! 😊`;
          const msgTelegram = `📅 *NUEVA CITA*\n👤 ${datos.nombre} (${telefonoClean})\n📅 ${datos.dia} | 🕐 ${datos.hora}\n📍 ${formatearNombreUbicacion(datos.ubicacion)}\n📝 ${datos.razon}`;
          await enviarNotificacionTelegram(telefonoClean, msgTelegram, [], 'cita');
        } else {
          response = `Para confirmar escribe "sí" o "confirmar"\n\nPara cancelar escribe "cancelar"`;
        }
      }
    }

    // ── COMPARACIÓN PENDIENTE ─────────────────────────────────────
    else if (await db.getComparacionPendiente(from)) {
      if (detectarRespuestaComparacion(incomingMsg)) {
        const prefs = extraerPreferencias(incomingMsg);
        const recomendaciones = recomendarPorPreferencias(prefs);
        await db.clearComparacionPendiente(from);
        response = recomendaciones || "¿Qué categoría te interesa? 😊";
      } else {
        response = "Para ayudarte mejor, dime:\n\n1. 💰 ¿Cuál es tu presupuesto?\n2. 🎨 ¿Qué estilo prefieres?\n3. 📏 ¿Para qué espacio?\n\n¿o prefieres ver el catálogo? 😊";
      }
    }

    // ── COMPARACIÓN NUEVA ─────────────────────────────────────────
    else if (detectarComparacion(incomingMsg)) {
      const comparacion = await compararProductos(from, incomingMsg);
      if (comparacion) {
        response = comparacion;
      } else {
        await db.setComparacionPendiente(from, {});
        response = "¡Claro! Para recomendarte mejor:\n\n1. 💰 ¿Cuál es tu presupuesto?\n2. 🎨 ¿Qué estilo prefieres?\n3. 📏 ¿Para qué espacio?\n\n¿o prefieres ver el catálogo? 😊";
      }
    }

    // ── FOTOS MÚLTIPLES ───────────────────────────────────────────
    else if (detectarFotoMultiple(incomingMsg)) {
      const productosComp = await db.getComparacionProductos(from);
      if (productosComp && productosComp.length >= 2) {
        const seleccionados = extraerFotoMultiple(incomingMsg, productosComp);
        if (seleccionados && seleccionados.length >= 2) {
          imagenURL = seleccionados[0].imagen;
          response = `Aquí tienes las fotos 😊`;
          for (let i = 1; i < seleccionados.length; i++) {
            if (seleccionados[i].imagen) await enviarSegundaFoto(from, seleccionados[i].imagen, '');
          }
          await db.clearComparacionProductos(from);
        } else if (seleccionados?.length === 1) {
          imagenURL = seleccionados[0].imagen;
          response = `Aquí tienes la foto de ${seleccionados[0].nombre} 😊`;
          await db.clearComparacionProductos(from);
        } else {
          response = "No encontré las fotos. ¿Qué producto te interesa? 😊";
        }
      } else {
        response = "¿De qué productos quieres ver la foto? 😊";
      }
    }

    // ── CANDIDATOS AMBIGUOS PENDIENTES ────────────────────────────
    else if (await db.getCandidatosPendientes(from)) {
      if (detectarSolicitudFoto(incomingMsg)) {
        const producto = buscarImagenProducto(incomingMsg);
        if (producto) {
          imagenURL = producto.imagen;
          response = `Claro! Aquí tienes la ${producto.nombre} 😊`;
        } else {
          response = "Dime qué producto te interesa y te envío la foto 😊";
        }
      } else {
        const pendientes = await db.getCandidatosPendientes(from);
        const elegido = resolverCandidatoAmbiguo(incomingMsg, pendientes.candidatos);
        if (elegido) {
          await db.clearCandidatosPendientes(from);
          await db.setCategoriaActual(from, elegido.categoria);
          await db.setUltimoProducto(from, { nombre: elegido.nombre, precio: elegido.precio, categoria: elegido.categoria });
          await db.guardarProductoPendiente(from, elegido.nombre, elegido.precio);
          response = `${elegido.nombre}\n💰 Precio: ${elegido.precio}\n📏 Medidas: ${elegido.medidas || 'No disponible'}\n🪵 Material: ${elegido.material || 'No disponible'}\n\n¿Procedemos a añadirlo al carrito? 😊`;
        } else {
          response = formatearMensajeAmbiguo(pendientes.candidatos);
        }
      }
    }

    // ── AGENDAR CITA ──────────────────────────────────────────────
    else if (detectarAgendar(incomingMsg)) {
      await db.iniciarAgendacion(from);
      response = `📅 *AGENDAR CITA*\n\nCon gusto te ayudo a agendar una visita.\n\nPrimero, ¿cuál es tu nombre?\n\nPara cancelar escribe "cancelar"`;
    }

    // ── SALUDO CON CONTENIDO ──────────────────────────────────────
    else if (esSaludo) {
      await db.addMensaje(from, 'user', incomingMsg);
      if (!(await db.haEnviadoSaludo(from))) await db.marcarSaludoEnviado(from);
      response = SALUDO_INICIAL;
    }

    // ── UBICACIÓN ─────────────────────────────────────────────────
    else if (detectarUbicacion(incomingMsg)) {
      response = generarRespuestaContactoUbicacion();
    }

    // ── YA TRANSFERIDO ────────────────────────────────────────────
    else if (await db.estaTransferida(from)) {
      const telefono = from.replace('whatsapp:', '');
      console.log(`[TRANSFER] Cliente transferido ${telefono} dice: ${incomingMsg}`);
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        await enviarNotificacionTelegram(telefono, incomingMsg, []);
      }
      return res.status(200).send('');
    }

    // FIX #3: OBJECIÓN DE PRECIO ──────────────────────────────────
    else if (detectarObjecionPrecio(incomingMsg)) {
      const categoriaActual = await db.getCategoriaActual(from);
      const ultimoProd = await db.getUltimoProducto(from);

      console.log(`[PRECIO] Objeción de precio detectada - categoría: ${categoriaActual}`);

      const respuestaObjecion = generarRespuestaObjecion(categoriaActual, ultimoProd);
      if (respuestaObjecion) {
        response = respuestaObjecion;
      } else {
        // Si no hay categoría activa, buscar la alternativa más barata globalmente
        const masBarato = buscarMasBarato(categoriaActual) || utils.buscarMasBaratoGlobal();
        if (masBarato) {
          response = `Entiendo tu presupuesto. Te puedo mostrar opciones más accesibles:\n\n📌 ${masBarato.nombre} - ${masBarato.precio}\n\n¿Te interesa ver más opciones económicas? 😊`;
        } else {
          // Fallback: enviar a Gemini para manejar la objeción
          await db.addMensaje(from, 'user', incomingMsg);
          response = await callGemini({ history, currentMessage: incomingMsg });
        }
      }
    }

    // ── MÁS BARATO EXPLÍCITO ──────────────────────────────────────
    else if (detectarMasBarato(incomingMsg)) {
      const categoria = await db.getCategoriaActual(from);
      if (categoria && knowledge.inventario[categoria]) {
        const masBarato = buscarMasBarato(categoria);
        if (masBarato) {
          response = `La opción más económica en ${formatearNombreCategoria(categoria)} es:\n\n📌 ${masBarato.nombre} - ${masBarato.precio}\n\n¿Te interesa? 😊`;
        }
      } else {
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        if (resultadoCategoria.categoria) {
          const masBarato = buscarMasBarato(resultadoCategoria.categoria);
          if (masBarato) {
            await db.setCategoriaActual(from, resultadoCategoria.categoria);
            response = `La opción más económica es:\n\n📌 ${masBarato.nombre} - ${masBarato.precio}\n\n¿Te interesa? 😊`;
          }
        } else {
          response = "¿De qué categoría quieres la opción más económica? 😊";
        }
      }
    }

    // ── FOTO DE PRODUCTO ──────────────────────────────────────────
    else if (detectarSolicitudFoto(incomingMsg)) {
      const producto = buscarImagenProducto(incomingMsg);
      if (producto) {
        imagenURL = producto.imagen;
        response = `Claro! Aquí tienes la ${producto.nombre} 😊`;
      } else {
        response = "Dime qué producto te interesa y te envío la foto 😊";
      }
    }

    // ── CONSULTA GENÉRICA DE CATEGORÍA ───────────────────────────
    else if (esConsultaGenericaCategoria(incomingMsg)) {
      const msgLower = incomingMsg.toLowerCase();
      if (msgLower.includes('silla')) {
        response = formatearPreguntaSubtipo('sillas_comedor', incomingMsg);
        await db.setSubtipoPendiente(from, 'sillas_comedor');
      } else if (msgLower.includes('mesa')) {
        response = formatearPreguntaSubtipo('mesas_centro', incomingMsg);
        await db.setSubtipoPendiente(from, 'mesas_centro');
      } else {
        const porCategoria = buscarProductosPorCategoria(incomingMsg);
        if (porCategoria.categoria && porCategoria.productos.length > 0) {
          await db.setCategoriaActual(from, porCategoria.categoria);
          response = formatearProductosVenta(porCategoria.productos);
          if (porCategoria.categoria === 'bases_comedores') {
            response += "\n\n💡 La base del comedor se vende sin sillas incluidas. Puedes elegir las sillas por separado. 🪑";
          }
        } else {
          response = "¿Qué categoría de muebles te interesa ver? 😊";
        }
      }
    }

    // ── CONSULTA PRECIO ───────────────────────────────────────────
    else if (detectarConsultaPrecio(incomingMsg)) {
      const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
      const subtipo = necesitaSubtipo(incomingMsg, categoriaDetectada);
      if (subtipo === 'PEDIR_SUBTIPO') {
        response = formatearPreguntaSubtipo(categoriaDetectada, incomingMsg);
        await db.setSubtipoPendiente(from, categoriaDetectada);
      } else if (subtipo) {
        const productosSubtipo = knowledge.inventario[subtipo]?.productos || [];
        if (productosSubtipo.length > 0) {
          await db.setCategoriaActual(from, subtipo);
          response = formatearProductosVenta(productosSubtipo);
        }
      }

      if (!response) {
        const catBD = await db.getCategoriaActual(from);
        const producto = buscarProductoPorNombre(incomingMsg, categoriaDetectada, catBD);

        if (producto && !producto.ambiguo) {
          await db.setCategoriaActual(from, producto.categoria || categoriaDetectada || catBD);
          await db.setUltimoProducto(from, { nombre: producto.nombre, precio: producto.precio, categoria: producto.categoria });
          response = `${producto.nombre} - ${producto.precio}\n\n¿Te interesa? 😊`;
        } else if (producto?.ambiguo && producto.candidatos) {
          await db.guardarCandidatosPendientes(from, producto.candidatos, incomingMsg);
          response = formatearMensajeAmbiguo(producto.candidatos);
        } else {
          const cat2 = categoriaDetectada || catBD;
          if (cat2 && knowledge.inventario[cat2]) {
            response = formatearProductosVenta(knowledge.inventario[cat2].productos);
            await db.setCategoriaActual(from, cat2);
          } else {
            await db.addMensaje(from, 'user', incomingMsg);
            response = await callGemini({ history, currentMessage: incomingMsg });
          }
        }
      }
    }

    // ── CONSULTA INFO ─────────────────────────────────────────────
    else if (detectarConsultaInfo(incomingMsg)) {
      const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
      const catBD = await db.getCategoriaActual(from);
      const subtipo = necesitaSubtipo(incomingMsg, categoriaDetectada);

      if (subtipo === 'PEDIR_SUBTIPO') {
        response = formatearPreguntaSubtipo(categoriaDetectada, incomingMsg);
        await db.setSubtipoPendiente(from, categoriaDetectada);
      } else if (subtipo) {
        const productosSubtipo = knowledge.inventario[subtipo]?.productos || [];
        if (productosSubtipo.length > 0) {
          await db.setCategoriaActual(from, subtipo);
          response = formatearProductosVenta(productosSubtipo);
          if (['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'].includes(subtipo)) {
            response += "\n\n💡 Las sillas se venden por unidad y por separado de la base del comedor. 🪑";
          }
        }
      }

      if (!response) {
        const productoInfo = buscarInfoProducto(incomingMsg, categoriaDetectada, catBD);
        if (productoInfo?.ambiguo && productoInfo.candidatos) {
          await db.guardarCandidatosPendientes(from, productoInfo.candidatos, incomingMsg);
          response = formatearMensajeAmbiguo(productoInfo.candidatos);
        } else if (productoInfo) {
          await db.setUltimoProducto(from, { nombre: productoInfo.nombre, precio: productoInfo.precio });
          await db.guardarProductoPendiente(from, productoInfo.nombre, productoInfo.precio);
          response = `${productoInfo.nombre}\n💰 Precio: ${productoInfo.precio}\n📏 Medidas: ${productoInfo.medidas}\n🪵 Material: ${productoInfo.material}\n\n¿Procedemos a añadirla al carrito? 😊`;
        } else {
          const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
          if (resultadoCategoria.productos?.length > 0) {
            if (resultadoCategoria.categoria) await db.setCategoriaActual(from, resultadoCategoria.categoria);
            response = formatearProductosVenta(resultadoCategoria.productos);
          } else {
            await db.addMensaje(from, 'user', incomingMsg);
            response = await callGemini({ history, currentMessage: incomingMsg });
          }
        }
      }
    }

    // ── CATÁLOGO / CATEGORÍA ──────────────────────────────────────
    else if (
      incomingMsg.toLowerCase().includes('comedores') ||
      incomingMsg.toLowerCase().includes('comedor') ||
      incomingMsg.toLowerCase().includes('camas') ||
      incomingMsg.toLowerCase().includes('sillas') ||
      incomingMsg.toLowerCase().includes('sofás') ||
      incomingMsg.toLowerCase().includes('sofas') ||
      incomingMsg.toLowerCase().includes('colchon') ||
      incomingMsg.toLowerCase().includes('bases de')
    ) {
      const msgLower = incomingMsg.toLowerCase();

      if (/que.*sillas|tiene.*sillas|ver.*sillas|tipos.*silla|sillas tienen/i.test(msgLower)) {
        response = formatearPreguntaSubtipo('sillas_comedor', incomingMsg);
        await db.setSubtipoPendiente(from, 'sillas_comedor');
      } else if (/que.*mesas|tiene.*mesas|ver.*mesas|tipos.*mesa|mesas tienen/i.test(msgLower)) {
        response = formatearPreguntaSubtipo('mesas_centro', incomingMsg);
        await db.setSubtipoPendiente(from, 'mesas_centro');
      } else {
        let porCategoria = buscarProductosPorCategoria(incomingMsg);
        let catalogo = null;

        const categoriaGuardada = await db.getCategoriaActual(from);
        if (categoriaGuardada && knowledge.catalogos[categoriaGuardada] && !porCategoria.categoria) {
          catalogo = { categoria: categoriaGuardada, url: knowledge.catalogos[categoriaGuardada] };
        }

        if (!porCategoria.categoria && !catalogo) {
          const catalogoBuscado = buscarCatalogo(incomingMsg);
          if (catalogoBuscado?.url && catalogoBuscado.categoria) {
            catalogo = catalogoBuscado;
            porCategoria = { categoria: catalogoBuscado.categoria, productos: [] };
          } else if (catalogoBuscado?.sinPdf && catalogoBuscado.categoria && catalogoBuscado.productos) {
            porCategoria = { categoria: catalogoBuscado.categoria, productos: catalogoBuscado.productos };
            await db.setCategoriaActual(from, catalogoBuscado.categoria);
          }
        }

        if (!catalogo && porCategoria.categoria && knowledge.catalogos[porCategoria.categoria]) {
          catalogo = { categoria: porCategoria.categoria, url: knowledge.catalogos[porCategoria.categoria] };
          await db.setCategoriaActual(from, porCategoria.categoria);
        }

        if (catalogo?.url) {
          imagenURL = catalogo.url;
          response = `Claro! Aquí tienes el catálogo de ${formatearNombreCategoria(catalogo.categoria)} 😊`;
        } else if (porCategoria.productos?.length > 0) {
          if (porCategoria.categoria) await db.setCategoriaActual(from, porCategoria.categoria);
          response = formatearProductosVenta(porCategoria.productos);
          if (porCategoria.categoria === 'bases_comedores') {
            response += "\n\n💡 La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
          }
        } else {
          const categoriasDisponibles = Object.keys(knowledge.catalogos).map(c => formatearNombreCategoria(c)).join(', ');
          response = `Estas son las categorías disponibles:\n${categoriasDisponibles}\n\n¿Cuál te gustaría ver? 😊`;
        }
      }
    }

    // ── SUBTIPO PENDIENTE ─────────────────────────────────────────
    else if (await db.getSubtipoPendiente(from)) {
      const contexto = await db.getSubtipoPendiente(from);
      const categoriaResuelta = resolverRespuestaSubtipo(incomingMsg, contexto.categoriaPadre);
      if (categoriaResuelta && knowledge.inventario[categoriaResuelta]) {
        await db.clearSubtipoPendiente(from);
        await db.setCategoriaActual(from, categoriaResuelta);
        response = formatearProductosVenta(knowledge.inventario[categoriaResuelta].productos);
        if (['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'].includes(categoriaResuelta)) {
          response += "\n\n💡 Las sillas se venden por unidad y por separado de la base del comedor. 🪑";
        }
      } else {
        await db.clearSubtipoPendiente(from);
      }
    }

    // ── VER CARRITO ───────────────────────────────────────────────
    else if (detectarVerCarrito(incomingMsg)) {
      const carritoData = await formatearCarrito(from);
      if (carritoData?.mensaje) {
        response = `${carritoData.mensaje}\n\n¿Confirmas la compra? Responde "confirmo" para proceder 😊`;
      } else {
        response = "Tu carrito está vacío. ¿Qué producto te gustaría comprar? 😊";
      }
    }

    // ── LIMPIAR CARRITO ───────────────────────────────────────────
    else if (detectarLimpiarCarrito(incomingMsg)) {
      const itemsCarrito = await db.verCarrito(from);
      if (itemsCarrito.length === 0) {
        response = "Tu carrito está vacío. ¿Qué te gustaría comprar? 😊";
      } else if (itemsCarrito.length === 1) {
        await db.limpiarCarrito(from);
        await db.clearProductoPendiente(from);
        response = `${itemsCarrito[0].producto} eliminado del carrito.\n\n¿Qué te gustaría comprar? 😊`;
      } else {
        const msgLower = incomingMsg.toLowerCase();
        let productoEliminado = null;
        for (const item of itemsCarrito) {
          if (msgLower.includes(item.producto.toLowerCase().substring(0, 10))) {
            productoEliminado = item;
            break;
          }
        }
        if (productoEliminado) {
          const itemsActualizados = itemsCarrito.filter(item => item.producto !== productoEliminado.producto);
          await db.updateEstado(from, { carrito: itemsActualizados });
          await db.clearProductoPendiente(from);
          response = `${productoEliminado.producto} eliminado. Tu carrito tiene ${itemsActualizados.length} producto(s).`;
        } else {
          const carritoFormateado = await formatearCarrito(from);
          response = carritoFormateado?.mensaje
            ? `${carritoFormateado.mensaje}\n\nDime cuál producto quieres eliminar. 😊`
            : "¿Cuál producto quieres quitar del carrito? 😊";
        }
      }
    }

    // ── FLUJO PRINCIPAL: COMPRA / AGREGAR AL CARRITO ──────────────
    else if (!(await db.estaTransferida(from))) {
      const pendiente = await db.getProductoPendiente(from);
      const itemsEnCarrito = await db.verCarrito(from);

      // FIX #2: Separar confirmación simple de confirmación explícita
      const esConfirmacionExplicita = detectarCompraExplicita(incomingMsg);
      // "sí" o "confirmo" solo son válidos si hay items en carrito o producto pendiente
      const esConfirmacionSimple = /^(si|sí|ok|confirmo|procede|listo)$/i.test(incomingMsg.trim());

      if ((esConfirmacionExplicita || esConfirmacionSimple) && itemsEnCarrito.length > 0) {
        const telefono = from.replace('whatsapp:', '');
        let productosTxt = '';
        let totalConfirmado = 0;
        itemsEnCarrito.forEach((item, i) => {
          const cant = item.cantidad || 1;
          const precio = parseInt(String(item.precio).replace(/[^0-9]/g, '')) || 0;
          productosTxt += `${i + 1}. ${item.producto} - ${item.precio}`;
          if (cant > 1) productosTxt += ` (${cant} unidades)`;
          productosTxt += '\n';
          totalConfirmado += precio * cant;
        });

        response = `📦 ¡Pedido confirmado!\n\n🛒 Tu pedido:\n${productosTxt}─────────────────\n💰 Total: $${totalConfirmado.toLocaleString()}\n\n¡Gracias por tu compra!\nUn asesor te contactará pronto. 🎉${generarMensajeInstagram()}`;

        for (const item of itemsEnCarrito) {
          await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
        }
        await db.marcarPedidoConfirmado(from);
        await enviarNotificacionPedido(telefono, itemsEnCarrito, history);
        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);

      } else if (esConfirmacionSimple && pendiente) {
        // Confirmar producto pendiente → agregar al carrito
        const cantidad = detectarCantidad(incomingMsg) || pendiente.cantidad || 1;
        await agregarAlCarritoDB(from, pendiente.producto, pendiente.precio, cantidad);
        await db.clearProductoPendiente(from);
        response = `${pendiente.producto} añadido al carrito (${cantidad} unidad${cantidad > 1 ? 'es' : ''}).\n\n¿Quieres ver el carrito o seguir viendo productos? 😊`;

      } else if (esConfirmacionSimple) {
        // "sí" sin contexto claro - mostrar carrito o pedir qué quiere
        const carritoData = await formatearCarrito(from);
        if (carritoData?.mensaje) {
          response = `${carritoData.mensaje}\n\n¿Confirmas la compra? Responde "confirmo" para proceder 😊`;
        } else {
          response = "¿Qué te gustaría comprar? Cuéntame y te ayudo 😊";
        }

      } else {
        // Flujo normal: detectar producto y acción
        const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
        const catBD = await db.getCategoriaActual(from);
        let productoDetectado = null;

        if (!esFraseCompraGenerica(incomingMsg)) {
          productoDetectado = buscarProductoPorNombre(incomingMsg, categoriaDetectada, catBD);
        }

        if (productoDetectado?.ambiguo && productoDetectado.candidatos) {
          await db.guardarCandidatosPendientes(from, productoDetectado.candidatos, incomingMsg);
          response = formatearMensajeAmbiguo(productoDetectado.candidatos);
          productoDetectado = null;
        }

        if (!productoDetectado && catBD) {
          const resultadoDescripcion = buscarPorDescripcion(incomingMsg, catBD);
          if (resultadoDescripcion) {
            productoDetectado = { nombre: resultadoDescripcion.nombre, precio: resultadoDescripcion.precio, categoria: catBD };
          }
        }

        if (!productoDetectado) {
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd?.nombre) {
            const msg = incomingMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const nombreLimpio = ultimoProd.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 3);
            const palabrasMsg = msg.split(' ').filter(p => p.length > 3);
            const coincidencias = palabrasMsg.filter(pm => palabrasProd.some(pp => pp.includes(pm) || pm.includes(pp)));
            if (coincidencias.length >= 1) {
              productoDetectado = { nombre: ultimoProd.nombre, precio: ultimoProd.precio, categoria: ultimoProd.categoria };
            }
          }
        }

        // FIX #2: detectarIntentionAddCarrito sin el patrón genérico /\b(lo|la|les)\b/i
        const quiereAgregar = detectarCompraExplicita(incomingMsg) || detectarIntentionAddCarrito(incomingMsg);

        if (!response && productoDetectado && quiereAgregar) {
          const cat = buscarProductosPorCategoria(incomingMsg);
          const catActual = cat.categoria || productoDetectado.categoria || catBD;
          if (catActual) await db.setCategoriaActual(from, catActual);

          const productoInfo = buscarInfoProducto(productoDetectado.nombre, catActual);
          await db.setUltimoProducto(from, { nombre: productoDetectado.nombre, precio: productoDetectado.precio, categoria: catActual });

          const cantidadDetectada = detectarCantidad(incomingMsg);
          await db.guardarProductoPendiente(from, productoDetectado.nombre, productoDetectado.precio, cantidadDetectada);

          response = `${productoDetectado.nombre}\n💰 Precio: ${productoDetectado.precio}\n📏 Medidas: ${productoInfo?.medidas || 'No disponible'}\n🪵 Material: ${productoInfo?.material || 'No disponible'}\n\n¿Confirmas agregar al carrito? Responde "sí" para confirmar 😊`;

        } else if (!response && !productoDetectado && quiereAgregar) {
          if (pendiente?.producto) {
            const cantidadDetectada = detectarCantidad(incomingMsg) || 1;
            const result = await agregarAlCarritoDB(from, pendiente.producto, pendiente.precio, cantidadDetectada);
            if (result.success) {
              await db.clearProductoPendiente(from);
              response = `${pendiente.producto} añadido al carrito!\n\n¿Quieres ver el carrito o seguir viendo? 😊`;
            } else {
              response = result.mensaje;
            }
          } else {
            response = "¿Qué producto deseas agregar al carrito? 😊";
          }
        }

        // Si aún no hay respuesta, ir a Gemini
        if (!response) {
          const catResult = buscarProductosPorCategoria(incomingMsg);
          if (catResult.categoria) await db.setCategoriaActual(from, catResult.categoria);

          if (!esMensajeRelevante(incomingMsg) && !catResult.categoria) {
            if (patronesContactoUbicacion.test(incomingMsg)) {
              response = generarRespuestaContactoUbicacion();
            } else {
              response = `Disculpa, solo puedo ayudarte con información sobre nuestros muebles de DeCasa 😊\n\n¿Te puedo mostrar nuestro catálogo? 📦${generarMensajeDespedida()}`;
            }
          } else {
            await db.addMensaje(from, 'user', incomingMsg);
            response = await callGemini({ history, currentMessage: incomingMsg });

            // FIX #4: Si Gemini parece no saber, agregar fallback
            if (response && !respuestaGeminiEsConfiable(response)) {
              const catActual = await db.getCategoriaActual(from);
              if (catActual && knowledge.inventario[catActual]) {
                const productosFallback = knowledge.inventario[catActual].productos.slice(0, 3);
                response += `\n\nMientras tanto, te muestro algunas opciones de ${formatearNombreCategoria(catActual)}:\n`;
                productosFallback.forEach(p => {
                  response += `• ${p.nombre} - ${p.precio}\n`;
                });
              }
            }
          }
        }
      }
    } else {
      // Estado transferido - ya manejado arriba
    }

    // Respuesta fallback si algo falla
    if (!response || response === 'undefined' || response === 'null') {
      response = SALUDO_INICIAL;
    }

    await db.addMensaje(from, 'assistant', response);
    await db.actualizarLastInteraction(from);

    console.log(`[RESP] ${from}: ${response.substring(0, 80)}...`);

    const twiml = new MessagingResponse();
    if (imagenURL) {
      twiml.message({ body: response, mediaUrl: [imagenURL] });
    } else {
      twiml.message(response);
    }

    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('[ERROR] Webhook:', error.message, error.stack);
    const twiml = new MessagingResponse();
    twiml.message('Disculpa, estoy teniendo problemas técnicos. Por favor intenta más tarde.');
    res.type('text/xml').send(twiml.toString());
  }
});

// ─────────────────────────────────────────────
// HEALTH CHECK / STATUS
// ─────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  res.json({ status: 'ok', message: 'Elena - Vendedora DeCasa', empresa: knowledge.empresa });
});

app.get('/health', async (req, res) => {
  let activeUsers = 0;
  try {
    const [rows] = await db.pool.query('SELECT COUNT(*) as count FROM usuarios');
    activeUsers = rows[0].count;
  } catch (e) {
    activeUsers = 0;
  }
  res.json({ status: 'ok', activeUsers });
});

// ─────────────────────────────────────────────
// INICIO DEL SERVIDOR
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function startServer() {
  console.log('[SERVER] 🔵 Iniciando...');
  try {
    await initDB();
    console.log('[SERVER] ✅ Base de datos conectada');
  } catch (error) {
    console.error('[SERVER] ❌ Error conectando a la base de datos:', error.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`[SERVER] ✅ Escuchando en puerto ${PORT}`);
    console.log(`
╔════════════════════════════════════════╗
║   Elena - Vendedora DeCasa             ║
╠════════════════════════════════════════╣
║  Puerto: ${PORT}                          ║
║  POST /webhook (Recibir mensajes)      ║
║  GET  /webhook (Verificar)             ║
║  GET  /health  (Estado)                ║
╚════════════════════════════════════════╝
    `);

    // Limpieza periódica (cada 30 min en lugar de 10)
    setInterval(async () => {
      try {
        await db.limpiarConversacionesInactivas(45);
      } catch (err) {
        console.error('[CLEANUP] Error:', err.message);
      }
    }, 30 * 60 * 1000);
  });

  server.on('error', (err) => {
    console.error('[SERVER] 🔴 ERROR:', err);
  });

  const gracefulShutdown = (signal) => {
    console.log(`\n[SERVER] ${signal} recibido. Cerrando...`);
    server.close(() => {
      console.log('[SERVER] HTTP cerrado');
      db.pool.end().then(() => {
        console.log('[SERVER] MySQL cerrado');
      }).catch(err => {
        console.error('[SERVER] Error cerrando MySQL:', err);
      });
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('[FATAL] Error en startServer:', err);
    console.error(err.stack);
  });
}
