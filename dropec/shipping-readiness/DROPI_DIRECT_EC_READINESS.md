# DropEC Ecuador — viabilidad real del cotizador directo Dropi (19-oct-2026)

**Objetivo:** resolver el bloqueo anti-bot HTML de ByetHost sin mover el comercio ni exponer contraseñas, y preparar la primera cotización `SIN RECAUDO` para Woo #260 / Dropi #20566, Guayaquil → Babahoyo. **No** equivale a una cotización real ni a autorizar pedidos.

## Fuentes públicas verificadas

1. Página oficial ecuatoriana del MCP de Dropi: https://dropi.co/ec/mcp-claude . Dice que el usuario elige el país al autenticarse; la sesión es única por cuenta. **No asumir que el texto regional prueba autorización para la cuenta o para uso autónomo server-to-server.**
2. Página regional Colombia https://dropi.co/cr/mcp-claude dice 'Colombia disponible hoy'; no extrapolar esa restricción a Ecuador porque la página ecuatoriana describe acceso regional. La disponibilidad real de nuestra **cuenta** debe confirmarse con soporte/consentimiento válido.
3. Metadatos públicos del recurso MCP: https://mcp.dropi.co/.well-known/oauth-protected-resource/mcp : `resource=https://mcp.dropi.co/mcp` y `authorization_servers=["https://integrations.dropi.co/bff"]`.
4. Metadata OAuth: https://integrations.dropi.co/bff/.well-known/oauth-authorization-server : `issuer="https://integrations.dropi.co"` (sin `/bff`). Esta discrepancia se volvió a constatar el 19-oct-2026; **OAuth backend NO debe ignorar validación de emisor**. No autorizar cliente, crear sesión ni solicitar tokens hasta documentación/corrección oficial.
5. OpenAPI publicada por backend ecuatoriano https://api.dropi.ec/docs (title 'Dropi Api', contacto `soporteti@dropi.co`): documenta autenticación de integraciones y algunas operaciones, **pero el documento visible no es un contrato suficiente de quote_shipping/inventario**; pedir ruta/esquema/autorización oficiales al proveedor. Nunca usar el endpoint de login solicitando credenciales Dropi en una aplicación externa.
6. La documentación antigua de integraciones publicada en Scribd describe aprobación de plataforma/dominio/IP por TI y `dropi-integration-key`. Es material histórico secundario, no una aprobación real ni garantía de validez actual; verificar requisitos con Dropi Ecuador antes de desplegar. No reutilizar el token de WordPress ni los tokens de Claude.

## Avance en PR #13

`dropi_direct_ec_policy.ts` y `dropi_direct_ec_policy.test.ts` constituyen **una capa de seguridad sin red** que:
- construye el payload MCP `quote_shipping` con `cash_on_delivery=false` únicamente para una cuenta de Ecuador y producto/cantidad válidos;
- exige snapshots privados de producto, bodega, stock y catálogo de ciudades **autenticados**, con trazabilidad y vencimiento menor o igual a 24 horas;
- rechaza capturas públicas, registros antiguos y códigos de Babahoyo elegidos por adivinanza;
- no permite usar un importe para checkout hasta confirmar, mediante una respuesta del proveedor autenticada, **la bodega exacta de origen, ciudad de origen, destino y producto**. El MCP informado por Claude no acepta origen entre sus parámetros y podría no devolverlo; en ese caso su tarifa sirve **solo para diagnóstico**. No fabricar una prueba de origen;
- redondea fracciones de centavo de fletes **hacia arriba** al centavo cobrable, sin confundir tarifa de transporte con costo total de fulfillment;
- no importa `create_order`, no usa credenciales y **no se integra** en los workers, cron, pagos ni pedidos activos.

Los datos de prueba con bodega `523`, ciudad de origen `732` y Babahoyo `700` son **simulados y/o históricos** para probar rechazos, no origin/destino verificados al 19/10. Tampoco copiar saldo de Wallet, tokens, stock antiguo ni checkout de A.

## Solicitud al soporte

Se preparó en Gmail un **BORRADOR SIN ENVIAR** dirigido a `soporteti@dropi.co` (dirección indicada por el propio OpenAPI), consultando: API aprobada Ecuador, credenciales/whitelist IP para backend Supabase, datos actuales de bodegas/stock/city DANE y tarifas SIN RECAUDO, OAuth discrepante, sesión única e issuer, atribución de origen real y tarifas/condiciones. **El usuario debe revisar y enviar voluntariamente; no se dio autorización para realizar el envío automático.** No pedir contraseñas ni adjuntar tokens.

## Bloqueos objetivos

- Sin respuesta de soporte ni credenciales aprobadas para API Ecuador; el MCP OAuth B sigue apagado y sin conexión. El usuario puede conservar su sesión Claude sin interferencias.
- Sin verificación oficial actual de origen para 20566 ni DANE de Babahoyo.
- `worker_enabled=false`, ventas/payments/fulfillment/cron apagados, #63 intacto. La PR queda draft.
- PayPhone sigue en revisión de desbloqueo; no prometer despacho inmediato hasta poder transferir efectivamente el pago del cliente a Dropi.

**No hacer:** intentos de `create_order`, login con contraseña, reutilizar la sesión Claude, modificar las reglas OAuth para aceptar issuer incorrecto, usar capturas como stock autenticado, mostrar precios simulados a clientes, o consumir los $6 de Wallet.
