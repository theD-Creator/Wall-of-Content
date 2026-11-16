# Wall of Content

Ein Bildschirm mit schwebenden Thumbnails (Bilder & Videos) – plus Fotostationen fürs Handy und ein Admin-Panel.

| Seite | Adresse | Zweck |
|---|---|---|
| **Wall** | `http://<laptop-ip>:3000/` | Großer Bildschirm. Thumbnails schweben herum, ein Klick/Tipp spielt Bild oder Video ab. |
| **Fotostation** | `https://<laptop-ip>:3443/station` | Handy/Tablet: Start → Rahmen wählen → Foto → QR-Code zum Download. |
| **Admin-Panel** | `http://<laptop-ip>:3000/admin` | Inhalte, Fotos, Rahmen, Hintergründe, Einstellungen, Fernsteuerung. |

## Starten

```bash
npm install
```

```bash
npm start
```

Beim Start zeigt das Terminal alle Adressen und das **Admin-Passwort** an (wird beim ersten Start erzeugt und in
`data/admin-password.txt` gespeichert; eigenes Passwort: `ADMIN_PASSWORD=geheim npm start`).

Voraussetzung: Node.js 18 oder neuer. Laptop, Stations-Handys und die Handys der Gäste müssen im selben WLAN sein.

## Ablauf Fotostation

1. Am Handy `https://<laptop-ip>:3443/station` öffnen (im Admin-Panel gibt es dafür einen QR-Code).
   Die Zertifikatswarnung **einmalig bestätigen** – Browser geben die Kamera nur über HTTPS frei.
2. **Start** → Rahmen wählen → Auslöser → Countdown → Foto.
3. Foto prüfen, optional den Haken **„Mein Foto auf der Wall of Content anzeigen“** setzen, **Speichern**.
4. Der QR-Code führt zur Download-Seite des Fotos. Nur Fotos mit gesetztem Haken erscheinen auf der Wall.

Tipp: `…/station?name=Eingang` gibt der Station einen Namen, der im Admin-Panel angezeigt wird.

## Eigene Dateien (Ordner `assets/`)

Alles in diesen Ordnern wird automatisch verwendet – einfach Dateien hineinkopieren (oder im Admin-Panel hochladen):

| Ordner | Inhalt |
|---|---|
| `assets/frames/` | Rahmen für die Fotostation: PNG, WebP oder SVG **mit transparentem Bereich**, am besten Hochformat 3:4 (z. B. 1080 × 1440 px). |
| `assets/backgrounds/` | Hintergrundbilder für Wall und Fotostation (JPG, PNG, WebP, SVG). Auswahl im Admin-Panel unter „Hintergründe“. |
| `assets/media/` | Bilder und Videos (JPG, PNG, WebP, GIF, MP4, WebM, MOV), die automatisch auf der Wall erscheinen. |

Fotos der Stationen, Uploads aus dem Admin-Panel und die Einstellungen liegen in `data/` (nicht im Git).

## Admin-Panel

- **Übersicht:** Adressen mit QR-Codes, verbundene Geräte, Fotostationen pausieren, Wall/Stationen neu laden.
- **Inhalte:** Bilder und Videos hochladen, ein-/ausblenden, betiteln, „Jetzt zeigen“ auf der Wall.
- **Fotos:** Alle Stations-Fotos; freigeben, von der Wall nehmen, löschen. Fotos ohne Zustimmung des Gastes
  können nicht auf die Wall gelegt werden.
- **Rahmen / Hintergründe:** hochladen, umbenennen, aktivieren, löschen.
- **Einstellungen:** Titel, Farbe, Anzahl/Größe/Geschwindigkeit der Kacheln, Automatik, Countdown,
  Freigabe-Pflicht (Moderation), automatisches Löschen alter Fotos, Adresse für QR-Codes.

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port (Wall, Admin, Download-Seiten) |
| `HTTPS_PORT` | `3443` | HTTPS-Port mit selbstsigniertem Zertifikat (für die Kamera); `0` = aus |
| `ADMIN_PASSWORD` | zufällig | Passwort für das Admin-Panel |
| `DATA_DIR` | `./data` | Speicherort für Fotos, Uploads, Einstellungen |
| `ASSETS_DIR` | `./assets` | Ordner mit `frames/`, `backgrounds/`, `media/` |
| `MAX_UPLOAD_MB` | `1024` | Maximale Größe eines Uploads im Admin-Panel |

Wenn der QR-Code auf eine falsche Adresse zeigt (z. B. mehrere Netzwerke), im Admin-Panel unter
Einstellungen die „Öffentliche Adresse für QR-Codes“ setzen, z. B. `http://192.168.1.10:3000`.

Ohne HTTPS (oder wenn die Kamera nicht freigegeben wird) nutzt die Fotostation automatisch die
Kamera-App des Handys als Ersatz.
