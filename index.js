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

const SALUDO_INICIAL = `Hola! 👋 Soy Elena, tu asesora de DeCasa. Somos especialistas en muebles de alta calidad en madera Flor Morado, con mas de 206 productos para el hogar. 

 Nuestras categorias:
• Sillas de comedor
• Bases de comedor
• Camas
• Mesas de centro, noche y TV
• Mesas auxiliares
• Sillas auxiliares y de barra
• Sofás

Horario de atencion: Lunes a viernes de 8am a 5pm.

Qué deseas? 😊`;

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
- Disponieble en la ciudad de Armenia 

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

function buscarProductoPorNombre(mensaje) {
  const mensajeLimpio = mensaje.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const categorias = Object.values(knowledge.inventario || {});
  
  let mejoresCoincidencias = [];
  
  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      const nombreLimpio = producto.nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      let score = 0;
      
      if (mensajeLimpio.includes(nombreLimpio)) {
        score = 100;
      } else if (nombreLimpio.includes(mensajeLimpio)) {
        score = 90;
      } else {
        const palabrasMsj = mensajeLimpio.split(' ').filter(p => p.length > 2);
        const palabrasProd = nombreLimpio.split(' ').filter(p => p.length > 2);
        
        for (const pm of palabrasMsj) {
          for (const pp of palabrasProd) {
            if (pp.includes(pm) || pm.includes(pp)) {
              score += 20;
            }
          }
        }
      }
      
      if (score > 0) {
        mejoresCoincidencias.push({ producto, score, nombre: producto.nombre, precio: producto.precio });
      }
    }
  }
  
  if (mejoresCoincidencias.length > 0) {
    mejoresCoincidencias.sort((a, b) => b.score - a.score);
    return { nombre: mejoresCoincidencias[0].nombre, precio: mejoresCoincidencias[0].precio };
  }
  
  return null;
}

function buscarInfoProducto(nombreProducto) {
  const nombreBuscado = nombreProducto.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const categorias = Object.values(knowledge.inventario || {});

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      const nombreLimpio = producto.nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (nombreBuscado.includes(nombreLimpio) || nombreLimpio.includes(nombreBuscado)) {
        return {
          nombre: producto.nombre,
          precio: producto.precio,
          medidas: producto.medidas || 'No disponible',
          material: producto.material || 'No disponible',
          imagen: producto.imagen || null
        };
      }

      const palabras = nombreLimpio.split(' ').filter(p => p.length > 3);
      for (const palabra of palabras) {
        if (palabra.length > 3 && nombreBuscado.includes(palabra)) {
          return {
            nombre: producto.nombre,
            precio: producto.precio,
            medidas: producto.medidas || 'No disponible',
            material: producto.material || 'No disponible',
            imagen: producto.imagen || null
          };
        }
      }
    }
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
    /tienen en/i
  ];
  
  for (const patron of patronesInfo) {
    if (patron.test(msg)) {
      return true;
    }
  }
  
  const palabrasVer = ['ver', 'mostrar', 'ver fotos', 'ver imágenes', 'quisiera', 'quiero'];
  const tienePalabraVer = palabrasVer.some(p => msg.includes(p));
  const tieneCategoria = msg.includes('silla') || msg.includes('comedor') || msg.includes('base') || 
                        msg.includes('cama') || msg.includes('mesa') || msg.includes('sof') ||
                        msg.includes('catálogo') || msg.includes('precio');
  
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
    /carrito/i,
    /que tengo/i,
    /qué tengo/i,
    /qué hay/i,
    /que hay/i,
    /ver lo que tengo/i,
    /mostrar carrito/i,
    /dame el carrito/i,
    /ver mis productos/i
  ];
  return patrones.some(p => p.test(msg));
}

function detectarLimpiarCarrito(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /borrar.*carrito/i,
    /vaciar.*carrito/i,
    /eliminar.*todo/i,
    /empezar.*de nuevo/i,
    /limpiar.*carrito/i,
    /cancelar.*pedido/i
  ];
  return patrones.some(p => p.test(msg));
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
    /me\s+lo\s+llevo/i,
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
    /me\h+completa/i
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
        
        for (const item of itemsCarrito) {
          await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
        }
        
        await db.limpiarConversaciones(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);
        
        await enviarNotificacionTelegram(telefono, incomingMsg, history, 'pedido');
        
        response = `📦 Tu pedido ha sido derivado a un asesor:\n\n${productosTxt}\n\nUn asesor te contactará pronto para confirmar entrega y pago. 🎉`;
        
        console.log(`Cliente ${telefono} transferido con pedido: $${total}`);
      } else {
        await enviarNotificacionTelegram(telefono, incomingMsg, history, 'asesor');
        await marcarTransferidaDB(from);
        
        response = `Te transfiero con un asesor, espera un momento 😊
Un asesor te atenderá personalmente para ayudarte con tu compra.`;
        
        console.log(`Cliente ${telefono} transferido a asesor sin pedido`);
      }
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
      const producto = buscarProductoPorNombre(incomingMsg);
      if (producto) {
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        if (resultadoCategoria.categoria) {
          await db.setCategoriaActual(from, resultadoCategoria.categoria);
        }
        response = `${producto.nombre} | ${producto.precio}. ¿Te interesa? 😊`;
      } else {
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        const porCategoria = resultadoCategoria.productos;
        if (porCategoria.length > 0) {
          if (resultadoCategoria.categoria) {
            await db.setCategoriaActual(from, resultadoCategoria.categoria);
          }
          response = formatearProductosVenta(porCategoria);
        } else {
          response = "No encontré ese producto. ¿Te interesan las bases de compositor o las sillas de compositor? 😊";
        }
      }
} else if (detectarConsultaInfo(incomingMsg)) {
      const productoInfo = buscarInfoProducto(incomingMsg);
      if (productoInfo) {
        const cat = buscarProductosPorCategoria(incomingMsg);
        if (cat.categoria) {
          await db.setCategoriaActual(from, cat.categoria);
        }
        const es_buscar_info = /medidas|material|de qué|características|es de|es de qué|que trae|viene/i.test(incomingMsg);
        if (es_buscar_info) {
          response = `${productoInfo.nombre}\n📏 Medidas: ${productoInfo.medidas}\n🪵 Material: ${productoInfo.material}\n💰 Precio: ${productoInfo.precio}\n\nEsta pieza estáurada en ${productoInfo.material.split(',')[0].toLowerCase()}, lo que garantiza resistencia y durabilidad.¿Te gustaría verlo en persona o saber más? 😊`;
        } else {
          response = `${productoInfo.nombre}\n💰 Precio: ${productoInfo.precio}\n📏 Medidas: ${productoInfo.medidas}\n🪵 Material: ${productoInfo.material}\n\n¡Excelente opción! Esta pieza está hecha en ${productoInfo.material.split(',')[0].toLowerCase()}, muy resistente y elegante. ¿Te gustaría más información o coordinar una cita para verlo? 😊`;
        }
      } else {
        const resultadoCategoria = buscarProductosPorCategoria(incomingMsg);
        const porCategoria = resultadoCategoria.productos;
        if (porCategoria.length > 0) {
          if (resultadoCategoria.categoria) {
            await db.setCategoriaActual(from, resultadoCategoria.categoria);
          }
          response = formatearProductosVenta(porCategoria);
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
    } else if (detectarVerCarrito(incomingMsg)) {
      const carritoData = await formatearCarrito(from);
      if (carritoData && carritoData.mensaje) {
        response = `${carritoData.mensaje}\n\n¿Confirmas la compra? Responde "si" o "confirmo" para proceder 😊`;
      } else {
        response = "Tu carrito está vacío. ¿Qué producto te gustaría comprar? 😊";
      }
    } else if (detectarLimpiarCarrito(incomingMsg)) {
      await db.limpiarCarrito(from);
      await db.clearProductoPendiente(from);
      response = "Carrito vaciado. ¿Qué te gustaría comprar? 😊";
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
        
        for (const item of itemsEnCarrito) {
          await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
        }
        
        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);
        
        await enviarNotificacionPedido(telefono, itemsEnCarrito, history);
        
        const mensajeConfirmado = await formatearCarrito(from);
        if (mensajeConfirmado && mensajeConfirmado.mensaje) {
          response = `📦 ¡Pedido confirmado!\n\n${mensajeConfirmado.mensaje}\n\n¡Gracias por tu compra!\nUn asesor te contactará pronto para coordinar entrega y pago. 🎉`;
        } else {
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
          response = `📦 ¡Pedido confirmado!\n\n${productosTxt}💰 Total: $${totalConfirmado.toLocaleString()}\n\n¡Gracias por tu compra!\nUn asesor te contactará pronto para coordinar entrega y pago. 🎉`;
        }
        
        console.log(`Cliente ${telefono} confirmó compra: $${total}`);
      } else if (esConfirmacionExplicita && itemsEnCarrito.length > 0) {
        const telefono = from.replace('whatsapp:', '');
        const total = itemsEnCarrito.reduce((acc, item) => {
          const precioUnitario = parseInt(item.precio.replace(/[^0-9]/g, '')) || 0;
          const cantidad = item.cantidad || 1;
          return acc + (precioUnitario * cantidad);
        }, 0);
        
        for (const item of itemsEnCarrito) {
          await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
        }
        
        await db.limpiarConversaciones(from);
        await db.clearProductoPendiente(from);
        await db.setCategoriaActual(from, null);
        await db.limpiarCarrito(from);
        
        await enviarNotificacionPedido(telefono, itemsEnCarrito, history);
        
        const mensajeConfirmado2 = await formatearCarrito(from);
        if (mensajeConfirmado2 && mensajeConfirmado2.mensaje) {
          response = `📦 ¡Pedido confirmado!\n\n${mensajeConfirmado2.mensaje}\n\n¡Gracias por tu compra!\nUn asesor te contactará pronto para coordinar entrega y pago. 🎉`;
        } else {
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
          response = `📦 ¡Pedido confirmado!\n\n${productosTxt}💰 Total: $${totalConfirmado.toLocaleString()}\n\n¡Gracias por tu compra!\nUn asesor te contactará pronto para coordinar entrega y pago. 🎉`;
        }
        
        console.log(`Cliente ${telefono} confirmó compra explícita: $${total}`);
      } else if (esConfirmacionSimple) {
        const carritoData = await formatearCarrito(from);
        if (carritoData && carritoData.items.length > 0) {
          response = `${carritoData.mensaje}\n\n¿Confirmas la compra? Responde "si" o "confirmo" para proceder 😊`;
        } else if (pendiente) {
          const cantidad = detectarCantidad(incomingMsg) || 1;
          await agregarAlCarritoDB(from, pendiente.producto, pendiente.precio, cantidad);
          response = `${pendiente.producto} añadido al carrito (${cantidad} unidad${cantidad > 1 ? 'es' : ''}).\n\nPuedes seguir viendo productos o confirmar tu compra cuando quieras.\n\n¿Quieres ver el carrito? 😊`;
        } else {
          response = "No hay productos en el carrito. ¿Qué te gustaría comprar? 😊";
        }
      } else {
        const esInfoPura = esPreguntaInformativa(incomingMsg);
        const productoDetectado = buscarProductoPorNombre(incomingMsg);
        
        if (esInfoPura && productoDetectado) {
          const argumentos = [
            "Madera Flor Morado: 3x más resistente que otras maderas",
            "Fabricación propia en Armenia: Control de calidad directo",
            "Diseño exclusivo: Pieza única para tu hogar",
            "Garantía de fabricación: 1 año en estructura",
            "Delivery gratis en Armenia: Entrega sin costo adicional"
          ];
          const argRandom = argumentos[Math.floor(Math.random() * argumentos.length)];
          response = `${productoDetectado.nombre} por ${productoDetectado.precio} es una excelente elección. ${argRandom}. ¿Te gustaría una foto o verlo en persona? 😊`;
        } else if (productoDetectado && (detectarCompra(incomingMsg) || detectarIntentionAddCarrito(incomingMsg) || incomingMsg.toLowerCase().includes('comprar') || incomingMsg.toLowerCase().includes('agregar') || incomingMsg.toLowerCase().includes('agregarle') || incomingMsg.toLowerCase().includes('nido'))) {
          const cantidadDetectada = detectarCantidad(incomingMsg);
          const cat = buscarProductosPorCategoria(incomingMsg);
          if (cat.categoria) {
            await db.setCategoriaActual(from, cat.categoria);
          }
          
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
