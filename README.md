# Asistente WhatsApp - DeCasa

## Configuración

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar credenciales

Edita el archivo `.env` y completa:
- `TWILIO_ACCOUNT_SID` - Tu Account SID de Twilio
- `TWILIO_AUTH_TOKEN` - Tu Auth Token de Twilio
- `OPENAI_API_KEY` - Tu API Key de OpenAI (requerido)

### 3. Actualizar información del negocio

Edita `knowledge.json` para cambiar información del negocio.

---

## Ejecución

### Desarrollo local
```bash
npm start
```

### Exponer con ngrok (necesario para Twilio)

1. Descarga ngrok: https://ngrok.com/download
2. Ejecuta:
```bash
ngrok http 3000
```
3. Copia la URL HTTPS (ej: `https://abc123.ngrok.io`)

---

## Configurar Twilio

1. Ve a https://console.twilio.com
2. Busca **Sandbox Settings** para WhatsApp
3. En **When a message comes in**, pon:
```
https://TU-URL-NGROK/webhook
```

---

## Probar

1. Asegúrate que el servidor está corriendo (`npm start`)
2. Asegúrate que ngrok está activo
3. Actualiza la URL del webhook en Twilio
4. Envía `join <palabra-sandbox>` al número sandbox

---

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /webhook | Recibe mensajes de WhatsApp |
| GET | /webhook | Verifica que el webhook está activo |
| GET | /health | Estado del servidor |
