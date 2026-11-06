# DropEC — Dropi MCP, solo lectura (desplegado en B, OAuth pendiente)

## Implementaremos únicamente dos mejoras

1. **Cotización alternativa de envíos** para comparar contra el mecanismo ya construido.
2. **Diagnóstico de pedidos existentes** cuando falle el puente WooCommerce/Supabase.

NO es otra integración de catálogo, NO reemplaza PayPhone, NO crea pedidos, NO consulta wallet, NO toca el pedido #63 y NO reactiva ventas, cron, tracking automático ni fulfillment.

Fuente: manual oficial *Conectar tu Agente de IA con el MCP de Dropi*, página 5, dirección https://mcp.dropi.co/mcp.

## Estado

Código experimental aislado en rama de GitHub. La Edge Function ya está desplegada en Supabase B, con verify_jwt=true, pero desactivada y NO conectada a Dropi. El PDF explica OAuth interactivo para asistentes, pero no documenta un token de servidor para DropEC ni cómo renovarlo. **No** reutilizar la sesión de Claude/ChatGPT ni publicar tokens. Es necesario verificar cómo autorizar legal y técnicamente un cliente de backend propio.

Supabase B (ubxkqbnzdtgfvphwohzm) ya es accesible mediante su cuenta conectada. La función dropec-dropi-mcp-readonly **v2** está desplegada en B, con JWT obligatorio y sin OAuth activo. No desplegar en A.

## Protección

- Todas las rutas requieren una clave interna nueva de mínimo 32 caracteres; para desplegar también exigir JWT de Supabase.
- Sin configuración y sin la bandera DROPI_MCP_READONLY_ENABLED=true, ninguna llamada externa se realiza.
- Solo se admiten herramientas aprobadas cuyo nombre normalizado sea Quote Shipping o Get Order. Nunca se acepta un nombre de herramienta desde la petición.
- Antes de ejecutar se consulta tools/list y se verifica que la herramienta existe y no declara readOnlyHint=false.
- Create Order, cancelar, actualizar, wallet y otras operaciones están **bloqueadas por código**.
- No hay reintentos ni temporizadores automáticos; host externo fijado a mcp.dropi.co; redirects prohibidos.
- Los resultados pueden contener datos personales, incluso aunque se redacten campos frecuentes: solo consumirlos desde un servicio interno protegido. No ofrecer el proxy a clientes ni al navegador.

## Archivos

- core.ts: protocolo MCP Streamable HTTP con initialize, tools/list y ejecución solo de dos acciones autorizadas.
- index.ts: entrypoint para Edge Function en Supabase.
- core.test.ts: pruebas simuladas de seguridad y llamadas, sin contactar a Dropi.

## Rutas internas (requieren clave interna)

- GET /health: solo indica si está preparado; sin tráfico hacia Dropi.
- POST /discover: descubre nombre real, descripción y esquema de argumentos de herramientas de lectura.
- POST /quote: una cotización; recibe JSON {"input":{...}}.
- POST /get-order: consulta de pedido existente, sin escritura; recibe JSON {"input":{...}}.

Los campos de input NO están asumidos: deben extraerse del inputSchema oficial mediante discovery antes de usarlo. Si los nombres de herramientas son distintos de Quote Shipping / Get Order, necesitan validación y actualización explícita del allowlist.

## Secuencia segura para activar

1. Recuperar acceso técnico a Supabase B sin tocar A.
2. Validar flujo OAuth propio de backend con Dropi y mecanismo seguro de renovación de tokens.
3. Verificar nombres reales y inputSchema mediante una sesión auténtica con herramientas de lectura.
4. Definir el mapeo exacto de argumentos para cotizaciones y estados de pedidos. No enviar datos personales de más.
5. Empaquetar index.ts y core.ts como nueva Edge Function dropec-dropi-mcp-readonly de Supabase B, verify_jwt=true.
6. Configurar solo en secretos de B: DROPEC_MCP_INTERNAL_KEY, DROPI_MCP_ACCESS_TOKEN; asignar DROPI_MCP_QUOTE_TOOL y DROPI_MCP_GET_ORDER_TOOL según discovery. Activar DROPI_MCP_READONLY_ENABLED solo cuando las verificaciones anteriores estén completas.
7. Probar /health y /discover, luego una cotización de envío a Babahoyo y contrastarla con la referencia histórica URBANO $4.52 (2026-10-06): la tarifa actual puede variar.
8. Probar Get Order en modo consulta sin modificar pedidos. Mantener el #63 excluido de acciones y de reintentos.
9. Solo después conectar el fallback a la lógica real de DropEC; mantener ventas/pagos/acciones externas apagados.

## Pruebas de código

Con Deno: deno test dropec/mcp-readonly/core.test.ts

Las pruebas no requieren Internet ni secretos y simulan el servidor; no demuestran conexión real ni permiso OAuth.

**Nunca** activar Create Order o migrar credenciales de Supabase A para esta prueba.

## Diagnóstico OAuth desde Supabase B — 2026-10-17 (solo lectura)

Se consultaron únicamente metadatos públicos, sin contraseñas, tokens ni creación de pedidos.

- GET `https://mcp.dropi.co/mcp` ⇒ **401**, cabecera WWW-Authenticate: Bearer resource_metadata=`https://mcp.dropi.co/.well-known/oauth-protected-resource/mcp`.
- GET metadata del recurso ⇒ **200**, resource `https://mcp.dropi.co/mcp`, authorization_servers **`https://integrations.dropi.co/bff`**, scope `mcp`.
- GET `https://integrations.dropi.co/bff/.well-known/oauth-authorization-server` ⇒ **200**, PERO issuer anunciado = **`https://integrations.dropi.co`** (sin /bff).
- GET `https://integrations.dropi.co/.well-known/oauth-authorization-server/bff` ⇒ **404**.
- Metadata del servidor anuncia authorization_code + refresh_token con PKCE S256, authorization_endpoint `https://oauth.dropi.co/oauth/authorize`, token_endpoint `https://integrations.dropi.co/oauth/token`, registration_endpoint `https://integrations.dropi.co/oauth/register`.

**Bloqueo confirmado**: discrepancia entre authorization_servers y issuer. No ignorar ni sobrescribir la validación de issuer; solicitar a soporte Dropi que alinee metadatos. No efectuar client registration ni intentar autorizar una sesión desde el backend hasta resolver el emisor y el callback OAuth/PKCE.

La página oficial actual de Dropi (https://dropi.co/br/mcp-claude) declara compatibilidad con **Ecuador** y advierte que solo se permite una sesión activa por cuenta. Un backend de DropEC puede competir con otra sesión de usuario; consultar a Dropi si el uso server-to-server está contemplado antes de vincularlo.

En esta prueba no hubo llamadas `tools/call`, cotizaciones reales, consulta de órdenes ni cargo a wallet; los controles globales de DropEC permanecen apagados.


## Cotización de Claude Free con MCP Dropi — 2026-10-17

Resultado reportado por el usuario tras autorizar el MCP en Claude: 11 herramientas, sin ejecutar create_order. Esa sesión de Claude NO autentica Supabase B.

Producto: MAQUINA DE AJO ELECTRICA; Dropi 3481; SKU A9; producto SIMPLE inferido de variations vacío; cantidad 1; precio declarado 25 (moneda supuesta USD).
Destino devuelto por MCP: BABAHOYO id 700, departamento 42, DANE 201001013001, zip 8. Origen no especificable en quote_shipping; Dropi lo resuelve internamente.

| Carrier | MCP sin recaudo | MCP con recaudo | Error |
| --- | ---: | ---: | --- |
| LAARCOURIER | 5.1175 | 6.555 | ninguno |
| SERVIENTREGA | 5.16925 | 6.89425 | ninguno |
| URBANO | no cotiza | no cotiza | TCC: Tienes que indicar la Linea (linea) |
| GINTRACOM | no cotiza | no cotiza | No existe cobertura: Credenciales inválidas |
| VELOCES | no cotiza | no cotiza | ciudad operativa no encontrada, código 9902 |

Referencia anterior guardada en Supabase A (2026-10-06): Woo product 29, valor 25, cantidad 1, SIN RECAUDO, origen QUITO id 802 DANE 201001001001, destino DANE **201001013013** (diferente de MCP). Tarifas: URBANO 4.5195, LAARCOURIER 5.6465, GINTRACOM 5.6695, SERVIENTREGA 6.60675.

Requisitos para incorporar MCP:
1. NO presentar tarifas como comparables hasta conciliar origen, DANE del destino, valor y modalidad SIN/CON RECAUDO.
2. NO elegir automáticamente un transportista sustituto cuando URBANO devuelva error; devolver estado claro de fallo y diagnóstico.
3. NO confundir costo de transporte con mínimo de saldo de wallet (error histórico 5.952), ni volver a intentar Woo order #63.
4. Falta conocer el inputSchema exacto de quote_shipping y get_order, validar codificación de ciudades y autenticación independiente de B.
5. Si la respuesta MCP tools/call tiene isError=true, tratarla como error, nunca como cotización exitosa.
6. No modificar credenciales de transportadoras por una hipótesis.

Sin pedidos nuevos, sin cobros, sin gasto de saldo y sin abrir ventas. El código B continúa desactivado en espera de autorización válida.

## Contrato exacto de herramientas informado por Claude (2026-10-17)

Los siguientes nombres/campos fueron extraídos de las definiciones disponibles en la sesión OAuth del usuario con Claude; **no los obtuvimos directamente desde una sesión OAuth de Supabase B**. Por seguridad se agregaron validaciones locales explícitas, incluso mientras la función sigue deshabilitada.

### quote_shipping (solo lectura)

Campos requeridos (JSON): cash_on_delivery (boolean; **false = SIN RECAUDO**, true = CON RECAUDO), destination_city (objeto), products (array). Opcionales: direction, neighborhood, zip_code (string o null). No se aceptan campos no declarados.

destination_city requiere **id integer**, **dane_code string** y **zip_code string|null**. Los tres se copian de search_cities, no se deben inventar.

products: 1 o más objetos con id integer, type (SIMPLE/VARIABLE/COMBO), quantity integer>=1, price number>0, variation_id integer|null condicional. Los productos VARIABLES requieren variation_id válido; SIMPLE y COMBO permiten omitirlo o usar null. El precio unitario debe haber sido confirmado antes de llamar al adaptador, nunca derivarse ciegamente de suggested_price.

Dropi publica products como array|null pero exige al menos un elemento; el adaptador **rechaza null** por coherencia y seguridad. Limita a 20 productos y longitudes de texto defensivas.

Ejemplo de diagnóstico (NO ejecutar automáticamente):

    {
      "cash_on_delivery": false,
      "destination_city": {"id":700,"dane_code":"201001013001","zip_code":"8"},
      "products":[{"id":3481,"type":"SIMPLE","quantity":1,"price":25}]
    }

El ejemplo refleja los datos que Claude obtuvo para Babahoyo; antes de producir precios cobrables validar el DANE y el origen efectivo de Dropi. **No existe un campo de transportadora ni de origen en quote_shipping.** La herramienta devuelve cotizaciones de varias transportadoras.

### get_order (solo lectura)

El único campo aceptado es id (string no vacío, por ejemplo ORD-2025-0001). La respuesta puede contener nombre, teléfono, dirección, productos y otros datos personales. No registrar el payload íntegro ni exponerlo en la tienda pública. No confundir el ID de Dropi con el ID WooCommerce del pedido histórico #63.

### Diferencias críticas para evitar errores

- quote_shipping usa **cash_on_delivery:boolean**; create_order usa rate_type string. No enviar rate_type a quote_shipping ni permitir create_order.
- Las respuestas por transportadora pueden incluir carrier, service, shipping_cost, insurance, trajectory y error; el MCP no declaró un JSON Schema formal de respuesta. El adaptador no presume una forma específica de éxito. Hay que interpretar y verificar cada resultado antes de mostrar precios al cliente.
- Para isError=true a nivel de herramienta MCP, el adaptador devuelve error 502 tipado en lugar de éxito.
- Los tipos SIMPLE, VARIABLE y COMBO se conocen por la descripción, no por un enum formal del esquema remoto.
- Las pruebas automatizadas son simuladas: **10 aprobadas, 0 fallidas** en GitHub Actions (2026-10-17). Todavía falta validar el contrato con acceso OAuth propio desde Supabase B.

### Próximos pasos

1. Ejecutar las pruebas locales de validate.ts y core.test.ts.
2. Diseñar OAuth propio y verificar issuer con Dropi; no copiar la sesión de Claude.
3. Verificar el JSON Schema vivo desde B, cotejar campos y permisos.
4. Actualizar y redesplegar la función de B **solo cuando pase pruebas**; mantener deshabilitado el gate OAuth.
5. Probar cotización en modo consulta sin recaudo y con ciudad válida; comparar sin asumir que Quito sea el origen MCP.
6. Integrar como fallback solo después de confirmar resultados y privacidad.

## Verificación después del despliegue v2

- GitHub Actions: **10 pruebas Deno superadas, 0 fallidas**, ejecución aislada sin permisos de red y sin credenciales, acción `Offline MCP read-only contract tests`.
- Supabase B: `dropec-dropi-mcp-readonly` **ACTIVE v2**, `verify_jwt=true`.
- Petición `/health` sin JWT ⇒ HTTP 401, `UNAUTHORIZED_NO_AUTH_HEADER`.
- `dropec_private.commerce_ready()` ⇒ **false** y `bot_order_jobs` ⇒ **0** en B.
- Gate MCP/OAuth sigue sin configurar: no hubo `tools/call` desde B, no se gastó wallet ni se crearon pedidos.
- PR #12 continúa como borrador, no fusionada. La función v2 se desplegó únicamente en B para validar que se conserva el control de acceso; no interviene en checkout.

## Auditoría OAuth estricta y prueba en B — 2026-10-17

- Se descubrió un callback OAuth separado `dropec-dropi-oauth`, registro dinámico (todavía bloqueado), PKCE S256, estado de un solo uso, Vault y renovación de tokens. No está conectado a la cuenta de Dropi.
- La discrepancia OAuth **persistió**: `authorization_servers=[https://integrations.dropi.co/bff]` pero la metadata publica `issuer=https://integrations.dropi.co`. No se debe interpretar el alias `/bff` como una identidad válida sin confirmación del proveedor.
- **Cambio de seguridad:** `validateMetadata` ahora exige que la identificación de servidor en `authorization_servers` y el `issuer` sean exactamente iguales al `https://integrations.dropi.co` fijado. Mientras Dropi no lo corrija, `start` aborta **sin registrar cliente OAuth ni generar enlaces de consentimiento**. La aprobación manual no ignora esta comprobación.
- **Cambio de seguridad:** callback comprueba de nuevo `setup_enabled`, `pinned_issuer_approved` y `session_replacement_ack` antes de intentar canjear o guardar credenciales. Si la autorización se revoca durante el proceso, responde fallo.
- Actualicé solo el servicio **`dropec-dropi-oauth` v2** en Supabase B, con callback público `verify_jwt=false` (necesario para redirección OAuth), pero `/start` y `/status` exigen una clave de configuración privada.
- Pruebas HTTP sin credenciales: GET `/status` -> **401**, POST `/start` -> **401**, GET `/callback` sin parámetros -> **400**. No hubo canje de token ni registro de cliente.
- Gates leídos desde B: `setup_enabled=false`, `pinned_issuer_approved=false`, `session_replacement_ack=false`, `readonly_enabled=false`; ninguna sesión guardada y cero consentimientos activos. `commerce_ready=false`, `bot_order_jobs=0`.
- La sesión conectada en Claude puede cerrarse si en el futuro se autoriza DropEC; el usuario debe aceptarlo explícitamente. El scope `mcp` también concede al cliente OAuth permiso de `create_order`, aunque nuestro adaptador de backend lo bloquea por código; el riesgo debe indicarse claramente antes de autorización.
- No modificar por SQL manualmente los gates antes de reparar la metadata OAuth del proveedor y verificar el flujo de consentimiento. No extraer claves internas del Vault a chat o logs.

La función de consultas `dropec-dropi-mcp-readonly` permanece desactivada, aunque esté desplegada. Las pruebas automáticas no equivalen a llamadas autenticadas al MCP.
