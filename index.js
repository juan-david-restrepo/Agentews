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

Horario de atencion: Lunes a viernes de 8am a 5pm.

Como puedo ayudarte hoy? 😊`;

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
  const mensajeLower = mensaje.toLowerCase();

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      const nombreLimpio = producto.nombre.toLowerCase().replace(/[^a-záéíóúñ\s]/g, '').trim();
      const palabrasClave = nombreLimpio.split(/\s+/);

      let coincidencias = 0;
      for (const palabra of palabrasClave) {
        if (palabra.length > 3 && mensajeLower.includes(palabra)) {
          coincidencias++;
        }
      }

      if (coincidencias >= Math.ceil(palabrasClave.length * 0.5) && producto.imagen) {
        return {
          imagen: producto.imagen,
          nombre: producto.nombre
        };
      }
    }
  }

  const sinonimos = {
    'cama': 'CAMA',
    'sofa': 'SOFA',
    'sofa cama': 'SOFA CAMA',
    'mesa': 'MESA',
    'silla': 'SILLA',
    'escritorio': 'ESCRITORIO',
    'tv': 'TV'
  };

  for (const [clave, valor] of Object.entries(sinonimos)) {
    if (mensajeLower.includes(clave)) {
      for (const categoria of categorias) {
        for (const producto of categoria.productos) {
          if (producto.nombre.toUpperCase().includes(valor) && producto.imagen) {
            const palabrasClave = valor.toLowerCase().split(/\s+/);
            let coincidencias = 0;
            for (const palabra of palabrasClave) {
              if (mensajeLower.includes(palabra)) {
                coincidencias++;
              }
            }
            if (coincidencias >= 1) {
              return {
                imagen: producto.imagen,
                nombre: producto.nombre
              };
            }
          }
        }
      }
    }
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
  const incomingMsg = (req.body.Body || '').trim();
  const from = req.body.From || 'unknown';

  console.log(`Mensaje de ${from}: ${incomingMsg}`);

  if (!incomingMsg) {
    return res.status(200).send('');
  }

  try {
    const history = getHistory(from);
    let response;
    let imagenURL = null;

    if (detectarSolicitudFoto(incomingMsg)) {
      const producto = buscarImagenProducto(incomingMsg);
      if (producto) {
        imagenURL = producto.imagen;
        response = `Claro! Aqui tienes la ${producto.nombre} 😊`;
      } else {
        response = "Claro! Dime que producto te interesa y te envio la foto 😊";
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
      }
    }

    addToHistory(from, 'assistant', response);

    console.log(`Respuesta: ${response}`);

    const twiml = new MessagingResponse();
    twiml.message(response);
    if (imagenURL) {
      twiml.media(imagenURL);
      console.log(`Enviando imagen: ${imagenURL}`);
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
