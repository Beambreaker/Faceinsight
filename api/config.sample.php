<?php
declare(strict_types=1);

// Kopiere diese Datei zu config.local.php (nicht ins Repo committen).
// config.local.php wird durch .htaccess vor direktem Zugriff geschuetzt.

define('FACEINSIGHT_OPENAI_API_KEY', 'PASTE_OPENAI_API_KEY_HERE');

// Rollenmodelle der Pipeline.
define('FACEINSIGHT_OPENAI_VALIDATION_MODEL', 'gpt-5.4-mini');
define('FACEINSIGHT_OPENAI_ANALYSIS_MODEL', 'gpt-5.4');
define('FACEINSIGHT_OPENAI_DESIGN_MODEL', 'gpt-5.4-mini');
define('FACEINSIGHT_OPENAI_IMAGE_MODEL', 'gpt-image-1');

// Fuer signierte Share-Links.
define('FACEINSIGHT_SHARE_TOKEN_SECRET', 'REPLACE_WITH_LONG_RANDOM_SECRET');
define('FACEINSIGHT_PUBLIC_BASE_URL', 'https://faceinsight.de/wp-content/faceinsight-generator');

// Stage-Modelle (wirtschaftlich steuerbar).
define('FACEINSIGHT_MODEL_PRECHECK', 'gpt-5.4-mini');
define('FACEINSIGHT_MODEL_PROCESSING', 'gpt-image-1');
define('FACEINSIGHT_MODEL_ANALYSIS', 'gpt-5.4');
define('FACEINSIGHT_MODEL_REPORT', 'gpt-5.4-mini');

// Gate-Schwellen.
define('FACEINSIGHT_GATE_SINGLE_PERSON_MIN', 0.90);
define('FACEINSIGHT_GATE_FACE_PRESENCE_MIN', 0.95);
define('FACEINSIGHT_GATE_SHARPNESS_MIN', 0.65);
define('FACEINSIGHT_GATE_LIGHTING_MIN', 0.55);
define('FACEINSIGHT_GATE_OCCLUSION_MAX', 0.35);
define('FACEINSIGHT_GATE_NEUTRAL_SMILE_MAX', 0.35);
define('FACEINSIGHT_GATE_SMILE_MIN', 0.60);
define('FACEINSIGHT_GATE_IDENTITY_PRESERVE_MIN', 0.85);
define('FACEINSIGHT_GATE_ARTIFACT_RISK_MAX', 0.30);
define('FACEINSIGHT_GATE_ANALYZE_CONFIDENCE_MIN', 0.70);

// Produktmodus
define('FACEINSIGHT_DISABLE_PAYWALL', true);

// Optional: Google Sheets als einfache Datenbank via Google Apps Script Web-App.
// Leer lassen, bis die Web-App-URL existiert.
define('FACEINSIGHT_GOOGLE_SHEETS_WEBHOOK_URL', '');

// Stripe optional (Premium/Pair Bezahlung)
define('FACEINSIGHT_STRIPE_SECRET_KEY', 'sk_live_or_test_...');
define('FACEINSIGHT_STRIPE_PUBLISHABLE_KEY', 'pk_live_or_test_...');
define('FACEINSIGHT_STRIPE_WEBHOOK_SECRET', 'whsec_...');
