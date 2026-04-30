# Plan: Sistema de Comparación de Productos

## Problema
Cuando el usuario está indeciso entre 2 o más productos o pide recomendación, el bot no tiene lógica para comparar productos ni recomendar según las necesidades del usuario.

## Solución Propuesta

Se implementarán **2 mecanismos** que funcionan en conjunto:

### 1. Detección Rule-Based de Comparación (para respuestas rápidas y consistentes)

Cuando el usuario envía mensajes como:
- "cual es mejor", "cuál me recomiendas", "cual me conviene"
- "estoy entre X y Y", "no me decido", "diferencia entre"
- "comparar", "compara", "cual elijo", "cual escojo"
- "recomiendame", "me recomiendas", "no se cual elegir"

El bot:
1. **Detecta los productos en el historial reciente** (últimos 2-3 productos mostrados)
2. **Si hay productos para comparar**: Genera una tabla comparativa con nombre, precio, material y medidas
3. **Si no hay contexto suficiente**: Pregunta al usuario qué busca (presupuesto, estilo, uso) y recomienda según eso

### 2. Gemini AI Fallback (para casos complejos)

Si la regla rule-based no puede resolver, Gemini se encarga con instrucciones específicas en el SYSTEM_PROMPT.

---

## Cambios Requeridos

### Cambio 1: Nueva función `detectarComparacion()` (AGREGAR después de `esPreguntaInformativa` ~línea 583)

```javascript
function detectarComparacion(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /cual.*mejor/i, /cu(a|á)l.*mejor/i, /cual.*recomiend/i, /cu(a|á)l.*recomiend/i,
    /cual.*me.*conviene/i, /cual.*escojo/i, /cual.*elijo/i,
    /cual.*deber/i, /cual.*me.*llevo/i, /cual.*mejor.*opcion/i,
    /estoy.*entre/i, /no.*me.*decido/i, /no.*se.*cual/i, /no.\s*cual/i,
    /indecis/i, /duda.*entre/i, /diferencia.*entre/i, /diferencias.*entre/i,
    /comparar/i, /compara/i, /comparacion/i, /compar/i,
    /recomiend/i, /mejor.*opcion/i, /cual.*elegir/i, /cual.*escojer/i,
    /cual.*compro/i, /cual.*me.*llev/i, /cual.*mas.*vale/i,
    /cual.*mas.*barat/i, /cual.*mas.*car/i, /cual.*mas.*resistent/i,
    /que.*me.*conviene/i, /que.*me.*recomend/i, /ayudame.*elegir/i,
    /ayudame.*decidir/i, /me.*puedes.*ayudar.*elegir/i
  ];
  return patrones.some(p => p.test(msg));
}
```

### Cambio 2: Nueva función `compararProductos()` (AGREGAR después de `detectarComparacion`)

```javascript
async function compararProductos(from, incomingMsg) {
  // Obtener productos del historial reciente
  const historial = await db.getHistorial(from, 8);
  const productosMencionados = [];
  const inventario = knowledge.inventario;
  
  // Buscar productos mencionados en el historial
  for (const msg of historial) {
    if (msg.role === 'assistant') {
      for (const [catKey, catData] of Object.entries(inventario)) {
        for (const prod of catData.productos) {
          if (msg.content.includes(prod.nombre) && !productosMencionados.find(p => p.nombre === prod.nombre)) {
            productosMencionados.push({ ...prod, categoria: catKey });
          }
        }
      }
    }
  }
  
  // Limitar a los últimos 3 productos
  const productosRecientes = productosMencionados.slice(-3);
  
  if (productosRecientes.length >= 2) {
    // Generar comparación
    let comparacion = "📊 *Comparación de productos:*\n\n";
    
    // Parsear precios para poder ordenar
    const productosConPrecio = productosRecientes.map(p => ({
      ...p,
      precioNumerico: parseInt(String(p.precio).replace(/[^0-9]/g, '')) || 0
    }));
    
    // Ordenar por precio (barato a caro)
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
    
    // Agregar recomendación basada en precio
    comparacion += `💡 *Mi recomendación:*\n`;
    comparacion += `• Si buscas la mejor relación precio-calidad: *${masBarato.nombre}* (${masBarato.precio})\n`;
    
    if (masBarato.nombre !== masCaro.nombre) {
      comparacion += `• Si buscas la opción premium: *${masCaro.nombre}* (${masCaro.precio})\n`;
    }
    
    comparacion += `\n¿Qué es lo que más te importa? ¿Presupuesto, material, tamaño o diseño? 😊`;
    
    return comparacion;
  }
  
  // Si no hay productos en el historial, preguntar qué busca
  return null;
}
```

### Cambio 3: Agregar detección en el flujo principal del webhook (~línea 2450, ANTES de `detectarSolicitudCatalogo`)

Insertar después de `} else if (detectarConsultaPrecio(incomingMsg)) {` y antes del siguiente `} else if (`:

Buscar la sección apropiada donde van las detecciones de intención y agregar:

```javascript
} else if (detectarComparacion(incomingMsg)) {
  const comparacion = await compararProductos(from, incomingMsg);
  if (comparacion) {
    response = comparacion;
  } else {
    response = "¡Claro! Te ayudo a elegir. 😊\n\nPara recomendarte mejor, cuéntame:\n\n1. 💰 ¿Cuál es tu presupuesto aproximado?\n2. 🎨 ¿Qué estilo prefieres: moderno, clásico, minimalista?\n3. 📏 ¿Para qué espacio es? (sala, comedor, dormitorio)\n\nCon eso te puedo dar la mejor recomendación. 😊";
  }
}
```

### Cambio 4: Actualizar SYSTEM_PROMPT (~línea 107, agregar después de la regla de sillas/comedores)

```
REGLA IMPORTANTE SOBRE COMPARACIONES:
- Si el cliente está indeciso entre varios productos, compara los productos mencionados recientemente en la conversación mostrando nombre, precio, material y medidas.
- Recomienda siempre la opción más económica como "mejor relación precio-calidad" y la más cara como "opción premium".
- Si no tienes contexto de qué productos comparar, pregunta al cliente: presupuesto, estilo preferido, y para qué espacio es.
- Basa tu recomendación en lo que el cliente necesita: si busca economía, recomienda el más barato; si busca calidad premium, recomienda el más caro.
- Mantén un tono persuasivo pero honesto, nunca inventes características.
```

---

## Resumen de Archivos a Modificar

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `index.js` | ~583 | Agregar función `detectarComparacion()` |
| `index.js` | ~610 | Agregar función `compararProductos()` |
| `index.js` | ~2450 | Agregar detección en flujo principal del webhook |
| `index.js` | ~107 | Agregar regla al SYSTEM_PROMPT para Gemini |

## Pruebas Sugeridas
1. Ver 2-3 productos → luego decir "cual me recomiendas" → Debe comparar los productos vistos
2. Ver comedores → luego decir "estoy entre estos, no me decido" → Debe comparar con precios
3. Sin haber visto productos → decir "ayudame a elegir un sofá" → Debe preguntar presupuesto/estilo/espacio
4. "cual es más barato" → Debe recomendar el de menor precio
5. "cual es mejor calidad" → Debe recomendar el de mayor precio o mejor material
6. Preguntar a Gemini "no sé cuál comprar" → Debe seguir las reglas del prompt
