# Wall of Content

✨ **Zwei Designs:** „Neu“ (helles Admin-Panel mit Seitenleiste, Schriften Outfit + DM Sans; Wall als **schwebende Kacheln**
im neuen Look, **Bühne** oder **Mosaik**) und „Klassisch“ (alter Look für Wall und Admin-Panel). Umschalten unter
Einstellungen → Design oder pro Gerät mit `?design=klassisch`.

📖 **Dokumentation**

- [Anleitung mit Screenshots](docs/ANLEITUNG.md) – Bedienung von Wall, Fotostation, Color Hunt, Quiz, Besucher-App und Admin-Panel
- [Start auf dem Mac](docs/MAC.md) – per Doppelklick, ohne Installation ([als PDF zum Ausdrucken](docs/Wall-of-Content-Mac-Anleitung.pdf))
- [Technische Dokumentation](docs/TECHNIK.md) – Aufbau, Daten, API, Sicherheit

**Mac:** Ordner entpacken, `Start-Mac.command` doppelklicken. Blockiert macOS die Datei („Apple konnte nicht überprüfen …“):
Terminal öffnen, `bash ` tippen, die Datei ins Fenster ziehen, Enter ([Details](docs/MAC.md)).

Ein Bildschirm mit schwebenden Thumbnails (Bilder & Videos) – plus Fotostationen fürs Handy und ein Admin-Panel.

| Seite | Adresse | Zweck |
|---|---|---|
| **Wall** | `http://<laptop-ip>:3000/` | Großer Bildschirm. Thumbnails schweben herum, ein Klick/Tipp spielt Bild oder Video ab. |
| **Fotostation** | `https://<laptop-ip>:3443/station` | Handy/Tablet: Start → Rahmen wählen → Foto → QR-Code zum Download. |
| **Admin-Panel** | `http://<laptop-ip>:3000/admin` | Inhalte, Fotos, Color Hunt, Rahmen, Hintergründe, Einstellungen, Fernsteuerung. |
| **Color Hunt** | `http://<laptop-ip>:3000/hunt` | Gäste scannen den QR-Code auf der Wall und machen mit dem eigenen Handy mit. |
| **Quiz** | `http://<laptop-ip>:3000/quiz` | Quiz mit Rangliste für das iPad; zeigt die Wall, solange kein Quiz läuft. |
| **Besucher-App** | `http://<laptop-ip>:3000/app` | Auf den Handys der Gäste: Live-Programm, Challenges (QR-Schatzsuche, digitaler Rundgang mit Stempeln), Merch-Shop mit Coupons, Feedback. |
| **Verbund-Wall** | `http://<laptop-ip>:3000/?pos=1` … | Experimentell: mehrere iPads nebeneinander bilden eine große Wall. |

## Starten

```bash
npm install
```

```bash
npm start
```

Beim Start zeigt das Terminal alle Adressen und das **Startpasswort** für **David R.** (Global Admin) an. Es steht auch in
`admin-password.txt` im Datenordner (`~/Wall of Content Daten`). David R. vergibt im Admin-Panel unter **Benutzer** die Passwörter für David K., Emily B.,
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

Fotos der Stationen, Uploads, Benutzer, Einstellungen und eigene Rahmen/Hintergründe liegen im Ordner
**`~/Wall of Content Daten`** – außerhalb des Programmordners. Eine neu heruntergeladene Version findet sie automatisch; beim
ersten Start werden Daten älterer Versionen (`data/` im Programmordner oder ältere Wall-of-Content-Ordner in Downloads,
Schreibtisch, Dokumente) automatisch übernommen. Sicherung herunterladen/einspielen: Admin-Panel → System → 💾 Sicherung.

## Admin-Panel

- **🎭 Bühne:** Playlist (anpinnen, Reihenfolge, nur für die Bühne ausblenden, „▶ Jetzt“), Modus „Alle“ oder „Nur Playlist“,
  Knopf **„Alle Inhalte“** auf der Wall zum Stöbern mit Filtern und Hashtags.
- **📍 Moments (Live-Modus):** Die Redaktion (eigene Rolle) postet unter `/live` Fotos/Videos mit Text und Hashtags vom Handy.
  Optionen: sofort groß auf die Bühne, erst nach Freigabe, Live-Ticker im Band, Dauer des LIVE-Abzeichens, Hashtag-Vorschläge.
- **🎵 Läuft gerade:** drehende Schallplatte mit Songtitel und Cover auf der Wall – automatisch von diesem Rechner (Apps und
  Browser wie Spotify Web/YouTube Music; Linux, Mac, Windows), aus der Textdatei der DJ-Software (VirtualDJ automatisch) oder
  von Hand.
- **📡 Livestream:** OBS streamt direkt an die Wall (`rtmp://<laptop-ip>:1935/live` + Stream-Key aus dem Admin-Panel);
  Anzeige groß, auf der Bühne oder als Bild-im-Bild.
- **💾 Sicherung:** alle Daten als ZIP herunterladen, einspielen oder aus einem alten Ordner übernehmen (startet sich selbst neu).
- **🎬 Show:** die wichtigsten Schalter für die laufende Veranstaltung, jede Änderung wirkt sofort – Live-Steuerung der Wall,
  Color Hunt/Quiz/Stationen an/aus, Tempo, Kachelgröße, QR-Größe, Vorladen, DVD-Logo, Vollbild.
- **📦 Paket teilen:** die komplette Wall of Content als ZIP – App, alle Inhalte, Fotos, Einstellungen, Benutzer mit
  Passwörtern, Color Hunt, Quiz, Besucher-App. Empfänger entpackt, doppelklickt `Start-Mac.command`, alles ist drin.
  Passwörter nur als scrypt-Hash, kein Klartext, kein privater Schlüssel. Inhalte und Fotos lassen sich außerdem per
  **📤 Teilen** als QR-Code weitergeben.
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
| `MAX_UPLOAD_MB` | (keine) | Optionale Höchstgröße für Uploads; ohne Angabe zählt nur der freie Speicherplatz |

Wenn der QR-Code auf eine falsche Adresse zeigt (z. B. mehrere Netzwerke), im Admin-Panel unter
Einstellungen die „Öffentliche Adresse für QR-Codes“ setzen, z. B. `http://192.168.1.10:3000`.

Ohne HTTPS (oder wenn die Kamera nicht freigegeben wird) nutzt die Fotostation automatisch die
Kamera-App des Handys als Ersatz.

## Neu

- **Videos laufen zuverlässig:** Videoplayer werden freigegeben, Vorschaubilder automatisch erzeugt, die Wall pausiert
  während der Wiedergabe, nicht abspielbare Formate zeigen einen Hinweis.
- **Paket teilen:** komplette Wall of Content inklusive aller Inhalte und Passwörter (als Hash) als startklare ZIP.
- **Vorladen:** Bilder und Videos der Wall werden im Hintergrund geladen und starten beim Antippen sofort.
- **Hitboxen:** Kacheln prallen exakt an Titel-Schrift, QR-Codes, Logo und Rangliste ab.
- **Kompakte QR-Codes** auf der Wall (nebeneinander, Größe einstellbar) und ein QR-Code zum Mitnehmen im Viewer.
- **DVD-Logo** als Bildschirmschoner bei Inaktivität – mit Ecken-Modus, der garantiert alle 4 Ecken nacheinander trifft.
- **Vollbild-Knopf** auf allen Geräten außer der Besucher-App.

Details: [Anleitung, Kapitel 14–17](docs/ANLEITUNG.md#14-show-modus-alles-wichtige-auf-einen-blick).
