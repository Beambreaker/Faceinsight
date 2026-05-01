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

$tid = strtoupper(trim((string)($_GET['tid'] ?? $_GET['ref'] ?? '')));
$mode = strtolower(trim((string)($_GET['mode'] ?? 'owner')));
$exp = intval($_GET['exp'] ?? 0);
$sig = strtolower(trim((string)($_GET['sig'] ?? '')));

if (!preg_match('/^FI-[A-Z0-9\-]{6,64}$/', $tid)) {
    respond(['success' => false, 'message' => 'ungueltige tid'], 400);
}

if ($mode === 'guest' && !valid_guest_signature($tid, $exp, $sig)) {
    respond(['success' => false, 'message' => 'Gast-Link ungueltig oder abgelaufen.'], 403);
}

$file = dirname(__DIR__) . '/data/tests/' . basename($tid) . '.json';
if (!is_file($file)) {
    respond(['success' => false, 'message' => 'Report nicht gefunden.'], 404);
}

$record = json_decode((string)file_get_contents($file), true);
if (!is_array($record) || !is_array($record['report'] ?? null)) {
    respond(['success' => false, 'message' => 'Report-Datei ist ungueltig.'], 500);
}

respond([
    'success' => true,
    'test_id' => $record['test_id'] ?? $tid,
    'created_at' => $record['created_at'] ?? '',
    'expires_at' => $record['expires_at'] ?? '',
    'user' => $record['payload']['user'] ?? [],
    'report' => $record['report'],
]);

function valid_guest_signature(string $tid, int $exp, string $sig): bool {
    if ($exp <= 0 || $sig === '' || $exp < time()) return false;
    $secret = share_secret();
    if ($secret === '') return false;
    $expected = hash_hmac('sha256', $tid . '|guest|' . $exp, $secret);
    return hash_equals($expected, $sig);
}

function share_secret(): string {
    if (defined('FACEINSIGHT_SHARE_TOKEN_SECRET') && FACEINSIGHT_SHARE_TOKEN_SECRET) {
        return (string)FACEINSIGHT_SHARE_TOKEN_SECRET;
    }
    $env = getenv('FACEINSIGHT_SHARE_TOKEN_SECRET');
    if (is_string($env) && $env !== '') return $env;
    if (defined('FACEINSIGHT_OPENAI_API_KEY') && FACEINSIGHT_OPENAI_API_KEY) {
        return hash('sha256', (string)FACEINSIGHT_OPENAI_API_KEY . '|faceinsight-share');
    }
    return '';
}

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
