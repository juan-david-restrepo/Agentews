require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const knowledge = require('./knowledge.json');

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

INSTRUCCIONES DE VENTA:
1. Cuando el cliente pregunte por un producto, SIEMPRE ofrece 2-3 alternativas similares con precios
2. Destaca la calidad de nuestros productos: "Madera Flor Morado, resistencia y elegancia"
3. Usa frases persuasivas: "Te recomiendo", "Es nuestra mejor opcion", "Excelente calidad-precio", "No te vas a arrepentir"
4. Cuando menciones productos, incluye el precio y destaca si es buena oferta
5. Si el cliente duda por el precio, enfoca en la calidad y durabilidad
6. Cierra siempre con una pregunta: "Te puedo ayudar con algo mas?" o "Te interesa ver mas opciones?"
7. SOLO pregunta "¿Confirmas?" o "¿Quieres proceder?" cuando el usuario muestre intención de compra usando palabras como: "me lo llevo", "lo quiero", "compro esto", "si", "confirmo", "esta", "me gusta", "perfecto". Si el usuario solo pregunta o consulta, NO preguntes confirmación, solo ofrece ayuda adicional.

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

const conversationHistory = new Map();
const greetingsSent = new Set();
const conversacionesTransferidas = new Set();
const carritoUsuario = new Map();

function agregarAlCarrito(from, producto, precio) {
  if (!carritoUsuario.has(from)) {
    carritoUsuario.set(from, []);
  }
  const items = carritoUsuario.get(from);
  items.push({ producto, precio });
  carritoUsuario.set(from, items);
}

function verCarrito(from) {
  return carritoUsuario.get(from) || [];
}

function limpiarCarrito(from) {
  return carritoUsuario.delete(from);
}

function formatearCarrito(from) {
  const items = verCarrito(from);
  if (items.length === 0) return null;
  
  let mensaje = "📦 Tu carrito:\n\n";
  let total = 0;
  
  items.forEach((item, index) => {
    mensaje += `${index + 1}. ${item.producto}: ${item.precio}\n`;
    const precioNum = item.precio.replace(/[^0-9]/g, '');
    total += parseInt(precioNum) || 0;
  });
  
  mensaje += `\n💰 Total: $${total.toLocaleString()}`;
  
  return { mensaje, total };
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
  const mensajeLower = mensaje.toLowerCase();
  const categorias = Object.values(knowledge.inventario || {});
  
  const prefijos = ['cama ', 'silla ', 'mesa ', 'base ', 'sofa ', 'mueble '];
  
  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      const nombreLimpio = producto.nombre.toLowerCase();
      
      for (const prefijo of prefijos) {
        if (nombreLimpio.startsWith(prefijo)) {
          const nombreSinPrefijo = nombreLimpio.substring(prefijo.length);
          if (mensajeLower.includes(nombreSinPrefijo) || mensajeLower.includes(nombreLimpio.substring(0, 12))) {
            return { nombre: producto.nombre, precio: producto.precio };
          }
        }
      }
      
      if (mensajeLower.includes(nombreLimpio.substring(0, 10))) {
        return { nombre: producto.nombre, precio: producto.precio };
      }
    }
  }
  return null;
}

const TRIGGERS_ASESOR = [
  'hablar con alguien', 'hablar con un asesor', 'asesor',
  'hablar con humano', 'persona real', 'necesito ayuda',
  'quiero comprar', 'lo quiero', 'como hago para pedir',
  'cotizar', 'hacer un pedido', 'hablar con persona',
  'hablar con alguien real', 'necesito un humano'
];

const TRIGGERS_COMPRA = [
  'si lo compro', 'confirmo compra', 'este me lo llevo',
  'esta es la que quiero', 'me decide', 'ya me decide',
  'si', 'confirmar', 'confirmo', 'quiero este',
  'me lo llevo', 'perfecto', 'esta bien',
  'esta es', 'esta me gusta', 'elige este',
  'me llevo', 'compro', 'lo quiero', 'dámelo',
  'esta bien', 'además', 'también', 'quiero comprar',
  'me gusta este', 'me gusta la', 'me gusta el'
];

function detectarAsesor(mensaje) {
  const msg = mensaje.toLowerCase();
  return TRIGGERS_ASESOR.some(t => msg.includes(t));
}

function detectarCompra(mensaje) {
  const msg = mensaje.toLowerCase();
  return TRIGGERS_COMPRA.some(t => msg.includes(t));
}

function estaTransferida(from) {
  return conversacionesTransferidas.has(from);
}

function marcarTransferida(from) {
  conversacionesTransferidas.add(from);
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
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    console.log(`Notificación ${tipo} enviada a Telegram`);
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
    listaProductos += `${index + 1}. ${item.producto} - ${item.precio}\n`;
    const precioNum = item.precio.replace(/[^0-9]/g, '');
    total += parseInt(precioNum) || 0;
  });

  const historialTexto = historial.slice(-4).map(m => {
    const rol = m.role === 'user' ? '👤' : '🤖';
    const contenido = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
    return `${rol} ${contenido}`;
  }).join('\n');

  const texto = `
📦 <b> NUEVO PEDIDO - DeCasa</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
📱 <b>Cliente:</b> ${telefono}
🕐 <b>Hora:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
━━━━━━━━━━━━━━━━━━━━━━━━━

🛒 <b>Productos:</b>
${listaProductos}
💰 <b>Total:</b> $${total.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 <b>Conversación:</b>
${historialTexto}
━━━━━━━━━━━━━━━━━━━━━━━━━

💡 <a href="wa.me/${telefono.replace(/\D/g,'')}">Responder por WhatsApp</a>
`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    console.log('Notificación de pedido enviada a Telegram');
  } catch (error) {
    console.error('Error enviando pedido a Telegram:', error.message);
  }
}

function getHistory(from) {
  if (!conversationHistory.has(from)) {
    conversationHistory.set(from, []);
  }
  return conversationHistory.get(from);
}

function addToHistory(from, role, content) {
  const history = getHistory(from);
  history.push({ role, content });
  if (history.length > 12) {
    history.shift();
  }
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

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || 'unknown';

  console.log(`Mensaje de ${from}: ${incomingMsg}`);

  if (!incomingMsg) {
    return res.status(200).send('');
  }

  try {
    const history = getHistory(from);
    let response;
    let imagenURL = null;

    if (detectarAsesor(incomingMsg) && !estaTransferida(from)) {
      const telefono = from.replace('whatsapp:', '');
      
      await enviarNotificacionTelegram(telefono, incomingMsg, history, 'asesor');
      marcarTransferida(from);
      
      response = `Te transfiero con un asesor, espera un momento 😊
      Un asesor te atenderá personalmente para ayudarte con tu compra.`;
      imagenURL = null;
      
      console.log(`Cliente ${telefono} transferido a asesor`);
    } else if (estaTransferida(from)) {
      const telefono = from.replace('whatsapp:', '');
      console.log(`Conversación transferida - Cliente ${telefono} dice: ${incomingMsg}`);
      
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        await enviarNotificacionTelegram(telefono, incomingMsg, []);
      }
      
      res.status(200).send('');
      return;
    } else if (detectarSolicitudFoto(incomingMsg)) {
      const producto = buscarImagenProducto(incomingMsg);
      if (producto) {
        imagenURL = producto.imagen;
        response = `Claro! Aquí tienes la ${producto.nombre} 😊 Si quieres el catálogo completo, pídemelo y te lo envío!`;
      } else {
        response = "Claro! Dime qué producto te interesa y te envío la foto 😊 Si quieres el catálogo completo, pídemelo y te lo envío!";
      }
    } else if (buscarCatalogo(incomingMsg)) {
      const ambiguo = detectarCategoriaAmbigua(incomingMsg);
      if (ambiguo) {
        response = ambiguo;
      } else {
        const catalogo = buscarCatalogo(incomingMsg);
        if (catalogo && catalogo.todos) {
          const catalogos = knowledge.catalogos || {};
          let mensajeCatalogos = "Nuestras categorias con catalogo PDF:\n\n";
          for (const [nombre, url] of Object.entries(catalogos)) {
            mensajeCatalogos += `• ${formatearNombreCategoria(nombre)}\n`;
          }
          mensajeCatalogos += "\nSi quieres ver una imagen de algún producto en especifico o el catálogo completo, dime cual! 😊";
          response = mensajeCatalogos;
        } else if (detectarCompra(incomingMsg) && !estaTransferida(from)) {
      const productoPendiente = buscarProductoPorNombre(incomingMsg) || buscarProductoEnHistorial(history, incomingMsg);
      
      if (productoPendiente) {
        agregarAlCarrito(from, productoPendiente.nombre, productoPendiente.precio);
      }
      
      const catalogoItems = verCarrito(from);
      if (catalogoItems.length > 0) {
        const telefono = from.replace('whatsapp:', '');
        
        await enviarNotificacionPedido(telefono, catalogoItems, history);
        
        const { mensaje, total } = formatearCarrito(from);
        response = `Perfecto! Este es tu pedido:\n\n${mensaje}\n\nUn asesor te contactará pronto para coordinar entrega y pago. Gracias por tu compra! 😊`;
        console.log(`Cliente ${telefono} confirmó pedido: $${total}`);
        
        limpiarCarrito(from);
        marcarTransferida(from);
      } else {
        response = "Para hacer un pedido, primero dime qué producto te interesa! 😊";
      }
    } else if (catalogo && catalogo.url) {
          imagenURL = catalogo.url;
          let nombreCat = formatearNombreCategoria(catalogo.categoria);
          if (catalogo.categoria === 'bases_comedores') {
            response = `Claro! Aquí tienes el catálogo de ${nombreCat} 😊. Las sillas y el base del comedor vienen por separado. Si quieres ver algo específico, dime!`;
          } else {
            response = `Claro! Aquí tienes el catálogo de ${nombreCat} 😊 Si quieres ver una imagen de algún producto o el catálogo completo, dime cual!`;
          }
        } else if (catalogo && catalogo.sinPdf) {
          const prod = formatearNombreCategoria(catalogo.categoria);
          response = `Tenemos ${prod} en nuestro inventario. Si quieres ver una imagen de algún producto en especifico o el catálogo completo, dimelo y con gusto te lo envìo! 😊`;
        } else {
          response = "Consulta nuestros productos y con gusto te ayudo! 😊";
        }
      }
    } else {
      if (history.length === 0 && !greetingsSent.has(from)) {
        response = SALUDO_INICIAL;
        greetingsSent.add(from);
      } else {
        addToHistory(from, 'user', incomingMsg);

        response = await callGemini({
          history: history,
          currentMessage: incomingMsg
        });

        if (!response.includes('catálogo') && !response.includes('PDF') && imagenURL === null) {
          response += "\n\nSi quieres el catálogo, pídemelo y te lo envío! 😊";
        }
      }
    }

    addToHistory(from, 'assistant', response);

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
      
    

    addToHistory(from, 'assistant', response);

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
    try{
      res.type('text/xml').send(twiml.toString());
    } catch (error) {
    console.error('Error:', error.message);

    const twiml = new MessagingResponse();
    twiml.message('Disculpa, estoy teniendo problemas tecnicos. Por favor intenta mas tarde.');
    res.type('text/xml').send(twiml.toString());
  }

app.get('/webhook', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Elena - Vendedora DeCasa',
    empresa: knowledge.empresa
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeConversations: conversationHistory.size });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Elena - Vendedora DeCasa 🎯            ║
╠══════════════════════════════════════════╣
║  Servidor corriendo en puerto ${PORT}       ║
║                                          ║
║  Endpoints:                              ║
║  - POST /webhook (Recibir mensajes)       ║
║  - GET  /webhook (Verificar)             ║
║  - GET  /health (Estado)                 ║
╚══════════════════════════════════════════╝
  `);
});
