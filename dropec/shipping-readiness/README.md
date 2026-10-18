# DropEC — cotizaciones de envío sin MCP: validación previa (Supabase B)

## Estado comprobado — 17 de octubre de 2026

**Objetivo de este bloque:** eliminar el falso estado `ok` del servicio de envíos y evitar nuevas colas de cotización cuando no existe un procesador funcional. No crea órdenes ni realiza llamadas a proveedores.

Proyectos: Supabase **B** `ubxkqbnzdtgfvphwohzm` (único objetivo de cambios) y Supabase **A** `kzwzputkwcpojevffjrm` (solo lectura de referencia, también aloja NOSTALTV).

### Bloqueos reales, comprobados directamente en B

| Requisito | Estado de B |
| --- | --- |
| Productos del catálogo WooCommerce | 65 |
| Vinculados a un ID Dropi | 63 |
| Registros en `public.radar_dropi_products` | **0** |
| Productos vinculados con origen verificable | **0 / 63** |
| `bot_woo_config.enabled` | false |
| Clave de firma Woo del puente | ausente |
| `dropec_bot_internal_key` | ausente |
| Procesador de cotizaciones en GitHub | **pausado** |
| Cola `bot_shipping_quote_jobs` | 0 |
| Checkouts y trabajos de pedidos | 0 / 0 |
| `commerce_ready()` | false |

El workflow `.github/workflows/dropec-shipping-quote.yml` de la rama principal solo es un marcador de pausa. Su versión de 2026-10-06 utilizaba GitHub OIDC, la Edge Function `dropec-shipping-bridge` del proyecto **A** y la ruta firmada de WordPress `/wp-json/dropec/v1/shipping-quote-v2`. **No** basta con volver a poner una programación para hacer funcionar B.

El catálogo grande de A tiene 24.568 productos Dropi y 69 referencias cruzadas Woo/Dropi. **No se ha clonado** a B ni se han copiado secretos; sus orígenes podrían estar desactualizados. El ID 3481 tenía almacén con código Quito `201001001001`, comprobación histórica que no equivale a stock actual. Para Babahoyo la cotización antigua utilizó DANE `201001013013`; el MCP encontró `201001013001` y se requiere conciliación antes de calcular precios cobrables.

## Corrección instalada, sin habilitar operaciones

- Nueva tabla privada `dropec_private.shipping_pipeline_control`, siempre inicializada con `worker_enabled=false`, sin heartbeat ni verificación de proveedor.
- `dropec-shipping-quote` **v4** desplegada exclusivamente en B con la autenticación de la ruta de POST preservada; no se configuraron claves ni procesos nuevos.
- GET `/health`: ahora devuelve `status=blocked`, `quote_processing_ready=false`; no afirma que las cotizaciones estén disponibles y no filtra qué secretos faltan.
- GET `/diagnostics`: requiere la **clave interna** que ya usa la ruta POST; sin clave devuelve **401**. Una vez configurada, muestra las razones concretas y cobertura.
- POST de cotización: exige primero la clave interna; después comprueba el estado del procesador, heartbeat reciente, verificación reciente del puente, configuración de Woo, firma y cobertura de almacenes. Cuando falta algún requisito, devuelve **503 `shipping_pipeline_unavailable`** antes de insertar un trabajo.
- NO se llama a Dropi ni al endpoint WooCommerce para calcular envíos en este bloque.
- `GET /health` devuelve HTTP 200 para confirmar que la función responde; **la disponibilidad comercial se determina exclusivamente por `quote_processing_ready`**, no por el código HTTP.
- `verify_jwt=false` se mantiene como en la función anterior, porque su POST/diagnostics autentican con una clave interna; **no** se ha habilitado ningún método de escritura público.

### Validación realizada

- 10 pruebas **offline** GitHub Actions aprobadas, ninguna fallida; incluyen pruebas del algoritmo de readiness y un control de regresión contra duplicar el manejador HTTP.
- HTTP real v4: `GET /health` → 200 con `status=blocked`; `GET /diagnostics` sin clave → 401.
- B continúa prelaunch y con sales/payment/fulfillment OFF. Sin checkouts, cotizaciones pendientes ni órdenes nuevas.
- Se revisó y corrigió un error de empaquetado del primer despliegue v2/v3 que no aparecía en el typecheck; existe prueba de regresión específica. **La versión final comprobada es v4**.

## Pasos que faltan antes de tener cotizaciones operativas

1. Actualizar **solo los productos necesarios** con su catálogo de origen/stock obtenido de una fuente Dropi vigente. No tratar fotos o stocks antiguos de A como verdad actual.
2. Conectar el puente de WooCommerce **con credenciales nuevas o selectivamente autorizadas** y clave de firma almacenada en Vault de B; jamás copiarlas a GitHub, código o chats. Revisar el contrato de la ruta firmada.
3. Portar/crear un **worker para B**, separado del antiguo puente A; probar la verificación GitHub OIDC y el alcance de lectura del endpoint WordPress.
4. Ejecutar una prueba controlada de acceso y cotización, **sin venta, sin crear órdenes, sin wallet ni pagos**. Comprobar diferencia origen/código DANE, modalidad SIN RECAUDO y expiración de precios.
5. Registrar un heartbeat y verificación del puente **solo como resultado de un worker realmente funcional**. No inventar timestamps, no habilitar worker en la base hasta realizar todas las verificaciones y recibir autorización explícita para llamadas externas.
6. Antes de venta real, corregir además el uso de precios de envío cacheados sin expiración segura y su vinculación al snapshot de checkout; asegurar que no se usen totales anteriores si se cambia producto/destino.
7. Mantener master sales, adquisición, PayPhone release, Dropi fulfillment y external actions apagados hasta autorización posterior de lanzamiento.

## Archivos

- `guard.ts`: evaluación determinista de requisitos, sin llamadas externas.
- `guard.test.ts`: casos de worker apagado, heartbeat vencido, cobertura incompleta y credenciales ausentes.
- `source_contract.test.ts`: prueba de regresión para el manejador HTTP y privacidad de health.
- `index.ts`: versión de `dropec-shipping-quote` desplegada en B.
- `enable_guard_migration.sql`: tabla de control privada por defecto OFF.
- `.github/workflows/dropec-shipping-readiness-tests.yml`: CI solo de pruebas, **sin cron**.

**Reglas permanentes:** no tocar Woo #63, no mover secretos de A indiscriminadamente, no modificar NOSTALTV, no llamar a `create_order`, no gastar saldo, no habilitar ventas ni cron.
