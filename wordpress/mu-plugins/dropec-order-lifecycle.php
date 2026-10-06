<?php
/**
 * Plugin Name: DropEC Order Lifecycle Proxy
 * Description: Secure, read-only Dropi order status proxy used by DropEC tracking automation.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

function dropec_lifecycle_clean($value, $max = 300) {
    $value = is_scalar($value) ? (string) $value : '';
    $value = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $value);
    $value = preg_replace('/\s+/u', ' ', $value);
    return mb_substr(trim($value), 0, $max);
}

function dropec_lifecycle_webhook_secret() {
    if (function_exists('wc_get_webhooks')) {
        $hooks = wc_get_webhooks(array('status' => 'active', 'limit' => 50));
        foreach ($hooks as $hook) {
            if (!is_object($hook) || !method_exists($hook, 'get_delivery_url') || !method_exists($hook, 'get_secret')) {
                continue;
            }
            $url = (string) $hook->get_delivery_url();
            if (strpos($url, 'dropec-woo-webhook') !== false) {
                $secret = (string) $hook->get_secret();
                if ($secret !== '') {
                    return $secret;
                }
            }
        }
    }

    if (function_exists('wc_get_webhook')) {
        $hook = wc_get_webhook(1);
        if (is_object($hook) && method_exists($hook, 'get_secret')) {
            return (string) $hook->get_secret();
        }
    }

    if (class_exists('WC_Webhook')) {
        try {
            $hook = new WC_Webhook(1);
            if (method_exists($hook, 'get_secret')) {
                return (string) $hook->get_secret();
            }
        } catch (Throwable $e) {
            return '';
        }
    }

    return '';
}

function dropec_lifecycle_verify_request($raw) {
    $secret = dropec_lifecycle_webhook_secret();
    $provided = isset($_SERVER['HTTP_X_DROPEC_SIGNATURE']) ? (string) $_SERVER['HTTP_X_DROPEC_SIGNATURE'] : '';
    if ($secret === '' || $provided === '' || strlen($raw) > 200000) {
        return false;
    }
    $expected = base64_encode(hash_hmac('sha256', $raw, $secret, true));
    return hash_equals($expected, $provided);
}

function dropec_lifecycle_token_for_order($order) {
    if (!$order || !is_object($order)) {
        return '';
    }

    foreach ($order->get_items() as $item) {
        $ids = array();
        if (method_exists($item, 'get_variation_id')) {
            $vid = (int) $item->get_variation_id();
            if ($vid > 0) {
                $ids[] = $vid;
            }
        }
        if (method_exists($item, 'get_product_id')) {
            $pid = (int) $item->get_product_id();
            if ($pid > 0) {
                $ids[] = $pid;
            }
        }
        foreach ($ids as $id) {
            $token = (string) get_post_meta($id, '_dropi_token', true);
            if (strlen(trim($token)) >= 20) {
                return trim($token);
            }
        }
    }

    if (class_exists('JPIODFW_TokenModel')) {
        try {
            $tokens = JPIODFW_TokenModel::GetInstance()->getTokens();
            if (is_array($tokens) && !empty($tokens) && isset($tokens[0]->token)) {
                $token = trim((string) $tokens[0]->token);
                if (strlen($token) >= 20) {
                    return $token;
                }
            }
        } catch (Throwable $e) {
            // Fall through to direct table lookup.
        }
    }

    global $wpdb;
    if (isset($wpdb) && is_object($wpdb)) {
        $table = $wpdb->prefix . 'dropi_tokens';
        $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table));
        if ($exists === $table) {
            $token = $wpdb->get_var("SELECT token FROM {$table} ORDER BY id ASC LIMIT 1");
            $token = trim((string) $token);
            if (strlen($token) >= 20) {
                return $token;
            }
        }
    }

    return '';
}

function dropec_lifecycle_api_base() {
    if (class_exists('JPIODFW_Constants')) {
        try {
            $constants = JPIODFW_Constants::GetInstance();
            if (is_object($constants) && !empty($constants->API_URL)) {
                return trailingslashit((string) $constants->API_URL);
            }
        } catch (Throwable $e) {
            // Use Ecuador fallback below.
        }
    }
    return 'https://api.dropi.ec/integrations/';
}

function dropec_lifecycle_find_scalar($node, $keys, $depth = 0) {
    if ($depth > 7 || $node === null) {
        return '';
    }
    if (is_object($node)) {
        $node = get_object_vars($node);
    }
    if (!is_array($node)) {
        return '';
    }

    foreach ($node as $key => $value) {
        $normalized = strtolower(preg_replace('/[^a-z0-9]+/i', '_', remove_accents((string) $key)));
        $normalized = trim($normalized, '_');
        if (in_array($normalized, $keys, true)) {
            if (is_scalar($value)) {
                return dropec_lifecycle_clean($value, 500);
            }
            if (is_object($value)) {
                $value = get_object_vars($value);
            }
            if (is_array($value)) {
                foreach (array('name', 'nombre', 'description', 'descripcion', 'label', 'value', 'status') as $subkey) {
                    if (isset($value[$subkey]) && is_scalar($value[$subkey])) {
                        return dropec_lifecycle_clean($value[$subkey], 500);
                    }
                }
            }
        }
    }

    foreach ($node as $value) {
        if (is_array($value) || is_object($value)) {
            $found = dropec_lifecycle_find_scalar($value, $keys, $depth + 1);
            if ($found !== '') {
                return $found;
            }
        }
    }
    return '';
}

function dropec_lifecycle_status_from_response($data) {
    return dropec_lifecycle_find_scalar($data, array(
        'status', 'status_name', 'order_status', 'estado', 'estado_orden',
        'status_order', 'order_state', 'state_name', 'state'
    ));
}

function dropec_lifecycle_handle(WP_REST_Request $request) {
    $raw = (string) $request->get_body();
    if (!dropec_lifecycle_verify_request($raw)) {
        return new WP_REST_Response(array('ok' => false, 'error' => 'unauthorized'), 401);
    }

    $body = json_decode($raw, true);
    if (!is_array($body)) {
        return new WP_REST_Response(array('ok' => false, 'error' => 'invalid_json'), 400);
    }

    $job_id = dropec_lifecycle_clean(isset($body['job_id']) ? $body['job_id'] : '', 80);
    $woo_order_id = isset($body['woo_order_id']) ? absint($body['woo_order_id']) : 0;
    $expected_dropi_id = dropec_lifecycle_clean(isset($body['dropi_order_id']) ? $body['dropi_order_id'] : '', 120);

    if ($job_id === '' || $woo_order_id <= 0 || $expected_dropi_id === '') {
        return new WP_REST_Response(array('ok' => false, 'error' => 'missing_order_reference'), 400);
    }

    if (!function_exists('wc_get_order')) {
        return new WP_REST_Response(array('ok' => false, 'error' => 'woocommerce_unavailable'), 503);
    }

    $order = wc_get_order($woo_order_id);
    if (!$order) {
        return new WP_REST_Response(array('ok' => false, 'error' => 'woo_order_not_found'), 404);
    }

    $stored_dropi_id = dropec_lifecycle_clean($order->get_meta('_dropi_order_id', true), 120);
    if ($stored_dropi_id === '' || !hash_equals($stored_dropi_id, $expected_dropi_id)) {
        return new WP_REST_Response(array('ok' => false, 'error' => 'dropi_order_mismatch'), 409);
    }

    $token = dropec_lifecycle_token_for_order($order);
    if ($token === '') {
        return new WP_REST_Response(array('ok' => false, 'error' => 'dropify_token_unavailable'), 503);
    }

    $endpoint = dropec_lifecycle_api_base() . 'orders/myorders/' . rawurlencode($stored_dropi_id);
    $response = wp_remote_get($endpoint, array(
        'timeout' => 25,
        'redirection' => 2,
        'sslverify' => true,
        'headers' => array(
            'Accept' => 'application/json',
            'dropi-integration-key' => $token,
        ),
    ));

    if (is_wp_error($response)) {
        return new WP_REST_Response(array('ok' => false, 'error' => 'dropi_request_failed'), 502);
    }

    $status_code = (int) wp_remote_retrieve_response_code($response);
    $response_body = (string) wp_remote_retrieve_body($response);
    $decoded = json_decode($response_body, true);

    if ($status_code < 200 || $status_code >= 300 || !is_array($decoded)) {
        return new WP_REST_Response(array(
            'ok' => false,
            'error' => 'dropi_http_' . $status_code,
            'http_status' => $status_code,
        ), 502);
    }

    $provider_status = dropec_lifecycle_status_from_response($decoded);
    $tracking_number = dropec_lifecycle_find_scalar($decoded, array(
        'guide_number', 'guide', 'guide_id', 'numero_guia', 'nro_guia', 'guia',
        'tracking_number', 'tracking', 'shipping_guide', 'shipment_number'
    ));
    $carrier = dropec_lifecycle_find_scalar($decoded, array(
        'carrier', 'carrier_name', 'transportadora', 'transportadora_name',
        'shipping_company', 'transport_company', 'courier', 'logistic_operator',
        'operador_logistico'
    ));
    $tracking_url = dropec_lifecycle_find_scalar($decoded, array(
        'tracking_url', 'tracking_link', 'url_tracking', 'guide_url', 'guia_url', 'shipment_url'
    ));

    if ($tracking_url !== '' && strpos($tracking_url, 'https://') !== 0) {
        $tracking_url = '';
    }

    return new WP_REST_Response(array(
        'ok' => true,
        'job_id' => $job_id,
        'woo_order_id' => $woo_order_id,
        'dropi_order_id' => $stored_dropi_id,
        'woo_status' => $order->get_status(),
        'provider_status' => $provider_status !== '' ? $provider_status : null,
        'carrier' => $carrier !== '' ? $carrier : null,
        'tracking_number' => $tracking_number !== '' ? $tracking_number : null,
        'tracking_url' => $tracking_url !== '' ? $tracking_url : null,
    ), 200);
}

add_action('rest_api_init', function () {
    register_rest_route('dropec/v1', '/order-lifecycle', array(
        'methods' => 'POST',
        'callback' => 'dropec_lifecycle_handle',
        'permission_callback' => '__return_true',
    ));
});
