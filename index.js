require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const OpenAI = require('openai');
const knowledge = require('./knowledge.json');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Eres un asistente virtual amable y profesional de ${knowledge.empresa}.
Información del negocio:
- Empresa: ${knowledge.empresa}
- Descripción: ${knowledge.descripcion}
- Servicios: ${knowledge.servicios.join(', ')}
- Horario de atención: ${knowledge.horario}
- Ubicación: ${knowledge.ubicacion}
- Contacto: ${knowledge.contacto}

Instrucciones:
1. Responde de manera amable, breve y en español
2. Solo proporciona información del negocio
3. Si preguntan algo fuera del negocio, redirige amablemente diciendo que solo puedes ayudar con temas relacionados a ${knowledge.empresa}
4. Menciona el horario de atención cuando sea relevante
5. Ofrece ayuda para cotizaciones si parece interesados en productos`;

const conversationHistory = new Map();

function getHistory(from) {
  if (!conversationHistory.has(from)) {
    conversationHistory.set(from, [
      { role: 'system', content: SYSTEM_PROMPT }
    ]);
  }
  return conversationHistory.get(from);
}

function addToHistory(from, role, content) {
  const history = getHistory(from);
  history.push({ role, content });
  if (history.length > 20) {
    history.splice(1, history.length - 21);
  }
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
    addToHistory(from, 'user', incomingMsg);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: history,
      max_tokens: 500,
      temperature: 0.7
    });

    const response = completion.choices[0].message.content;
    addToHistory(from, 'assistant', response);

    console.log(`Respuesta: ${response}`);

    const twiml = new MessagingResponse();
    twiml.message(response);

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Error:', error.message);
    
    const twiml = new MessagingResponse();
    twiml.message('Disculpa, estoy teniendo problemas técnicos. Por favor intenta más tarde.');
    res.type('text/xml').send(twiml.toString());
  }
});

app.get('/webhook', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Webhook activo',
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
║   Asistente WhatsApp - ${knowledge.empresa.padEnd(26)}║
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
