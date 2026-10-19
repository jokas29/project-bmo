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
- `dropec-shipping-quote` **v6** desplegada exclusivamente en B con la autenticación de la ruta de POST preservada; no se configuraron claves ni procesos nuevos.
- GET `/health`: ahora devuelve `status=blocked`, `quote_processing_ready=false`; no afirma que las cotizaciones estén disponibles y no filtra qué secretos faltan.
- GET `/diagnostics`: requiere la **clave interna** que ya usa la ruta POST; sin clave devuelve **401**. Una vez configurada, muestra las razones concretas y cobertura.
- POST de cotización: exige primero la clave interna; después comprueba el estado del procesador, heartbeat reciente, verificación reciente del puente, configuración de Woo, firma y cobertura de almacenes. Cuando falta algún requisito, devuelve **503 `shipping_pipeline_unavailable`** antes de insertar un trabajo.
- NO se llama a Dropi ni al endpoint WooCommerce para calcular envíos en este bloque.
- `GET /health` devuelve HTTP 200 para confirmar que la función responde; **la disponibilidad comercial se determina exclusivamente por `quote_processing_ready`**, no por el código HTTP.
- `verify_jwt=false` se mantiene como en la función anterior, porque su POST/diagnostics autentican con una clave interna; **no** se ha habilitado ningún método de escritura público.

### Validación realizada

- 25 pruebas **offline** GitHub Actions aprobadas, ninguna fallida; incluyen pruebas del algoritmo de readiness y un control de regresión contra duplicar el manejador HTTP.
- HTTP real v6: `GET /health` → 200 con `status=blocked`; `GET /diagnostics` sin clave → 401.
- B continúa prelaunch y con sales/payment/fulfillment OFF. Sin checkouts, cotizaciones pendientes ni órdenes nuevas.
- Se revisó y corrigió un error de empaquetado del primer despliegue v2/v3 que no aparecía en el typecheck; existe prueba de regresión específica. **La versión final comprobada es v6**.

## Pasos que faltan antes de tener cotizaciones operativas

1. Actualizar **solo los productos necesarios** con su catálogo de origen/stock obtenido de una fuente Dropi vigente. No tratar fotos o stocks antiguos de A como verdad actual.
2. Conectar el puente de WooCommerce **con credenciales nuevas o selectivamente autorizadas** y clave de firma almacenada en Vault de B; jamás copiarlas a GitHub, código o chats. Revisar el contrato de la ruta firmada.
3. Portar/crear un **worker para B**, separado del antiguo puente A; probar la verificación GitHub OIDC y el alcance de lectura del endpoint WordPress.
4. Ejecutar una prueba controlada de acceso y cotización, **sin venta, sin crear órdenes, sin wallet ni pagos**. Comprobar diferencia origen/código DANE, modalidad SIN RECAUDO y expiración de precios.
5. Registrar un heartbeat y verificación del puente **solo como resultado de un worker realmente funcional**. No inventar timestamps, no habilitar worker en la base hasta realizar todas las verificaciones y recibir autorización explícita para llamadas externas.
6. Ya se corrigió la reutilización incondicional del caché: exige coincidencia de contexto y antigüedad menor a 30 minutos; **queda pendiente** validar el recorrido end-to-end y que la finalización del trabajo no pueda escribir totales en un checkout modificado.
7. Mantener master sales, adquisición, PayPhone release, Dropi fulfillment y external actions apagados hasta autorización posterior de lanzamiento.

## Archivos

- `guard.ts`: evaluación determinista de requisitos, sin llamadas externas.
- `guard.test.ts`: casos de worker apagado, heartbeat vencido, cobertura incompleta y credenciales ausentes.
- `source_contract.test.ts`: prueba de regresión para el manejador HTTP y privacidad de health.
- `index.ts`: versión de `dropec-shipping-quote` desplegada en B.
- `enable_guard_migration.sql`: tabla de control privada por defecto OFF.
- `.github/workflows/dropec-shipping-readiness-tests.yml`: CI solo de pruebas, **sin cron**.

**Reglas permanentes:** no tocar Woo #63, no mover secretos de A indiscriminadamente, no modificar NOSTALTV, no llamar a `create_order`, no gastar saldo, no habilitar ventas ni cron.

## Segunda fase — orígenes selectivos, TTL y preflight hacia Supabase B

- **Estado actual:** `dropec-shipping-quote` **v6** desplegada en **B**, `/health` HTTP 200 con `status=blocked` y `quote_processing_ready=false`. `/diagnostics` sin credencial HTTP 401.
- Nueva tabla privada `dropec_private.shipping_verified_origins` para guardar exclusivamente el **origen de productos seleccionados** a partir de una observación oficial reciente de Dropi. Cada fila documenta ID Dropi, bodega, ciudad de origen, stock, procedencia, fecha de observación y vencimiento (máximo **24 horas**). **Cero registros insertados**; no se copiarán los 24.568 productos antiguos de A como inventario actual.
- El quote service v6 ignora ya `public.radar_dropi_products` para obtener el origen. Solo acepta una bodega elegible con stock suficiente y observación vigente; si hay cero o más de una, devuelve `verified_origin_unavailable_or_ambiguous` sin encolar un envío.
- La cobertura parcial del catálogo ahora queda como **advertencia**, no bloqueo global; cada producto debe superar su propia comprobación antes de cotizar. Se conserva el requisito de un worker funcional, firma y credenciales B.
- El precio cacheado de envío solo puede reutilizarse si el job `completed` es de los últimos **30 minutos**, SIN RECAUDO, con mismo producto, importe, cantidad, ciudad/provincia y origen `id/cod_dane`. Una actualización condicional detecta si el checkout cambia antes de confirmar el total. No se cancela automáticamente un trabajo abierto de otro contexto.
- Se ejecutaron consultas `EXPLAIN` de solo lectura en B para verificar los joins/índices del esquema nuevo.
- **25 pruebas offline aprobadas, 0 fallidas**, más `deno check` correcto en GitHub Actions.

### GitHub OIDC para B: solo preflight, NO procesador

- Función **`dropec-shipping-preflight-b` v1** desplegada en B. `verify_jwt=false` porque comprueba sus **propios** tokens OIDC firmados por GitHub; acepta solo RS256, audiencia `dropec-shipping-preflight-b`, repositorio `jokas29/project-bmo`, ID `1328431663`, owner ID `311696812`, `ref=refs/heads/main`, `event_name=workflow_dispatch` y el workflow exacto `.github/workflows/dropec-shipping-preflight-b.yml`.
- `GET /health` devuelve identificación estática; `POST /status` exige GitHub OIDC. Sin token o con token inválido devuelve HTTP **401**. El endpoint solo lee `shipping_pipeline_control`; no tiene rutas `pull`, `complete` ni código que contacte Dropi o WordPress.
- Workflow `.github/workflows/dropec-shipping-preflight-b.yml` **manual solamente**, sin cron, y actualmente en rama draft. No se ha ejecutado un OIDC REAL desde GitHub a B: para probarlo deberá estar en `main` y requerirá aprobación de cambio. Su autenticación no equivale a cotización real.
- El worker antiguo `.github/workflows/dropec-shipping-quote.yml` de `main` sigue **PAUSADO**, sin cambios.

### Bloqueos externos antes de producir una tarifa

1. Conseguir una **fuente oficial actual** que devuelva ciudad e inventario por bodega del producto vendido; no inventar valores ni usar instantáneas históricas como inventario actual. El MCP para servidor B continúa bloqueado por OAuth.
2. Auditar el código del endpoint WordPress `/wp-json/dropec/v1/shipping-quote-v2`: **su implementación PHP no está en este repositorio** y tampoco se encontró en la referencia disponible del trabajo anterior. La instalación WooCommerce usa `wc-dropi-integration` y un MU plugin `dropec-webhook-sync.php`, pero ninguno constituye evidencia del contrato del endpoint de cotización. Además, el hosting ByetHost puede requerir una sesión de navegador.
3. Conectar la firma y credenciales nuevas/expresamente autorizadas en **Vault B**, sin leer ni traspasar valores de A indiscriminadamente. Mantener el worker y los gates comerciales OFF.
4. Completar y validar un puente B separado que implemente reclamación/finalización idempotente **solo** después de que el contrato de WordPress y los permisos de solo cotización sean comprobados; por ahora el preflight NO puede tomar ni cerrar trabajos.
5. Probar una cotización sin recaudo, con precio unitario explícito y datos reales de ciudad de entrega/origen, verificar diferencias del DANE de Babahoyo y preservar Woo #63. No activar cron, pagos ni ventas durante esa prueba.

**Revisión final en B:** `worker_enabled=false`, `shipping_verified_origins=0`, `bot_shipping_quote_jobs=0`, `bot_checkout_sessions=0`, `bot_order_jobs=0`, `dropi_mcp_oauth_settings.setup_enabled=false` y `commerce_ready=false`.

El código está en **PR #13 draft**, sin fusionar; únicamente las dos funciones de seguridad/preflight fueron desplegadas en B. Ninguna cuenta o saldo de Dropi fue utilizado. No hubo ventas, acciones sobre Woo #63, PayPhone ni NOSTALTV.


## Tercera fase — contrato WordPress auditado y cliente firmado OFFLINE (19-oct-2026)

El operador compartió la copia completa de `dropec-webhook-sync.php` (3.762 líneas). Se comprobó con `php -l` que no tiene errores de sintaxis; **no se ha desplegado, alterado ni reemplazado** ese archivo. La ruta histórica `POST /wp-json/dropec/v1/shipping-quote-v2` existe y firma el cuerpo RAW con HMAC-SHA256 base64, header `x-dropec-signature`. Antes de devolver una tarifa ejecuta `department?country_id=1`, `trajectory/bycity`, `getOriginCityForCalculateShipping` y `cotizaEnvioTransportadoraV2` SIN RECAUDO. El contrato exacto, riesgos y prohibiciones están en [WORDPRESS_CONTRACT_AUDIT.md](./WORDPRESS_CONTRACT_AUDIT.md). Esta auditoría reemplaza únicamente la nota antigua que decía que aún no se conocía su PHP; **el archivo vivo continúa sin versionar en este repositorio**.

Se añadió `wordpress_quote_bridge.ts`, cliente de cotización **sin ejecución automática**: solo acepta la URL de cotización verificada, serializa la bodega provista por B, firma el JSON, impide redirecciones/reintentos, limita la respuesta y valida coincidencia exacta del DANE origen, destino, opciones, transportadora y tarifa más económica. Todos los errores pasan a códigos seguros, sin conservar el proveedor RAW. Se añadieron 7 pruebas offline, sin llamadas externas. CI Deno: **32 pruebas aprobadas, 0 fallidas**, más typecheck de los endpoints y del nuevo transporte; ejecución: https://github.com/jokas29/project-bmo/actions/runs/39289104581

**Bloqueos restantes:** no hay credenciales de firma nuevas/autorizadas ni fuente vigente de bodega y stock en B, y GitHub OIDC sigue solo en preflight. El módulo no es un worker y no puede reclamar/completar trabajos. La conexión real WordPress/Supabase B y prueba de cotización continúan pendientes y requieren validación separada del hosting. El saldo Wallet reportado por el operador es de $6 y **no se utilizó**. Worker/cron, ventas, pagos y fulfillment continúan OFF; Woo #63, A y NOSTALTV intactos.
