# Wall of Content

📖 **Dokumentation**

- [Anleitung mit Screenshots](docs/ANLEITUNG.md) – Bedienung von Wall, Fotostation, Color Hunt, Quiz und Admin-Panel
- [Start auf dem Mac](docs/MAC.md) – per Doppelklick, ohne Installation
- [Technische Dokumentation](docs/TECHNIK.md) – Aufbau, Daten, API, Sicherheit

**Mac:** Ordner entpacken, `Start-Mac.command` mit Rechtsklick → Öffnen starten – fertig ([Details](docs/MAC.md)).

Ein Bildschirm mit schwebenden Thumbnails (Bilder & Videos) – plus Fotostationen fürs Handy und ein Admin-Panel.

| Seite | Adresse | Zweck |
|---|---|---|
| **Wall** | `http://<laptop-ip>:3000/` | Großer Bildschirm. Thumbnails schweben herum, ein Klick/Tipp spielt Bild oder Video ab. |
| **Fotostation** | `https://<laptop-ip>:3443/station` | Handy/Tablet: Start → Rahmen wählen → Foto → QR-Code zum Download. |
| **Admin-Panel** | `http://<laptop-ip>:3000/admin` | Inhalte, Fotos, Color Hunt, Rahmen, Hintergründe, Einstellungen, Fernsteuerung. |
| **Color Hunt** | `http://<laptop-ip>:3000/hunt` | Gäste scannen den QR-Code auf der Wall und machen mit dem eigenen Handy mit. |
| **Quiz** | `http://<laptop-ip>:3000/quiz` | Quiz mit Rangliste für das iPad; zeigt die Wall, solange kein Quiz läuft. |
| **Verbund-Wall** | `http://<laptop-ip>:3000/?pos=1` … | Experimentell: mehrere iPads nebeneinander bilden eine große Wall. |

## Starten

```bash
npm install
```

```bash
npm start
```

Beim Start zeigt das Terminal alle Adressen und das **Startpasswort** für **David R.** (Global Admin) an. Es steht auch in
`data/admin-password.txt`. David R. vergibt im Admin-Panel unter **Benutzer** die Passwörter für David K., Emily B.,
Jakob K. und Lilian H. Passwort vergessen? `ADMIN_PASSWORD=neuesPasswort npm start` setzt das Passwort des Global Admins.

Voraussetzung: Node.js 18 oder neuer. Laptop, Stations-Handys und die Handys der Gäste müssen im selben WLAN sein.

## Ablauf Fotostation

1. Am Handy `https://<laptop-ip>:3443/station` öffnen (im Admin-Panel gibt es dafür einen QR-Code).
   Die Zertifikatswarnung **einmalig bestätigen** – Browser geben die Kamera nur über HTTPS frei.
2. **Start** → Rahmen wählen → Auslöser → Countdown → Foto.
3. Foto prüfen, optional den Haken **„Mein Foto auf der Wall of Content anzeigen“** setzen, **Speichern**.
4. Der QR-Code führt zur Download-Seite des Fotos. Nur Fotos mit gesetztem Haken erscheinen auf der Wall.

Tipp: `…/station?name=Eingang` gibt der Station einen Namen, der im Admin-Panel angezeigt wird.

## Color Hunt

1. Im Admin-Panel unter **Color Hunt** den Schalter „Geöffnet“ einschalten – auf der Wall erscheint unten links ein QR-Code.
2. Gäste scannen den Code mit dem eigenen Handy, geben ihren **Namen** ein und bekommen eine **Farbe**.
3. Nach einer kurzen **Anleitung** startet mit „Start“ die Zeit (Standard: **5 Minuten**). In der Zeit fotografieren
   sie **5 Dinge** in ihrer Farbe. Danach wird abgegeben – spätestens automatisch, wenn die Zeit abläuft.
4. Jede Person kann **nur einmal** mitmachen (pro Handy und pro Name).
5. Im Admin-Panel siehst du alle Teilnehmer mit ihren Fotos live. Mit **„Als Sieger wählen“** erscheint der Sieger
   mit Name, Farbe und Fotos groß auf der Wall – bis du ihn wieder ausblendest.
6. **„Neue Runde“** löscht alle Teilnehmer und Fotos, danach können alle wieder mitmachen.
7. **Countdown:** Im Tab Color Hunt Minuten eintragen und „Countdown starten“. Die Restzeit läuft auf der Wall und den
   Handys mit (+5/−5 Min jederzeit möglich). Läuft sie ab, schließt der Color Hunt automatisch und alle geben ab.

Zeit und Anzahl der Fotos stellst du unter Einstellungen → „Color Hunt“ ein.

## Eigene Dateien (Ordner `assets/`)

Alles in diesen Ordnern wird automatisch verwendet – einfach Dateien hineinkopieren (oder im Admin-Panel hochladen):

| Ordner / Datei | Inhalt |
|---|---|
| `assets/frames/` | Rahmen für die Fotostation, am besten 1080 × 1920 px. **Deckende Bilder** (JPG/PNG) sind Hintergründe: das Foto wird in das abgerundete Fotofenster gesetzt (Vorlage: `docs/foto-layout.png`). **Bilder mit Transparenz** (PNG/WebP/SVG) werden über das Foto gelegt. |
| `assets/logo.svg` | Logo auf Wall, Fotostation, Download-Seite und im Admin-Panel (auch `logo.png` / `logo.webp` möglich). |
| `assets/backgrounds/` | Optionale Hintergrundbilder für die Wall und den Startbildschirm der Station (Querformat). Auswahl im Admin-Panel unter „Hintergründe“. |
| `assets/media/` | Bilder und Videos (JPG, PNG, WebP, GIF, MP4, WebM, MOV), die automatisch auf der Wall erscheinen. |

Position und Größe des Fotofensters lassen sich im Admin-Panel unter Einstellungen → „Fotofenster“ anpassen.

Fotos der Stationen, Uploads aus dem Admin-Panel und die Einstellungen liegen in `data/` (nicht im Git).

## Admin-Panel

- **Übersicht:** Adressen mit QR-Codes, verbundene Geräte, Fotostationen pausieren, Wall/Stationen neu laden.
- **Inhalte:** Bilder und Videos hochladen, ein-/ausblenden, betiteln, „Jetzt zeigen“ auf der Wall.
- **Fotos:** Alle Stations-Fotos; freigeben, von der Wall nehmen, löschen. Fotos ohne Zustimmung des Gastes
  können nicht auf die Wall gelegt werden.
- **Rahmen / Hintergründe:** hochladen, umbenennen, aktivieren, löschen.
- **Color Hunt:** öffnen/schließen, Teilnehmer und Fotos live, Sieger wählen und auf der Wall zeigen, neue Runde.
- **Einstellungen:** Titel, Farbe, Anzahl/Größe/Geschwindigkeit der Kacheln, Countdown, Color-Hunt-Zeit, Passwort,
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
