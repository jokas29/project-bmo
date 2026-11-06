# DropEC — auditoría del cotizador WordPress (fuente entregada, 19-oct-2026)

**Fuente auditada:** copia de `htdocs/wp-content/mu-plugins/dropec-webhook-sync.php` proporcionada por el operador (3.762 líneas). **No** es una copia verificada de su estado futuro ni está desplegada por esta PR. `php -l` sobre la copia: sin errores de sintaxis.

## Contrato existente /shipping-quote-v2

- Ruta `POST https://radarcommerce.byethost7.com/wp-json/dropec/v1/shipping-quote-v2`.
- WordPress exige header `x-dropec-signature` = Base64(HMAC-SHA256(`raw_request_body`, secreto webhook Woo)), comparado con `hash_equals`. El `permission_callback` es público, pero el callback hace su propia verificación antes de procesar.
- Body JSON: `woo_product_id` (Woo ID), `province`, `city`, `amount` (importe total de producto), `quantity`, `origin:{id,cod_dane}`.
- Dropi: `GET department?country_id=1`; `POST trajectory/bycity` con `rate_type:"SIN RECAUDO"`; `POST orders/getOriginCityForCalculateShipping`; `POST orders/cotizaEnvioTransportadoraV2` con `EnvioConCobro:false`, origen/destino, `products:[{id,type,quantity}]` y amount.
- Éxito: `{ok:true,shipping_amount,carrier,origin_code,destination_code,options:[{price,carrier}]}`. El plugin elige el precio positivo menor.
- Esta ruta NO llama a `wc_create_order`, `create_order`, `Dropify OrdersModel.save` ni al cobro de Wallet. No demuestra por sí sola qué hace internamente Dropi; NO se han hecho solicitudes reales.

## Riesgos relevantes

1. **Origen remoto prioritario:** el plugin usa `getOriginCityForCalculateShipping` si tiene éxito, incluso cuando B envió un origen verificado distinto. Solo aplica el origen suministrado si el proveedor no devolvió uno; como último recurso usa `_dropi_product.warehouse_product` de Woo, que puede estar vencido. **B debe rechazar cualquier `origin_code` que no coincida exactamente con la bodega verificada**. Antes de cotizar para clientes, también verificar la identidad y stock de la bodega, no solo el DANE.
2. **No hay comprobación de stock y límite de cantidad suficientes en la ruta PHP:** `max(1,absint(...))` puede convertir datos inválidos en 1 y no impone límite máximo. **Validar en B cantidad 1–20 y stock >= cantidad** antes de invocarla.
3. **Respuesta no normalizada:** el PHP devuelve `details` del proveedor en algunos errores. No guardar esos detalles ni exponerlos a clientes. Validar códigos DANE, importe positivo, transportadora, precio y opción seleccionada.
4. **`/wake` público y con efectos laterales**: `GET /wp-json/dropec/v1/wake` ejecuta `dropec_catalog_sync_tick`, que intenta procesar pedidos e importar/retirar productos. Debe protegerse con autenticación y controles de negocio en una corrección separada y probada. **NO solicitar `/wake` ni reactivar cron de WordPress/GitHub desde esta PR.**
5. La firma Woo original no está disponible en Vault B. **No extraerla del proyecto A ni publicarla**. Se requiere autorización de una clave propia/selectiva en B y validación de su alcance; el plugin actual comparte el secreto del webhook. Una solución definitiva debe separar credenciales por finalidad, con rotación controlada.
6. Hosting ByetHost puede impedir HTTP directo desde una Edge Function. Una sesión de navegador validada podría ser necesaria; esta PR no automatiza ni asume acceso a terceros.

## Preparado en la PR

`wordpress_quote_bridge.ts` contiene el transporte firmado y la validación estricta del contrato. No tiene cron, endpoint público, tareas de pedidos ni ejecución automática. El cliente rechaza dominios/rutas distintos, redirecciones, errores HTTP/JSON, respuesta grande, origen distinto, transportadora faltante, precios inválidos y tarifas que no sean la menor opción. Las pruebas usan un `fetch` simulado y no acceden a proveedores.

## Puertas de activación pendientes

- Origen, bodega y stock *oficiales y vigentes* guardados selectivamente en `shipping_verified_origins` de B.
- Contrato de solo cotización verificado en entorno real sin efectos secundarios, acceso vía ByetHost/WordPress comprobado, DANE de Babahoyo conciliado (`201001013013` frente a `201001013001`).
- Firma autorizada nueva/selectiva instalada en Vault **B**, no en GitHub ni en chat.
- Worker autenticado GitHub OIDC hacia B: **preflight** actual es solo lectura; faltan reclamación/finalización idempotente, validación de checkout y pruebas E2E.
- Aprobación explícita para cada prueba que haga llamadas externas; **cero órdenes, pagos, Wallet y cron** antes de ello.

**Guardias:** ventas OFF, PayPhone release OFF, Dropi fulfillment OFF, conservar Woo #63, Supabase A/NOSTALTV sin modificaciones, PR en draft.
