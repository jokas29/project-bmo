# DropEC — primera cotización controlada, producto Woo 260 / Dropi 20566

**Fecha de revisión:** 19 de octubre de 2026. **No representa una cotización real.** No se enviaron pedidos, mensajes comerciales ni solicitudes autenticadas a Dropi; Wallet sin cargo provocado por estas pruebas.

## Qué está documentado realmente

| Campo | Dato | Evidencia / limitación |
| --- | --- | --- |
| Producto | DOS MICROFONOS PARA CELULAR | Captura del operador, Dropi ID 20566, Woo 260 |
| Precio de proveedor | USD 11,25 | Captura 19/10; no demuestra disponibilidad de compra |
| Precio de venta | USD 32,00 | Captura y catálogo B al 08/10 |
| Proveedor / sucursal | Marrios / Guayaquil | Captura del operador el 19/10 |
| Stock visible | 131 unidades | Captura del operador el 19/10; **NO** es una confirmación autenticada del API ni debe escribirse como una bodega `verified` en B |
| Stock histórico B/A | 133 unidades | Sincronización 08/10; obsoleto para cotizaciones actuales |
| `warehouse_product.id` candidato | `210922` | Snapshot A del 08/10, solo referencia; no fuente actual |
| `warehouse.id` candidato | `523` (MARRIOS) | Snapshot A del 08/10; falta verificar identidad vigente |
| `warehouse.city.id` candidato | `732` | Snapshot A del 08/10, GUAYAQUIL; falta verificar la API actual |
| `warehouse.city.cod_dane` candidato | `201001002001` | Snapshot A del 08/10; no marcar como actual sin consulta oficial |
| Destino propuesto | Babahoyo, Los Ríos | Solicitud del operador; sin compra ni dirección de entrega real |
| Código del destino | **DESCONOCIDO** | Históricos contradictorios: `201001013013` versus `201001013001`. Prohibido elegir uno arbitrariamente |

**Importante:** El objeto `origin` del cotizador WordPress se refiere al ID de CIUDAD (732), no al ID de bodega (523). El snapshot de almacén se guarda como `warehouse_ref` aparte. Usar `523` como `origin.id` produciría un error de contrato; hay una regresión sobre ID de ciudad y DANE.

## Verificación offline reproducible

`product260_route_preflight.test.ts` utiliza el producto real y sus **identificadores históricos**, pero todo dato de origen fresco, destino y precio en las pruebas es **sintético y solo sirve para comprobar rechazos de seguridad**. Nunca presentar los importes simulados como tarifas. Rechaza el origen de 08/10 por vencido, falta de DANE de Babahoyo, bodegas inconsistentes y cambio de destino (`013013` vs `013001`).

## Para hacer la PRIMERA cotización real, en este orden

1. Leer datos actuales directamente de la integración autorizada Dropi/Dropify y certificar que el Dropi ID 20566 sigue asociado a la bodega ID 523, ciudad 732, DANE `201001002001` y stock suficiente en ese origen. La captura acredita lo visible, no los identificadores internos.
2. Consultar la lista oficial de ciudades `trajectory/bycity` de Dropi para `SIN RECAUDO`, seleccionar explícitamente Babahoyo y fijar su DANE auténtico. Sin esto, la B NO debe cotizar.
3. Resolver la firma específica: el PHP actual usa la clave compartida del webhook Woo. Definir una firma de solo cotización en WordPress y una versión minimizada, con credencial limitada en Vault B; no copiar secretos A ni publicarlos.
4. Comprobar acceso HTTPS a `shipping-quote-v2` desde el futuro worker. La solicitud debe llamar **solo** al endpoint de cotización, prohibido `/wake` y cualquier `create_order`.
5. Solo entonces hacer **un POST firmado de cotización**, cantidad 1, precio de producto USD 32, modo `SIN RECAUDO`; validar origen, destino, precio, transportadora y opciones sin pedidos ni Wallet. No habilitar pagos ni ventas por esta prueba.
6. Completar el flujo de cobros de PayPhone después de resolver el desbloqueo y demostrar que el dinero puede transferirse a Dropi antes de prometer despachos. Los $6 actuales son saldo de prueba, no financiación garantizada de productos.

**Situación al corte:** Supabase B `worker_enabled=false`, sin orígenes ni destinos oficiales, sin firma Woo y sin clave bot, sin cotizaciones ni checkouts; no hay un puente de WordPress funcionando. PR #13 permanece draft y sin fusión. Estado de PayPhone Developers: acceso reportado como bloqueado; el operador confirmó que solicitó desbloqueo el 19/10.
