# FaceInsight Standalone Generator

Dies ist die eigenstaendige Generator-App fuer den FaceInsight Premium-Steckbrief. Der Ordner kann per FileZilla/SFTP auf IONOS hochgeladen werden, z. B. nach:

```text
/faceinsight-generator/
```

Live-Einstieg:

```text
https://www.faceinsight.de/faceinsight-app/
```

Direkter Pfad:

```text
https://www.faceinsight.de/wp-content/faceinsight-generator/
```

## Struktur

```text
index.html                 Mobile-first Generator und feste Report-Maske
assets/css/faceinsight.css Kamera, Layout, druckbare Premium-Schablone
assets/js/faceinsight.js   Kamera-Ampel, FaceDetector-Fallback, Rendering, Teilen
api/analyze.php            OpenAI Pipeline und JSON API
api/config.sample.php      Vorlage fuer serverseitige OpenAI-Konfiguration
```

## KI-Pipeline

1. Fotopruefung: genau ein Gesicht, neutraler Ausdruck, sichtbares Laecheln, optisches Alter als kurze Spanne.
2. Auswertung: Gesichtsanalyse, Merkmalswerte, Archetyp, stilistische Referenzperson, Kurzfazit und Tipps.
3. Werbetext-Verdichtung: Felder werden fuer die feste Steckbrief-Maske gekuerzt.
4. Bildaufbereitung: laechelndes Bild wird als Premium-Report-Portrait aufbereitet; die Originalbilder bleiben im Browser unverfiltert.
5. Referenzbild: optionales gemaltes Medaillon fuer die stilistische Referenz.

## OpenAI aktivieren

`api/config.sample.php` zu `api/config.php` kopieren und die Werte setzen:

```php
define('FACEINSIGHT_OPENAI_API_KEY', 'PASTE_OPENAI_API_KEY_HERE');
define('FACEINSIGHT_OPENAI_VALIDATION_MODEL', 'gpt-5.4-mini');
define('FACEINSIGHT_OPENAI_ANALYSIS_MODEL', 'gpt-5.4');
define('FACEINSIGHT_OPENAI_DESIGN_MODEL', 'gpt-5.4-mini');
define('FACEINSIGHT_OPENAI_IMAGE_MODEL', 'gpt-image-1');
```

Alternativ akzeptiert `api/analyze.php` serverseitig die Umgebungsvariablen `FACEINSIGHT_OPENAI_API_KEY` oder `OPENAI_API_KEY`.

Ohne Key funktioniert der Generator mit lokalem Fallback-Report. Fuer echte KI-Auswertung und Bildaufbereitung ist der Key noetig.

## Hinweise

- Kamera braucht HTTPS.
- Primaer fuer Handy gebaut, iPad/Desktop sind ebenfalls unterstuetzt.
- Es werden zwei Frontfotos genutzt: neutral und laechelnd.
- Der Kamerarahmen zeigt rot, gelb und gruen. Bei gruen startet ein 3-Sekunden-Selbstausloeser.
- Wenn der Browser `FaceDetector` unterstuetzt, wird live geprueft, ob ein Gesicht im Bild ist. Danach prueft die OpenAI-Fotopruefung die Bilder erneut.
- Die Report-Maske ist druckbar und per Web Share / Zwischenablage teilbar.
- Die Auswertung ist eine visuelle Einordnung, keine Diagnose, keine Identifikation und kein biometrischer Abgleich.
