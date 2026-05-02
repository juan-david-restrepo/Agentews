require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { MessagingResponse } = twilio.twiml;
const knowledge = require('./knowledge.json');
const { initDB } = require('./init-db');
const db = require('./db');
const { processRoomImage } = require('./image-processor');
const utils = require('./utils');

function validateTwilioRequest(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioSignature = req.headers['x-twilio-signature'];
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  if (!twilioSignature || !twilio.webhook(authToken)(req.headers, url, req.body)) {
    console.warn('Invalid Twilio signature - rejecting request');
    return res.status(403).send('Forbidden');
  }
  next();
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(validateTwilioRequest);

app.use((err, req, res, next) => {
  console.error('Error no manejado:', err.message);
  res.status(500).send('Error interno del servidor');
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.5-flash-lite';

const SALUDO_INICIAL = `Hola! 👋 Soy Elena, tu asesora de DeCasa.

🏠 Especialistas en muebles de madera Flor Morado (más de 200 productos)
📍 Nuestras tiendas en Armenia, Quindío:
   - Av. Bolívar # 16 N 26
   - Km 2 vía El Edén
   - Km 1 vía Jardines

📦 Categorías: Sillas, Bases, Camas, Mesas, Sofás
🕐 Horario: L-V 8am-5pm

💬 Estoy para ayudarte con información o comprar muebles. 
   ¿Qué necesitas? 😊`;

const { generarInventarioTexto: generarInventarioTextoUtils } = utils;
const generarInventarioTexto = generarInventarioTextoUtils;

const SYSTEM_PROMPT = `Eres Elena, una vendedora amable y persuasiva de DeCasa. Tu objetivo es ayudar al cliente a encontrar el mueble perfecto y convencerlo de comprar.

PERFIL DE VENDEDORA:
- Nombre: Elena
- Empresa: DeCasa
- Especialidad: Muebles de madera Flor Morado de alta calidad
- Horario: Lunes a viernes de 8am a 5pm
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
2. Cuando no sepas algo,问 immediately ofrece: "¿Te gustaría que te transfiera a un asesor para aclarar tu duda?"
3. SOLO menciona productos con precios si estás SEGURA de que existen en el inventario.
4. NUNCA des información sobre productos que NO están en el inventario. Si no estás SEGURA de que un producto existe:
   - NO des información sobre ese producto
   - Responde: "Disculpa, no encontré '[producto]' en nuestro inventario. ¿Podrías verificar el nombre o decirme qué tipo de mueble buscas?"
   - Ofrece ayuda: "¿Te puedo mostrar nuestro catálogo?"

REGLAS DE CONSULTA:
- Siempre consulta el inventario primero
- Si el producto NO está en el inventario, no lo menciones como disponible
- Si no sabes el precio exacto, no especules - ofrece transferir al asesor

INSTRUCCIONES DE VENTA:
1. Cuando el cliente pregunte por un producto, SIEMPRE ofrece 2-3 alternativas similares con precios
2. Destaca la calidad de nuestros productos: "Madera Flor Morado, resistencia y elegancia"
3. Usa frases persuasivas: "Te recomiendo", "Es nuestra mejor opcion", "Excelente calidad-precio", "No te vas a arrepentir"
4. Cuando menciones productos, incluye el precio y destaca si es buena oferta
5. Si el cliente duda por el precio, enfoca en la calidad y durabilidad
6. Cierra siempre con una pregunta: "¿Te puedo ayudar con algo más?" o "¿Te interesa ver más opciones?"
7. SOLO pregunta "¿Confirmas?" o "¿Quieres proceder?" cuando el usuario muestre intención clara de compra.

EJEMPLOS DE RESPUESTA:

Cliente: "tienen camas?"
Elena: "Claro! Tenemos mas de 20 modelos de camas. Nuestra CAMA DINTEL en madera Flor Morado esta a $3.680.000, es muy resistente. Si buscas algo mas economico, la CAMA BARCELONETA esta a $2.880.000, excelente calidad-precio. Cual te llama la atencion? 😊"



Cliente: "cuanto cuesta un sofa?"
Elena: "Tenemos sofás desde $2.040.000 hasta $5.100.000. El SOFA NUBE a $3.480.000 es uno de los mas vendidos por su comodidad. Tambien te recomiendo el SOFA CHESTER a $3.380.000, super elegante. Quieres ver mas opciones? 💪"

REGLAS IMPORTANTES:
- Solo habla de productos de DeCasa
- Si preguntan algo fuera del negocio, redirige amablemente
- Mantén un tono amigable, profesional y persuasivo
- No seas agresiva, pero si convincente
- Siempre ofrece ayuda adicional al final

REGLA IMPORTANTE SOBRE SILLAS Y COMEDORES:
- TODAS las sillas (de comedor, auxiliares, de barra) se venden POR UNIDAD (una por una), NO en paquetes.
- Las sillas se venden POR SEPARADO de las bases de comedor. La base del comedor NO incluye sillas.
- Cuando el cliente pregunte "cuántas vienen?" o similar sobre sillas, responde que se venden por unidad.
- Siempre que muestres sillas, menciona que el precio es por unidad y que se venden aparte de la base del comedor.
- Cuando el cliente consulte sobre bases de comedores, menciona que se venden sin sillas incluidas y que puede elegir sillas por separado.

REGLA IMPORTANTE SOBRE COMPARACIONES:
- Si el cliente está indeciso entre varios productos, compara los productos mencionados recientemente en la conversación mostrando nombre, precio, material y medidas.
- Recomienda siempre la opción más económica como "mejor relación precio-calidad" y la más cara como "opción premium".
- Si no tienes contexto de qué productos comparar, pregunta al cliente: presupuesto, estilo preferido, y para qué espacio es.
- Basa tu recomendación en lo que el cliente necesita: si busca economía, recomienda el más barato; si busca calidad premium, recomienda el más caro.
- Mantén un tono persuasivo pero honesto, nunca inventes características.

SINONIMOS Y TERMINOS GENERICOS - Como interpretar al cliente:
- "muebles" o "mueble" = cualquier producto de DeCasa (sofás, camas, mesas, sillas, etc.)
- "para la sala" = sofás modulares, sofás camas, mesas de centro, sillas auxiliares, mesas de TV
- "para el cuarto" o "para el dormitorio" = camas, colchones, mesas de noche, cajoneros
- "para comer" o "para el comedor" = bases de comedores, sillas de comedor
- "para la barra" o "para cocina" = sillas de barra
- "para descansar" o "para ver TV" = sofás, sofás camas, sillas auxiliares
- "para trabajar" o "para oficina" = escritorios
- "para guardar" = cajoneros, bifes, mesas de noche con cajones

Cuando el cliente use un termino generico, interpreta que necesita y muestra productos relevantes de la categoria mas probable.

REGLAS PARA FOTOS:
- Cuando el cliente pida una foto, imagen o diga "como se ve", el sistema enviara automaticamente la imagen del producto si esta disponible
- Solo responde con un mensaje breve como "Claro! Aqui tienes la [nombre del producto] 😊" o "Aqui esta [nombre del producto], muy elegante! 💪"
- No intentes enviar la imagen tu misma, el sistema lo hace automaticamente
- Si no tienes la foto del producto que pide, di "Claro! Dime que producto te interesa y te envio la foto 😊"

${generarInventarioTexto()}`;

async function callGeminiWithHistory(from, currentMessage) {
  const history = await db.getHistorial(from, 12);
  return callGemini({
    history: history,
    currentMessage: currentMessage
  });
}

const { buscarMasBarato: buscarMasBaratoUtils } = utils;
const buscarMasBarato = buscarMasBaratoUtils;

const { buscarProductosRelacionados: buscarProductosRelacionadosUtils } = utils;
const buscarProductosRelacionados = buscarProductosRelacionadosUtils;

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

async function verCarritoDB(from) {
  return await db.verCarrito(from);
}

async function limpiarCarritoDB(from) {
  return await db.limpiarCarrito(from);
}

async function formatearCarrito(from) {
  const items = await db.verCarrito(from);
  if (!items || items.length === 0) return null;

  let mensaje = "🛒 Tu carrito:\n\n";
  let total = 0;

  items.forEach((item, index) => {
    const cantidad = item.cantidad || 1;
    const precioUnitario = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
    const precioTotal = precioUnitario * cantidad;
    mensaje += `${index + 1}. ${item.producto} - ${item.precio}`;
    if (cantidad > 1) {
      mensaje += ` (${cantidad} unidades)`;
    }
    mensaje += `\n`;
    total += precioTotal;
  });

  mensaje += `\n─────────────────\n💰 Total: $${total.toLocaleString()}`;

  return { mensaje, total, items };
}

const { buscarProductoEnHistorial: buscarProductoEnHistorialUtils } = utils;
const buscarProductoEnHistorial = buscarProductoEnHistorialUtils;

const { detectarCategoriaEnMensaje: detectarCategoriaEnMensajeUtils } = utils;
const detectarCategoriaEnMensaje = detectarCategoriaEnMensajeUtils;
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

for (const [palabra, clave] of Object.entries(mapeoCategorias)) {
  if (msg.includes(palabra)) {
    return clave;
  }
}
return null;


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
    if (tieneSilla && (msg === 'silla' || msg === 'sillas' || msg.includes('quiero una silla') || msg.includes('Quiero una') || msg.includes('busco una silla'))) {
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

  // Remove articles from the message for better matching
  const palabrasMsg = mensajeLimpio.split(' ').filter(p => p.length > 2 && !articulos.includes(p));
  if (palabrasMsg.length > 0) {
    mensajeLimpio = palabrasMsg.join(' ');
  }

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
            if (pp.includes(pm) && pm.length >= pp.length * 0.5) {
              score += 50;
            } else if (pm.includes(pp) && pp.length >= pm.length * 0.5) {
              score += 50;
            }
          }
        }

        // Bonus for exact word match (e.g., "amatista" matching "amatista")
        for (const pm of palabrasMsj) {
          if (palabrasProd.includes(pm)) {
            score += 30;
          }
        }

        if (mensajeLimpio.length >= 4 && nombreLimpio.startsWith(mensajeLimpio.substring(0, 4))) {
          score += 30;
        }
      }

      if (score > 0) {
        coincidencias.push({ producto, score, nombre: producto.nombre, precio: producto.precio, categoria: cat.nombre, categoriaKey: Object.keys(knowledge.inventario).find(k => knowledge.inventario[k] === cat), esCategoriaPreferida: esPreferida, medidas: producto.medidas, material: producto.material, imagen: producto.imagen });
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

  // Lower threshold for single-word meaningful queries (like "amatista", "torello")
  const palabrasSignificativas = mensaje.toLowerCase().split(' ').filter(p => p.length > 3 && !['quiero', 'ver', 'una', 'unos', 'unas', 'este', 'esta', 'estos', 'estas'].includes(p));
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
        nombre: c.nombre,
        precio: c.precio,
        categoria: c.categoria,
        medidas: c.medidas,
        material: c.material,
        imagen: c.imagen
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
      } else if (nombreLimpio.includes(nombreBuscado) || nombreBuscado.includes(nombreLimpio)) {
        score = 90;
      } else {
        const palabrasMsg = nombreBuscado.split(' ').filter(p => p.length > 2);
        const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 2);

        for (const pm of palabrasMsg) {
          for (const pp of palabrasProd) {
            if (pp.includes(pm) || pm.includes(pp)) {
              score += 25;
            }
          }
        }

        if (nombreBuscado.length >= 4 && nombreLimpio.includes(nombreBuscado.substring(0, 6))) {
          score += 40;
        }
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
    const candidatos = mismosScore.map(c => {
      const prod = c.producto;
      return {
        nombre: prod.nombre,
        precio: prod.precio,
        medidas: prod.medidas || 'No disponible',
        material: prod.material || 'No disponible',
        imagen: prod.imagen || null
      };
    });
    const prod = mismosScore[0].producto;
    return {
      nombre: prod.nombre,
      precio: prod.precio,
      medidas: prod.medidas || 'No disponible',
      material: prod.material || 'No disponible',
      imagen: prod.imagen || null,
      ambiguo: true,
      candidatos
    };
  }

  const prod = mejoresCoincidencias[0].producto;
  return {
    nombre: prod.nombre,
    precio: prod.precio,
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

  // Check for numeric response like "1" or "el 1" or "numero 1"
  const numMatch = msgLimpio.match(/(?:numero|nro|num|#|el|la|los)?\s*(\d+)/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    if (num >= 1 && num <= candidatos.length) {
      return candidatos[num - 1];
    }
  }

  // Check for partial name match
  for (const c of candidatos) {
    const nombreLimpio = c.nombre.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const palabras = nombreLimpio.split(' ').filter(p => p.length > 2);
    for (const palabra of palabras) {
      if (msgLimpio.includes(palabra)) {
        return c;
      }
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
        if (pp.includes(pm) || pm.includes(pp)) {
          score += 50;
        }
      }
    }

    if (score > mejorScore) {
      mejorScore = score;
      mejorCoincidencia = {
        nombre: producto.nombre,
        precio: producto.precio,
        medidas: producto.medidas,
        material: producto.material,
        imagen: producto.imagen
      };
    }
  }

  return mejorScore > 50 ? mejorCoincidencia : null;
}

function esFraseCompraGenerica(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const palabrasFiltro = [
    'cama', 'sofa', 'sofá', 'comedor', 'silla', 'mesa', 'cama',
    'base', 'colchon', 'colchón', 'nido', 'repisa', 'mueble',
    'sillon', 'sillón', 'auxiliar', 'barra', 'moderno', 'clasico',
    'madera', 'cuero', 'tela', 'color', 'negro', 'blanco', 'cafe',
    'gris', 'rojo', 'azul', 'verde', 'dorado', 'plateado',
    'grande', 'pequeño', 'pequeno', 'economico', 'barato', 'caro',
    'mejor', 'barato', 'economico', 'torello', 'valencia', 'monaco',
    'torino', 'milan', 'roma', 'aria', 'luna', 'sol', 'perla',
    'diamante', 'cristal', 'oro', 'plata', 'roble', 'nogal',
    'pine', 'pino', 'cedro', 'caoba', 'tropical', 'rustico',
    'lujo', 'premium', 'deluxe', 'ejecutivo', 'estandar',
    'doble', 'individual', 'queen', 'king', 'full',
    'seater', 'seaters', 'plaza', 'plazas',
    'centro', 'esquina', 'seccional', 'reclinable',
    'puff', 'otomana', 'ottoman', 'console', 'consola',
    'escritorio', 'estante', 'closet', 'zapatero',
    'tocador', 'velador', 'comoda', 'modul',
    'infantil', 'juvenil', 'gamer', 'oficina',
    'exterior', 'interior', 'jardin', 'balcon',
    'plegable', 'abatible', 'apilable'
  ];
  const msgSinAcentos = msg.toLowerCase();
  for (const palabra of palabrasFiltro) {
    if (msgSinAcentos.includes(palabra)) {
      return false;
    }
  }
  return true;
}

const TRIGGERS_ASESOR = [
  'hablar con', 'hablarle a', 'llamar a',
  'asesor', 'asesora', 'asesores',
  'humano', 'humana', 'persona real',
  'persona de verdad', 'una persona',
  'necesito hablar con', 'quiero hablar con',
  'hablar con alguien más', 'que me atienda alguien',
  'atención humana', 'derivame a', 'transferirme a'
];

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
    /cual.*mejor/i, /cu(a|á)l.*mejor/i, /cual.*recomiend/i, /cu(a|á)l.*recomiend/i,
    /cual.*me.*conviene/i, /cual.*escojo/i, /cual.*elijo/i,
    /cual.*deber/i, /cual.*me.*llevo/i, /cual.*mejor.*opcion/i,
    /estoy.*entre/i, /no.*me.*decido/i, /no.*se.*cual/i,
    /indecis/i, /duda.*entre/i, /diferencia.*entre/i, /diferencias.*entre/i,
    /comparar/i, /compara/i, /comparacion/i, /compar/i,
    /recomiend/i, /mejor.*opcion/i, /cual.*elegir/i,
    /cual.*compro/i, /cual.*me.*llev/i, /cual.*mas.*vale/i,
    /cual.*mas.*barat/i, /cual.*mas.*car/i, /cual.*mas.*resistent/i,
    /que.*me.*conviene/i, /que.*me.*recomend/i, /ayudame.*elegir/i,
    /ayudame.*decidir/i, /me.*puedes.*ayudar.*elegir/i
  ];
  return patrones.some(p => p.test(msg));
}

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
      ...p,
      precioNumerico: parseInt(String(p.precio).replace(/[^0-9]/g, '')) || 0
    }));

    const ordenados = [...productosConPrecio].sort((a, b) => a.precioNumerico - b.precioNumerico);
    const masBarato = ordenados[0];
    const masCaro = ordenados[ordenados.length - 1];

    productosRecientes.forEach((prod, i) => {
      comparacion += `${i + 1}. *${prod.nombre}*\n`;
      comparacion += `   💰 Precio: ${prod.precio}\n`;
      if (prod.material) comparacion += `   🪵 Material: ${prod.material}\n`;
      if (prod.medidas) comparacion += `   📏 Medidas: ${prod.medidas}\n`;
      comparacion += `\n`;
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
  if (numeros && numeros.length > 0) {
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
    { patron: /contemporaneo/i, valor: 'contemporaneo' },
    { patron: /sencillo|simple/i, valor: 'sencillo' },
    { patron: /elegante/i, valor: 'elegante' },
    { patron: /vintage/i, valor: 'vintage' }
  ];
  for (const e of estilos) {
    if (e.patron.test(msg)) { prefs.estilo = e.valor; break; }
  }

  const espacios = [
    { patron: /comedor/i, valor: 'comedor' },
    { patron: /sala|estar/i, valor: 'sala' },
    { patron: /dormitorio|cuarto|habitacion|dormir/i, valor: 'dormitorio' },
    { patron: /cocina/i, valor: 'cocina' },
    { patron: /oficina|escritorio|estudio/i, valor: 'oficina' },
    { patron: /recibidor|entrada/i, valor: 'recibidor' }
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

  let categoriasBusqueda = [];
  if (prefs.espacio && espacioCategoria[prefs.espacio]) {
    categoriasBusqueda = espacioCategoria[prefs.espacio];
  } else {
    categoriasBusqueda = Object.keys(inventario);
  }

  for (const catKey of categoriasBusqueda) {
    const cat = inventario[catKey];
    if (!cat || !cat.productos) continue;
    for (const prod of cat.productos) {
      const precioNum = parseInt(String(prod.precio).replace(/[^0-9]/g, '')) || 0;
      if (precioNum === 0) continue;

      let score = 0;

      if (prefs.presupuesto) {
        const rango = prefs.presupuesto * 0.3;
        if (precioNum <= prefs.presupuesto + rango && precioNum >= prefs.presupuesto - rango) {
          score += 100;
        } else if (precioNum <= prefs.presupuesto) {
          score += 80;
        } else {
          continue;
        }
      }

      if (prefs.estilo) {
        const estiloPalabras = {
          clasico: ['clasico', 'colonial', 'traditional', 'antiguo'],
          moderno: ['moderno', 'contemporaneo', 'actual', 'minimal'],
          minimalista: ['minimal', 'simple', 'sencillo', 'basico'],
          rustico: ['rustico', 'madera', 'natural', 'campo'],
          industrial: ['industrial', 'metal', 'hierro', 'urbano'],
          elegante: ['elegante', 'premium', 'lujo', 'deluxe'],
          vintage: ['vintage', 'retro', 'antiguo'],
          sencillo: ['sencillo', 'simple', 'basico']
        };
        const palabrasEstilo = estiloPalabras[prefs.estilo] || [];
        const prodNombre = prod.nombre.toLowerCase();
        const prodMaterial = (prod.material || '').toLowerCase();
        for (const p of palabrasEstilo) {
          if (prodNombre.includes(p) || prodMaterial.includes(p)) { score += 20; }
        }
      }

      if (score > 0) {
        candidatos.push({ ...prod, categoria: catKey, score, precioNumerico: precioNum });
      }
    }
  }

  candidatos.sort((a, b) => b.score - a.score);
  const seleccionados = candidatos.slice(0, 5);

  if (seleccionados.length === 0) {
    let todosProductos = [];
    for (const catKey of categoriasBusqueda) {
      const cat = inventario[catKey];
      if (!cat || !cat.productos) continue;
      for (const prod of cat.productos) {
        const precioNum = parseInt(String(prod.precio).replace(/[^0-9]/g, '')) || 0;
        if (precioNum > 0) todosProductos.push({ ...prod, categoria: catKey, precioNumerico: precioNum });
      }
    }
    if (prefs.presupuesto) {
      todosProductos = todosProductos.filter(p => p.precioNumerico <= prefs.presupuesto);
    }
    todosProductos.sort((a, b) => a.precioNumerico - b.precioNumerico);
    const fallback = todosProductos.slice(0, 5);
    if (fallback.length === 0) return null;

    let respuesta = "No encontré productos exactos con esas preferencias, pero aquí tienes algunas opciones:\n\n";
    fallback.forEach((prod, i) => {
      respuesta += `${i + 1}. *${prod.nombre}* - ${prod.precio}\n`;
      if (prod.material) respuesta += `   🪵 ${prod.material}\n`;
    });
    respuesta += "\n¿Alguna te interesa? 😊";
    return respuesta;
  }

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
  if (premium) {
    respuesta += `• Opción premium: *${premium.nombre}* (${premium.precio})\n`;
  }
  respuesta += "\n¿Cuál te llama más la atención? 😊";

  return respuesta;
}

async function generarComparacionDirecta(from, productosEncontrados) {
  if (!productosEncontrados || productosEncontrados.length < 2) return null;

  let comparacion = "📊 *Comparación de productos:*\n\n";

  const ordenados = [...productosEncontrados].sort((a, b) => a.precioNumerico - b.precioNumerico);
  const masBarato = ordenados[0];
  const masCaro = ordenados[ordenados.length - 1];

  productosEncontrados.forEach((prod, i) => {
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
  comparacion += "\n¿Cuál te interesa? 😊";

  await db.setComparacionProductos(from, productosEncontrados.map(p => ({ nombre: p.nombre, imagen: p.imagen, categoria: p.categoria })));

  return comparacion;
}

function detectarFotoMultiple(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /foto.*de.*(las|los)\s*(dos|ambos|2)/i,
    /foto.*ambos/i,
    /foto.*ambas/i,
    /foto.*de.*los\s*dos/i,
    /foto.*de.*las\s*dos/i,
    /fotos.*de.*(ambos|ambas|los\s*dos|las\s*dos)/i,
    /mandar.*foto.*dos/i,
    /enviar.*foto.*dos/i,
    /foto.*de.*cada/i,
    /foto.*de.*tod/i,
    /foto.*de.*todo/i,
    /foto.*de\s*(los|las)\s*(2|dos)/i
  ];
  return patrones.some(p => p.test(msg));
}

function extraerFotoMultiple(mensaje, productosComparacion) {
  const msg = mensaje.toLowerCase();
  if (!productosComparacion || productosComparacion.length === 0) return null;

  const refPrimera = /primera|primer\b/i.test(msg);
  const refSegunda = /segunda|segundo\b/i.test(msg);
  const refUltima = /ultima|última|ultim/i.test(msg);
  const refDos = /las\s*dos|los\s*dos|ambos|ambas/i.test(msg);

  if (refDos) {
    return productosComparacion;
  }
  if (refPrimera) {
    return [productosComparacion[0]];
  }
  if (refSegunda && productosComparacion.length >= 2) {
    return [productosComparacion[1]];
  }
  if (refUltima) {
    return [productosComparacion[productosComparacion.length - 1]];
  }

  const palabras = msg.split(/\s+/).filter(p => p.length > 2 && !/foto|foto|mandar|enviar|imagen|ver|foto|de|las|los|dos|ambos|ambas|porfa|porfavor|please/i.test(p));

  if (palabras.length > 0) {
    const filtrados = productosComparacion.filter(p => {
      const nombreLimpio = p.nombre.toLowerCase();
      return palabras.some(pal => nombreLimpio.includes(pal));
    });
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
    console.error('Error enviando segunda foto:', e.message);
  }
}

const MAX_ITEMS_CARRITO = 10;

const TRIGGERS_COMPRA = [
  'si lo compro', 'confirmo compra', 'este me lo llevo',
  'confirmar compra', 'confirmar pedido',
  'me lo llevo ya', 'ya me lo llevo',
  'deseo proceder', 'si deseo', 'si quiero',
  'me quiero llevar', 'me llevo en', 'quiero llevar',
  'completar mi pedido', 'finalizar mi pedido', 'ya lo quiero',
  'perfecto', 'muy bien', 'esta bien', 'está bien', 'bien',
  'comprar ahora', 'finalizar compra',
  'pedido confirmado', 'ordenar ya',
  'quiero comprar', 'me gustaría comprar',
  'comprar', 'lo quiero comprar',
  'si quiero', 'si quiero compr',
  'sí quiero', 'sí, quiero',
  'dámelo', 'me lo llevo',
  'lo tomo', 'me quedo con',
  'me gustaría comprarlo', 'lo quiero Comprar',
  'me gustarían', 'gustarían', 'me gustaría comprarlo',
  'si me gustarían', 'sí me gustarían'
];

function detectarUbicacion(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /ubicaci[óa]n/i,
    /ubicad[oa]s?\b/i,
    /direcci[óa]n/i,
    /direcciones/i,
    /d[óa]nde.*est[áa]n/i,
    /d[óa]nde.*est[áa] located/i,
    /en.*d[óa]nde/i,
    /en.*qu[é].*direcci[óa]n/i,
    /puedo.*visitar/i,
    /visitar.*tienda/i,
    /ir.*tienda/i,
    /tiendas.*ubic/i,
    /qu[é].*direcci[óa]n/i,
    /给出地址/i,
    /地址/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarSaludo(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /\bhola\b/i,
    /\bholis\b/i,
    /\bholi\b/i,
    /\bholaa\b/i,
    /\bholaaa\b/i,
    /\bholas\b/i,
    /\bola\b/i,
    /\bolas\b/i,
    /\bolaas\b/i,
    /\bollaaa\b/i,
    /\bbuenos\s+dias\b/i,
    /\bbuenas\s+dias\b/i,
    /\bbuenos\s+días\b/i,
    /\bbuenas\s+días\b/i,
    /\bbuenas\b/i,
    /\bbueno\s+dias\b/i,
    /\bbuena\s+dias\b/i,
    /\bbuena\s+días\b/i,
    /\bque\s+tal\b/i,
    /\bqué\s+tal\b/i,
    /\bque\s+tales\b/i,
    /\bqué\s+tales\b/i,
    /\bsaludos\b/i,
    /\bhello\b/i,
    /\bhi\b/i,
    /\bhey\b/i,
    /\bbuenas\s+tardes\b/i,
    /\bbuenas\s+noches\b/i,
    /\bbuena\s+tarde\b/i,
    /\bbuena\s+noche\b/i,
    /\bcomo\s+estas\b/i,
    /\bcómo\s+estás\b/i,
    /\bcomo\s+está\b/i,
    /\bcomo\s+va\b/i,
    /\bcomo\s+van\b/i,
    /\bqué\s+hay\b/i,
    /\bque\s+hay\b/i,
    /^\s*hola\s*$/i,
    /^\s*buenas?\s*$/i,
    /^\s*buenos\s*$/i,
    /^\s*buenos\s*$/i
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
  const msg = mensaje.trim();
  const msgLower = msg.toLowerCase();

  const patrones = [
    /^(me\s+gustar[ií]a\s+saber\s+(que|qu[eé])|quiero\s+saber\s+(que|qu[eé])|quisiera\s+saber\s+(que|qu[eé])|dime\s+(que|qu[eé])|decime\s+(que|qu[eé]))\s+(sillas|mesas|comedores|camas|sofas|sof[aá]s|colchones|bases|escritorios|cajoneros)\s+(tienen|manejan|hay|ofrecen|manej[aá]is)/i,
    /^(que|qu[eé])\s+(sillas|mesas|comedores|camas|sofas|sof[aá]s|colchones|bases|escritorios|cajoneros)\s+(tienen|manejan|hay|ofrecen|manejan\s+ustedes)/i,
    /^(que|qu[eé])\s+(sillas|mesas|comedores|camas|sofas|sof[aá]s|colchones|bases|escritorios|cajoneros)\s+(tienen|manejan|hay|ofrecen)/i,
    /^(que|qu[eé])\s+(tipos?\s+de\s+)?(sillas|mesas|comedores|camas|sofas|sof[aá]s|colchones|bases|escritorios|cajoneros)\s+(tienen|manejan|hay|ofrecen)/i
  ];

  return patrones.some(p => p.test(msgLower));
}

function detectarAsesor(mensaje) {
  const msg = mensaje.toLowerCase();
  const triggers_exactos = [
    'hablar con un asesor', 'hablar con asesor', 'hablarle al asesor',
    'hablar con una persona', 'hablar con humano', 'hablar con persona real',
    'necesito un asesor', 'necesito una persona', 'necesito un humano',
    'quiero hablar con', 'necesito hablar con',
    'asesor', 'asesora',
    'humano', 'humana',
    'persona real', 'persona de verdad',
    'que me atienda', 'derivame', 'transferirme',
    'atencion humana', 'atención humana',
    'mándame con el', 'pasame con el', 'envíame con el',
    'comunico con', 'que me comunique', 'hablar con el asesor',
    'transfiéreme', 'pásame al', 'envíame al',
    'mándame directamente', 'pásame al asesor'
  ];
  if (triggers_exactos.some(t => msg.includes(t))) {
    return true;
  }
  const patrones = [
    /\bhablar\s+con\b/,
    /\bhablarle\s+a\b/,
    /\bllamar\s+a\b/,
    /\bpersona\b/,
    /\bhumano\b/
  ];
  return patrones.some(p => p.test(msg));
}

function detectarMedidaPersonalizada(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // First check if this is a catalog request (should NOT trigger medida personalizada)
  const esConsultaCatalogo = /que.*tienen/i.test(msg) ||
    /que.*hay/i.test(msg) ||
    /mostrar.*catalogo/i.test(msg) ||
    /ver.*catalogo/i.test(msg) ||
    /saber que/i.test(msg) ||
    /^ver /i.test(msg) ||
    /^que /i.test(msg);

  if (esConsultaCatalogo) {
    return false;
  }

  const patrones = [
    /si la medida/i,
    /cambiar la medida/i,
    /medida personalizada/i,
    /otra medida/i,
    /de (\d+) puestos/i,
    /quiero de (\d+) puestos/i,
    /lo quiero de (\d+)/i,
    /para (\d+) personas/i,
    /para (\d+) puestos/i,
    /medida de/i,
    /en medida/i,
    /con medida/i,
    /modificar la medida/i,
    /ajustar la medida/i,
    /personalizar.*medida/i,
    /medida diferente/i,
    /otro tamano/i,
    /diferente tamano/i,
    /pero de (\d+)/i,
    /ese de (\d+)/i,
    /esa de (\d+)/i,
    /quiero.*de (\d+)/i,
    /gustaria.*de (\d+)/i,
    /ese pero de (\d+)/i,
    /esa pero de (\d+)/i,
    /lo quiero de (\d+) puestos/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarPersonalizacion(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const COLORES = ['negro', 'blanco', 'azul', 'rojo', 'verde', 'amarillo', 'gris', 'marron', 'beige', 'cafe', 'crema', 'champan', 'vino', 'burdeos', 'naranja', 'rosa', 'morado', 'lila'];
  const coloresRegex = COLORES.join('|');

  const patrones = [
    // Color patterns
    new RegExp('en (' + coloresRegex + ')', 'i'),
    new RegExp('color (' + coloresRegex + ')', 'i'),
    /quiero en /i,
    /lo quiero en /i,
    /pintado en /i,
    /con (color|tinte)/i,
    // Material patterns
    /de (roble|pino|cedro|madera)/i,
    /en (cuero|tela|trapo|sintetico)/i,
    // Generic customization
    /personalizado/i,
    /modificar/i,
    /cambiar/i,
    /diferente/i,
    /especial/i
  ];

  return patrones.some(p => p.test(msg));
}

function detectarAgregarProducto(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /agregarle/i,
    /agregar/i,
    /añadirle/i,
    /también la/i,
    /y también/i,
    /y agrégale/i,
    /agregame/i,
    /añade/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarCompra(mensaje) {
  const msg = mensaje.toLowerCase();
  return TRIGGERS_COMPRA.some(t => msg.includes(t));
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
  const msg = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const diasValidos = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  return diasValidos.some(d => msg === d || msg === 'el ' + d || msg.includes(d));
}

function esSabado(mensaje) {
  const msg = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return msg.includes('sabado') || msg.includes('sábado');
}

function esHoraValida(mensaje, esSabadoDia = false) {
  const msg = mensaje.toLowerCase().replace(/\s+/g, ' ').trim();

  // Acepta: hora entera (9, 14) o hora:minuto (9:30, 14:50)
  const match = msg.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return false;

  const hora = parseInt(match[1]);
  const minutos = match[2] ? parseInt(match[2]) : 0;

  // Validar rango de hora
  const horaMin = 8;
  const horaMax = esSabadoDia ? 11 : 16;
  if (hora < horaMin || hora > horaMax) return false;

  // Validar minutos (0-59)
  if (minutos < 0 || minutos > 59) return false;

  return true;
}

function formatearHora(hora) {
  const msg = hora.trim();
  // Acepta hora entera u hora:minuto
  const match = msg.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return hora;

  const h = parseInt(match[1]);
  const m = match[2] ? parseInt(match[2]) : 0;

  // Rellenar con ceros a la izquierda (2 dígitos)
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');

  return `${hh}:${mm}`;
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

const UBICACIONES_LISTA = `📍 Nuestras ubicaciones:
1. Av. Bolívar # 16 N 26, Armenia
2. Km 2 vía El Edén, Armenia
3. Km 1 vía Jardines, Armenia
4. CC Unicentro Pereira
5. Cra. 14 #11 - 93. Pereira, Risaralda`;

const MSJ_ERROR_DIA = `Por favor ingresa un día válido: lunes, martes, miercoles, jueves, viernes o sabado.`;
const MSJ_ERROR_HORA = `No entendí. Por favor ingresa la hora así:\n• 2:30 pm / 9:00 am\n• 14:00 (formato 24h)\n• Solo la hora: 2 / 3 / 10`;
const MSJ_ERROR_UBICACION = `Por favor ingresa el número de la ubicación: 1, 2, 3, 4 o 5.`;
const MSJ_CANCELAR = `Para cancelar escribe "cancelar" o "cancelar agendacion".`;

function detectarConsultaInfo(mensaje) {
  if (detectarAsesor(mensaje)) return false;
  if (detectarCompra(mensaje)) return false;
  if (detectarVerCarrito(mensaje)) return false;
  if (detectarLimpiarCarrito(mensaje)) return false;
  if (detectarAgendar(mensaje)) return false;

  const msg = mensaje.toLowerCase();
  const patronesInfo = [
    /^qui[é]iera ver/i,
    /^quiero ver/i,
    /^ver el cat[á]logo/i,
    /^ver productos/i,
    /^mostrarme/i,
    /^ver fotos/i,
    /^ver im[á]genes/i,
    /viene con/i,
    /viene incluido/i,
    /incluye las sillas/i,
    /incluye las bases/i,
    /cu[á]ndo vale/i,
    /cu[á]nto vale/i,
    /cu[á]nto cuesta/i,
    /precio del/i,
    /precio de la/i,
    /cu[á]l es el precio/i,
    /qu[é] incluye/i,
    /qu[é] trae/i,
    /c[ó]mo funciona/i,
    /son separad/i,
    /se vende por separad/i,
    /hay modelos/i,
    /hay dise[ñ]os/i,
    /qu[é] modelos/i,
    /qu[é] estilos/i,
    /me puede mostrar/i,
    /quisiera ver/i,
    /dame ver/i,
    /mu[é]strame/i,
    /est[á] hechos/i,
    /de qu[é] material/i,
    /son de/i,
    /hfabricad/i,
    /hay en/i,
    /tiene en/i,
    /tienen en/i,
    /m[áa]s informaci[óa]n/i,
    /m[áa]s info/i,
    /m[áa]s detalles/i,
    /detalles de/i,
    /informaci[óa]n del/i,
    /informaci[óa]n de la/i,
    /saber m[áa]s/i,
    /saber de/i,
    /saber sobre/i,
    /quisiera saber/i,
    /quiero saber/i,
    /dime de/i,
    /dime sobre/i,
    /hablar de/i,
    /hablar sobre/i,
    /m[é]strame.*inform/i,
    /m[é]strame.*detalles/i,
    /ver.*detalles/i,
    /ver.*especificac/i,
    /caracter[íá]sticas/i,
    /que tiene el/i,
    /que tiene la/i,
    /que incluye/i,
    /me puedes/i,
    /me podr[íá]as/i,
    /podr[íá]as/i,
    /\binfo\b/i,
    /\bdetails?\b/i,
    /\bspecs?\b/i,
    /^el\b/i,
    /^la\b/i,
    /^\s*el\s+\w+/i,
    /^\s*la\s+\w+/i,
    /por el\s+\w+/i,
    /por la\s+\w+/i,
    /sobre el\s+\w+/i,
    /sobre la\s+\w+/i,
    /consultar.*\w+/i
  ];

  for (const patron of patronesInfo) {
    if (patron.test(msg)) {
      return true;
    }
  }

  const palabrasVer = ['ver', 'mostrar', 'ver fotos', 'ver imágenes', 'quisiera', 'quiero', 'información', 'info', 'detalles', 'saber', 'conocer'];
  const tienePalabraVer = palabrasVer.some(p => msg.includes(p));
  const tieneCategoria = msg.includes('silla') || msg.includes('comedor') || msg.includes('base') ||
    msg.includes('cama') || msg.includes('mesa') || msg.includes('sof') ||
    msg.includes('catálogo') || msg.includes('precio') || msg.includes('el ') || msg.includes('la ');

  return tienePalabraVer && tieneCategoria;
}

async function estaTransferidaDB(from) {
  return await db.estaTransferida(from);
}

async function marcarTransferidaDB(from) {
  return await db.marcarTransferida(from);
}

function marcarTransferida(from) {
  conversacionesTransferidas.set(from, true);
}

async function enviarNotificacionTelegram(telefono, mensaje, historial, tipo = 'asesor', producto = null, tipoPersonalizacion = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('Telegram no configurado - Transferencia ignorada');
    console.log('Para activar: configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID');
    return;
  }

  const historialTexto = historial.slice(-6).map(m => {
    const rol = m.role === 'user' ? '👤' : '🤖';
    const contenido = m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content;
    return `${rol} ${contenido}`;
  }).join('\n');

  let titulo = '🆘 SOLICITUD DE ASESOR';
  let emoji = '💬';

  if (tipo === 'pedido') {
    titulo = '📦 NUEVO PEDIDO - DeCasa';
    emoji = '💰';
  } else if (tipo === 'medida_personalizada' || tipo === 'personalizacion') {
    titulo = '🎨 PERSONALIZACIÓN - DeCasa';
    emoji = '🎨';
  }

  let productoInfo = '';
  if (producto) {
    productoInfo = `\n📏 <b>Producto:</b> ${producto}`;
  }

  let personalizacionInfo = '';
  if (tipoPersonalizacion) {
    personalizacionInfo = `\n🎨 <b>Tipo:</b> Personalización de ${tipoPersonalizacion}`;
  }

  const texto = `
<b>${titulo}</b>
━━━━━━━━━━━━━━━━━━━━━━━
📱 <b>Cliente:</b> ${telefono}${productoInfo}${personalizacionInfo}
${emoji} <b>Mensaje:</b> "${mensaje}"
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
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }, 2, 10000);
    const result = await response.json();
    if (!response.ok) {
      console.error('Error Telegram:', response.status, JSON.stringify(result));
    } else {
      console.log(`Notificación ${tipo} enviada a Telegram`);
    }
  } catch (error) {
    console.error('Error enviando a Telegram:', error.message);
  }
}

async function enviarNotificacionPedido(telefono, productos, historial) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('Telegram no configurado');
    return;
  }

  let listaProductos = '';
  let total = 0;

  productos.forEach((item, index) => {
    const cantidad = item.cantidad || 1;
    const precioUnitario = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
    const precioTotal = precioUnitario * cantidad;
    listaProductos += `${index + 1}. ${item.producto} - ${item.precio}`;
    if (cantidad > 1) {
      listaProductos += ` (${cantidad})`;
    }
    listaProductos += `\n`;
    total += precioTotal;
  });

  const historialTexto = historial.slice(-4).map(m => {
    const rol = m.role === 'user' ? '👤' : '🤖';
    const contenido = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
    return `${rol} ${contenido}`;
  }).join('\n');

  const fechaActual = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const texto = `
📦 <b>NUEVO PEDIDO - DeCasa</b>
━━━━━━━━━━━━━━━━━━━━━━━━
📱 <b>Cliente:</b> ${telefono}
📅 <b>Fecha:</b> ${fechaActual}
━━━━━━━━━━━━━━━━━━━━━━━━

🛒 <b>Productos:</b>
${listaProductos}💰 <b>Total:</b> $${total.toLocaleString()}
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
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }, 2, 10000);
    const result = await response.json();
    if (!response.ok) {
      console.error('Error Telegram pedido:', response.status, JSON.stringify(result));
    } else {
      console.log(`Notificación pedido enviada a Telegram`);
    }
  } catch (error) {
    console.error('Error enviando pedido a Telegram:', error.message);
  }


async function getHistoryDB(from) {
  return await db.getHistorial(from, 12);
}

async function addToHistoryDB(from, role, content) {
  return await db.addMensaje(from, role, content);
}

function detectarSolicitudFoto(mensaje) {
  const patrones = [
    /env[ií]ame.*foto/i,
    /env[ií]ame.*imagen/i,
    /env[ií]ame.*im[áa]gen/i,
    /foto.*del?/i,
    /imagen.*de/i,
    /im[áa]gen.*del?/i,
    /c[oó]mo.*se.*ve/i,
    /m[eé]strame.*foto/i,
    /m[eé]strame.*imagen/i,
    /ver.*foto/i,
    /ver.*imagen/i,
    /foto/i,
    /imagen/i,
    /picture/i
  ];

  for (const patron of patrones) {
    if (patron.test(mensaje)) {
      return true;
    }
  }
  return false;
}

function detectarConsultaPrecio(mensaje) {
  const patrones = [
    /cu[áa]nto.*cuesta/i,
    /cu[áa]nto.*vale/i,
    /cu[áa]nto.* cuest[áa]/i,
    /cu[áa]nto.* val[é]e/i,
    /cu[áa]l.*precio/i,
    /precio.*del/i,
    /precio.*de/i,
    /cu[áa]l.*es.*el.*precio/i,
    /cu[áa]nto.*(vale|cuesta)/i,
    /valor.*del/i,
    /valor.*de/i,
    /cu[áa]l.*es.*el.*valor/i,
    /\bprecio\b/i,
    /\bvalores\b/i,
    /\bcuesta\b/i,
    /\bvale\b/i
  ];

  for (const patron of patrones) {
    if (patron.test(mensaje)) {
      return true;
    }
  }
  return false;
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
    /ver.*carrito/i,
    /mi carrito/i,
    /\bcarrito\b/i,
    /que tengo/i,
    /qué tengo/i,
    /qué hay/i,
    /que hay/i,
    /ver lo que tengo/i,
    /ver lo que hay/i,
    /mostrar carrito/i,
    /dame el carrito/i,
    /ver mis productos/i,
    /ver\s+mi\s+carrito/i,
    /ver\s+el\s+carrito/i,
    /quiero\s+ver.*carrito/i,
    /dime.*carrito/i,
    /muestrame.*carrito/i,
    /hay\s+en\s+mi\s+carrito/i,
    /hay\s+en\s+el\s+carrito/i,
    /que\s+hay\s+en/i,
    /qué\s+hay\s+en/i
  ];

  for (const patron of patrones) {
    if (patron.test(msg)) {
      return true;
    }
  }
  return false;
}

function detectarLimpiarCarrito(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /borrar.*carrito/i,
    /vaciar.*carrito/i,
    /eliminar.*todo/i,
    /empezar.*de nuevo/i,
    /limpiar.*carrito/i,
    /cancelar.*pedido/i,
    /eliminar.*producto/i,
    /eliminar.*silla/i,
    /eliminar.*base/i,
    /eliminar.*cama/i,
    /eliminar.*mesa/i,
    /eliminar.*sofa/i,
    /quitar.*carrito/i,
    /quitar.*producto/i,
    /quitar.*del/i,
    /borrar.*producto/i,
    /borrar.*silla/i,
    /borrar.*base/i,
    /sacar.*carrito/i,
    /sacar.*producto/i,
    /\bno\s+lo\s+quiero\b/i,
    /\bno\s+la\s+quiero\b/i,
    /\bno\s+lo\s+llev[oe]\b/i,
    /\bno\s+la\s+llev[oe]\b/i,
    /\bno\s+lo\s+compro\b/i,
    /cambiar.*producto/i,
    /cambiar.*silla/i,
    /cambiar.*mueble/i,
    /otro.*producto/i,
    /diferente.*producto/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarCalculoTotal(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /cu[áa]nto.*(total|suma|mont[oa])/i,
    /total.*(de|m[áa]s)/i,
    /suma.*de/i,
    /cu[áa]nto.*(valen|cuestan)/i,
    /cu[áa]l.*(es )?el.*total/i
  ];
  return patrones.some(p => p.test(msg));
}

function esMensajeRelevante(mensaje) {
  const msg = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const sinonimos = {
    productos: /silla[ s]?|mesa[ s]?|cama[ s]?|sofa[ s]?|sofas?|base[ s]?|cajon[eo][ s]?|colchon[es]?|escritorio[ s]?|mueble[ s]?|sillon|puff| banqueta/,
    compra: /precio|cuesta|val(?:e|er|or)|comprar|llevar|pedido|carrito|confirmar|pagar|ordenar|adquirir/,
    materiales: /madera|flor morado|cedro|roble|laminado|tapizado|chapilla|pintado/,
    servicio: /delivery|envio|entrega|armenia|horario|atencion|contacto|ubicacion|direccion|tienda/,
    redes: /instagram|facebook|tiktok|youtube|redes?|pagina web|pagina oficial|social/,
    general: /catalogo[ s]?|pdf|foto[ s]?|imagen[ s]?|producto[ s]?|ver|mostrar|coleccion/,
    especifico: /flor morado|de casa|decasa/
  };

  for (const [categoria, patron] of Object.entries(sinonimos)) {
    if (patron.test(msg)) {
      return true;
    }
  }

  const preguntasIntencion = /cu[áa]nto|cu[áa]l|qu[é]|d[óa]nde|c[óa]mo|cu[áa]ndo|por qu[é]/;
  if (preguntasIntencion.test(msg)) {
    return false;
  }

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
🔔 ¡Mantente al día con nuestros productos y ofertas! 😊`;
}

const patronesContactoUbicacion = /donde|ubicacion|tienda|direccion|instagram|redes?|seguir|contacto|telefono|numero|whatsapp|encontrar|localizar/i;

function calcularTotalProductos(mensaje, from) {
  const msg = mensaje.toLowerCase();
  const categorias = Object.values(knowledge.inventario || {});
  const productosMencionados = [];

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      const nombreLimpio = producto.nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const palabras = nombreLimpio.split(' ').filter(p => p.length > 3);
      let coincidencias = 0;
      for (const palabra of palabras) {
        if (msg.includes(palabra)) {
          coincidencias++;
        }
      }

      if (coincidencias >= 2 || (palabras.length === 1 && msg.includes(palabras[0]))) {
        productosMencionados.push({
          nombre: producto.nombre,
          precio: producto.precio
        });
      }
    }
  }

  return productosMencionados;
}

function detectarSolicitudCatalogo(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /\bcat[áa]logos?\b/i,
    /ver.*el.*cat[áa]logo/i,
    /ver.*los.*cat[áa]logo/i,
    /cat[áa]logo.*de/i,
    /el.*cat[áa]logo\b/i,
    /d[áa]me.*el.*cat[áa]logo/i,
    /d[áa]me.*cat[áa]logo/i,
    /m[áa]ndame.*el.*cat[áa]logo/i,
    /env[ií]ame.*el.*cat[áa]logo/i,
    /env[ií]ame.*cat[áa]logo/i,
    /ver.*PDF/i,
    /ver.*pdf/i,
    /el.*PDF\b/i,
    /el.*pdf\b/i,
    /\bPDF\b/i,
    /\bpdf\b/i,
    /el pdf\b/i,
    /ver pdf\b/i,
    /dame pdf\b/i,
    /cat[áa]logo.*completo/i,
    /mostrar.*cat[áa]logo/i,
    /^cat[áa]logo$/i,
    /^dame el cat/i,
    /m[é]strame el cat/i,
    /solo\s+pdf/i,
    /solo\s+cat/i,
    /\bel\s+pdf\b/i,
    /\bver\s+pdf\b/i,
    /\bdame\s+pdf\b/i,
    /\bel\s+cat/i,
    /el\s+cat[áa]logo\s+completo/i,
    /qu[é]产品的/i,
    /ver\s+todos\s+los\s+productos/i,
    /\bver\s+todo\b/i,
    /ver\s+todo\s+el\s+cat/i,
    /ver\s+todo\s+el\s+inventario/i,
    /muestrame\s+todo/i
  ];

  for (const patron of patrones) {
    if (patron.test(mensaje)) {
      return true;
    }
  }

  return false;
}

function detectarCantidad(mensaje) {
  const patrones = [
    /(\d+)\s*(?:unidades?|unds?|uds?|u\.?)?\s*(?:de\s+)?es[ae]s/i,
    /(\d+)\s*(?:sillas?|compras?|por\s+ favor)?/i,
    /quiero\s*(\d+)/i,
    /necesito\s*(\d+)/i,
    /me\s*llevo\s*(\d+)/i,
    /(\d+)\s*de\s*(?:es[ae]s[ae]?s?)/i,
    /^si\s*(\d+)/i,
    /^sí\s*(\d+)/i,
    /si\s+(\d+)\s+unidades/i,
    /sí\s+(\d+)\s+unidades/i,
    /(\d+)\s+unidades/i
  ];

  for (const patron of patrones) {
    const match = patron.exec(mensaje.toLowerCase());
    if (match) {
      const cantidad = parseInt(match[1]);
      if (cantidad > 0 && cantidad <= 100) {
        return cantidad;
      }
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
  const patrones = [
    /me\s+gustaria\s+comprar/i,
    /me\s+gustaria\s+comprarlo/i,
    /me\s+gustaria\s+comprar\s+el/i,
    /me\s+gustaria\s+comprar\s+la/i,
    /quiero\s+comprar/i,
    /quiero\s+la\s+/i,
    /Quiero\s+el\s+/i,
    /me\s+llevo/i,
    /dame\s+el\s+/i,
    /dame\s+la\s+/i,
    /necesito\s+el\s+/i,
    /necesito\s+la\s+/i,
    /\bcomprar\b.*\b(silla|base|cama|mesa|sofa)/i,
    /\b(silla|base|cama|mesa|sofa)\b.*\bcomprar\b/i,
    /me\s+gust[óa]\s+comprar/i,
    /bien\s+me\s+gustar/i,
    /bien\s+me\s+llevo/i,
    /bien\s+me\s+comprar/i,
    /lo\s+quiero\s+comprar/i,
    /lo\s+quiero\b/i,
    /la\s+quiero\b/i,
    /me\s+lo\s+llevo/i,
    /me\s+la\s+llevo/i,
    /comprar\s+ese/i,
    /comprar\s+este/i,
    /comprar\s+la/i,
    /comprar\s+el/i,
    /\bcomprar\b\s+es[oe]/i,
    /comprar\s+el\s+nube/i,
    /comprar\s+el\s+sofa/i,
    /Comprar\s+ese/i,
    /agregarle/i,
    /agregar/i,
    /y también la/i,
    /y también el/i,
    /también la/i,
    /también el/i,
    /agrégale/i,
    /agregame/i,
    /y agrégale/i,
    /add\s+.*al\s+carrito/i,
    /ponle/i,
    /me\h+completa/i,
    /lo\s+añado/i,
    /la\s+añado/i,
    /añadir.*carrito/i,
    /meter.*carrito/i,
    /meter al/i,
    /meterle/i,
    /quisiera\s+(comprar|añadir|agregar)/i,
    /deseo\s+(comprar|añadir|agregar)/i,
    /quiero\s+(añadir|agregar)/i,
    /\bcarrito\b.*\b(añadir|agregar)/i,
    /\b(lo|la|les)\b/i,
    /\b(es|este|esta)\s+(producto|mueble)/i,
    /me\s+(lo|la)\s+(llevo|quiero|compro)/i,
    /confirmar.*compra/i,
    /proceder.*compra/i,
    /si.*comprar/i,
    /si.*quiero/i,
    /si.* Llevo/i,
    /si.* llevo/i,
    /si.*confirmo/i,
    /\bcomprar\b/i,
    /\bllevar\b/i,
    /\bañadir\b/i,
    /\bagregar\b/i,
    /me\s+lo\s+(añad|agreg)/i,
    /me\s+la\s+(añad|agreg)/i,
    /lo\s+(añad|agreg)/i,
    /la\s+(añad|agreg)/i,
    /si\s+(me|gustaria|quiero)/i,
    /me\s+gustar[ií]an/i,
    /gustar[ií]an/i,
    /me\s+gustar[ií]an\s+\d+/i,
    /gustar[ií]an\s+de/i
  ];
  return patrones.some(p => p.test(msg));
}

function buscarProductosPorCategoria(mensaje) {
  const mensajeLimpio = mensaje.toLowerCase().replace(/[^a-záéíóúñ\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const mapeoCategorias = {
    'sofa cama': 'sofas_camas',
    'sofas cama': 'sofas_camas',
    'sofacama': 'sofas_camas',
    'sofacamas': 'sofas_camas',
    'sofa': 'sofas',
    'sofas': 'sofas',
    'sofa modular': 'sofas_modulares',
    'sofas modulares': 'sofas_modulares',
    'silla barra': 'sillas_barra',
    'sillas barra': 'sillas_barra',
    'barra': 'sillas_barra',
    'silla de barra': 'sillas_barra',
    'sillas de barra': 'sillas_barra',
    'de barra': 'sillas_barra',
    'silla': 'sillas_comedor',
    'sillas': 'sillas_comedor',
    'silla comedor': 'sillas_comedor',
    'sillas de comedor': 'sillas_comedor',
    'silla auxiliar': 'sillas_auxiliares',
    'sillas auxiliar': 'sillas_auxiliares',
    'comedor': 'bases_comedores',
    'comedores': 'bases_comedores',
    'base': 'bases_comedores',
    'bases': 'bases_comedores',
    'base compositor': 'bases_comedores',
    'bases de compositor': 'bases_comedores',
    'el de comedores': 'bases_comedores',
    'las bases de comedores': 'bases_comedores',
    'mesa noche': 'mesas_noche',
    'mesas noche': 'mesas_noche',
    'mesa de noche': 'mesas_noche',
    'mesa tv': 'mesas_tv',
    'mesas tv': 'mesas_tv',
    'mesa de tv': 'mesas_tv',
    'mesa centro': 'mesas_centro',
    'mesas centro': 'mesas_centro',
    'mesa de centro': 'mesas_centro',
    'mesa sala': 'mesas_centro',
    'mesa de sala': 'mesas_centro',
    'mesa auxiliar': 'mesas_auxiliares',
    'mesas auxiliar': 'mesas_auxiliares',
    'auxiliar': 'mesas_auxiliares',
    'colchon': 'colchones',
    'colchones': 'colchones',
    'cama': 'camas',
    'camas': 'camas',
    'escritorio': 'escritorios',
    'escritorios': 'escritorios',
    'cajoneros': 'cajoneros_bifes',
    'cajones': 'cajoneros_bifes',
    'bifes': 'cajoneros_bifes'
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

function formatearProductos(precios, limite = 5) {
  if (!precios || precios.length === 0) return null;

  const limitados = precios.slice(0, limite);
  const total = precios.length;

  let mensaje = "Aquí tienes algunas opciones:\n\n";

  limitados.forEach((p, i) => {
    mensaje += `${i + 1}. ${p.nombre} - ${p.precio}\n`;
  });

  if (total > limite) {
    mensaje += `\n(${limite} de ${total}) Tenemos más opciones. ¿Quieres ver más o prefieres el catálogo completo en PDF? 😊`;
  } else {
    mensaje += "\n¿Cuál te interesa? 😊";
  }

  return mensaje;
}

function formatearProductosVenta(productos, limite = 5) {
  if (!productos || productos.length === 0) return null;

  const limitados = productos.slice(0, limite);
  const total = productos.length;

  let mensaje = "OPIONES DISPONIBLES:\n\n";

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

  const stopWords = ['dos', 'ambos', 'ambas', 'las', 'los', 'del', 'una', 'unos', 'unas', 'que', 'este', 'esta', 'ese', 'esa', 'aquel', 'aquella', 'otra', 'otro', 'todas', 'todos', 'cada', 'foto', 'fotos', 'imagen', 'imagenes', 'mandar', 'enviar', 'puedes', 'podrías', 'porfa', 'favor'];
  const productosConImagen = [];

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      if (!producto.imagen) continue;

      const nombreLimpio = producto.nombre.toLowerCase().replace(/[^a-záéíóúñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const palabrasClave = nombreLimpio.split(' ').filter(p => p.length > 2 && !stopWords.includes(p));

      let score = 0;
      for (const palabra of palabrasClave) {
        if (mensajeLower.includes(palabra)) {
          score += palabra.length;
        }
      }

      if (score > 0) {
        productosConImagen.push({
          nombre: producto.nombre,
          imagen: producto.imagen,
          score: score,
          nombreLimpio: nombreLimpio
        });
      }
    }
  }

  if (productosConImagen.length === 0) return null;

  productosConImagen.sort((a, b) => b.score - a.score);

  const mejor = productosConImagen[0];

  for (const p of productosConImagen) {
    if (p.nombreLimpio.includes(mejor.nombreLimpio) && p.nombreLimpio !== mejor.nombreLimpio) {
      if (p.score >= mejor.score * 0.8) {
        return {
          imagen: p.imagen,
          nombre: p.nombre
        };
      }
    }
  }

  return {
    imagen: mejor.imagen,
    nombre: mejor.nombre
  };
}

function formatearNombreCategoria(nombre) {
  const mapeo = {
    'cajoneros_bifes': 'cajoneros y bifes',
    'sofas_camas': 'sofacamas',
    'sofas_modulares': 'sofas modulares',
    'bases_comedores': 'bases de comedores',
    'mesas_auxiliares': 'mesas auxiliares',
    'mesas_centro': 'mesas de centro',
    'mesas_noche': 'mesas de noche',
    'mesas_tv': 'mesas de televisor',
    'sillas_auxiliares': 'sillas auxiliares',
    'sillas_barra': 'sillas de barra'
  };
  return mapeo[nombre] || nombre.replace(/_/g, ' ');
}

function buscarCatalogo(mensaje) {
  const catalogos = knowledge.catalogos || {};
  const inventario = knowledge.inventario || {};
  const mensajeLower = mensaje.toLowerCase();

  const mapeoCategorias = {
    'sofa cama': 'sofas_camas',
    'sofacama': 'sofas_camas',
    'sofacamas': 'sofas_camas',
    'sofa modular': 'sofas',
    'sofas modular': 'sofas',
    'sofas modulares': 'sofas',
    'modular': 'sofas',
    'sofa': 'sofas',
    'sofas': 'sofas',
    'silla auxiliar': 'sillas_auxiliares',
    'sillas auxiliar': 'sillas_auxiliares',
    'sillon': 'sillas_auxiliares',
    'sillón': 'sillas_auxiliares',
    'mueble para uno': 'sillas_auxiliares',
    'silla para uno': 'sillas_auxiliares',
    'silla barra': 'sillas_barra',
    'sillas barra': 'sillas_barra',
    'silla alta': 'sillas_barra',
    'silla de plancha': 'sillas_barra',
    'silla de meson': 'sillas_barra',
    'silla de mesón': 'sillas_barra',
    'silla comedor': 'sillas_comedor',
    'sillas de comedor': 'sillas_comedor',
    'silla': 'sillas_comedor',
    'sillas': 'sillas_comedor',
    'comedor': 'bases_comedores',
    'comedores': 'bases_comedores',
    'comeda': 'bases_comedores',
    'comedo': 'bases_comedores',
    'base': 'bases_comedores',
    'bases': 'bases_comedores',
    'base comedor': 'bases_comedores',
    'bases de comedor': 'bases_comedores',
    'mesa auxiliar': 'mesas_auxiliares',
    'mesas auxiliar': 'mesas_auxiliares',
    'auxiliar': 'mesas_auxiliares',
    'mesa centro': 'mesas_centro',
    'mesas centro': 'mesas_centro',
    'mesa de centro': 'mesas_centro',
    'mesa sala': 'mesas_centro',
    'mesa de sala': 'mesas_centro',
    'mesacentro': 'mesas_centro',
    'mesa noche': 'mesas_noche',
    'mesas noche': 'mesas_noche',
    'mesa de noche': 'mesas_noche',
    'mesa tv': 'mesas_tv',
    'mesas tv': 'mesas_tv',
    'mesa de tv': 'mesas_tv',
    'mesa television': 'mesas_tv',
    'mesa tele': 'mesas_tv',
    'colchon': 'colchones',
    'colchones': 'colchones',
    'cama': 'camas',
    'camas': 'camas',
    'escritorio': 'escritorios',
    'escritorios': 'escritorios',
    'cajonero': 'cajoneros_bifes',
    'cajon': 'cajoneros_bifes',
    'bifes': 'cajoneros_bifes',
    'cajoneros': 'cajoneros_bifes',
    'catalogo': 'todos',
    'ver catalogos': 'todos',
    'catalogos': 'todos',
    'pdf': 'todos',
    'ver productos': 'todos'
  };

  for (const [palabra, clave] of Object.entries(mapeoCategorias)) {
    if (mensajeLower.includes(palabra)) {
      if (clave === 'todos') {
        return { todos: true };
      }
      if (clave === 'escritorios' || clave === 'colchones') {
        return { sinPdf: true, categoria: clave };
      }
      const url = catalogos[clave];
      if (url) {
        return { url: url, categoria: clave };
      }
      if (inventario[clave] && inventario[clave].productos) {
        return { sinPdf: true, categoria: clave, productos: inventario[clave].productos };
      }
    }
  }

  return null;
}

function detectarCategoriaAmbigua(mensaje) {
  const mensajeLower = mensaje.toLowerCase().replace(/[¿?.,!]/g, '').trim();

  const sinonimosMesa = ['mesa', 'mesas', 'mobiliario', 'mueble'];
  const sinonimosSilla = ['silla', 'sillas', 'asiento', 'asientos'];

  const esSoloMesa = sinonimosMesa.some(p => mensajeLower === p || mensajeLower === 'una ' + p || mensajeLower === 'un ' + p || mensajeLower === 'ver ' + p || mensajeLower === 'dame ' + p);
  const esSoloSilla = sinonimosSilla.some(p => mensajeLower === p || mensajeLower === 'una ' + p || mensajeLower === 'un ' + p || mensajeLower === 'ver ' + p || mensajeLower === 'dame ' + p);

  if (esSoloMesa) {
    return "Qué tipo de mesa te interesa? Tenemos:\n• Mesa de centro (sala)\n• Mesa auxiliar\n• Mesa de TV\n• Mesa de noche\n\nCual quieres ver?";
  }
  if (esSoloSilla) {
    return "Qué tipo de silla te interesa? Tenemos:\n• Sillas de comedor\n• Sillas auxiliares/sillones\n• Sillas de barra\n\nCual quieres ver?";
  }

  return null;
}

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
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 600
      }
    })
  }, 2, 15000);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

const PROMPT_CLASIFICACION = `Clasifica el mensaje del usuario según estas reglas:

REGLAS DE CLASIFICACIÓN:
1. "sí" + cualquier cosa extra = CONSULTA (no confirmar)
2. "sí pero...", "sí, quiero saber..." = CONSULTA
3. "sí, confirmo", "sí, lo quiero", "sí, me lo llevo" = CONFIRMAR_COMPRA
4. producto + "medidas/material/precio" = CONSULTA_INFO
5. "hablar con", "asesor", "humano" = PEDIR_ASESOR
6. "catálogo", "PDF", "ver productos" = VER_CATALOGO
7. "cuánto", "precio", "cuesta" = CONSULTA_PRECIO
8. hola, saludos = SALUDO
9. "gracias" = AGRADECIMIENTO
10. cualquier otra cosa = GENERAL

PRODUCTOS CON PRECIOS:
${generarInventarioTexto()}

Responde SOLO con JSON en este formato (sin texto adicional):
{"intencion": "CONSULTA|CONSULTA_INFO|CONSULTA_PRECIO|CONFIRMAR_COMPRA|PEDIR_ASESOR|VER_CATALOGO|SALUDO|AGRADECIMIENTO|GENERAL", "producto": "nombre del producto o null", "detalle": "medidas/material/precio/general o null"}`;

async function clasificarIntencion(mensaje) {
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

  const contents = [
    { role: 'user', parts: [{ text: PROMPT_CLASIFICACION }] },
    { role: 'user', parts: [{ text: `Mensaje del usuario: "${mensaje}"` }] }
  ];

  const { fetchWithRetry } = require('./httpClient');
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 100
      }
    })
  }, 2, 10000);

  if (!response.ok) {
    return { intencion: 'GENERAL', producto: null, detalle: null };
  }

  const data = await response.json();
  const texto = data.candidates[0].content.parts[0].text;

  try {
    const limpio = texto.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(limpio);
  } catch {
    return { intencion: 'GENERAL', producto: null, detalle: null };
  }
}

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || 'unknown';

  console.log(`Mensaje de ${from}: ${incomingMsg}`);

  if (!incomingMsg) {
    return res.status(200).send('');
  }

  try {
    await db.verificarYLimpiarInactividad(from, 10);
    await db.getOrCreateUsuario(from);

    // EARLY GREETING CHECK - Before any product search
    const esSaludo = detectarSaludo(incomingMsg);
    console.log(`[GREETING] detectarSaludo="${esSaludo}", msg="${incomingMsg}", solo="${esSoloSaludo(incomingMsg)}"`);
    if (esSaludo) {
      if (esSoloSaludo(incomingMsg)) {
        // Pure greeting → always send full SALUDO_INICIAL
        console.log(`[GREETING] Pure greeting detected, sending SALUDO_INICIAL`);
        let response = SALUDO_INICIAL;

        const twiml = new MessagingResponse();
        twiml.message(response);
        res.type('text/xml').send(twiml.toString());
        return; // STOP processing - don't search for products
      } else {
        // Greeting + question → save to history, continue to detect question
        console.log(`[GREETING] Greeting + content, continuing to detect question`);
        await addToHistoryDB(from, 'user', incomingMsg);
        if (!(await db.haEnviadoSaludo(from))) {
          await db.marcarSaludoEnviado(from);
        }
      }
    }

    const estaTransferidoAhora = await db.estaTransferida(from);
    const esTransferencia = detectarAsesor(incomingMsg);
    if (estaTransferidoAhora && !esTransferencia) {
      console.log(`Limpiando estado transferido para ${from}`);
      await db.updateEstado(from, { transferido: false });
    }

    const history = await getHistoryDB(from);
    let response;
    let imagenURL = null;
    const mediaUrl = req.body.MediaUrl0;
    const mediaContentType = req.body.MediaContentType0;

    // CATALOG/PDF REQUEST CHECK - Before any other processing
    // This ensures "El pdf", "El catálogo", etc. are handled correctly
    if (detectarSolicitudCatalogo(incomingMsg)) {
      console.log(`[CATALOG] Solicitud de catálogo detectada: "${incomingMsg}"`);
      const categoriaGuardada = await db.getCategoriaActual(from);
      console.log(`[CATALOG] Categoria guardada: ${categoriaGuardada}`);

      let imagenURL = null;
      let response = '';

      // First try saved category
      if (categoriaGuardada && knowledge.catalogos[categoriaGuardada]) {
        imagenURL = knowledge.catalogos[categoriaGuardada];
        let nombreCat = formatearNombreCategoria(categoriaGuardada);
        response = `Claro! Aquí tienes el catálogo de ${nombreCat} 😊`;
        console.log(`[CATALOG] Enviando PDF desde categoria guardada: ${nombreCat}`);
      } else {
        // Try to detect category from message
        const catDetectada = buscarCatalogo(incomingMsg);
        if (catDetectada && catDetectada.url) {
          imagenURL = catDetectada.url;
          let nombreCat = formatearNombreCategoria(catDetectada.categoria);
          response = `Claro! Aquí tienes el catálogo de ${nombreCat} 😊`;
          console.log(`[CATALOG] Enviando PDF detectado del mensaje: ${nombreCat}`);
        } else {
          // No saved or detected category, show available categories
          const categoriasDisponibles = Object.keys(knowledge.catalogos).map(c => formatearNombreCategoria(c)).join(', ');
          response = `¿De qué categoría te gustaría ver el catálogo? 😊\n\nCategorías disponibles:\n${categoriasDisponibles}`;
          console.log(`[CATALOG] Sin categoria, mostrando disponibles`);
        }
      }

      // Save to history and send response immediately
      await addToHistoryDB(from, 'user', incomingMsg);
      await addToHistoryDB(from, 'assistant', response);
      await db.actualizarLastInteraction(from);

      const twiml = new MessagingResponse();
      if (imagenURL) {
        twiml.message({
          body: response,
          mediaUrl: [imagenURL]
        });
        console.log(`[CATALOG] Enviando imagen: ${imagenURL}`);
      } else {
        twiml.message(response);
      }
      res.type('text/xml').send(twiml.toString());
      return; // Stop processing - we've handled the catalog request
    }

    if (mediaUrl && mediaContentType && mediaContentType.startsWith('image/')) {
      console.log('Image received from:', from, 'URL:', mediaUrl);

      // Send initial response
      const twiml = new MessagingResponse();
      twiml.message('⏳ Recibí tu foto! Estoy procesando la imagen para agregar un sofá... ⏳');
      res.type('text/xml').send(twiml.toString());

      // Process image asynchronously
      try {
        const result = await processRoomImage(mediaUrl);

        const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        if (result.success) {
          await twilioClient.messages.create({
            from: req.body.To,
            to: from,
            body: '¡Aquí tienes tu sala con el nuevo sofá! 😊 ¿Te gustaría ver más opciones de sofás en nuestro catálogo?',
            mediaUrl: [result.imageUrl]
          });
        } else if (result.error === 'NO_CREDIT') {
          const recentHistory = await db.getHistorial(from, 5);
          let sofaMentioned = null;

          for (const msg of recentHistory) {
            if (msg.role === 'user') {
              const msgLower = msg.content.toLowerCase();
              const sofas = knowledge.inventario?.sofas?.productos || [];
              for (const sofa of sofas) {
                if (msgLower.includes(sofa.nombre.toLowerCase().split(' ')[0].toLowerCase())) {
                  sofaMentioned = sofa;
                  break;
                }
              }
              if (sofaMentioned) break;
            }
          }

          if (sofaMentioned) {
            await twilioClient.messages.create({
              from: req.body.To,
              to: from,
              body: `Disculpa, nuestro servicio de visualización está temporalmente no disponible 😊\n\nMientras tanto, aquí tienes la información del ${sofaMentioned.nombre}:\n💰 Precio: ${sofaMentioned.precio}\n📏 Medidas: ${sofaMentioned.medidas || 'Consultar'}\n🪵 Material: ${sofaMentioned.material || 'Tapizado'}\n\n¿Te gustaría agregarlo al carrito? 😊`
            });
          } else {
            await twilioClient.messages.create({
              from: req.body.To,
              to: from,
              body: `Disculpa, nuestro servicio de visualización de muebles está temporalmente no disponible 😊\n\nMientras tanto, tenemos estos sofás disponibles:\n• SOFÁ TERRA - $3.480.000\n• SOFÁ NUBE - $3.480.000\n• SOFÁ CHESTER - $3.380.000\n• SOFÁ LONDRES - $3.980.000\n\n¿Te gustaría ver el catálogo completo? 😊`
            });
          }
        } else {
          await twilioClient.messages.create({
            from: req.body.To,
            to: from,
            body: 'Disculpa, tuve un problema procesando tu foto 😊\n\n¿Te gustaría ver nuestro catálogo de sofás mientras tanto? Tenemos más de 15 modelos disponibles. 😊'
          });
        }
      } catch (error) {
        console.error('Error processing image:', error);
        try {
          const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          await twilioClient.messages.create({
            from: req.body.To,
            to: from,
            body: 'Disculpa, tuve un problema procesando tu foto 😊\n\n¿Te gustaría ver nuestro catálogo de sofás mientras tanto? Tenemos más de 15 modelos disponibles. 😊'
          });
        } catch (e) {
          console.error('Error sending error message:', e);
        }
      }

      return; // Stop processing - we've handled the image
    }

    const esAsesorDetectado = detectarAsesor(incomingMsg);
    let intencionClasificada = null;
    let debeTransferir = esAsesorDetectado;
    let esTransferenciaMedida = false;

    // Check if we already offered transfer for custom measurements and user confirms
    const rawTransferencia = await db.getTransferenciaMedidaPendiente(from);
    let transferenciaMedidaPendiente = null;
    if (rawTransferencia) {
      transferenciaMedidaPendiente = typeof rawTransferencia === 'object' ? rawTransferencia : { producto: rawTransferencia, solicitud: null };
    }

    const msgTrim = incomingMsg.trim().toLowerCase();
    const esAfirmativo = /^(si|sí|claro|dale|ok|ya|de una|amén|confirmo|por favor|listo|vamos|pues|porfa)(\s|$|,|\.|!)/i.test(msgTrim) && !/^(buenos?|buenas?)\s/i.test(msgTrim);
    console.log(`[TRANSFER] esAfirmativo="${esAfirmativo}", msgTrim="${msgTrim}", pendiente="${!!transferenciaMedidaPendiente}"`);

    if (transferenciaMedidaPendiente && esAfirmativo) {
      debeTransferir = true;
      esTransferenciaMedida = true;
      await db.setTransferenciaMedidaPendiente(from, transferenciaMedidaPendiente);
      console.log(`Confirmada transferencia por medida personalizada: ${from} - Producto: ${transferenciaMedidaPendiente.producto}, Solicitud: ${transferenciaMedidaPendiente.solicitud || incomingMsg}`);
    }

    if (!debeTransferir && (detectarMedidaPersonalizada(incomingMsg) || detectarPersonalizacion(incomingMsg))) {
      const productoPendiente = await db.getProductoPendiente(from);
      const ultimoProd = await db.getUltimoProducto(from);
      const producto = productoPendiente?.producto || ultimoProd?.nombre;

      if (producto) {
        await db.setTransferenciaMedidaPendiente(from, { producto: producto, solicitud: incomingMsg });
        response = `Entiendo que necesitas una personalización para ${producto}. ¿Te gustaría que te transfiera con un asesor especializado en diseño a medida? 😊`;
        console.log(`Ofreciendo transferencia por personalización: ${from} - Producto: ${producto}`);
        imagenURL = null;

        // Enviar respuesta y salir para evitar que se sobreescriba
        await addToHistoryDB(from, 'assistant', response);
        await db.actualizarLastInteraction(from);
        console.log(`Respuesta: ${response}`);
        const twiml = new MessagingResponse();
        twiml.message(response);
        res.type('text/xml').send(twiml.toString());
        return;
      }
    }

    // Check if bot offered transfer and user confirms
    let ofrecioTransferencia = false;
    if (!debeTransferir) {
      const history = await db.getHistorial(from);
      const ultimoMensajeBot = history.filter(h => h.role === 'assistant').pop();
      ofrecioTransferencia = ultimoMensajeBot && (ultimoMensajeBot.content.includes('asesor') || ultimoMensajeBot.content.includes('transfiera') || ultimoMensajeBot.content.includes('transferencia') || ultimoMensajeBot.content.includes('personalización'));

      if (ofrecioTransferencia && esAfirmativo) {
        const telefono = from.replace('whatsapp:', '');
        const productoPendiente = await db.getProductoPendiente(from);
        let prodInfo = productoPendiente?.producto || null;
        let esPersonalizacion = ultimoMensajeBot && (ultimoMensajeBot.content.includes('personalización') || ultimoMensajeBot.content.includes('personalizar') || ultimoMensajeBot.content.includes('medida') || ultimoMensajeBot.content.includes('diseño a medida'));

        if (!prodInfo && transferenciaMedidaPendiente?.producto) {
          prodInfo = transferenciaMedidaPendiente.producto;
          esPersonalizacion = true;
        }

        if (esPersonalizacion && prodInfo) {
          const solicitudUsuario = transferenciaMedidaPendiente?.solicitud || incomingMsg;
          await enviarNotificacionTelegram(telefono, solicitudUsuario, history, 'personalizacion', prodInfo, 'personalización');
        } else {
          await enviarNotificacionTelegram(telefono, 'Solicitud de transferencia a asesor', history);
        }

        await marcarTransferidaDB(from);
        response = "¡Perfecto! Te transfiero con un asesor especializado para que podamos ayudarte. Por favor, espera un momento. 😊";
        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);
        return;
      }
    }

    if (debeTransferir && !(await estaTransferidaDB(from))) {
      const telefono = from.replace('whatsapp:', '');

      if (esTransferenciaMedida) {
        const nombreProducto = transferenciaMedidaPendiente?.producto || transferenciaMedidaPendiente || 'Producto no especificado';
        const solicitudUsuario = transferenciaMedidaPendiente?.solicitud || incomingMsg;

        const esColor = /en (negro|blanco|azul|rojo|verde)/i.test(solicitudUsuario);
        const esMaterial = /de (roble|pino|cedro|cuero|tela)/i.test(solicitudUsuario);
        const tipoPersonalizacion = esColor ? 'color' : (esMaterial ? 'material' : 'medida');

        await enviarNotificacionTelegram(telefono, solicitudUsuario, history, 'personalizacion', nombreProducto, tipoPersonalizacion);
        await marcarTransferidaDB(from);

        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setTransferenciaMedidaPendiente(from, null);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);

        const tipoMsg = esColor ? 'color' : (esMaterial ? 'material' : 'medidas');
        response = `Entiendo que necesitas personalizar el ${tipoMsg} de ${nombreProducto}. Te transfiero con un asesor especializado en diseño a medida. Él te ayudará con los ajustes que necesitas. 😊\n\nUn asesor te contactará en breve.`;

        console.log(`Cliente ${telefono} transferido por personalización (${tipoPersonalizacion}): ${nombreProducto}`);
      } else {
        const itemsCarrito = await db.verCarrito(from);

        if (itemsCarrito.length > 0) {
          let productosTxt = '';
          let total = 0;
          itemsCarrito.forEach((item, i) => {
            const cant = item.cantidad || 1;
            const precio = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
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

          console.log(`Cliente ${telefono} transferido con pedido: $${total}`);
        } else {
          await enviarNotificacionTelegram(telefono, incomingMsg, history, 'asesor');
          await marcarTransferidaDB(from);

          await db.limpiarConversaciones(from);
          await db.clearProductoPendiente(from);
          await db.setCategoriaActual(from, null);
          await db.limpiarCarrito(from);

          response = `Te transfiero con un asesor, espera un momento 😊
Un asesor te atenderá personalmente para ayudarte con tu compra.`;

          console.log(`Cliente ${telefono} transferido a asesor sin pedido`);
        }
      }
      imagenURL = null;
    } else if (await db.getEstaAgendando(from)) {
      const paso = await db.getPasoAgendacion(from);
      const datos = await db.getDatosAgendacion(from);

      if (detectarCancelarAgendacion(incomingMsg)) {
        await db.cancelarAgendacion(from);
        response = `Has cancelado la agendación de cita.\n\n¿Hay algo más en lo que pueda ayudarte? 😊`;
      } else if (paso === 1) {
        const nombre = incomingMsg.trim();
        if (nombre.length < 2) {
          response = `Por favor ingresa tu nombre completo (mínimo 2 caracteres).\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.nombre = nombre;
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 2);
          response = `Selecciona la sede de tu preferencia:\n\n📍 *NUESTRAS UBICACIONES:*\n1. Av. Bolívar # 16 N 26, Armenia\n2. Km 2 vía El Edén, Armenia\n3. Km 1 vía Jardines, Armenia\n4. CC Unicentro Pereira\n5. Cra. 14 #11 - 93. Pereira, Risaralda\n\nEjemplo: 1\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 2) {
        if (!esUbicacionValida(incomingMsg)) {
          response = `Por favor ingresa el número de la sede (1, 2, 3, 4 o 5).\n\n📍 *UBICACIONES:*\n1. Av. Bolívar # 16 N 26, Armenia\n2. Km 2 vía El Edén, Armenia\n3. Km 1 vía Jardines, Armenia\n4. CC Unicentro Pereira\n5. Cra. 14 #11 - 93. Pereira, Risaralda\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.ubicacion = parseInt(incomingMsg.trim());
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 3);
          response = `¿Qué día te queda disponible?\n\n📅 *DÍAS DISPONIBLES:*\n• Lunes a viernes\n• Sábado (solo hasta las 12:00 pm)\n\nEjemplo: lunes o miercoles\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 3) {
        if (!esDiaValido(incomingMsg)) {
          response = `Por favor ingresa un día válido: lunes, martes, miercoles, jueves, viernes o sabado.\n\n📅 *HORARIO:*\n• L-V: 8:00 am a 5:00 pm\n• Sábado: 8:00 am a 12:00 pm\n\nEjemplo: miercoles o viernes\n\nPara cancelar escribe "cancelar"`;
        } else {
          const msg = incomingMsg.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^el\s+/, '');
          datos.dia = msg.charAt(0).toUpperCase() + msg.slice(1);
          datos.esSabado = esSabado(incomingMsg);
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 4);
          const horarioInfo = datos.esSabado ?
            '📅 Horario sábado: 8 am a 11 am\n\n' :
            '📅 Horario: 8 am a 4 pm\n\n';
          response = `${horarioInfo}¿A qué hora deseas visitarnos?\n\n*FORMATO (hora militar):*\n• 8 / 9 / 10 / 11 (hasta 11 am - sábado)\n• 12 / 13 / 14 / 15 / 16\n• Con minutos: 9:30 / 14:50 / 16:15\n\nEjemplo: 14 o 14:30\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 4) {
        const esSabadoFlag = datos.esSabado || false;
        if (!esHoraValida(incomingMsg, esSabadoFlag)) {
          const horarioInfo = esSabadoFlag ?
            '• Sábado: 8 am a 11 am' :
            '• L-V: 8 am a 4 pm';
          response = `Hora no válida.\n\n📅 ${horarioInfo}\n\n*FORMATO (hora militar):*\n• 8 / 9 / 10 / 11 (hasta 11 am - sábado)\n• 12 / 13 / 14 / 15 / 16\n• Con minutos: 9:30 / 14:50 / 16:15\n\nEjemplo: 14 o 14:30\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.hora = formatearHora(incomingMsg);
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 5);
          response = `¿Cuál es el motivo de tu visita?\n\nEjemplo: ver productos en persona, cotizar una mesa, verificar calidad\n\nPara cancelar escribe "cancelar"`;
        }
      } else if (paso === 5) {
        const razon = incomingMsg.trim();
        if (razon.length < 3) {
          response = `Por favor ingresa una descripción más completa (mínimo 3 caracteres).\n\nEjemplo: ver productos en persona, cotizar una mesa\n\nPara cancelar escribe "cancelar"`;
        } else {
          datos.razon = razon;
          await db.guardarDatosAgendacion(from, datos);
          await db.setPasoAgendacion(from, 6);
          const resumen = `📅 *RESUMEN DE TU CITA*
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
          response = resumen;
        }
      } else if (paso === 6) {
        const confirm = incomingMsg.toLowerCase().trim();
        if (confirm === 'sí' || confirm === 'si' || confirm === 'confirmar' || confirm === 'si, confirmar') {
          await db.guardarCita(from, datos);
          const telefonoClean = from.replace('whatsapp:', '');
          response = `¡Cita agendada exitosamente!\n\n📅 *DETALLES DE TU CITA*
━━━━━━━━━━━━━━━━━━━━━━━━
👤 Nombre: ${datos.nombre}
📅 Día: ${datos.dia}
🕐 Hora: ${datos.hora}
📍 Ubicación: ${formatearNombreUbicacion(datos.ubicacion)}
━━━━━━━━━━━━━━━━━━━━━━━━

Te esperamos! 😊\n\n¿Hay algo más en lo que pueda ayudarte?`;

          const msgTelegram = `📅 *NUEVA CITA - DeCasa*
━━━━━━━━━━━━━━━━━━━━━━━━
👤 Cliente: ${datos.nombre} (${telefonoClean})
📅 Día: ${datos.dia}
🕐 Hora: ${datos.hora}
📝 Motivo: ${datos.razon}
📍 Ubicación: ${datos.ubicacion}. ${formatearNombreUbicacion(datos.ubicacion)}
━━━━━━━━━━━━━━━━━━━━━━━━
💡 Contactar: wa.me/${telefonoClean}`;
          await enviarNotificacionTelegram(telefonoClean, msgTelegram, [], 'cita');
        } else {
          response = `No se guardó la cita.\n\nPara confirmar escribe "sí" o "confirmar"\n\nPara cancelar escribe "cancelar"`;
        }
      }
    } else if (await db.getComparacionPendiente(from)) {
      if (detectarRespuestaComparacion(incomingMsg)) {
        const prefs = extraerPreferencias(incomingMsg);
        prefs.textoCompleto = incomingMsg;
        const pendientes = await db.getComparacionPendiente(from);
        if (pendientes.presupuesto && !prefs.presupuesto) prefs.presupuesto = pendientes.presupuesto;
        if (pendientes.estilo && !prefs.estilo) prefs.estilo = pendientes.estilo;
        if (pendientes.espacio && !prefs.espacio) prefs.espacio = pendientes.espacio;

        const recomendaciones = recomendarPorPreferencias(prefs);
        if (recomendaciones) {
          await db.clearComparacionPendiente(from);
          response = recomendaciones;
        } else {
          response = "Cuéntame más detalles para ayudarte mejor 😊\n\n¿Qué categoría te interesa? (sillas, mesas, camas, sofás, etc.)";
        }
      } else if (/si|sí|claro|dale|ok|bueno|perfecto|este|ese|aquel|prefiero|escojo|elijo/i.test(incomingMsg.toLowerCase())) {
        await db.clearComparacionPendiente(from);
        response = "¿Qué producto te interesa? 😊";
      } else if (/no|ninguno|ningun|nada/i.test(incomingMsg.toLowerCase())) {
        await db.clearComparacionPendiente(from);
        response = "Entiendo. ¿Qué otro tipo de mueble buscas? 😊";
      } else {
        const prefs = extraerPreferencias(incomingMsg);
        if (prefs.presupuesto || prefs.estilo || prefs.espacio) {
          prefs.textoCompleto = incomingMsg;
          const pendientes = await db.getComparacionPendiente(from);
          if (pendientes.presupuesto && !prefs.presupuesto) prefs.presupuesto = pendientes.presupuesto;
          if (pendientes.estilo && !prefs.estilo) prefs.estilo = pendientes.estilo;
          if (pendientes.espacio && !prefs.espacio) prefs.espacio = pendientes.espacio;
          const recomendaciones = recomendarPorPreferencias(prefs);
          if (recomendaciones) {
            await db.clearComparacionPendiente(from);
            response = recomendaciones;
          } else {
            await db.clearComparacionPendiente(from);
            response = "¿Qué categoría te interesa? 😊";
          }
        } else {
          response = "Para ayudarte mejor, dime:\n\n1. 💰 ¿Cuál es tu presupuesto?\n2. 🎨 ¿Qué estilo prefieres?\n3. 📏 ¿Para qué espacio?\n\nCon eso te doy la mejor recomendación 😊";
        }
      }
    } else if (detectarComparacion(incomingMsg)) {
      const comparacion = await compararProductos(from, incomingMsg);
      if (comparacion) {
        response = comparacion;
      } else {
        await db.setComparacionPendiente(from, {});
        response = "¡Claro! Te ayudo a elegir. 😊\n\nPara recomendarte mejor, cuéntame:\n\n1. 💰 ¿Cuál es tu presupuesto aproximado?\n2. 🎨 ¿Qué estilo prefieres: moderno, clásico, minimalista?\n3. 📏 ¿Para qué espacio es? (sala, comedor, dormitorio)\n\nCon eso te puedo dar la mejor recomendación. 😊";
      }
    } else if (detectarFotoMultiple(incomingMsg)) {
      const productosComp = await db.getComparacionProductos(from);
      if (productosComp && productosComp.length >= 2) {
        const seleccionados = extraerFotoMultiple(incomingMsg, productosComp);
        if (seleccionados && seleccionados.length >= 2) {
          imagenURL = seleccionados[0].imagen;
          response = `Aquí tienes las fotos de ${seleccionados.map(p => p.nombre).join(' y ')} 😊`;
          for (let i = 1; i < seleccionados.length; i++) {
            if (seleccionados[i].imagen) {
              await enviarSegundaFoto(from, seleccionados[i].imagen, '');
            }
          }
          await db.clearComparacionProductos(from);
        } else if (seleccionados && seleccionados.length === 1) {
          imagenURL = seleccionados[0].imagen;
          response = `Aquí tienes la foto de ${seleccionados[0].nombre} 😊`;
          await db.clearComparacionProductos(from);
        } else {
          response = "No encontré las fotos que buscas 😊 ¿Qué producto te interesa?";
        }
      } else {
        response = "¿De qué productos quieres ver la foto? 😊";
      }
    } else if (await db.getCandidatosPendientes(from)) {
      // Check if this is a photo request first, before treating it as candidate selection
      if (detectarSolicitudFoto(incomingMsg)) {
        // Don't clear candidates, let it flow to the detectarSolicitudFoto block later
        const producto = buscarImagenProducto(incomingMsg);
        if (producto) {
          imagenURL = producto.imagen;
          response = `Claro! Aquí tienes la ${producto.nombre} 😊 Si quieres el catálogo completo, pídemelo y te lo envío!`;
        } else {
          response = "Claro! Dime qué producto te interesa y te envío la foto 😊 Si quieres el catálogo completo, pídemelo y te lo envío!";
        }
      } else {
        const pendientes = await db.getCandidatosPendientes(from);
        const elegido = resolverCandidatoAmbiguo(incomingMsg, pendientes.candidatos);
        if (elegido) {
          await db.clearCandidatosPendientes(from);
          await db.setCategoriaActual(from, elegido.categoria);
          await db.setUltimoProducto(from, {
            nombre: elegido.nombre,
            precio: elegido.precio,
            categoria: elegido.categoria
          });
          await db.guardarProductoPendiente(from, elegido.nombre, elegido.precio);
          const catActual = await db.getCategoriaActual(from);
          let catNombre = catActual ? formatearNombreCategoria(catActual) : 'producto';
          response = `${elegido.nombre}\n💰 Precio: ${elegido.precio}\n📏 Medidas: ${elegido.medidas || 'No disponible'}\n🪵 Material: ${elegido.material || 'No disponible'}\n\n¡Excelente opción! ${catNombre} de gran calidad.\n\n¿Procedemos a añadirlo al carrito por ${elegido.precio}? 😊`;
        } else {
          const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
          const catBD = await db.getCategoriaActual(from);
          const nuevoProducto = buscarProductoPorNombre(incomingMsg, categoriaDetectada, catBD);
          if (nuevoProducto && !nuevoProducto.ambiguo) {
            await db.clearCandidatosPendientes(from);
            const cat = nuevoProducto.categoria || categoriaDetectada || catBD;
            await db.setCategoriaActual(from, cat);
            await db.setUltimoProducto(from, { nombre: nuevoProducto.nombre, precio: nuevoProducto.precio, categoria: cat });
            await db.guardarProductoPendiente(from, nuevoProducto.nombre, nuevoProducto.precio);
            const info = buscarInfoProducto(nuevoProducto.nombre, cat);
            response = `${nuevoProducto.nombre}\n💰 Precio: ${nuevoProducto.precio}\n📏 Medidas: ${info?.medidas || 'No disponible'}\n🪵 Material: ${info?.material || 'No disponible'}\n\n¿Te interesa? 😊`;
          } else if (nuevoProducto && nuevoProducto.ambiguo && nuevoProducto.candidatos) {
            await db.clearCandidatosPendientes(from);
            const cat = nuevoProducto.categoria || categoriaDetectada || catBD;
            await db.setCategoriaActual(from, cat);
            await db.guardarCandidatosPendientes(from, nuevoProducto.candidatos, incomingMsg);
            response = formatearMensajeAmbiguo(nuevoProducto.candidatos);
          } else {
            response = formatearMensajeAmbiguo(pendientes.candidatos);
          }
        }
      }
    } else if (detectarAgendar(incomingMsg)) {
      await db.iniciarAgendacion(from);
      response = `📅 *AGENDAR CITA*\n\nCon gusto te ayudo a agendar una cita.\n\nPrimero, ¿cuál es tu nombre?\n\nPara cancelar escribe "cancelar"`;
    } else if (detectarSaludo(incomingMsg)) {
      const tieneSaludo = true;
      let respuestaSecundaria = '';

      if (/instagram|facebook|tiktok|youtube|redes?|pagina web|pagina oficial|social/i.test(incomingMsg)) {
        respuestaSecundaria = `Síguenos en Instagram: @muebles_decasa\n🔔 ¡Mantente al día con nuestros nuevos productos y promociones! 😊`;
      } else if (detectarUbicacion(incomingMsg)) {
        respuestaSecundaria = `Puedes visitarnos en cualquiera de nuestras cinco tiendas:
*   **Avenida Bolívar # 16 N 26, Armenia, Quindío**
*   **Km 2 vía El Edén, Armenia, Quindío**
*   **Km 1 vía Jardines, Armenia, Quindío**
*   **CC Unicentro Pereira, Pereira, Risaralda**
*   **Cra. 14 #11 - 93. Pereira, Risaralda**
¿Te gustaría que te agendara una visita a alguna de ellas? 😊`;
      } else if ((detectarCompra(incomingMsg) || detectarIntentionAddCarrito(incomingMsg)) && incomingMsg.toLowerCase().includes('comedor')) {
        const productoEspecifico = buscarProductoPorNombre(incomingMsg, 'bases_comedores');
        if (productoEspecifico) {
          if (productoEspecifico.ambiguo && productoEspecifico.candidatos) {
            await db.guardarCandidatosPendientes(from, productoEspecifico.candidatos, incomingMsg);
            respuestaSecundaria = formatearMensajeAmbiguo(productoEspecifico.candidatos);
          } else {
            const cantidad = detectarCantidad(incomingMsg) || 1;
            await db.setCategoriaActual(from, 'bases_comedores');
            await db.setUltimoProducto(from, {
              nombre: productoEspecifico.nombre,
              precio: productoEspecifico.precio,
              categoria: 'bases_comedores'
            });
            await db.guardarProductoPendiente(from, productoEspecifico.nombre, productoEspecifico.precio, cantidad);
            respuestaSecundaria = `${productoEspecifico.nombre}\n💰 Precio: ${productoEspecifico.precio}\n📏 Medidas: ${productoEspecifico.medidas || 'No disponible'}\n🪵 Material: ${productoEspecifico.material || 'No disponible'}\n\n¿Confirmas agregar al carrito? Responde "sí" para confirmar 😊`;
          }
        } else {
          respuestaSecundaria = '¿Cuál modelo de comedor te interesa? 😊';
        }
      } else if (await db.getSubtipoPendiente(from)) {
        const contexto = await db.getSubtipoPendiente(from);
        const categoriaResuelta = resolverRespuestaSubtipo(incomingMsg, contexto.categoriaPadre);
        if (categoriaResuelta && knowledge.inventario[categoriaResuelta]) {
          await db.clearSubtipoPendiente(from);
          await db.setCategoriaActual(from, categoriaResuelta);
          respuestaSecundaria = formatearProductosVenta(knowledge.inventario[categoriaResuelta].productos);
          if (['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'].includes(categoriaResuelta)) {
            respuestaSecundaria += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
          }
        } else {
          await db.clearSubtipoPendiente(from);
          respuestaSecundaria = null;
        }
      } else if (detectarSolicitudCatalogo(incomingMsg) || incomingMsg.toLowerCase().includes('comedores') || incomingMsg.toLowerCase().includes('comedor') || incomingMsg.toLowerCase().includes('bases de') || incomingMsg.toLowerCase().includes('camas') || incomingMsg.toLowerCase().includes('sillas') || incomingMsg.toLowerCase().includes('sofás') || incomingMsg.toLowerCase().includes('colchon') || incomingMsg.toLowerCase().includes('sofas')) {
        const msgLower = incomingMsg.toLowerCase();
        const esMensajeGenericoSillas = /que.*sillas|tiene.*sillas|ver.*sillas|tipos.*silla|que.*tipos.*silla|sillas tienen|ver las sillas/i.test(msgLower);
        const esMensajeGenericoMesas = /que.*mesas|tiene.*mesas|ver.*mesas|tipos.*mesa|que.*tipos.*mesa|mesas tienen|ver las mesas/i.test(msgLower);

        if (esMensajeGenericoSillas) {
          respuestaSecundaria = formatearPreguntaSubtipo('sillas_comedor', incomingMsg);
          await db.setSubtipoPendiente(from, 'sillas_comedor');
        } else if (esMensajeGenericoMesas) {
          respuestaSecundaria = formatearPreguntaSubtipo('mesas_centro', incomingMsg);
          await db.setSubtipoPendiente(from, 'mesas_centro');
        } else {
          let porCategoria = buscarProductosPorCategoria(incomingMsg);
          let catalogo = null;

          if (porCategoria.categoria) {
            const productoEspecifico = buscarProductoPorNombre(incomingMsg, porCategoria.categoria);
            if (productoEspecifico) {
              if (productoEspecifico.ambiguo && productoEspecifico.candidatos) {
                await db.guardarCandidatosPendientes(from, productoEspecifico.candidatos, incomingMsg);
                respuestaSecundaria = formatearMensajeAmbiguo(productoEspecifico.candidatos);
              } else {
                await db.setCategoriaActual(from, porCategoria.categoria);
                await db.setUltimoProducto(from, {
                  nombre: productoEspecifico.nombre,
                  precio: productoEspecifico.precio,
                  categoria: porCategoria.categoria
                });
                respuestaSecundaria = `${productoEspecifico.nombre}\n💰 Precio: ${productoEspecifico.precio}\n📏 Medidas: ${productoEspecifico.medidas || 'No disponible'}\n🪵 Material: ${productoEspecifico.material || 'No disponible'}\n\n¿Te interesa? 😊`;
                imagenURL = productoEspecifico.imagen || null;
              }
            }
          }

          if (!respuestaSecundaria) {
            const categoriaGuardada = await db.getCategoriaActual(from);
            if (categoriaGuardada && knowledge.catalogos[categoriaGuardada] && !porCategoria.categoria) {
              catalogo = { categoria: categoriaGuardada, url: knowledge.catalogos[categoriaGuardada] };
            }

            if (!porCategoria.categoria && !catalogo) {
              if (categoriaGuardada && knowledge.inventario[categoriaGuardada]) {
                porCategoria = { categoria: categoriaGuardada, productos: knowledge.inventario[categoriaGuardada].productos };
              }
            }

            if (!porCategoria.categoria && !catalogo) {
              const catalogoBuscado = buscarCatalogo(incomingMsg);
              if (catalogoBuscado) {
                if (catalogoBuscado.url && catalogoBuscado.categoria) {
                  catalogo = catalogoBuscado;
                  porCategoria = { categoria: catalogoBuscado.categoria, productos: [] };
                } else if (catalogoBuscado.sinPdf && catalogoBuscado.categoria && catalogoBuscado.productos) {
                  porCategoria = { categoria: catalogoBuscado.categoria, productos: catalogoBuscado.productos };
                  await db.setCategoriaActual(from, catalogoBuscado.categoria);
                }
              }
            }

            if (!catalogo && porCategoria.categoria && knowledge.catalogos[porCategoria.categoria]) {
              catalogo = { categoria: porCategoria.categoria, url: knowledge.catalogos[porCategoria.categoria] };
              await db.setCategoriaActual(from, porCategoria.categoria);
            }

            if (catalogo && catalogo.url) {
              imagenURL = catalogo.url;
              let nombreCat = formatearNombreCategoria(catalogo.categoria);
              respuestaSecundaria = `Claro! Aquí tienes el catálogo de ${nombreCat} 😊`;
            } else if (porCategoria.productos && porCategoria.productos.length > 0) {
              if (porCategoria.categoria) {
                await db.setCategoriaActual(from, porCategoria.categoria);
              }
              respuestaSecundaria = formatearProductosVenta(porCategoria.productos);
            } else {
              const categoriasDisponibles = Object.keys(knowledge.catalogos).map(c => formatearNombreCategoria(c)).join(', ');
              respuestaSecundaria = `Claro! Estas son las categorías disponibles:\n${categoriasDisponibles}\n\n¿Cuál te gustaría ver? 😊`;
            }
          }
        }

      } else if (detectarConsultaPrecio(incomingMsg)) {
        const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
        const catBD = await db.getCategoriaActual(from);
        const producto = buscarProductoPorNombre(incomingMsg, categoriaDetectada, catBD);
        if (producto) {
          if (producto.categoria) {
            await db.setCategoriaActual(from, producto.categoria);
          }
          respuestaSecundaria = `${producto.nombre} | ${producto.precio}. ¿Te interesa? 😊`;
        } else {
          const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
          if (resultadoCategoria.productos && resultadoCategoria.productos.length > 0) {
            respuestaSecundaria = formatearProductosVenta(resultadoCategoria.productos);
            if (resultadoCategoria.categoria) {
              await db.setCategoriaActual(from, resultadoCategoria.categoria);
            }
          }
        }
      } else if (detectarConsultaInfo(incomingMsg)) {
        const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
        const catBD = await db.getCategoriaActual(from);
        const productoInfo = buscarInfoProducto(incomingMsg, categoriaDetectada, catBD);
        if (productoInfo) {
          if (productoInfo.ambiguo && productoInfo.candidatos) {
            await db.guardarCandidatosPendientes(from, productoInfo.candidatos, incomingMsg);
            respuestaSecundaria = formatearMensajeAmbiguo(productoInfo.candidatos);
          } else {
            if (buscarProductosPorCategoria(incomingMsg).categoria) {
              await db.setCategoriaActual(from, buscarProductosPorCategoria(incomingMsg).categoria);
            }
            await db.setUltimoProducto(from, {
              nombre: productoInfo.nombre,
              precio: productoInfo.precio,
              medidas: productoInfo.medidas,
              material: productoInfo.material
            });
            respuestaSecundaria = `${productoInfo.nombre}\n💰 Precio: ${productoInfo.precio}\n📏 Medidas: ${productoInfo.medidas}\n🪵 Material: ${productoInfo.material}\n\n¿Procedemos a añadirla al carrito por ${productoInfo.precio}? 😊`;
          }
        }
      }

      if (respuestaSecundaria) {
        response = `${SALUDO_INICIAL}\n\n${respuestaSecundaria}`;
      } else {
        response = SALUDO_INICIAL;
      }
      if (!(await db.haEnviadoSaludo(from))) {
        await db.marcarSaludoEnviado(from);
      }
    } else if (detectarUbicacion(incomingMsg)) {
      response = `¡Claro que sí! Puedes visitarnos en cualquiera de nuestras cinco tiendas:
*   **Avenida Bolívar # 16 N 26, Armenia, Quindío**
*   **Km 2 vía El Edén, Armenia, Quindío**
*   **Km 1 vía Jardines, Armenia, Quindío**
*   **CC Unicentro Pereira, Pereira, Risaralda**
*   **Cra. 14 #11 - 93. Pereira, Risaralda**
¿Te gustaría que te agendara una visita a alguna de ellas? 😊`;
      imagenURL = null;
    } else if (await estaTransferidaDB(from)) {
      const telefono = from.replace('whatsapp:', '');
      console.log(`Conversación transferida - Cliente ${telefono} dice: ${incomingMsg}`);

      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        await enviarNotificacionTelegram(telefono, incomingMsg, []);
      }

      res.status(200).send('');
      return;
    } else if (detectarMasBarato(incomingMsg)) {
      const categoria = await db.getCategoriaActual(from);
      if (categoria && knowledge.inventario[categoria]) {
        const masBarato = buscarMasBarato(categoria);
        if (masBarato) {
          response = `La opción más económica es ${masBarato.nombre} | ${masBarato.precio}. ¿Te interesa? 😊`;
        }
      } else {
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        if (resultadoCategoria.categoria) {
          const masBarato = buscarMasBarato(resultadoCategoria.categoria);
          if (masBarato) {
            await db.setCategoriaActual(from, resultadoCategoria.categoria);
            response = `La opción más económica es ${masBarato.nombre} | ${masBarato.precio}. ¿Te interesa? 😊`;
          }
        } else {
          response = "¿De qué categoría quieres la opción más económica? 😊";
        }
      }
    } else if (detectarFotoMultiple(incomingMsg)) {
      const productosComp = await db.getComparacionProductos(from);
      if (productosComp && productosComp.length >= 2) {
        const seleccionados = extraerFotoMultiple(incomingMsg, productosComp);
        if (seleccionados && seleccionados.length >= 2) {
          imagenURL = seleccionados[0].imagen;
          response = `Aquí tienes las fotos de ${seleccionados.map(p => p.nombre).join(' y ')} 😊`;
          for (let i = 1; i < seleccionados.length; i++) {
            if (seleccionados[i].imagen) {
              await enviarSegundaFoto(from, seleccionados[i].imagen, '');
            }
          }
          await db.clearComparacionProductos(from);
        } else if (seleccionados && seleccionados.length === 1) {
          imagenURL = seleccionados[0].imagen;
          response = `Aquí tienes la foto de ${seleccionados[0].nombre} 😊`;
          await db.clearComparacionProductos(from);
        } else {
          response = "No encontré las fotos que buscas 😊 ¿Qué producto te interesa?";
        }
      } else {
        response = "¿De qué productos quieres ver la foto? 😊";
      }
    } else if (detectarSolicitudFoto(incomingMsg)) {
      const producto = buscarImagenProducto(incomingMsg);
      if (producto) {
        imagenURL = producto.imagen;
        response = `Claro! Aquí tienes la ${producto.nombre} 😊 Si quieres el catálogo completo, pídemelo y te lo envío!`;
      } else {
        response = "Claro! Dime qué producto te interesa y te envío la foto 😊 Si quieres el catálogo completo, pídemelo y te lo envío!";
      }
    } else if (esConsultaGenericaCategoria(incomingMsg)) {
      const msgLower = incomingMsg.toLowerCase();
      if (msgLower.includes('silla')) {
        response = formatearPreguntaSubtipo('sillas_comedor', incomingMsg);
        await db.setSubtipoPendiente(from, 'sillas_comedor');
      } else if (msgLower.includes('mesa')) {
        response = formatearPreguntaSubtipo('mesas_centro', incomingMsg);
        await db.setSubtipoPendiente(from, 'mesas_centro');
      } else {
        let porCategoria = buscarProductosPorCategoria(incomingMsg);
        if (porCategoria.categoria && porCategoria.productos.length > 0) {
          await db.setCategoriaActual(from, porCategoria.categoria);
          response = formatearProductosVenta(porCategoria.productos);
          if (porCategoria.categoria === 'bases_comedores') {
            response += "\n\n💡 Recuerda: La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
          }
        } else {
          response = "¿Qué categoría de muebles te interesa ver? 😊";
        }
      }
    } else if ((detectarConsultaPrecio(incomingMsg) || detectarConsultaInfo(incomingMsg)) &&
      (incomingMsg.toLowerCase().includes('comedor') || incomingMsg.toLowerCase().includes('silla') || incomingMsg.toLowerCase().includes('cama') || incomingMsg.toLowerCase().includes('sofa') || incomingMsg.toLowerCase().includes('bases de') || incomingMsg.toLowerCase().includes('colchon') || incomingMsg.toLowerCase().includes('mesa'))) {
      const catBD = await db.getCategoriaActual(from);
      const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
      const producto = buscarProductoPorNombre(incomingMsg, categoriaDetectada, catBD);
      if (producto && !producto.ambiguo) {
        const cat = producto.categoria || categoriaDetectada || catBD;
        await db.setCategoriaActual(from, cat);
        await db.setUltimoProducto(from, { nombre: producto.nombre, precio: producto.precio, categoria: cat });
        await db.guardarProductoPendiente(from, producto.nombre, producto.precio);
        const info = buscarInfoProducto(producto.nombre, cat);
        response = `${producto.nombre}\n💰 Precio: ${producto.precio}\n📏 Medidas: ${info?.medidas || 'No disponible'}\n🪵 Material: ${info?.material || 'No disponible'}\n\n¿Te interesa? 😊`;
      } else if (producto && producto.ambiguo && producto.candidatos) {
        const cat = producto.categoria || categoriaDetectada || catBD;
        await db.setCategoriaActual(from, cat);
        await db.guardarCandidatosPendientes(from, producto.candidatos, incomingMsg);
        response = formatearMensajeAmbiguo(producto.candidatos);
      } else {
        const catBD2 = await db.getCategoriaActual(from);
        const cat2 = categoriaDetectada || catBD2;
        if (cat2 && knowledge.inventario[cat2]) {
          const productosCat = knowledge.inventario[cat2].productos;
          response = formatearProductosVenta(productosCat);
          await db.setCategoriaActual(from, cat2);
          if (cat2 === 'bases_comedores') {
            response += "\n\n💡 Recuerda: La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
          }
        } else {
          response = `Claro! Estas son las categorías disponibles:\n${Object.keys(knowledge.catalogos).map(c => formatearNombreCategoria(c)).join(', ')}\n\n¿Cuál te gustaría ver? 😊`;
        }
      }
    } else if (/vienen\s+por\s+separado|se\s+venden\s+(por|de)\s+separado|inclu(ye|yen)|trae|traen|con\s+silla|sin\s+silla|silla\s+(incluida|suelta)|demora|entrega|domicilio|envio|pago|cuota|financiaci|plazo|color|tama|personaliz|medida\s+especial|medida\s+a\s+medida|a\s+medida/i.test(incomingMsg)) {
      const catBD = await db.getCategoriaActual(from);
      const ultimoProd = await db.getUltimoProducto(from);
      const prodNombre = ultimoProd?.nombre || null;
      const msgLower = incomingMsg.toLowerCase();

      let respuestaPregunta = null;

      if (/vienen\s+por\s+separado|se\s+venden\s+por\s+separado|inclu(ye|yen)|trae\s+silla|traen\s+silla/i.test(msgLower)) {
        if (catBD === 'bases_comedores') {
          respuestaPregunta = `No, las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑`;
          if (prodNombre) {
            respuestaPregunta += `\n\n${prodNombre} es solo la base. Puedes elegir las sillas que más te gusten de nuestro catálogo.`;
          }
          const sillas = knowledge.inventario.sillas_comedor?.productos || [];
          if (sillas.length > 0) {
            respuestaPregunta += `\n\nEstas son algunas sillas disponibles:\n`;
            sillas.slice(0, 5).forEach(s => {
              respuestaPregunta += `• ${s.nombre} | ${s.precio}\n`;
            });
            respuestaPregunta += `\n¿Te interesa alguna? 😊`;
          }
        } else if (catBD === 'camas') {
          respuestaPregunta = `La cama viene con su base incluida. ¿Te gustaría ver más detalles? 😊`;
        } else {
          respuestaPregunta = `Cada producto tiene sus propias especificaciones. Cuéntame cuál te interesa y te doy más detalles. 😊`;
        }
      } else if (/entrega|domicilio|envio|demora/i.test(msgLower)) {
        respuestaPregunta = `Los muebles se fabrican a pedido y el tiempo de entrega varía según el producto. Un asesor te puede dar información exacta sobre tiempos de entrega a tu ubicación. 😊`;
      } else if (/pago|cuota|financiaci|plazo/i.test(msgLower)) {
        respuestaPregunta = `Aceptamos diferentes métodos de pago. Un asesor te puede informar sobre opciones de financiación y plazos disponibles. 😊`;
      } else if (/color|tama|personaliz|medida\s+especial|medida\s+a\s+medida|a\s+medida/i.test(msgLower)) {
        const prodPendiente = await db.getProductoPendiente(from);
        const ultimoProd = await db.getUltimoProducto(from);
        const prodParaPersonalizar = prodPendiente?.producto || ultimoProd?.nombre || 'Producto no especificado';
        await db.setTransferenciaMedidaPendiente(from, { producto: prodParaPersonalizar, solicitud: incomingMsg });
        respuestaPregunta = `Todos nuestros muebles pueden personalizarse en medidas, colores y materiales. ¿Te gustaría que te transfiera con un asesor para cotizar tu diseño a medida? 😊`;
      }

      if (respuestaPregunta) {
        if (/silla|sillas/i.test(msgLower) && catBD === 'bases_comedores') {
          // Already includes sillas list in respuestaPregunta, no need to append catalog
          response = respuestaPregunta;
        } else {
          response = respuestaPregunta;
        }
      } else {
        // Question pattern detected but not matched, fall through to Gemini
        await addToHistoryDB(from, 'user', incomingMsg);
        response = await callGemini({ history, currentMessage: incomingMsg });
      }
    } else if (await db.getSubtipoPendiente(from)) {
      const contexto = await db.getSubtipoPendiente(from);
      const categoriaResuelta = resolverRespuestaSubtipo(incomingMsg, contexto.categoriaPadre);
      if (categoriaResuelta && knowledge.inventario[categoriaResuelta]) {
        await db.clearSubtipoPendiente(from);
        await db.setCategoriaActual(from, categoriaResuelta);
        response = formatearProductosVenta(knowledge.inventario[categoriaResuelta].productos);
        if (['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'].includes(categoriaResuelta)) {
          response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
        }
      } else {
        await db.clearSubtipoPendiente(from);
        response = null;
      }
    } else if (detectarSolicitudCatalogo(incomingMsg) || incomingMsg.toLowerCase().includes('comedores') || incomingMsg.toLowerCase().includes('comedor') || incomingMsg.toLowerCase().includes('bases de') || incomingMsg.toLowerCase().includes('camas') || incomingMsg.toLowerCase().includes('sillas') || incomingMsg.toLowerCase().includes('sofás') || incomingMsg.toLowerCase().includes('colchon') || incomingMsg.toLowerCase().includes('sofas')) {
      const msgLower = incomingMsg.toLowerCase();
      const esMensajeGenericoSillas = /que.*sillas|tiene.*sillas|ver.*sillas|tipos.*silla|que.*tipos.*silla|sillas tienen|ver las sillas/i.test(msgLower);
      const esMensajeGenericoMesas = /que.*mesas|tiene.*mesas|ver.*mesas|tipos.*mesa|que.*tipos.*mesa|mesas tienen|ver las mesas/i.test(msgLower);

      if (esMensajeGenericoSillas) {
        response = formatearPreguntaSubtipo('sillas_comedor', incomingMsg);
        await db.setSubtipoPendiente(from, 'sillas_comedor');
      } else if (esMensajeGenericoMesas) {
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
          if (categoriaGuardada && knowledge.inventario[categoriaGuardada]) {
            porCategoria = { categoria: categoriaGuardada, productos: knowledge.inventario[categoriaGuardada].productos };
          }
        }

        if (!porCategoria.categoria && !catalogo) {
          const catalogoBuscado = buscarCatalogo(incomingMsg);
          if (catalogoBuscado) {
            if (catalogoBuscado.url && catalogoBuscado.categoria) {
              catalogo = catalogoBuscado;
              porCategoria = { categoria: catalogoBuscado.categoria, productos: [] };
            } else if (catalogoBuscado.sinPdf && catalogoBuscado.categoria && catalogoBuscado.productos) {
              porCategoria = { categoria: catalogoBuscado.categoria, productos: catalogoBuscado.productos };
              await db.setCategoriaActual(from, catalogoBuscado.categoria);
            }
          }
        }

        if (!catalogo && porCategoria.categoria && knowledge.catalogos[porCategoria.categoria]) {
          catalogo = { categoria: porCategoria.categoria, url: knowledge.catalogos[porCategoria.categoria] };
          await db.setCategoriaActual(from, porCategoria.categoria);
        }

        if (catalogo && catalogo.url) {
          imagenURL = catalogo.url;
          let nombreCat = formatearNombreCategoria(catalogo.categoria);
          response = `Claro! Aquí tienes el catálogo de ${nombreCat} 😊`;
        } else if (porCategoria.productos && porCategoria.productos.length > 0) {
          if (porCategoria.categoria) {
            await db.setCategoriaActual(from, porCategoria.categoria);
          }
          response = formatearProductosVenta(porCategoria.productos);
          const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
          if (porCategoria.categoria && categoriasSillas.includes(porCategoria.categoria)) {
            response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
          }
          if (porCategoria.categoria === 'bases_comedores') {
            response += "\n\n💡 Recuerda: La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
          }
        } else {
          const categoriasDisponibles = Object.keys(knowledge.catalogos).map(c => formatearNombreCategoria(c)).join(', ');
          response = `Claro! Estas son las categorías disponibles:\n${categoriasDisponibles}\n\n¿ cual te gustaría ver? 😊`;
        }
      }
    } else if (detectarConsultaPrecio(incomingMsg)) {
      const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
      const subtipo = necesitaSubtipo(incomingMsg, categoriaDetectada);
      if (subtipo === 'PEDIR_SUBTIPO') {
        response = formatearPreguntaSubtipo(categoriaDetectada, incomingMsg);
        await db.setSubtipoPendiente(from, categoriaDetectada);
      } else if (subtipo) {
        const productosSubtipo = knowledge.inventario[subtipo]?.productos || [];
        if (productosSubtipo.length > 0) {
          await db.setCategoriaActual(from, subtipo);
          const tienePdf = knowledge.catalogos[subtipo];
          response = formatearProductosVenta(productosSubtipo);
          if (tienePdf) {
            response += "\n\n¿Quieres ver el catálogo completo en PDF? 😊";
          }
        }
      }
      if (response) {
        // Ya se manejó
      } else {
        const catBD2 = await db.getCategoriaActual(from);
        let producto = buscarProductoPorNombre(incomingMsg, categoriaDetectada, catBD2);

        if (!producto) {
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd) {
            producto = {
              nombre: ultimoProd.nombre,
              precio: ultimoProd.precio,
              categoria: ultimoProd.categoria || categoriaDetectada
            };
          }
        }

        if (producto) {
          if (producto.categoria) {
            await db.setCategoriaActual(from, producto.categoria);
          }
          await db.setUltimoProducto(from, {
            nombre: producto.nombre,
            precio: producto.precio,
            categoria: producto.categoria
          });
          response = `${producto.nombre} | ${producto.precio}. ¿Te interesa? 😊`;
        }
      }
    } else if (detectarConsultaInfo(incomingMsg)) {
      const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
      const subtipo = necesitaSubtipo(incomingMsg, categoriaDetectada);
      if (subtipo === 'PEDIR_SUBTIPO') {
        response = formatearPreguntaSubtipo(categoriaDetectada, incomingMsg);
        await db.setSubtipoPendiente(from, categoriaDetectada);
      } else if (subtipo) {
        const productosSubtipo = knowledge.inventario[subtipo]?.productos || [];
        if (productosSubtipo.length > 0) {
          await db.setCategoriaActual(from, subtipo);
          const tienePdf = knowledge.catalogos[subtipo];
          response = formatearProductosVenta(productosSubtipo);
          const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
          if (subtipo && categoriasSillas.includes(subtipo)) {
            response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
          }
          if (subtipo === 'bases_comedores') {
            response += "\n\n💡 Recuerda: La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
          }
          if (tienePdf) {
            response += "\n\n¿Quieres ver el catálogo completo en PDF? 😊";
          }
        }
      }
      if (response) {
        // Ya se manejó
      } else {
        const catBD2 = await db.getCategoriaActual(from);
        const productoInfo = buscarInfoProducto(incomingMsg, categoriaDetectada, catBD2);
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        const porCategoria = resultadoCategoria.productos;
        if (porCategoria.length > 0) {
          if (resultadoCategoria.categoria) {
            await db.setCategoriaActual(from, resultadoCategoria.categoria);
          }
          response = formatearProductosVenta(porCategoria);
          const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
          if (resultadoCategoria.categoria && categoriasSillas.includes(resultadoCategoria.categoria)) {
            response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
          }
          if (resultadoCategoria.categoria === 'bases_comedores') {
            response += "\n\n💡 Recuerda: La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
          }
        } else {
          const catActual = await db.getCategoriaActual(from);
          if (catActual && knowledge.inventario[catActual]) {
            response = formatearProductosVenta(knowledge.inventario[catActual].productos);
          } else {
            const catNombre = categoriaDetectada ? formatearNombreCategoria(categoriaDetectada) : 'comedores';
            response = `No encontré "${incomingMsg}" en nuestro inventario. 
            
Tenemos varias opciones de ${catNombre} disponibles.¿Te gustaría ver nuestro catálogo de ${catNombre}? 😊`;
          }
        }
      }
    } else if (detectarConsultaInfo(incomingMsg)) {
      const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
      const catBD = await db.getCategoriaActual(from);
      const productoInfo = buscarInfoProducto(incomingMsg, categoriaDetectada, catBD);
      if (productoInfo) {
        if (productoInfo.ambiguo && productoInfo.candidatos) {
          await db.guardarCandidatosPendientes(from, productoInfo.candidatos, incomingMsg);
          response = formatearMensajeAmbiguo(productoInfo.candidatos);
        } else {
          const cat = buscarProductosPorCategoria(incomingMsg);
          if (cat.categoria) {
            await db.setCategoriaActual(from, cat.categoria);
          }

          await db.setUltimoProducto(from, {
            nombre: productoInfo.nombre,
            precio: productoInfo.precio,
            medidas: productoInfo.medidas,
            material: productoInfo.material
          });

          await db.guardarProductoPendiente(from, productoInfo.nombre, productoInfo.precio);

          const es_buscar_info = /medidas|material|de qué|características|es de|es de qué|que trae|viene/i.test(incomingMsg);
          if (es_buscar_info) {
            response = `${productoInfo.nombre}\n📏 Medidas: ${productoInfo.medidas}\n🪵 Material: ${productoInfo.material}\n💰 Precio: ${productoInfo.precio}\n\nEsta pieza está hecha en ${productoInfo.material.split(',')[0].toLowerCase()}, lo que garantiza resistencia y durabilidad.\n\n¿Procedemos a añadirla al carrito por ${productoInfo.precio}? 😊`;
          } else {
            response = `${productoInfo.nombre}\n💰 Precio: ${productoInfo.precio}\n📏 Medidas: ${productoInfo.medidas}\n🪵 Material: ${productoInfo.material}\n\n¡Excelente opción! Esta pieza está hecha en ${productoInfo.material.split(',')[0].toLowerCase()}, muy resistente y elegante.\n\n¿Procedemos a añadirla al carrito por ${productoInfo.precio}? 😊`;
          }
        }
      } else {
        const catBD = await db.getCategoriaActual(from);
        const productosBD = catBD && knowledge.inventario[catBD]?.productos;
        if (productosBD && productosBD.length > 0) {
          response = formatearProductosVenta(productosBD);
          const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
          if (catBD && categoriasSillas.includes(catBD)) {
            response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
          }
          if (catBD === 'bases_comedores') {
            response += "\n\n💡 Recuerda: La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
          }
        } else {
          const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
          const porCategoria = resultadoCategoria.productos;
          if (porCategoria.length > 0) {
            if (resultadoCategoria.categoria) {
              await db.setCategoriaActual(from, resultadoCategoria.categoria);
            }
            response = formatearProductosVenta(porCategoria);
          } else if (!esMensajeRelevante(incomingMsg)) {
            const catActivaFallback = await db.getCategoriaActual(from);
            if (catActivaFallback) {
              const productoEnCatActiva = buscarProductoPorNombre(incomingMsg, catActivaFallback, catActivaFallback);
              if (productoEnCatActiva && !productoEnCatActiva.ambiguo) {
                const productoInfoFallback = buscarInfoProducto(productoEnCatActiva.nombre, catActivaFallback);
                await db.setUltimoProducto(from, { nombre: productoEnCatActiva.nombre, precio: productoEnCatActiva.precio, categoria: catActivaFallback });
                await db.guardarProductoPendiente(from, productoEnCatActiva.nombre, productoEnCatActiva.precio);
                response = `${productoEnCatActiva.nombre}\n💰 Precio: ${productoEnCatActiva.precio}\n📏 Medidas: ${productoInfoFallback?.medidas || 'No disponible'}\n🪵 Material: ${productoInfoFallback?.material || 'No disponible'}\n\n¡Excelente opción! ¿Procedemos a añadirlo al carrito por ${productoEnCatActiva.precio}? 😊`;
              } else if (productoEnCatActiva && productoEnCatActiva.ambiguo && productoEnCatActiva.candidatos) {
                await db.guardarCandidatosPendientes(from, productoEnCatActiva.candidatos, incomingMsg);
                response = formatearMensajeAmbiguo(productoEnCatActiva.candidatos);
              } else {
                await addToHistoryDB(from, 'user', incomingMsg);
                response = await callGemini({ history, currentMessage: incomingMsg });
              }
            } else if (patronesContactoUbicacion.test(incomingMsg)) {
              response = generarRespuestaContactoUbicacion();
            } else {
              response = `Disculpa, solo puedo ayudarte con información sobre nuestros muebles de DeCasa 😊 \n\n¿Te puedo mostrar nuestro catálogo de productos? 📦${generarMensajeDespedida()}`;
            }
          } else {
            // Check if message contains furniture-like words but no confident match
            const tienePalabrasMueble = /cama|silla|mesa|sofa|base|comedor|escritorio/i.test(incomingMsg);
            if (tienePalabrasMueble && !productoDetectado) {
              response = "No estoy segura de qué producto buscas exactamente. ¿Podrías decirme el nombre correcto o describirlo mejor? 😊";
              const catActual = await db.getCategoriaActual(from);
              if (catActual && knowledge.inventario[catActual]) {
                response += `\n\nO puedo mostrarte las opciones de ${formatearNombreCategoria(catActual)} que tenemos disponibles. 😊`;
              }
            }
            const catFallback = buscarProductosPorCategoria(incomingMsg);
            if (catFallback.categoria && catFallback.productos && catFallback.productos.length > 0) {
              await db.setCategoriaActual(from, catFallback.categoria);
              response = formatearProductosVenta(catFallback.productos);
            } else {
              await addToHistoryDB(from, 'user', incomingMsg);
              response = await callGemini({
                history: history,
                currentMessage: incomingMsg
              });

              const pareceNoSabe = !response.includes('$') &&
                (response.includes('no tengo') || response.includes('no estoy segura') ||
                  response.includes('posiblemente') || response.includes('creo que') ||
                  response.length < 30);

              if (pareceNoSabe) {
                const catActual = await db.getCategoriaActual(from);
                if (catActual && knowledge.inventario[catActual]) {
                  response = `Tenemos varios modelos disponibles. ¿Cuál te interesa? 😊`;
                } else {
                  response += "\n\n¿Te gustaría que te transferiera a un asesor para aclarar tu duda? 😊";
                }
              }
            }
          }
        }
      }
    } else if (detectarVerCarrito(incomingMsg)) {
      const carritoData = await formatearCarrito(from);
      if (carritoData && carritoData.mensaje) {
        response = `${carritoData.mensaje}\n\n¿Confirmas la compra? Responde "si" o "confirmo" para proceder 😊`;
      } else {
        response = "Tu carrito está vacío. ¿Qué producto te gustaría comprar? 😊";
      }
    } else if (detectarLimpiarCarrito(incomingMsg)) {
      const itemsCarrito = await db.verCarrito(from);

      if (itemsCarrito.length === 0) {
        response = "Tu carrito está vacío. ¿Qué te gustaría comprar? 😊";
      } else if (itemsCarrito.length === 1) {
        await db.limpiarCarrito(from);
        await db.clearProductoPendiente(from);
        response = `${itemsCarrito[0].producto} eliminado del carrito.\n\nTu carrito ahora está vacío. ¿Qué te gustaría comprar? 😊`;
      } else {
        const msgLower = incomingMsg.toLowerCase();
        let productoEliminado = null;

        for (const item of itemsCarrito) {
          const nombreLimpio = item.producto.toLowerCase();
          if (msgLower.includes(nombreLimpio.substring(0, 10))) {
            productoEliminado = item;
            break;
          }
        }

        if (productoEliminado) {
          const itemsActualizados = itemsCarrito.filter(item => item.producto !== productoEliminado.producto);
          await db.updateEstado(from, { carrito: itemsActualizados });
          await db.clearProductoPendiente(from);
          response = `${productoEliminado.producto} eliminado del carrito.\n\nTu carrito ahora tiene ${itemsActualizados.length} producto(s).`;
        } else {
          const carritoFormateado = await formatearCarrito(from);
          if (carritoFormateado && carritoFormateado.mensaje) {
            response = `${carritoFormateado.mensaje}\n\nPara eliminar un producto específico, dime cuál quieres quitar. 😊`;
          } else {
            response = "Tu carrito tiene productos. ¿Cuál quieres eliminar? 😊";
          }
        }
      }
    } else if (!(await db.estaTransferida(from))) {
      const pendiente = await db.getProductoPendiente(from);
      const itemsEnCarrito = await db.verCarrito(from);

      const esConfirmacionExplicita = /si lo compro|confirmo compra|este me lo llevo|confirmar|me lo llevo ya|comprar ahora|pedido confirmado|ordenar ya|confirmar.*pedido|procedamos.*compra|proceder.*compra/i.test(incomingMsg);
      const esConfirmacionSimple = /^si$|^sí$|^ok$|^yes$|^si claro$|^así$|^asiprocede$|^confirmo$/i.test(incomingMsg.trim());

      if (esConfirmacionSimple && itemsEnCarrito.length > 0) {
        const telefono = from.replace('whatsapp:', '');
        const total = itemsEnCarrito.reduce((acc, item) => {
          const precioUnitario = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
          const cantidad = item.cantidad || 1;
          return acc + (precioUnitario * cantidad);
        }, 0);

        let productosTxt = '';
        let totalConfirmado = 0;
        itemsEnCarrito.forEach((item, i) => {
          const cant = item.cantidad || 1;
          const precio = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
          productosTxt += `${i + 1}. ${item.producto} - ${item.precio}`;
          if (cant > 1) productosTxt += ` (${cant} unidades)`;
          productosTxt += '\n';
          totalConfirmado += precio * cant;
        });

        const mensajeCarrito = `🛒 Tu pedido:\n\n${productosTxt}─────────────────\n💰 Total: $${totalConfirmado.toLocaleString()}`;

        response = `📦 ¡Pedido confirmado!\n\n${mensajeCarrito}\n\n¡Gracias por tu compra!\nUn asesor te contactará pronto para coordinar entrega y pago. 🎉${generarMensajeInstagram()}`;

        for (const item of itemsEnCarrito) {
          await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
        }

        await db.marcarPedidoConfirmado(from);

        await enviarNotificacionPedido(telefono, itemsEnCarrito, history);

        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);

        console.log(`Cliente ${telefono} confirmó compra: $${total}`);
      } else if (esConfirmacionExplicita && itemsEnCarrito.length > 0) {
        const telefono = from.replace('whatsapp:', '');
        const total = itemsEnCarrito.reduce((acc, item) => {
          const precioUnitario = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
          const cantidad = item.cantidad || 1;
          return acc + (precioUnitario * cantidad);
        }, 0);

        let productosTxt = '';
        let totalConfirmado = 0;
        itemsEnCarrito.forEach((item, i) => {
          const cant = item.cantidad || 1;
          const precio = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
          productosTxt += `${i + 1}. ${item.producto} - ${item.precio}`;
          if (cant > 1) productosTxt += ` (${cant} unidades)`;
          productosTxt += '\n';
          totalConfirmado += precio * cant;
        });

        const mensajeCarrito = `🛒 Tu pedido:\n\n${productosTxt}─────────────────\n💰 Total: $${totalConfirmado.toLocaleString()}`;

        response = `📦 ¡Pedido confirmado!\n\n${mensajeCarrito}\n\n¡Gracias por tu compra!\nUn asesor te contactará pronto para coordinar entrega y pago. 🎉${generarMensajeInstagram()}`;

        for (const item of itemsEnCarrito) {
          await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
        }

        await db.marcarPedidoConfirmado(from);

        await enviarNotificacionPedido(telefono, itemsEnCarrito, history);

        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);

        console.log(`Cliente ${telefono} confirmó compra explícita: $${total}`);
      } else if (esConfirmacionSimple) {
        const carritoData = await formatearCarrito(from);
        if (carritoData && carritoData.mensaje) {
          response = `${carritoData.mensaje}\n\n¿Confirmas la compra? Responde "si" o "confirmo" para proceder 😊`;
        } else if (pendiente) {
          const cantidad = detectarCantidad(incomingMsg) || (pendiente.cantidad || 1);
          await agregarAlCarritoDB(from, pendiente.producto, pendiente.precio, cantidad);
          await db.clearProductoPendiente(from);
          response = `${pendiente.producto} añadido al carrito (${cantidad} unidad${cantidad > 1 ? 'es' : ''}).\n\nPuedes seguir viendo productos o confirmar tu compra cuando quieras.\n\n¿Quieres ver el carrito? 😊`;
        } else {
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd && ultimoProd.nombre) {
            const cantidad = detectarCantidad(incomingMsg) || 1;
            await agregarAlCarritoDB(from, ultimoProd.nombre, ultimoProd.precio, cantidad);
            await db.clearProductoPendiente(from);
            response = `${ultimoProd.nombre} añadido al carrito (${cantidad} unidad${cantidad > 1 ? 'es' : ''}) por ${ultimoProd.precio}.\n\nPuedes seguir viendo productos o confirmar tu compra cuando quieres.\n\n¿Quieres ver el carrito? 😊`;
          } else {
            response = "No hay productos en el carrito. ¿Qué te gustaría comprar? 😊";
          }
        }
      } else {
        const esInfoPura = esPreguntaInformativa(incomingMsg);
        const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
        const catBD3 = await db.getCategoriaActual(from);
        let productoDetectado = null;
        if (!esFraseCompraGenerica(incomingMsg)) {
          productoDetectado = buscarProductoPorNombre(incomingMsg, categoriaDetectada, catBD3);
        }

        if (productoDetectado && productoDetectado.ambiguo && productoDetectado.candidatos) {
          await db.guardarCandidatosPendientes(from, productoDetectado.candidatos, incomingMsg);
          response = formatearMensajeAmbiguo(productoDetectado.candidatos);
          productoDetectado = null;
        }

        // If no product detected, try searching by description in current category
        if (!productoDetectado && catBD3) {
          const resultadoDescripcion = buscarPorDescripcion(incomingMsg, catBD3);
          if (resultadoDescripcion) {
            productoDetectado = {
              nombre: resultadoDescripcion.nombre,
              precio: resultadoDescripcion.precio,
              categoria: catBD3
            };
            console.log(`Producto detectado por descripción: ${resultadoDescripcion.nombre} en categoría ${catBD3}`);
          }
        }

        // If still no product, check if message refers to recently shown products
        if (!productoDetectado) {
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd && ultimoProd.nombre) {
            const msg = incomingMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const nombreLimpio = ultimoProd.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Check if message contains words from the last product name
            const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 3);
            const palabrasMsg = msg.split(' ').filter(p => p.length > 3);
            let coincidencias = 0;
            for (const pm of palabrasMsg) {
              for (const pp of palabrasProd) {
                if (pp.includes(pm) || pm.includes(pp)) {
                  coincidencias++;
                }
              }
            }
            if (coincidencias >= 1) {
              productoDetectado = {
                nombre: ultimoProd.nombre,
                precio: ultimoProd.precio,
                categoria: ultimoProd.categoria
              };
              console.log(`Producto detectado por referencia a último producto: ${ultimoProd.nombre}`);
            }
          }
        }

        const esDejaloPendiente = /déjalo pendiente|dejalo pendiente|déjala pendiente|dejala pendiente|dejar pendiente|guardar pendiente/i.test(incomingMsg);
        if (esDejaloPendiente) {
          let prodParaGuardar = productoDetectado;
          if (!prodParaGuardar) {
            const ultimoProd = await db.getUltimoProducto(from);
            if (ultimoProd && ultimoProd.nombre) {
              prodParaGuardar = ultimoProd;
            }
          }
          if (prodParaGuardar && prodParaGuardar.nombre) {
            await db.guardarProductoPendiente(from, prodParaGuardar.nombre, prodParaGuardar.precio);
            response = `${prodParaGuardar.nombre} guardado como pendiente. `;
          }
        }

        const esPronombreReferido = /^\s*(lo|la|les|este|esta|estos|estas)\s*$/i.test(incomingMsg) ||
          incomingMsg.toLowerCase().includes('lo quiero') ||
          incomingMsg.toLowerCase().includes('la quiero') ||
          incomingMsg.toLowerCase().includes('me gusta') ||
          (incomingMsg.toLowerCase().includes('me gustaría') && !ofrecioTransferencia) ||
          incomingMsg.toLowerCase().includes('comprar') && !productoDetectado;

        if (!productoDetectado && esPronombreReferido) {
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd) {
            productoDetectado = {
              nombre: ultimoProd.nombre,
              precio: ultimoProd.precio,
              categoria: ultimoProd.categoria || categoriaDetectada
            };
          }
        }

        const esReferenciaPendiente = /pendiente|dejamos pendiente|quedó pendiente|mueble pendiente|producto pendiente/i.test(incomingMsg);
        let productoPendienteData = null;
        if (esReferenciaPendiente) {
          const pendiente = await db.getProductoPendiente(from);
          if (pendiente && pendiente.producto) {
            productoPendienteData = {
              nombre: pendiente.producto,
              precio: pendiente.precio,
              categoria: pendiente.categoria
            };
            if (!productoDetectado) {
              productoDetectado = productoPendienteData;
            }
          }
        }

        const esSoloPronombre = /^si$|^sí$|^si$|^lo$|^la$|^les$|^este$|^esta$|^estos$|^estas$|^comprarlo$|^comprarla$|^quiero$|^me\s+gustaría$|^me\s+gustaria$/i.test(incomingMsg.trim());
        const quiereAgregar = detectarCompra(incomingMsg) || detectarIntentionAddCarrito(incomingMsg) || incomingMsg.toLowerCase().includes('comprar') || incomingMsg.toLowerCase().includes('agregar') || incomingMsg.toLowerCase().includes('agregarle') || incomingMsg.toLowerCase().includes('lo') || incomingMsg.toLowerCase().includes('la');

        const mensajeAmbiguo = /conocerla|conocerlo|conorarla|conorarlo|agregarla|agregarlo|conocella|conocellar/i.test(incomingMsg.toLowerCase());

        if (mensajeAmbiguo && !productoDetectado) {
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd && ultimoProd.nombre) {
            response = `¿Te refieres a la ${ultimoProd.nombre} que estuvimos viendo? Confirma con "sí" para agregarla al carrito 😊`;
          } else {
            response = "Perdona, ¿a qué producto te refieres? 😊";
          }
        } else if (!productoDetectado && quiereAgregar) {
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
            const pendiente = await db.getProductoPendiente(from);
            if (pendiente && pendiente.producto) {
              productoDetectado = {
                nombre: pendiente.producto,
                precio: pendiente.precio,
                categoria: pendiente.categoria
              };
            } else {
              const ultimoProd = await db.getUltimoProducto(from);
              if (ultimoProd && ultimoProd.nombre) {
                productoDetectado = {
                  nombre: ultimoProd.nombre,
                  precio: ultimoProd.precio,
                  categoria: ultimoProd.categoria
                };
              }
            }
          }
        }

        const pideSuma = /suma|total|cuanto.*suma|cuanto.*total|cuánto.*suma|cuánto.*total/i.test(incomingMsg);
        if (pideSuma && productoDetectado && productoPendienteData && productoDetectado.nombre !== productoPendienteData.nombre) {
          const precio1 = parseInt(String(productoDetectado.precio).replace(/[^0-9]/g, '')) || 0;
          const precio2 = parseInt(String(productoPendienteData.precio).replace(/[^0-9]/g, '')) || 0;
          const total = precio1 + precio2;
          response = `📋 Resumen de productos:\n\n1. ${productoDetectado.nombre} - ${productoDetectado.precio}\n2. ${productoPendienteData.nombre} - ${productoPendienteData.precio}\n\n💰 Suma total: $${total.toLocaleString()}\n\n¿Confirmas agregar ambos al carrito? 😊`;
        }

        const preguntaCantidadSillas = /cu(a|á)nt(a|á)s|cu(a|á)ntos|cuantos|viene|vienen|cantidad|unidad|unidades|paquete|pack/i.test(incomingMsg);
        if (!response && preguntaCantidadSillas) {
          const catBD = await db.getCategoriaActual(from);
          const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
          if (catBD && categoriasSillas.includes(catBD)) {
            response = `Las sillas se venden por unidad (una por una), no vienen en paquete. El precio que ves es por cada silla individual. 🪑\n\n¿Cuántas sillas te gustaría agregar a tu pedido? 😊`;
          }
        }

        const preguntaSillas = /(comedor|base).*(silla|viene|incluye|separado|apart)|(silla).*(comedor|base)/i.test(incomingMsg);
        if (!response && preguntaSillas && (incomingMsg.includes('?') || /viene|incluye|separado/i.test(incomingMsg))) {
          response = `Las bases de comedor se venden por separado de las sillas. Cada producto se cotiza de forma independiente. 🪑\n\n¿Te gustaría ver nuestras sillas de comedor para acompañar tu base? 😊`;
        }

        if (esInfoPura && productoDetectado) {
          await db.setUltimoProducto(from, {
            nombre: productoDetectado.nombre,
            precio: productoDetectado.precio,
            categoria: productoDetectado.categoria
          });
          await db.guardarProductoPendiente(from, productoDetectado.nombre, productoDetectado.precio);
          const argumentos = [
            "Madera Flor Morado: 3x más resistente que otras maderas",
            "Fabricación propia en Armenia: Control de calidad directo",
            "Diseño exclusivo: Pieza única para tu hogar",
            "Garantía de fabricación: 1 año en estructura",
            "Delivery gratis en Armenia: Entrega sin costo adicional"
          ];
          const argRandom = argumentos[Math.floor(Math.random() * argumentos.length)];
          response = `${productoDetectado.nombre} por ${productoDetectado.precio} es una excelente elección. ${argRandom}.\n\n¿Procedemos a añadirla al carrito por ${productoDetectado.precio}? 😊`;
        } else if (productoDetectado && (detectarCompra(incomingMsg) || detectarIntentionAddCarrito(incomingMsg) || incomingMsg.toLowerCase().includes('comprar') || incomingMsg.toLowerCase().includes('agregar') || incomingMsg.toLowerCase().includes('agregarle') || incomingMsg.toLowerCase().includes('nido') || incomingMsg.toLowerCase().includes('lo') || incomingMsg.toLowerCase().includes('la'))) {
          let cantidadDetectada = detectarCantidad(incomingMsg);
          let catActual = productoDetectado.categoria;

          if (!productoDetectado.nombre || productoDetectado.nombre.includes('undefined')) {
            const pendiente = await db.getProductoPendiente(from);
            if (pendiente && pendiente.producto && !pendiente.producto.includes('undefined')) {
              productoDetectado = {
                nombre: pendiente.producto,
                precio: pendiente.precio,
                categoria: pendiente.categoria
              };
              cantidadDetectada = cantidadDetectada || pendiente.cantidad;
            }
          }

          const cat = buscarProductosPorCategoria(incomingMsg);
          catActual = cat.categoria || productoDetectado.categoria;
          if (catActual && typeof catActual === 'string') {
            await db.setCategoriaActual(from, catActual);
          }

          const productoInfo = buscarInfoProducto(productoDetectado.nombre, catActual);
          await db.setUltimoProducto(from, {
            nombre: productoDetectado.nombre,
            precio: productoDetectado.precio,
            categoria: catActual
          });

          if (productoInfo) {
            const cantidadDetectada = detectarCantidad(incomingMsg);
            await db.guardarProductoPendiente(from, productoDetectado.nombre, productoDetectado.precio, cantidadDetectada);
            if (cantidadDetectada) {
              response = `${productoDetectado.nombre}\n💰 Precio: ${productoDetectado.precio}\n📏 Medidas: ${productoInfo.medidas || 'No disponible'}\n🪵 Material: ${productoInfo.material || 'No disponible'}\n\nConfirmas ${cantidadDetectada} unidades a $${productoDetectado.precio.replace('$', '').replace('.', '')} cada una?\nResponde "sí" para confirmar 😊`;
            } else {
              response = `${productoDetectado.nombre}\n💰 Precio: ${productoDetectado.precio}\n📏 Medidas: ${productoInfo.medidas || 'No disponible'}\n🪵 Material: ${productoInfo.material || 'No disponible'}\n\n¿Confirmas agregar al carrito? Responde "sí" para confirmar 😊`;
            }
          } else {
            const cantidad = cantidadDetectada || 1;
            const result = await agregarAlCarritoDB(from, productoDetectado.nombre, productoDetectado.precio, cantidad);

            if (result.success) {
              const itemsCarrito = await db.verCarrito(from);
              if (itemsCarrito.length === 1) {
                response = `${productoDetectado.nombre} añadido al carrito (${cantidad} unidad${cantidad > 1 ? 'es' : ''}) por ${productoDetectado.precio}.\n\n¿Quieres ver más productos o confirmar tu compra? 😊`;
              } else {
                const carritoActual = await formatearCarrito(from);
                if (carritoActual && carritoActual.mensaje) {
                  response = `${productoDetectado.nombre} añadido.\n\n${carritoActual.mensaje}\n\n¿Confirmas la compra? Responde "si" o "confirmo" para proceder 😊`;
                } else {
                  response = `${productoDetectado.nombre} añadido al carrito.\n\n¿Quieres ver más productos o confirmar tu compra? 😊`;
                }
              }
            } else {
              response = result.mensaje;
            }
          }
        } else if (detectarCompra(incomingMsg)) {
          response = "Para hacer un pedido, dime qué producto te interesa! 😊";
        } else if (!esMensajeRelevante(incomingMsg)) {
          const catFallback = buscarProductosPorCategoria(incomingMsg);
          if (catFallback.categoria && catFallback.productos && catFallback.productos.length > 0) {
            await db.setCategoriaActual(from, catFallback.categoria);
            response = formatearProductosVenta(catFallback.productos);
          } else if (patronesContactoUbicacion.test(incomingMsg)) {
            response = generarRespuestaContactoUbicacion();
          } else {
            response = `Disculpa, solo puedo ayudarte con información sobre nuestros muebles de DeCasa 😊 \n\n¿Te puedo mostrar nuestro catálogo de productos? 📦${generarMensajeDespedida()}`;
          }
        } else {
          const catResult = buscarProductosPorCategoria(incomingMsg);
          if (catResult.categoria) {
            await db.setCategoriaActual(from, catResult.categoria);
          }
          await addToHistoryDB(from, 'user', incomingMsg);
          response = await callGemini({
            history: history,
            currentMessage: incomingMsg
          });
        }
      }
    } else {
      if (history.length === 0 && !(await db.haEnviadoSaludo(from))) {
        response = SALUDO_INICIAL;
        await db.marcarSaludoEnviado(from);
      } else if (!esMensajeRelevante(incomingMsg)) {
        const catFallback = buscarProductosPorCategoria(incomingMsg);
        if (catFallback.categoria && catFallback.productos && catFallback.productos.length > 0) {
          await db.setCategoriaActual(from, catFallback.categoria);
          response = formatearProductosVenta(catFallback.productos);
        } else if (patronesContactoUbicacion.test(incomingMsg)) {
          response = generarRespuestaContactoUbicacion();
        } else {
          response = `Disculpa, solo puedo ayudarte con información sobre nuestros muebles de DeCasa 😊 \n\n¿Te puedo mostrar nuestro catálogo de productos? 📦${generarMensajeDespedida()}`;
        }
      } else {
        await addToHistoryDB(from, 'user', incomingMsg);

        response = await callGemini({
          history: history,
          currentMessage: incomingMsg
        });

        if (!response.includes('catálogo') && !response.includes('PDF') && imagenURL === null) {
          response += "\n\nSi quieres el catálogo, pídemelo y te lo envío! 😊";
        }
      }
    }

    if (!response || response === 'undefined' || response === 'null') {
      response = SALUDO_INICIAL;
    }

    await addToHistoryDB(from, 'assistant', response);

    await db.actualizarLastInteraction(from);

    console.log(`Respuesta: ${response}`);

    const twiml = new MessagingResponse();
    if (imagenURL) {
      twiml.message({
        body: response,
        mediaUrl: [imagenURL]
      });
      console.log(`Enviando imagen: ${imagenURL}`);
    } else {
      twiml.message(response);
    }

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Error:', error.message);

    const twiml = new MessagingResponse();
    twiml.message('Disculpa, estoy teniendo problemas tecnicos. Por favor intenta mas tarde.');
    res.type('text/xml').send(twiml.toString());
  }
});

app.get('/webhook', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Elena - Vendedora DeCasa',
    empresa: knowledge.empresa
  });
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

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
    console.log('✅ Base de datos conectada');
  } catch (error) {
    console.error('❌ Error conectando a la base de datos:', error.message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   Elena - Vendedora DeCasa               ║
╠════════════════════════════════════════╣
║  Servidor corriendo en puerto ${PORT}    ║
║                                          ║
║  Endpoints:                              ║
║  - POST /webhook (Recibir mensajes)      ║
║  - GET  /webhook (Verificar)             ║
║  - GET  /health (Estado)                 ║
╚════════════════════════════════════════╝
    `);

    setInterval(async () => {
      await db.limpiarConversacionesInactivas(10);
    }, 10 * 60 * 1000);
  });

  return server;
}

if (require.main === module) {
  async function main() {
    const server = await startServer();

    const gracefulShutdown = (signal) => {
      console.log(`\n${signal} recibido. Cerrando servidor...`);
      server.close(() => {
        console.log('Servidor HTTP cerrado');
        db.pool.end().then(() => {
          console.log('Conexiones MySQL cerradas');
          process.exit(0);
        }).catch(err => {
          console.error('Error cerrando MySQL:', err);
          process.exit(1);
        });
      });

      setTimeout(() => {
        console.error('Forzando cierre después de timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  main().catch(err => {
    console.error('Error iniciando servidor:', err);
    process.exit(1);
  });
}

module.exports = {
  generarInventarioTexto,
  buscarMasBarato,
  buscarProductosRelacionados,
  agregarAlCarritoDB,
  verCarritoDB,
  limpiarCarritoDB,
  formatearCarrito,
  buscarProductoEnHistorial,
  detectarCategoriaEnMensaje,
}};  