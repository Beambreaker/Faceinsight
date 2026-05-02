<?php
declare(strict_types=1);

/**
 * Gemeinsame HMAC-Secrets fuer Owner-Zugriff und Gast-Links (FACEINSIGHT_SHARE_TOKEN_SECRET).
 */

function fi_share_secret(): string {
    if (defined('FACEINSIGHT_SHARE_TOKEN_SECRET') && FACEINSIGHT_SHARE_TOKEN_SECRET) {
        return (string) FACEINSIGHT_SHARE_TOKEN_SECRET;
    }
    $env = getenv('FACEINSIGHT_SHARE_TOKEN_SECRET');
    return is_string($env) && $env !== '' ? $env : '';
}

function fi_normalize_sig(string $value): string {
    return strtolower((string) preg_replace('/[^a-f0-9]/i', '', trim($value)));
}

/** Server-seitiger Owner-Nachweis fuer dieselbe tid (zusammen mit analyze-Antwort an Client). */
function fi_owner_signature_for_tid(string $tid): string {
    $secret = fi_share_secret();
    if ($secret === '') {
        return '';
    }
    $tidNorm = strtoupper(trim($tid));
    return hash_hmac('sha256', $tidNorm . '|owner', $secret);
}

function fi_valid_owner_signature(string $tid, string $sigHex): bool {
    $expected = fi_owner_signature_for_tid($tid);
    if ($expected === '') {
        return false;
    }
    $sigHex = fi_normalize_sig($sigHex);
    if (strlen($sigHex) !== 64) {
        return false;
    }
    return hash_equals($expected, $sigHex);
}
