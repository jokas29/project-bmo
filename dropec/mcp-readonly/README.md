# DropEC — Dropi MCP, solo lectura (desplegado en B, OAuth pendiente)

## Implementaremos únicamente dos mejoras

1. **Cotización alternativa de envíos** para comparar contra el mecanismo ya construido.
2. **Diagnóstico de pedidos existentes** cuando falle el puente WooCommerce/Supabase.

NO es otra integración de catálogo, NO reemplaza PayPhone, NO crea pedidos, NO consulta wallet, NO toca el pedido #63 y NO reactiva ventas, cron, tracking automático ni fulfillment.

Fuente: manual oficial *Conectar tu Agente de IA con el MCP de Dropi*, página 5, dirección https://mcp.dropi.co/mcp.

## Estado

Código experimental aislado en rama de GitHub. La Edge Function ya está desplegada en Supabase B, con verify_jwt=true, pero desactivada y NO conectada a Dropi. El PDF explica OAuth interactivo para asistentes, pero no documenta un token de servidor para DropEC ni cómo renovarlo. **No** reutilizar la sesión de Claude/ChatGPT ni publicar tokens. Es necesario verificar cómo autorizar legal y técnicamente un cliente de backend propio.

Supabase B (ubxkqbnzdtgfvphwohzm) ya es accesible mediante su cuenta conectada. La función dropec-dropi-mcp-readonly v1 está desplegada en B, con JWT obligatorio y sin OAuth activo. No desplegar en A.

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