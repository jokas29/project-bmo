# DropEC — Dropi MCP, solo lectura (NO desplegado)

## Implementaremos únicamente dos mejoras

1. **Cotización alternativa de envíos** para comparar contra el mecanismo ya construido.
2. **Diagnóstico de pedidos existentes** cuando falle el puente WooCommerce/Supabase.

NO es otra integración de catálogo, NO reemplaza PayPhone, NO crea pedidos, NO consulta wallet, NO toca el pedido #63 y NO reactiva ventas, cron, tracking automático ni fulfillment.

Fuente: manual oficial *Conectar tu Agente de IA con el MCP de Dropi*, página 5, dirección https://mcp.dropi.co/mcp.

## Estado

Código experimental aislado en rama de GitHub; **todavía no conectado a Dropi ni desplegado**. El PDF explica OAuth interactivo para asistentes, pero no documenta un token de servidor para DropEC ni cómo renovarlo. **No** reutilizar la sesión de Claude/ChatGPT ni publicar tokens. Es necesario verificar cómo autorizar legal y técnicamente un cliente de backend propio.

El conector Supabase actual solo permite acceder al proyecto A; B (ubxkqbnzdtgfvphwohzm) rechaza la conexión. **No desplegar en A.**

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
