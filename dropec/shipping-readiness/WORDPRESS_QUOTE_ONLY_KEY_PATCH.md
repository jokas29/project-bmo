# DropEC — parche de firma SOLO cotización para WordPress (BORRADOR; NO INSTALADO)

**No aplicar automáticamente.** El operador facilitó el PHP completo `dropec-webhook-sync.php` (3.762 líneas); la ruta `shipping-quote-v2` comienza en la línea ~3106. El parche conserva la aceptación de la firma Woo antigua exclusivamente para compatibilidad mientras añade un secreto nuevo de solo cotización. No toca `/wake`, pagos ni pedidos. Requiere copia de seguridad y revisión de producción antes de aplicar.

## 1. Añadir una clave fuerte, privada y exclusiva en WordPress

En `wp-config.php`, **antes** del comentario `/* That's all, stop editing! */`, definir una constante (no publicar la clave ni incluirla en GitHub o chats):

```php
define('DROPEC_SHIPPING_QUOTE_SECRET', 'VALOR_ALEATORIO_DE_AL_MENOS_48_CARACTERES');
```

Generar el valor localmente con un generador criptográfico y usar una clave **diferente** de la firma del webhook Woo, tokens Dropi/PayPhone y claves Supabase. No reutilizar la contraseña del panel. Permitir acceso únicamente al operador autorizado.

## 2. En `dropec-webhook-sync.php` añadir un verificador exclusivo

Agregar antes del bloque `17. DROPEC COTIZADOR DROPI V2`:

```php
if (!function_exists('dropec_verify_shipping_quote_only_signature')) {
    function dropec_verify_shipping_quote_only_signature($raw, $provided) {
        if (!defined('DROPEC_SHIPPING_QUOTE_SECRET')
            || !is_string(DROPEC_SHIPPING_QUOTE_SECRET)
            || strlen(DROPEC_SHIPPING_QUOTE_SECRET) < 48
            || !is_string($provided)
            || $provided === '') {
            return false;
        }
        $expected = base64_encode(hash_hmac(
            'sha256', $raw, DROPEC_SHIPPING_QUOTE_SECRET, true
        ));
        return hash_equals($expected, $provided);
    }
}
```

## 3. Cambiar ÚNICAMENTE la comprobación de firma en `shipping-quote-v2`

Reemplazar **solamente en el callback de `/shipping-quote-v2`**:

```php
if ( ! dropec_v16_verify_signature( $raw, $signature ) ) {
```

por:

```php
if (
    ! dropec_v16_verify_signature($raw, $signature)
    && ! dropec_verify_shipping_quote_only_signature($raw, $signature)
) {
```

**No editar los validadores globales, los webhooks Woo ni otros callbacks.** Esta estrategia evita dar a B el secreto compartido del webhook Woo y no interrumpe clientes antiguos que ya usaban esa firma. Cuando se migren consumidores antiguos, revisar la eliminación del fallback bajo prueba controlada.

## 4. Configuración posterior en Supabase B

- Guardar el **mismo** nuevo valor mediante Vault B como `dropec_shipping_quote_key_b`. Nunca en la tabla pública, el repositorio, capturas o logs.
- Adaptar el broker B para leer exclusivamente este secreto en operaciones de cotización, sin `bot_woo_config.enabled` ni tokens Woo/Dropi o PayPhone; mantener `worker_enabled=false` y release OFF durante pruebas.
- Revalidar HMAC-SHA256 base64, el cuerpo RAW, el origen 732/DANE `201001002001` **solo después** de verificación actual y el DANE oficial de Babahoyo. En caso de error de autenticación 401, no reintentar con credenciales Woo compartidas.
- Probar primero rechazos sin autorización y luego una sola cotización SIN RECAUDO. **No** hacer compras, `create_order`, `/wake`, ni cobrar dinero. Mantener Woo #63 fallido y ventas desactivadas.

## Seguridad/estado

Este documento **no instala la clave ni cambia WordPress**; es un parche en espera de acceso autorizado al hosting. Antes de aplicarlo se debe preparar copia de seguridad del archivo original y verificar su versión real y sintaxis. La captura del operador acredita 131 unidades visibles en Dropi el 19/10 pero **no verifica** los IDs actuales de bodega, ni determina el DANE de Babahoyo. PayPhone sigue pendiente de desbloqueo.
