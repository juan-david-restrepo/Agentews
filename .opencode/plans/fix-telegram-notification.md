# Fix: Telegram notification missing user's actual request

## Problem

When user says "Me gustaría comprar el Torelló pero de color blanco" → bot asks if they want to be transferred → user says "Si" → Telegram gets generic "Solicitud de transferencia a asesor" instead of the actual request.

## Root Cause

The greeting handler at line 2864-2868 stores the request in `setTransferenciaMedidaPendiente`:
```js
await db.setTransferenciaMedidaPendiente(from, { producto: prodParaPersonalizar, solicitud: incomingMsg });
```

But the confirmation block at line 2346-2347 only checks `getProductoPendiente`:
```js
const productoPendiente = await db.getProductoPendiente(from);
const prodInfo = productoPendiente?.producto || null;
```

Since `productoPendiente` is null (greeting handler stored in `transferenciaMedidaPendiente`, not `productoPendiente`), the condition at line 2350 (`esPersonalizacion && prodInfo`) is false, and the code falls to line 2354 sending the generic message.

## Fix

**File:** `index.js`, lines ~2344-2355

**Replace:**
```js
if (ofrecioTransferencia && esAfirmativo) {
  const telefono = from.replace('whatsapp:', '');
  const productoPendiente = await db.getProductoPendiente(from);
  const prodInfo = productoPendiente?.producto || null;
  const esPersonalizacion = ultimoMensajeBot && (ultimoMensajeBot.content.includes('personalización') || ultimoMensajeBot.content.includes('personalizar') || ultimoMensajeBot.content.includes('medida') || ultimoMensajeBot.content.includes('diseño a medida'));

  if (esPersonalizacion && prodInfo) {
    const solicitudAlt = transferenciaMedidaPendiente?.solicitud || incomingMsg;
    await enviarNotificacionTelegram(telefono, solicitudAlt, history, 'personalizacion', prodInfo, 'personalización');
  } else {
    await enviarNotificacionTelegram(telefono, 'Solicitud de transferencia a asesor', history);
  }
```

**With:**
```js
if (ofrecioTransferencia && esAfirmativo) {
  const telefono = from.replace('whatsapp:', '');
  const productoPendiente = await db.getProductoPendiente(from);
  let prodInfo = productoPendiente?.producto || null;
  let solicitudUsuario = transferenciaMedidaPendiente?.solicitud || incomingMsg;
  let esPersonalizacion = ultimoMensajeBot && (ultimoMensajeBot.content.includes('personalización') || ultimoMensajeBot.content.includes('personalizar') || ultimoMensajeBot.content.includes('medida') || ultimoMensajeBot.content.includes('diseño a medida'));

  if (!prodInfo && transferenciaMedidaPendiente?.producto) {
    prodInfo = transferenciaMedidaPendiente.producto;
    esPersonalizacion = true;
  }

  if (esPersonalizacion && prodInfo) {
    await enviarNotificacionTelegram(telefono, solicitudUsuario, history, 'personalizacion', prodInfo, 'personalización');
  } else {
    await enviarNotificacionTelegram(telefono, 'Solicitud de transferencia a asesor', history);
  }
```

## What changes

1. `prodInfo` changed from `const` to `let` so it can be reassigned
2. Added fallback: if `prodInfo` is null but `transferenciaMedidaPendiente?.producto` exists, use that product and set `esPersonalizacion = true`
3. The `solicitudUsuario` variable (already existed as `solicitudAlt`) will now properly include the user's actual request like "Me gustaría comprar el Torelló pero de color blanco"
