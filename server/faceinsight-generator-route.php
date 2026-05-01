<?php
/**
 * FaceInsight standalone route.
 *
 * Redirects /faceinsight-generator/ to the uploaded standalone app in wp-content.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('template_redirect', function () {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    $path = '/' . trim((string) $path, '/') . '/';

    if (!in_array($path, ['/faceinsight-app/', '/faceinsight-generator-v1/'], true)) {
        return;
    }

    wp_safe_redirect(content_url('/faceinsight-generator/'), 302);
    exit;
}, 0);
