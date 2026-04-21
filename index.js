require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const knowledge = require('./knowledge.json');
const { initDB } = require('./init-db');
const db = require('./db');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

const SYSTEM_PROMPT = `Eres Elena, una vendedora amable y persuasiva de DeCasa. Tu objetivo es ayudar al cliente a encontrar el mueble perfecto y convencerlo de comprar.

PERFIL DE VENDEDORA:
- Nombre: Elena
- Empresa: DeCasa
- Especialidad: Muebles de madera Flor Morado de alta calidad
- Horario: Lunes a viernes de 8am a 5pm
- Disponible en la ciudad de Armenia, Quindío

DIRECCIONES DE NUESTRAS TIENDAS:
- Avenida Bolívar # 16 N 26, Armenia, Quindío
- Km 2 vía El Edén, Armenia, Quindío
- Km 1 vía Jardines, Armenia, Quindío

Cuando el cliente pregunte por ubicación, dirección o dónde están, proporciona las 3 direcciones disponibles y pregunta si desea agendar una visita.

INSTRUCCIONES IMPORTANTES - PRIORIDAD ABSOLUTA:
1. NUNCA inventest información sobre productos, precios o disponibilidad. Si no tienes la información EXACTA del inventario, DEBES decir: "No tengo esa información específica disponible."
2. Cuando no sepas algo,问 immediately ofrece: "¿Te gustaría que te transferiera a un asesor para aclarar tu duda?"
3. SOLO menciona productos con precios si estás SEGURA de que existen en el inventario.

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
  
  for (const [palabra, clave] of Object.entries(mapeoCategorias)) {
    if (msg.includes(palabra)) {
      return clave;
    }
  }
  return null;
}

function necesitaSubtipo(mensaje, categoria) {
  const msg = mensaje.toLowerCase();
  if (categoria === 'sillas_comedor' || categoria === null) {
    if (msg.includes('comedor') || msg.includes('comida') || msg.includes('para comer')) return null;
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

function formatearPreguntaSubtipo(categoria) {
  if (categoria === 'sillas_comedor') {
    return `¿Qué tipo de silla buscas?
• De comedor (para el diario)
• Auxiliares/rededoras (para la sala)
• De barra (para cocina)
¿Cuál te interesa? 😊`;
  }
  if (categoria === 'mesas_centro') {
    return `¿Qué tipo de mesa buscas?
• De centro (para la sala)
• Auxiliar
• De noche
• De TV
¿Cuál te interesa? 😊`;
  }
  return null;
}

function buscarProductoPorNombre(mensaje, categoriaPref = null) {
  const mensajeLimpio = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const categorias = Object.values(knowledge.inventario || {});
  const categoriaDetectada = categoriaPref || detectarCategoriaEnMensaje(mensaje);
  
  let mejoresCoincidencias = [];
  let categoriaDelProducto = null;
  
  const buscarEnCategoria = (cat) => {
    if (!cat.productos) return;
    for (const producto of cat.productos) {
      const nombreLimpio = producto.nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      let score = 0;
      
      if (mensajeLimpio.includes(nombreLimpio) || nombreLimpio.includes(mensajeLimpio)) {
        score = 100;
      } else if (mensajeLimpio.length >= 3 && nombreLimpio.includes(mensajeLimpio)) {
        score = 90;
      } else if (mensajeLimpio.length >= 4 && nombreLimpio.includes(mensajeLimpio.substring(0, Math.min(mensajeLimpio.length, 8)))) {
        score = 80;
      } else {
        const palabrasMsj = mensajeLimpio.split(' ').filter(p => p.length > 2);
        const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 2);
        
        for (const pm of palabrasMsj) {
          for (const pp of palabrasProd) {
            if (pp.includes(pm) || pm.includes(pp)) {
              score += 25;
            }
          }
        }
        
        if (mensajeLimpio.length >= 4 && nombreLimpio.startsWith(mensajeLimpio.substring(0, 4))) {
          score += 30;
        }
      }
      
      if (score > 0) {
        mejoresCoincidencias.push({ producto, score, nombre: producto.nombre, precio: producto.precio, categoria: cat });
      }
    }
  };
  
  if (categoriaDetectada && knowledge.inventario[categoriaDetectada]) {
    buscarEnCategoria(knowledge.inventario[categoriaDetectada]);
    if (mejoresCoincidencias.length > 0) {
      mejoresCoincidencias.sort((a, b) => b.score - a.score);
      return { 
        nombre: mejoresCoincidencias[0].nombre, 
        precio: mejoresCoincidencias[0].precio,
        categoria: categoriaDetectada 
      };
    }
  }
  
  for (const categoria of categorias) {
    buscarEnCategoria(categoria);
  }
  
  if (mejoresCoincidencias.length > 0) {
    mejoresCoincidencias.sort((a, b) => b.score - a.score);
    return { 
      nombre: mejoresCoincidencias[0].nombre, 
      precio: mejoresCoincidencias[0].precio,
      categoria: mejoresCoincidencias[0].categoria
    };
  }
  
  return null;
}

function buscarInfoProducto(nombreProducto, categoriaPref = null) {
  const nombreBuscado = nombreProducto.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const categoriaDetectada = categoriaPref || detectarCategoriaEnMensaje(nombreProducto);
  const categorias = Object.values(knowledge.inventario || {});
  
  let mejoresCoincidencias = [];

  const buscarEnCategoria = (cat) => {
    if (!cat.productos) return;
    for (const producto of cat.productos) {
      const nombreLimpio = producto.nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

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
        mejoresCoincidencias.push({ producto, score });
      }
    }
  };
  
  if (categoriaDetectada && knowledge.inventario[categoriaDetectada]) {
    buscarEnCategoria(knowledge.inventario[categoriaDetectada]);
    if (mejoresCoincidencias.length > 0) {
      mejoresCoincidencias.sort((a, b) => b.score - a.score);
      const prod = mejoresCoincidencias[0].producto;
      return {
        nombre: prod.nombre,
        precio: prod.precio,
        medidas: prod.medidas || 'No disponible',
        material: prod.material || 'No disponible',
        imagen: prod.imagen || null
      };
    }
  }
  
  for (const categoria of categorias) {
    buscarEnCategoria(categoria);
  }
  
  if (mejoresCoincidencias.length > 0) {
    mejoresCoincidencias.sort((a, b) => b.score - a.score);
    const prod = mejoresCoincidencias[0].producto;
    return {
      nombre: prod.nombre,
      precio: prod.precio,
      medidas: prod.medidas || 'No disponible',
      material: prod.material || 'No disponible',
      imagen: prod.imagen || null
    };
  }
  return null;
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
    /te parece que/i, /vale la pena/i, /me conviene/i
  ];
  return patrones.some(p => p.test(msg));
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
  'me gustaría comprarlo', 'lo quiero Comprar'
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
    /\bqué\s+hay\b/i,
    /\bque\s+hay\b/i,
    /^\s*hola\s*$/i,
    /^\s*buenas?\s*$/i,
    /^\s*buenos\s*$/i
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

function detectarConsultaInfo(mensaje) {
  if (detectarAsesor(mensaje)) return false;
  if (detectarCompra(mensaje)) return false;
  if (detectarVerCarrito(mensaje)) return false;
  if (detectarLimpiarCarrito(mensaje)) return false;
  
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
    /^\s*la\s+\w+/i
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

async function enviarNotificacionTelegram(telefono, mensaje, historial, tipo = 'asesor') {
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

  let titulo = tipo === 'pedido' ? '📦 NUEVO PEDIDO - DeCasa' : '🆘 SOLICITUD DE ASESOR';
  let emoji = tipo === 'pedido' ? '💰' : '💬';

  const texto = `
<b>${titulo}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
📱 <b>Cliente:</b> ${telefono}
${emoji} <b>Mensaje:</b> "${mensaje}"
🕐 <b>Hora:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 <b>Historial:</b>
${historialTexto}
━━━━━━━━━━━━━━━━━━━━━━━━━

💡 <a href="wa.me/${telefono.replace(/\D/g,'')}">Responder por WhatsApp</a>
`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
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

💡 <a href="wa.me/${telefono.replace(/\D/g,'')}">Responder por WhatsApp</a>
`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('Error Telegram pedido:', response.status, JSON.stringify(result));
    } else {
      console.log('Notificación de pedido enviada a Telegram');
    }
  } catch (error) {
    console.error('Error enviando pedido a Telegram:', error.message);
  }
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
    /\bver\s+cat/i,
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
  
  const palabrasCategoria = ['sofa', 'sofas', 'silla', 'sillas', 'cama', 'camas', 'mesa', 'mesas', 'base', 'bases', 'comedor', 'comedores'];
  for (const palabra of palabrasCategoria) {
    if (msg.includes(palabra + 's') || msg === palabra || msg.includes('ver ' + palabra) || msg.includes('ver los ' + palabra) || msg.includes('ver las ' + palabra)) {
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
    /(\d+)\s*de\s*(?:es[ae]s[ae]?s?)/i
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
    /si\s+(me|gustaria|quiero)/i
  ];
  return patrones.some(p => p.test(msg));
}

function buscarProductosPorCategoria(mensaje) {
  const mensajeLimpio = mensaje.toLowerCase().replace(/[^a-záéíóúñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  
  const mapeoCategorias = {
    'cajoneros': 'cajoneros_bifes',
    'cajones': 'cajoneros_bifes',
    'bifes': 'cajoneros_bifes',
    'cama': 'camas',
    'camas': 'camas',
    'escritorio': 'escritorios',
    'escritorios': 'escritorios',
    'colchon': 'colchones',
    'colchones': 'colchones',
    'mesa auxiliar': 'mesas_auxiliares',
    'mesas auxiliar': 'mesas_auxiliares',
    'auxiliar': 'mesas_auxiliares',
    'mesa centro': 'mesas_centro',
    'mesas centro': 'mesas_centro',
    'mesa de centro': 'mesas_centro',
    'mesa sala': 'mesas_centro',
    'mesa de sala': 'mesas_centro',
    'mesa noche': 'mesas_noche',
    'mesas noche': 'mesas_noche',
    'mesa de noche': 'mesas_noche',
    'mesa tv': 'mesas_tv',
    'mesas tv': 'mesas_tv',
'mesa de tv': 'mesas_tv',
    'base': 'bases_comedores',
    'bases': 'bases_comedores',
    'base compositor': 'bases_comedores',
    'bases de compositor': 'bases_comedores',
    'el de comedores': 'bases_comedores',
    'las bases de comedores': 'bases_comedores',
    'comedor': 'bases_comedores',
    'comedores': 'bases_comedores',
    'silla': 'sillas_comedor',
    'sillas': 'sillas_comedor',
    'silla comedor': 'sillas_comedor',
    'sillas de comedor': 'sillas_comedor',
    'silla auxiliar': 'sillas_auxiliares',
    'sillas auxiliar': 'sillas_auxiliares',
    'silla barra': 'sillas_barra',
    'sillas barra': 'sillas_barra',
    'sofa': 'sofas',
    'sofas': 'sofas',
    'sofa cama': 'sofas_camas',
    'sofas cama': 'sofas_camas',
    'sofa modular': 'sofas_modulares',
    'sofas modulares': 'sofas_modulares'
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

  const productosConImagen = [];

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      if (!producto.imagen) continue;

      const nombreLimpio = producto.nombre.toLowerCase().replace(/[^a-záéíóúñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const palabrasClave = nombreLimpio.split(' ').filter(p => p.length > 2);

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
  const mensajeLower = mensaje.toLowerCase();
  
  const mapeoCategorias = {
    'cajonero': 'cajoneros_bifes',
    'cajon': 'cajoneros_bifes',
    'bifes': 'cajoneros_bifes',
    'cajoneros': 'cajoneros_bifes',
    'cama': 'camas',
    'camas': 'camas',
    'escritorio': 'escritorios',
    'escritorios': 'escritorios',
    'colchon': 'colchones',
    'colchones': 'colchones',
    'mesa auxiliar': 'mesas_auxiliares',
    'mesas auxiliar': 'mesas_auxiliares',
    'auxiliar': 'mesas_auxiliares',
    'mesa centro': 'mesas_centro',
    'mesas centro': 'mesas_centro',
    'mesa de centro': 'mesas_centro',
    'mesa sala': 'mesas_centro',
    'mesa de sala': 'mesas_centro',
    'mesa de centro': 'mesas_centro',
    'mesacentro': 'mesas_centro',
    'mesa noche': 'mesas_noche',
    'mesas noche': 'mesas_noche',
    'mesa de noche': 'mesas_noche',
    'mesa tv': 'mesas_tv',
    'mesas tv': 'mesas_tv',
    'mesa de tv': 'mesas_tv',
    'mesa television': 'mesas_tv',
    'mesa tele': 'mesas_tv',
    'base': 'bases_comedores',
    'bases': 'bases_comedores',
    'base comedor': 'bases_comedores',
    'bases de comedor': 'bases_comedores',
    'comedor': 'bases_comedores',
    'comedores': 'bases_comedores',
    'comedor': 'bases_comedores',
    'comeda': 'bases_comedores',
    'comedo': 'bases_comedores',
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
    'sofa': 'sofas',
    'sofas': 'sofas',
    'sofa cama': 'sofas_camas',
    'sofacama': 'sofas_camas',
    'sofa cama': 'sofas_camas',
    'sofacamas': 'sofas_camas',
    'sofa modular': 'sofas',
    'sofas modular': 'sofas',
    'sofas modulares': 'sofas',
    'modular': 'sofas',
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

  const response = await fetch(url, {
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
  });

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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 100
      }
    })
  });

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
    await db.getOrCreateUsuario(from);
    await db.verificarYLimpiarInactividad(from, 20);
    
    const estaTransferidoAhora = await db.estaTransferida(from);
    const esTransferencia = detectarAsesor(incomingMsg);
    if (estaTransferidoAhora && !esTransferencia) {
      console.log(`Limpiando estado transferido para ${from}`);
      await db.updateEstado(from, { transferido: false });
    }
    
    const history = await getHistoryDB(from);
    let response;
    let imagenURL = null;

    const esAsesorDetectado = detectarAsesor(incomingMsg);
    let intencionClasificada = null;
    let debeTransferir = esAsesorDetectado;
    
if (debeTransferir && !(await estaTransferidaDB(from))) {
      const telefono = from.replace('whatsapp:', '');
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
        
        response = `Te transfiero con un asesor, espera un momento 😊
Un asesor te atenderá personalmente para ayudarte con tu compra.`;
        
        console.log(`Cliente ${telefono} transferido a asesor sin pedido`);
      }
      imagenURL = null;
    } else if (detectarSaludo(incomingMsg)) {
      const tieneSaludo = true;
      let respuestaSecundaria = '';
      
      if (detectarUbicacion(incomingMsg)) {
        respuestaSecundaria = `Puedes visitarnos en cualquiera de nuestras tres tiendas en Armenia, Quindío:
*   **Avenida Bolívar # 16 N 26, Armenia, Quindío**
*   **Km 2 vía El Edén, Armenia, Quindío**
*   **Km 1 vía Jardines, Armenia, Quindío**
¿Te gustaría que te agendara una visita a alguna de ellas? 😊`;
      } else if (detectarSolicitudCatalogo(incomingMsg) || incomingMsg.toLowerCase().includes('comedores') || incomingMsg.toLowerCase().includes('bases de') || incomingMsg.toLowerCase().includes('camas') || incomingMsg.toLowerCase().includes('sillas') || incomingMsg.toLowerCase().includes('sofás') || incomingMsg.toLowerCase().includes('colchon') || incomingMsg.toLowerCase().includes('sofas')) {
        const porCategoria = buscarProductosPorCategoria(incomingMsg);
        if (porCategoria.categoria && knowledge.catalogos[porCategoria.categoria]) {
          respuestaSecundaria = `Claro! Aquí tienes el catálogo de ${formatearNombreCategoria(porCategoria.categoria)} 😊`;
          imagenURL = knowledge.catalogos[porCategoria.categoria];
          await db.setCategoriaActual(from, porCategoria.categoria);
        } else if (porCategoria.productos && porCategoria.productos.length > 0) {
          respuestaSecundaria = formatearProductosVenta(porCategoria.productos);
          if (porCategoria.categoria) {
            await db.setCategoriaActual(from, porCategoria.categoria);
          }
        }
      } else if (detectarConsultaPrecio(incomingMsg)) {
        const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
        const producto = buscarProductoPorNombre(incomingMsg, categoriaDetectada);
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
        const productoInfo = buscarInfoProducto(incomingMsg, categoriaDetectada);
        if (productoInfo) {
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
      
      if (respuestaSecundaria) {
        response = `${SALUDO_INICIAL}\n\n${respuestaSecundaria}`;
      } else {
        response = SALUDO_INICIAL;
      }
      if (!(await db.haEnviadoSaludo(from))) {
        await db.marcarSaludoEnviado(from);
      }
    } else if (detectarUbicacion(incomingMsg)) {
      response = `¡Claro que sí! Puedes visitarnos en cualquiera de nuestras tres tiendas en Armenia, Quindío:
*   **Avenida Bolívar # 16 N 26, Armenia, Quindío**
*   **Km 2 vía El Edén, Armenia, Quindío**
*   **Km 1 vía Jardines, Armenia, Quindío**
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
    } else if (detectarSolicitudFoto(incomingMsg)) {
      const producto = buscarImagenProducto(incomingMsg);
      if (producto) {
        imagenURL = producto.imagen;
        response = `Claro! Aquí tienes la ${producto.nombre} 😊 Si quieres el catálogo completo, pídemelo y te lo envío!`;
      } else {
        response = "Claro! Dime qué producto te interesa y te envío la foto 😊 Si quieres el catálogo completo, pídemelo y te lo envío!";
      }
    } else if (detectarSolicitudCatalogo(incomingMsg) || incomingMsg.toLowerCase().includes('comedores') || incomingMsg.toLowerCase().includes('bases de') || incomingMsg.toLowerCase().includes('camas') || incomingMsg.toLowerCase().includes('sillas') || incomingMsg.toLowerCase().includes('sofás') || incomingMsg.toLowerCase().includes('colchon') || incomingMsg.toLowerCase().includes('sofas')) {
      let porCategoria = buscarProductosPorCategoria(incomingMsg);
      let catalogo = null;
      
      if (!porCategoria.categoria) {
        const categoriaGuardada = await db.getCategoriaActual(from);
        if (categoriaGuardada && knowledge.inventario[categoriaGuardada]) {
          porCategoria = { categoria: categoriaGuardada, productos: knowledge.inventario[categoriaGuardada].productos };
        }
      }
      
      if (!porCategoria.categoria) {
        const catalogoBuscado = buscarCatalogo(incomingMsg);
        if (catalogoBuscado && catalogoBuscado.url && catalogoBuscado.categoria) {
          catalogo = catalogoBuscado;
          porCategoria = { categoria: catalogoBuscado.categoria, productos: [] };
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
      } else {
        const categoriasDisponibles = Object.keys(knowledge.catalogos).map(c => formatearNombreCategoria(c)).join(', ');
        response = `Claro! Estas son las categorías disponibles:\n${categoriasDisponibles}\n\n¿ cual te gustaría ver? 😊`;
      }
    } else if (detectarConsultaPrecio(incomingMsg)) {
      const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
      const subtipo = necesitaSubtipo(incomingMsg, categoriaDetectada);
      if (subtipo === 'PEDIR_SUBTIPO') {
        response = formatearPreguntaSubtipo(categoriaDetectada);
      } else if (subtipo) {
        const productosSubtipo = knowledge.inventario[subtipo]?.productos || [];
        if (productosSubtipo.length > 0) {
          await db.setCategoriaActual(from, subtipo);
          response = formatearProductosVenta(productosSubtipo);
        }
      }
      if (response) {
        // Ya se manejó
      } else {
      let producto = buscarProductoPorNombre(incomingMsg, categoriaDetectada);
      
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
        response = formatearPreguntaSubtipo(categoriaDetectada);
      } else if (subtipo) {
        const productosSubtipo = knowledge.inventario[subtipo]?.productos || [];
        if (productosSubtipo.length > 0) {
          await db.setCategoriaActual(from, subtipo);
          response = formatearProductosVenta(productosSubtipo);
        }
      }
      if (response) {
        // Ya se manejó
      } else {
      const productoInfo = buscarInfoProducto(incomingMsg, categoriaDetectada);
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        const porCategoria = resultadoCategoria.productos;
        if (porCategoria.length > 0) {
          if (resultadoCategoria.categoria) {
            await db.setCategoriaActual(from, resultadoCategoria.categoria);
          }
          response = formatearProductosVenta(porCategoria);
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
      const productoInfo = buscarInfoProducto(incomingMsg, categoriaDetectada);
      if (productoInfo) {
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
      } else {
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        const porCategoria = resultadoCategoria.productos;
        if (porCategoria.length > 0) {
          if (resultadoCategoria.categoria) {
            await db.setCategoriaActual(from, resultadoCategoria.categoria);
          }
          response = formatearProductosVenta(porCategoria);
        } else if (!esMensajeRelevante(incomingMsg)) {
          response = `Disculpa, solo puedo ayudarte con información sobre nuestros muebles de DeCasa 😊 \n\n¿Te puedo mostrar nuestro catálogo de productos? 📦${generarMensajeDespedida()}`;
        } else {
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
        const productoAEliminar = buscarProductoPorNombre(incomingMsg, detectarCategoriaEnMensaje(incomingMsg));
        
        if (productoAEliminar) {
          await db.limpiarCarrito(from);
          await db.clearProductoPendiente(from);
          response = `${productoAEliminar.nombre} eliminado del carrito.\n\n¿Te gustaría ver el catálogo de productos para elegir otro? 😊`;
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
      
      const esConfirmacionExplicita = /si lo compro|confirmo compra|este me lo llevo|confirmar|me lo llevo ya|comprar ahora|pedido confirmado|ordenar ya|confirmar.*pedido/i.test(incomingMsg);
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
          const cantidad = detectarCantidad(incomingMsg) || 1;
          await agregarAlCarritoDB(from, pendiente.producto, pendiente.precio, cantidad);
          response = `${pendiente.producto} añadido al carrito (${cantidad} unidad${cantidad > 1 ? 'es' : ''}).\n\nPuedes seguir viendo productos o confirmar tu compra cuando quieras.\n\n¿Quieres ver el carrito? 😊`;
        } else {
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd && ultimoProd.nombre) {
            const cantidad = detectarCantidad(incomingMsg) || 1;
            await agregarAlCarritoDB(from, ultimoProd.nombre, ultimoProd.precio, cantidad);
            await db.clearProductoPendiente(from);
            response = `${ultimoProd.nombre} añadido al carrito (${cantidad} unidad${cantidad > 1 ? 'es' : ''}) por ${ultimoProd.precio}.\n\nPuedes seguir viendo productos o confirmar tu compra cuando quieras.\n\n¿Quieres ver el carrito? 😊`;
          } else {
            response = "No hay productos en el carrito. ¿Qué te gustaría comprar? 😊";
          }
        }
      } else {
        const esInfoPura = esPreguntaInformativa(incomingMsg);
        const categoriaDetectada = detectarCategoriaEnMensaje(incomingMsg);
        let productoDetectado = buscarProductoPorNombre(incomingMsg, categoriaDetectada);
        
        const esPronombreReferido = /^\s*(lo|la|les|este|esta|estos|estas)\s*$/i.test(incomingMsg) ||
          incomingMsg.toLowerCase().includes('lo quiero') ||
          incomingMsg.toLowerCase().includes('la quiero') ||
          incomingMsg.toLowerCase().includes('me gusta') ||
          incomingMsg.toLowerCase().includes('me gustaría') ||
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
          const ultimoProd = await db.getUltimoProducto(from);
          if (ultimoProd && ultimoProd.nombre) {
            productoDetectado = {
              nombre: ultimoProd.nombre,
              precio: ultimoProd.precio,
              categoria: ultimoProd.categoria
            };
          }
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
          const cantidadDetectada = detectarCantidad(incomingMsg);
          const cat = buscarProductosPorCategoria(incomingMsg);
          const catActual = cat.categoria || productoDetectado.categoria;
          if (catActual) {
            await db.setCategoriaActual(from, catActual);
          }
          
          await db.setUltimoProducto(from, {
            nombre: productoDetectado.nombre,
            precio: productoDetectado.precio,
            categoria: catActual
          });
          
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
        } else if (detectarCompra(incomingMsg)) {
          response = "Para hacer un pedido, dime qué producto te interesa! 😊";
        } else if (!esMensajeRelevante(incomingMsg)) {
          const catFallback = buscarProductosPorCategoria(incomingMsg);
          if (catFallback.categoria && catFallback.productos && catFallback.productos.length > 0) {
            await db.setCategoriaActual(from, catFallback.categoria);
            response = formatearProductosVenta(catFallback.productos);
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

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   Elena - Vendedora DeCasa               ║
╠══════════════════════════════════════════╣
║  Servidor corriendo en puerto ${PORT}    ║
║                                          ║
║  Endpoints:                              ║
║  - POST /webhook (Recibir mensajes)      ║
║  - GET  /webhook (Verificar)             ║
║  - GET  /health (Estado)                 ║
╚══════════════════════════════════════════╝
    `);
  });
}

startServer();
