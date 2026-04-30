# Plan: Correcciones de Sillas y Comedores - Venta por Unidad y Separados

## Problema
1. Cuando el usuario pregunta "Cuántas vienen?" después de ver sillas de comedor, el bot no responde correctamente.
2. No se recuerda al usuario que las sillas se venden por separado de la base del comedor.
3. **NUEVO:** Tampoco se recuerda cuando el usuario consulta comedores que las sillas van aparte.

## Cambios Requeridos

### Cambio 1: Detección de cantidad para sillas (index.js ~línea 3022)

**YA IMPLEMENTADO** - Línea 3022-3029: Cuando el usuario pregunta sobre cantidad y la categoría actual es de sillas, responde que se venden por unidad.

### Cambio 2: Agregar recordatorio al mostrar COMEDORES (bases_comedores)

Se debe agregar el recordatorio en los MISMOS lugares donde ya se agregaron para sillas, pero también para la categoría `bases_comedores`.

**Ubicación 1:** `index.js` línea 2541-2549, dentro del bloque `if (porCategoria.productos && porCategoria.productos.length > 0)`

**Código actual:**
```javascript
if (porCategoria.productos && porCategoria.productos.length > 0) {
  if (porCategoria.categoria) {
    await db.setCategoriaActual(from, porCategoria.categoria);
  }
  response = formatearProductosVenta(porCategoria.productos);
  const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
  if (porCategoria.categoria && categoriasSillas.includes(porCategoria.categoria)) {
    response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
  }
}
```

**Nuevo código:**
```javascript
if (porCategoria.productos && porCategoria.productos.length > 0) {
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
}
```

**Ubicación 2:** `index.js` línea 2605-2618, dentro del bloque de `detectarConsultaInfo` con subtipo

**Código actual:**
```javascript
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
    if (tienePdf) {
      response += "\n\n¿Quieres ver el catálogo completo en PDF? 😊";
    }
  }
}
```

**Nuevo código:**
```javascript
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
```

**Ubicación 3:** `index.js` línea 2627-2635, dentro del bloque de `detectarConsultaInfo` por categoría

**Código actual:**
```javascript
if (porCategoria.length > 0) {
  if (resultadoCategoria.categoria) {
    await db.setCategoriaActual(from, resultadoCategoria.categoria);
  }
  response = formatearProductosVenta(porCategoria);
  const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
  if (resultadoCategoria.categoria && categoriasSillas.includes(resultadoCategoria.categoria)) {
    response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
  }
}
```

**Nuevo código:**
```javascript
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
}
```

**Ubicación 4:** `index.js` línea 2674-2681, dentro del bloque que muestra productos de la categoría guardada

**Código actual:**
```javascript
if (productosBD && productosBD.length > 0) {
  response = formatearProductosVenta(productosBD);
  const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
  if (catBD && categoriasSillas.includes(catBD)) {
    response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
  }
}
```

**Nuevo código:**
```javascript
if (productosBD && productosBD.length > 0) {
  response = formatearProductosVenta(productosBD);
  const categoriasSillas = ['sillas_comedor', 'sillas_auxiliares', 'sillas_barra'];
  if (catBD && categoriasSillas.includes(catBD)) {
    response += "\n\n💡 Recuerda: Las sillas se venden por separado de la base del comedor y el precio es por unidad. 🪑";
  }
  if (catBD === 'bases_comedores') {
    response += "\n\n💡 Recuerda: La base del comedor se vende sin sillas. Puedes elegir tus sillas favoritas por separado. 🪑";
  }
}
```

### Cambio 3: Actualizar regla en SYSTEM_PROMPT para Gemini (index.js ~línea 102)

**Código actual:**
```
REGLA IMPORTANTE SOBRE SILLAS:
- TODAS las sillas (de comedor, auxiliares, de barra) se venden POR UNIDAD (una por una), NO en paquetes.
- Las sillas se venden POR SEPARADO de las bases de comedor. La base del comedor NO incluye sillas.
- Cuando el cliente pregunte "cuántas vienen?" o similar sobre sillas, responde que se venden por unidad.
- Siempre que muestres sillas, menciona que el precio es por unidad y que se venden aparte de la base del comedor.
```

**Nuevo código:**
```
REGLA IMPORTANTE SOBRE SILLAS Y COMEDORES:
- TODAS las sillas (de comedor, auxiliares, de barra) se venden POR UNIDAD (una por una), NO en paquetes.
- Las sillas se venden POR SEPARADO de las bases de comedor. La base del comedor NO incluye sillas.
- Cuando el cliente pregunte "cuántas vienen?" o similar sobre sillas, responde que se venden por unidad.
- Siempre que muestres sillas, menciona que el precio es por unidad y que se venden aparte de la base del comedor.
- Cuando el cliente consulte sobre bases de comedores, menciona que se venden sin sillas incluidas y que puede elegir sillas por separado.
```

## Resumen de Archivos a Modificar

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `index.js` | ~2541-2549 | Agregar recordatorio al mostrar comedores por catálogo |
| `index.js` | ~2605-2618 | Agregar recordatorio en detectarConsultaInfo con subtipo para comedores |
| `index.js` | ~2627-2635 | Agregar recordatorio en detectarConsultaInfo por categoría para comedores |
| `index.js` | ~2674-2681 | Agregar recordatorio en fallback de categoría guardada para comedores |
| `index.js` | ~102-106 | Actualizar SYSTEM_PROMPT para incluir comedores |

## Pruebas Sugeridas
1. Enviar "comedores" → Debe incluir recordatorio de que las sillas van aparte
2. Enviar "base comedor redondo" → Debe incluir recordatorio de que las sillas van aparte
3. Enviar "comedores" → luego "Y con sillas?" → luego "Cuántas vienen?" → Debe responder que se venden por unidad
4. Enviar "sillas de comedor" → Debe incluir recordatorio de que son aparte y por unidad
5. Preguntar a Gemini sobre comedores → Debe mencionar que las sillas van aparte
6. Preguntar a Gemini sobre sillas → Debe mencionar que son por unidad y aparte
