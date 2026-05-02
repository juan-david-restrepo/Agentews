# Guidelines para modificar el código del agente

## Reglas generales

1. **NO eliminAR código existente a menos que sea ABSOLUTAMENTE necesario y fijate que no dupliques codigo** para solucionar un error específico
2. **Ante la duda, añadir o modificar en lugar de eliminar**
3. **Mantener la coherencia del código** - no dejar funciones huérfanas o sin uso
4. **Verificar que las funciones seguen existiendo** antes de llamarlas

## Antes de hacer una edición

- ✅ Revisar si la función que voy a modificar existe
- ✅ Verificar que no estoy reemplazando código que se usa en otra parte
- ✅ Comprobar que no creo funciones duplicadas

## Si necesito eliminar algo

- ✅ Eliminar solo lo mínimo indispensable
- ✅ Verificar que no haya referencias a esa función en el código
- ✅ Si hay referencias, eliminarlas también o reemplazarlas por algo equivalente

## Después de hacer cambios

- ✅ Verificar sintaxis con `node -c archivo.js`
- ✅ Probar el código si es posible

## Ejemplo de buena práctica

```javascript
// MALO (eliminar y reemplazar todo)
function detectarVerCarrito(mensaje) {
  const patrones = [...];
  return patrones.some(p => p.test(msg));
}

// BUENO (añadir nuevo patrón sin eliminar los existentes)
function detectarVerCarrito(mensaje) {
  const msg = mensaje.toLowerCase();
  const patrones = [
    /ver.*carrito/i,
    /mi carrito/i,
    // añadir nuevo patrón sin eliminar los existentes
    /mi compra/i,  // <-- añadido
  ];
  return patrones.some(p => p.test(msg));
}
```

## Notas adicionales

- Este agente es grande y robusto, mantener la lógica completa es prioritario
- Si algo funciona, no tocarlo solo por "limpiar" código
- Documentar cualquier cambio significativo