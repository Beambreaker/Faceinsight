<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$configFile = __DIR__ . '/config.php';
if (is_file($configFile)) {
    require_once $configFile;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respond(['success' => false, 'message' => 'Nur GET ist erlaubt.'], 405);
}

$action = strtolower((string)($_GET['action'] ?? 'verify'));
$tid = strtoupper(trim((string)($_GET['tid'] ?? '')));
$mode = strtolower(trim((string)($_GET['mode'] ?? 'guest')));
$exp = intval($_GET['exp'] ?? 0);
$sig = strtolower(trim((string)($_GET['sig'] ?? '')));

if (!preg_match('/^FI-[A-Z0-9\-]{6,64}$/', $tid)) {
    respond(['success' => false, 'message' => 'ungueltige tid'], 400);
}

$secret = share_secret();
if ($secret === '') {
    respond(['success' => false, 'message' => 'share secret fehlt'], 500);
}

if ($action === 'issue') {
    $ttl = 7 * 86400;
    $exp = time() + $ttl;
    $mode = 'guest';
    $sig = build_sig($tid, $mode, $exp, $secret);
    respond([
        'success' => true,
        'tid' => $tid,
        'mode' => $mode,
        'exp' => $exp,
        'sig' => $sig,
        'guest_url' => build_guest_url($tid, $exp, $sig),
    ]);
}

if ($action === 'verify') {
    if ($exp <= 0 || $sig === '') {
        respond(['success' => false, 'valid' => false, 'message' => 'parameter fehlen'], 400);
    }
    if ($mode !== 'guest') {
        respond(['success' => false, 'valid' => false, 'message' => 'mode ungueltig'], 400);
    }
    if ($exp < time()) {
        respond(['success' => true, 'valid' => false, 'reason' => 'expired']);
    }
    $expected = build_sig($tid, $mode, $exp, $secret);
    $valid = hash_equals($expected, $sig);
    respond([
        'success' => true,
        'valid' => $valid,
        'reason' => $valid ? 'ok' : 'signature_mismatch',
    ]);
}

respond(['success' => false, 'message' => 'unknown action'], 400);

function build_guest_url(string $tid, int $exp, string $sig): string {
    $base = public_base_url();
    return $base . '/steckbrief-reel.html?mode=guest&ref='
        . rawurlencode($tid) . '&exp=' . rawurlencode((string)$exp) . '&sig=' . rawurlencode($sig);
}

function build_sig(string $tid, string $mode, int $exp, string $secret): string {
    $payload = $tid . '|' . $mode . '|' . $exp;
    return hash_hmac('sha256', $payload, $secret);
}

function share_secret(): string {
    if (defined('FACEINSIGHT_SHARE_TOKEN_SECRET') && FACEINSIGHT_SHARE_TOKEN_SECRET) {
        return (string)FACEINSIGHT_SHARE_TOKEN_SECRET;
    }
    $env = getenv('FACEINSIGHT_SHARE_TOKEN_SECRET');
    if (is_string($env) && $env !== '') {
        return $env;
    }
    return '';
}

function public_base_url(): string {
    if (defined('FACEINSIGHT_PUBLIC_BASE_URL') && FACEINSIGHT_PUBLIC_BASE_URL) {
        $configured = trim((string)FACEINSIGHT_PUBLIC_BASE_URL);
        if (filter_var($configured, FILTER_VALIDATE_URL)) {
            return rtrim($configured, '/');
        }
    }
    $env = getenv('FACEINSIGHT_PUBLIC_BASE_URL');
    if (is_string($env) && $env !== '' && filter_var($env, FILTER_VALIDATE_URL)) {
        return rtrim($env, '/');
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = sanitize_host((string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '') {
        return 'https://faceinsight.de/wp-content/faceinsight-generator';
    }
    return $scheme . '://' . $host . '/wp-content/faceinsight-generator';
}

function sanitize_host(string $host): string {
    $host = trim($host);
    if ($host === '' || preg_match('/[\r\n\/\\\\]/', $host)) {
        return '';
    }
    return preg_match('/^[A-Za-z0-9.-]+(?::\d{1,5})?$/', $host) ? strtolower($host) : '';
}

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
