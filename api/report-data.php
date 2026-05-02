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
require_once __DIR__ . '/auth-tokens.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respond(['success' => false, 'message' => 'Nur GET ist erlaubt.'], 405);
}

$tid = strtoupper(trim((string)($_GET['tid'] ?? $_GET['ref'] ?? '')));
$mode = strtolower(trim((string)($_GET['mode'] ?? 'owner')));
$exp = intval($_GET['exp'] ?? 0);
$sig = fi_normalize_sig((string)($_GET['sig'] ?? ''));
debug_log('H1', 'report-data.php:request', 'incoming request', [
    'mode' => $mode,
    'tid' => $tid,
    'hasExp' => $exp > 0,
    'hasSig' => $sig !== '',
]);

if (!preg_match('/^FI-[A-Z0-9\-]{6,64}$/', $tid)) {
    respond(['success' => false, 'message' => 'ungueltige tid'], 400);
}

if ($mode === 'guest') {
    if (!valid_guest_signature($tid, $exp, $sig)) {
        debug_log('H4', 'report-data.php:guest-guard', 'guest signature invalid', [
            'tid' => $tid,
            'exp' => $exp,
            'sigLength' => strlen($sig),
        ]);
        respond(['success' => false, 'message' => 'Gast-Link ungueltig oder abgelaufen.'], 403);
    }
} elseif ($mode === 'owner') {
    if ($sig === '' || !fi_valid_owner_signature($tid, $sig)) {
        debug_log('H4', 'report-data.php:owner-guard', 'owner signature invalid', [
            'tid' => $tid,
            'sigLength' => strlen($sig),
        ]);
        respond(['success' => false, 'message' => 'Owner-Nachweis fehlt oder ungueltig.'], 403);
    }
} else {
    respond(['success' => false, 'message' => 'ungueltiger mode'], 400);
}

$file = dirname(__DIR__) . '/data/tests/' . basename($tid) . '.json';
if (!is_file($file)) {
    debug_log('H1', 'report-data.php:file-check', 'report file missing', [
        'tid' => $tid,
        'path' => $file,
    ]);
    respond(['success' => false, 'message' => 'Report nicht gefunden.'], 404);
}

$record = json_decode((string)file_get_contents($file), true);
if (!is_array($record) || !is_array($record['report'] ?? null)) {
    debug_log('H1', 'report-data.php:file-check', 'report file invalid', [
        'tid' => $tid,
    ]);
    respond(['success' => false, 'message' => 'Report-Datei ist ungueltig.'], 500);
}

$expiresTs = strtotime((string)($record['expires_at'] ?? ''));
if ($expiresTs && $expiresTs < time()) {
    respond(['success' => false, 'message' => 'Report abgelaufen.'], 410);
}

$report = $record['report'];
debug_log('H2', 'report-data.php:response', 'report payload summary', [
    'tid' => (string)($record['test_id'] ?? $tid),
    'hasReport' => is_array($report),
    'hasPortraitImage' => trim((string)($report['visual_asset']['premium_portrait_image'] ?? '')) !== '',
    'hasReferenceItems' => !empty($report['reference']['items']) && is_array($report['reference']['items']),
    'hasArchetypeImage' => trim((string)($report['archetype']['image_url'] ?? '')) !== '',
]);

respond([
    'success' => true,
    'test_id' => $record['test_id'] ?? $tid,
    'created_at' => $record['created_at'] ?? '',
    'expires_at' => $record['expires_at'] ?? '',
    'user' => $record['payload']['user'] ?? [],
    'product_type' => $record['mode'] ?? 'premium',
    'photos' => report_photos($record['payload'] ?? []),
    'report' => $report,
]);

function valid_guest_signature(string $tid, int $exp, string $sig): bool {
    if ($exp <= 0 || $sig === '' || $exp < time()) return false;
    $secret = fi_share_secret();
    if ($secret === '') return false;
    $expected = hash_hmac('sha256', $tid . '|guest|' . $exp, $secret);
    return hash_equals($expected, $sig);
}

function report_photos(array $payload): array {
    $images = is_array($payload['images'] ?? null) ? $payload['images'] : [];
    $processed = is_array($payload['processed_images'] ?? null) ? $payload['processed_images'] : [];

    return [
        'neutral' => safe_photo((string)($processed['front_neutral'] ?? $images['front_neutral'] ?? '')),
        'smile' => safe_photo((string)($processed['front_smile'] ?? $images['front_smile'] ?? '')),
        'profile' => safe_photo((string)($processed['side_profile'] ?? $images['side_profile'] ?? '')),
    ];
}

function safe_photo(string $value): string {
    $value = trim($value);
    if ($value === '') return '';
    if (preg_match('#^data:image/(png|jpe?g|webp);base64,(.+)$#is', $value, $m)) {
        $b64 = preg_replace('/\s+/', '', $m[2]);
        $out = 'data:image/' . $m[1] . ';base64,' . $b64;
        if (!preg_match('#^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$#i', $out)) return '';
        return $out;
    }
    return '';
}

function respond(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function debug_log(string $hypothesisId, string $location, string $message, array $data): void {
    // #region agent log
    $line = json_encode([
        'sessionId' => 'b7e216',
        'runId' => 'run-server',
        'hypothesisId' => $hypothesisId,
        'location' => $location,
        'message' => $message,
        'data' => $data,
        'timestamp' => (int)round(microtime(true) * 1000),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (is_string($line) && $line !== '') {
        @file_put_contents(dirname(__DIR__) . '/debug-b7e216.log', $line . PHP_EOL, FILE_APPEND);
    }
    // #endregion
}
