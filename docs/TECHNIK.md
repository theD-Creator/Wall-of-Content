# Wall of Content – Technische Dokumentation

Für alle, die die Wall of Content betreiben, anpassen oder weiterentwickeln. Die Bedienung steht in der
[Anleitung](ANLEITUNG.md), der Start auf dem Mac in [MAC.md](MAC.md).

---

## Überblick

```
                      ┌──────────────────────── Laptop / Mac ─────────────────────────┐
                      │  Node.js-Server (server.js, Express)                          │
  Wall (Beamer) ─────►│   • liefert die Seiten aus  public/                           │
  Fotostation ───────►│   • REST-API  /api/…                                          │
  Quiz-iPad ─────────►│   • Live-Updates per Server-Sent Events  /api/events          │
  Gäste-Handys ──────►│   • speichert alles in  data/  (JSON + Dateien)               │
  Admin-Panel ───────►│   • liest Rahmen, Hintergründe, Medien aus  assets/           │
                      └───────────────────────────────────────────────────────────────┘
```

- **Ein Prozess, keine Datenbank, keine Cloud.** Alles läuft lokal im WLAN; Internet wird nur für die Installation gebraucht.
- **Server:** Node.js ≥ 18 mit [Express](https://expressjs.com). Weitere Abhängigkeiten: `qrcode` (QR-Codes als SVG)
  und `selfsigned` (HTTPS-Zertifikat für die Kamera).
- **Clients:** reines HTML/CSS/JavaScript ohne Build-Schritt und ohne Framework.
- **Live-Updates:** Jede Seite hält eine Server-Sent-Events-Verbindung (`/api/events`). Der Server meldet Änderungen
  (`items`, `settings`, `hunt`, `quiz`, `devices`, `command`, `grid`); die Seiten laden daraufhin die betroffenen Daten neu.

## Ordner und Dateien

| Pfad | Inhalt |
|---|---|
| `server.js` | Der Server: Einstellungen, Speicherung, Anmeldung, API-Routen, Color Hunt, Quiz, Verbund-Wall |
| `lib/pack.js`, `lib/zip.js` | Paket teilen: komplette Wall of Content als ZIP (eigener ZIP-Schreiber mit ZIP64, ohne Zusatzpakete) |
| `lib/portal.js` | Besucher-App: Besucherprofile, Live-Programm, Challenges, Merch-Shop mit Coupons, Feedback |
| `public/` | Ausgelieferte Seiten: `wall.html`, `station.html`, `hunt.html`, `quiz.html`, `portal.html` (Besucher-App), `redeem.html` (Coupon einlösen), `admin.html` |
| `public/js/` | `common.js` (gemeinsame Helfer, Vollbild, Kopieren), `qrscan.js` (QR-Scanner), `wall.js`, `station.js`, `hunt.js`, `quiz.js`, `portal.js`, `redeem.js`, `admin.js`, `admin-portal.js`, `admin-show.js` (Show-Modus), `admin-pack.js` (Paket teilen), `admin-share.js` (Teilen-Dialog mit QR), `print.js` |
| `public/css/style.css` | Gemeinsames Stylesheet für alle Seiten (klassisches Design) |
| `public/css/neu.css` | Design „neu“ für Wall und Admin-Panel (greift nur bei `<html data-design="neu">`), Schriften Outfit + DM Sans |
| `assets/frames/` | Rahmen der Fotostation (werden automatisch erkannt) |
| `assets/backgrounds/` | Hintergründe – Bilder oder Videos (MP4/WebM) |
| `assets/media/` | Bilder/Videos, die automatisch auf der Wall erscheinen (Ordner wird überwacht) |
| `assets/avatars/` | Profilbilder der Admin-Benutzer |
| `assets/logo.svg` | Logo auf Wall, Station, Download-Seite und Admin-Panel |
| `data/` | **Laufzeitdaten** (nicht im Git) – siehe unten |
| `docs/` | Anleitungen und Screenshots |
| `Start-Mac.command` | Startskript für macOS (lädt bei Bedarf Node.js in `.runtime/`) |

### Laufzeitdaten in `data/`

| Datei/Ordner | Inhalt |
|---|---|
| `db.json` | Einstellungen, Liste aller Inhalte und Fotos, Color-Hunt-Teilnehmer, Quizfragen und Rangliste, Benutzer (Passwörter nur als scrypt-Hash) und unter `portal` die Besucher-App: Programm, Challenges, Stationen, erledigte Challenges, Besucherprofile, Shop-Artikel, Coupons, Feedback |
| `uploads/` | Hochgeladene Medien, Fotos der Stationen, Color-Hunt-Fotos, Vorschaubilder |
| `admin-password.txt` | Startpasswort des Global Admins – wird gelöscht, sobald er sein Passwort ändert |
| `https-key.pem`, `https-cert.pem` | Selbst erzeugtes HTTPS-Zertifikat (1 Jahr gültig, wird bei IP-Wechsel neu erzeugt) |

`db.json` wird bei jeder Änderung (gebündelt nach 150 ms) über eine temporäre Datei atomar geschrieben.

**Sichern:** Server stoppen, Ordner `data/` kopieren. **Zurücksetzen:** Server stoppen, `data/` wegsichern bzw. löschen, neu starten.

## Starten und Konfiguration

```bash
npm install
```

```bash
npm start
```

Für die Entwicklung startet `npm run dev` den Server mit automatischem Neustart bei Änderungen.

| Umgebungsvariable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port (Wall, Admin-Panel, Quiz, Color Hunt, Download-Seiten) |
| `HTTPS_PORT` | `3443` | HTTPS-Port mit selbst signiertem Zertifikat – nötig, damit Handy-Browser die Kamera freigeben. `0` schaltet HTTPS ab. |
| `ADMIN_PASSWORD` | – | Setzt beim Start das Passwort des Global Admins (Notfall-Zurücksetzung) |
| `LAN_IP` | automatisch | Adresse des Rechners im WLAN, falls die automatische Erkennung falsch liegt |
| `DATA_DIR` | `./data` | Speicherort der Laufzeitdaten |
| `ASSETS_DIR` | `./assets` | Ordner mit `frames/`, `backgrounds/`, `media/`, `avatars/` |
| `MAX_UPLOAD_MB` | `1024` | Maximale Größe von Medien- und Hintergrundvideo-Uploads im Admin-Panel |

Alle übrigen Einstellungen (Titel, Farben, Zeiten, Verbund-Wall …) werden im Admin-Panel gesetzt und in `db.json` gespeichert.
Für QR-Codes kann im Admin-Panel eine feste „Öffentliche Adresse“ eingetragen werden.

**Netzwerk:** Alle Geräte müssen den Rechner auf Port 3000 (und für die Fotostation 3443) erreichen. Firewall entsprechend
freigeben. WLANs mit „Client-Isolation“ (häufig Gäste-WLANs) funktionieren nicht.

## Seiten

| URL | Seite | Hinweise |
|---|---|---|
| `/` bzw. `/wall` | Wall | `?pos=N` = Teil N der Verbund-Wall, `?name=…` = Name in der Geräteliste |
| `/station` | Fotostation | über HTTPS (`:3443`) für die Live-Kamera; `?name=…` für den Stationsnamen |
| `/quiz` | Quiz-iPad | zeigt per eingebettetem Rahmen die Wall, solange das Quiz nicht gestartet ist; `?pos=N` wird an die Wall weitergegeben |
| `/hunt` | Color Hunt | auf den Handys der Gäste |
| `/admin` | Admin-Panel | Anmeldung erforderlich |
| `/p/:id` | Download-Seite eines Fotos | Ziel des QR-Codes an der Fotostation |
| `/app` | Besucher-App | Tabs per `#programm`, `#challenges`, `#shop`, `#feedback`; Kurzadressen `/programm`, `/challenges`, `/shop`, `/feedback` |
| `/c/:token` | Ziel der Challenge- und Stations-QR-Codes | schreibt gut und leitet zur Besucher-App weiter |
| `/einloesen/:code` | Einlöse-Seite für Coupons | nur für angemeldete Admins; Ziel des Coupon-QR-Codes |
| `/admin/print/qr/:id`, `/admin/print/station/:id`, `/admin/print/stations` | Druckansicht der QR-Codes (A4) | nur für angemeldete Admins |

## API

Alle Antworten sind JSON (außer QR-Codes als SVG). Fehler kommen als `{ "error": "…" }` mit passendem HTTP-Status.

### Öffentlich

| Methode und Pfad | Zweck |
|---|---|
| `GET /api/state` | Einstellungen (ohne interne Werte), Logo, Hintergrund, aktive Rahmen, Color-Hunt- und Quiz-Status |
| `GET /api/wall` | Inhalte, die auf der Wall gezeigt werden |
| `GET /api/events?role=wall\|station\|quiz\|admin` | Live-Ereignisse (Server-Sent Events); `admin` nur angemeldet |
| `POST /api/photos?share=0\|1&station=…&frame=…` | Foto einer Station hochladen (JPEG im Body, max. 12 MB) |
| `GET /api/photos/:id/qr.svg` | QR-Code zur Download-Seite |
| `GET /p/:id`, `GET /p/:id/download` | Download-Seite und Datei-Download |

### Color Hunt (Gäste)

Teilnehmer werden über ein HttpOnly-Cookie (`woc_hunt`) wiedererkannt – deshalb kann jedes Gerät nur einmal mitmachen.

| Methode und Pfad | Zweck |
|---|---|
| `GET /api/hunt/me` | Status, Countdown-Ende und eigener Spielstand |
| `POST /api/hunt/join` `{ name }` | Anmelden, Farbe wird zugeteilt (die am seltensten vergebene) |
| `POST /api/hunt/start` | Persönliche Zeit starten (endet spätestens mit dem Countdown) |
| `PUT /api/hunt/photos/:slot` | Foto für ein Feld hochladen (JPEG, wird im Browser verkleinert) |
| `POST /api/hunt/finish` | Abgeben |
| `GET /api/hunt/qr.svg` | QR-Code für die Wall |

### Quiz (iPad)

Punkte werden **auf dem Server** berechnet; das iPad bekommt die richtige Antwort erst nach dem Antworten.

| Methode und Pfad | Zweck |
|---|---|
| `GET /api/quiz/state` | Ob das Quiz läuft, Anzahl Fragen, Top 10 |
| `POST /api/quiz/start` `{ name }` | Neue Runde mit zufälligen Fragen; liefert Sitzungs-ID und erste Frage |
| `POST /api/quiz/answer` `{ session, answer }` | Antwort auswerten (100 Punkte + bis zu 100 Zeitbonus), nächste Frage bzw. Ergebnis mit Platz |

### Besucher-App (Gäste)

Gäste werden über ein HttpOnly-Cookie (`woc_visitor`, 60 Tage) wiedererkannt; das Profil wird beim ersten Aufruf angelegt.
Ein 8-stelliger Besucher-Code erlaubt das Mitnehmen auf ein anderes Gerät.

| Methode und Pfad | Zweck |
|---|---|
| `GET /api/v/state` | Alles für die App: Punkte, Programm, Challenges mit eigenem Fortschritt, Shop, eigene Coupons, eigenes Feedback |
| `POST /api/v/claim` `{ token }` | Gescannten Code einlösen (aus dem Scanner in der App); Ergebnis `ok`, `already`, `inactive` oder `invalid` |
| `POST /api/v/restore` `{ code }` | Fortschritt per Besucher-Code übernehmen (max. 10 Versuche / 10 Min) |
| `POST /api/v/feedback` `{ rating, text }` | Feedback abgeben oder ändern (eins pro Besucher) |
| `POST /api/v/shop/:id` | Coupon für einen Artikel holen (prüft Punkte und Bestand) |
| `GET /api/v/coupons/:id/qr.svg` | QR-Code eines eigenen Coupons |
| `GET /api/v/qr.svg` | QR-Code zur Besucher-App (für die Wall) |

### Admin (Anmeldung erforderlich)

| Bereich | Routen |
|---|---|
| Anmeldung | `GET /api/admin/users` (für die Auswahl, ohne Geheimnisse), `POST /api/admin/login` `{ userId, password }`, `POST /api/admin/logout`, `GET /api/admin/me`, `POST /api/admin/password` |
| Benutzer (nur Global Admin) | `POST /api/admin/users`, `PATCH /api/admin/users/:id` (Name, Rolle, Passwort), `DELETE /api/admin/users/:id`, `PUT /api/admin/users/:id/avatar` (auch für sich selbst) |
| Übersicht & Steuerung | `GET /api/admin/overview`, `GET /api/admin/qr.svg?text=…`, `PUT /api/admin/settings`, `POST /api/admin/command` (`reload`, `show`, `close`) |
| Inhalte | `POST /api/admin/media`, `PUT /api/admin/items/:id/thumb`, `PATCH /api/admin/items/:id`, `DELETE /api/admin/items/:id` |
| Rahmen & Hintergründe | `POST /api/admin/assets/:kind`, `PATCH /api/admin/assets/:kind/:file`, `DELETE /api/admin/assets/:kind/:file` |
| Color Hunt | `PUT /api/admin/hunt` (`active`, `countdownMinutes`, `extendMinutes`, `countdown: null`, `winnerId`, `showWinner`), `DELETE /api/admin/hunt/players/:id`, `POST /api/admin/hunt/reset` |
| Quiz | `PUT /api/admin/quiz` (`active`, `showBoard`), `POST/PUT/DELETE /api/admin/quiz/questions[/:id]`, `DELETE /api/admin/quiz/scores/:id`, `POST /api/admin/quiz/reset` |
| Besucher-App | `GET /api/admin/portal` (alle Daten + Auswertung), `POST /api/admin/portal/reset` (`what: progress \| feedback`) |
| Programm | `POST /api/admin/program`, `PUT/DELETE /api/admin/program/:id`, `POST /api/admin/program/:id/move` (`dir: -1 \| 1`), `POST /api/admin/program/sort` |
| Challenges | `POST /api/admin/challenges/qr`, `PUT/DELETE /api/admin/challenges/qr/:id`, `POST /api/admin/stations`, `PUT/DELETE /api/admin/stations/:id`, `POST /api/admin/stations/:id/move` |
| QR-Codes | `GET /api/admin/qrcode/:kind/:id.png` (Download), `POST /api/admin/qrcode/:kind/:id/renew` (neuer Code, alter wird ungültig) |
| Shop | `POST /api/admin/shop`, `PUT/DELETE /api/admin/shop/:id`, `PUT /api/admin/shop/:id/image` |
| Coupons | `GET /api/admin/coupons/:code`, `POST /api/admin/coupons/:code/redeem`, `POST /api/admin/coupons/:code/cancel` |
| Feedback | `PATCH /api/admin/feedback/:id` (`read`), `DELETE /api/admin/feedback/:id`, `GET /api/admin/feedback.csv` |

## Funktionsweise einzelner Teile

**Wall-Physik.** Jede Kachel ist ein Rechteck mit Masse proportional zur Fläche. Pro Bildschirm-Frame wird in
Teilschritten von 1/120 s gerechnet: Bewegung mit leichtem Schlängeln, Abprallen an den Rändern, Stöße zwischen
Kacheln entlang der geringsten Überlappung (elastischer Impuls, Überlappungen werden weich aufgelöst).
Inhalte öffnen sich ausschließlich durch Antippen oder per „Jetzt zeigen“ im Admin-Panel.

**Verbund-Wall (experimentell).** Ist mindestens ein Bildschirm mit `?pos=N` verbunden, rechnet der **Server** die
Physik für eine große Fläche (Spalten × Zeilen × Bildschirmformat) mit ca. 30 Schritten/s und sendet ca. 10×/s alle
Positionen. Jeder Bildschirm zeigt seinen Ausschnitt und rechnet zwischen zwei Meldungen weich weiter. Ohne
Verbund-Bildschirme läuft auf dem Server keine Physik.

**Color-Hunt-Countdown.** Das Ende wird als Zeitpunkt (`endsAt`) gespeichert. Ein Timer schließt den Color Hunt
beim Ablauf – auch nach einem Neustart des Servers. Die persönliche Zeit jedes Teilnehmers wird auf dieses Ende begrenzt;
Änderungen am Countdown erreichen die Gäste-Handys innerhalb von 8 Sekunden. Uploads werden noch 20 Sekunden nach
Ablauf angenommen, damit kurz vorher gemachte Fotos nicht verloren gehen.

**Challenges.** Jeder versteckte QR-Code und jede Station hat einen zufälligen 128-Bit-Schlüssel; der QR-Code enthält
die Adresse `/c/<Schlüssel>`. Beim Scannen prüft der Server den Schlüssel und speichert die Erledigung einmalig pro
Besucher (`portal.challenges.done`). Punkte = Summe der Erledigungen minus nicht stornierte Coupons. Der Rundgang-Bonus
wird vergeben, sobald alle aktuellen Stationen besucht sind. Gelöschte Stationen/Challenges nehmen bereits verdiente
Punkte nicht wieder weg.

**QR-Scanner** (`qrscan.js`). Über HTTPS bzw. `localhost` mit Live-Kamera (eingebauter `BarcodeDetector` oder
[jsQR](https://github.com/cozmo/jsQR), Apache-2.0, lokal unter `/vendor/jsQR.js`). Über HTTP – wo Browser keine
Live-Kamera erlauben – nimmt der Gast ein Foto, das im Browser mit jsQR ausgewertet wird.

**Shop und Coupons.** Ein Coupon bekommt einen 10-stelligen Code (`ABCDE-FGHIJ`, ohne verwechselbare Zeichen). Einlösen
kann nur ein angemeldeter Admin; dabei werden Zeitpunkt und Name gespeichert, ein zweites Einlösen wird abgelehnt.
Stornieren gibt Punkte und Bestand zurück.

**Feedback.** Gespeichert werden nur Bewertung, Text, Zeit und ein Hash des Besucherprofils (damit jedes Gerät eine
änderbare Bewertung hat) – keine Namen. Der CSV-Export schützt vor Formeln in Excel.

**Designs.** Die Einstellung `design` (`neu` | `klassisch`) steht in `/api/state`. `public/js/design.js` setzt
`data-design` schon im `<head>` (zuletzt gesehener Wert aus `localStorage` bzw. `?design=` in der Adresse),
`applyDesign()` in `common.js` gleicht ihn mit den Einstellungen ab. `neu.css` greift nur bei `data-design="neu"`,
dadurch bleibt das klassische Aussehen unverändert. Die Schriften kommen aus `@fontsource-variable/outfit` und
`@fontsource-variable/dm-sans` und werden lokal unter `/vendor/fonts/…` ausgeliefert.

**Wall-Layouts** (`public/js/wall-layouts.js`). Im Design „neu“ übergibt `wall.js` die Inhalte an ein Layout
(`wallLayout`: `buehne`, `mosaik`, `wechsel`) statt an die Physik. Ein Layout bekommt `update(items, {fresh})`,
`settings(settings, program, logo)`, `pause(on)` (während der Viewer offen ist) und `destroy()`. Viewer, Sieger,
Countdown, Rangliste, QR-Codes und DVD-Logo bleiben in `wall.js` und liegen über dem Layout. Das Programm-Band nutzt
`program` aus `/api/state`; Änderungen kommen per Live-Ereignis `program`. Die Verbund-Wall (`?pos=`) nutzt immer die
schwebenden Kacheln.

Beide Layouts passen Dateien ein, statt sie zu beschneiden oder aufzublasen: `capUpscale()` begrenzt die Vergrößerung
kleiner Dateien auf das Doppelte; im Mosaik bekommen Kacheln mit stark abweichendem Seitenverhältnis die Klasse `fit`
(ganzes Bild + unscharfer Hintergrund). Ist der Bildschirm hochkant (Breite/Höhe < 1,05), bekommt die Bühne die Klasse
`portrait`. Die Leiste zeigt nur Karten, die ganz hineinpassen (`fitRail()`). Die Gästeseiten binden `neu.css` und
`design.js` ebenfalls ein; `applyTheme()` ruft `applyDesign()` auf.

**DVD-Logo.** `dvdBounds()` ermittelt beim Laden des Logos über ein Canvas den sichtbaren Bereich ohne durchsichtigen
Rand. Die CSS-Maske wird so skaliert und verschoben, dass genau dieser Bereich die Box füllt. Dadurch stimmen die
Eckentreffer im Ecken-Modus auch optisch.

**Fotostation.** Das Foto wird im Browser zusammengesetzt: Bei deckenden Rahmen kommt das Kamerabild in das
Fotofenster (Position in den Einstellungen), bei transparenten Rahmen liegt der Rahmen über dem Foto. Hochgeladen wird
das fertige JPEG. Ohne Kamera-Freigabe wird die Kamera-App des Geräts über ein Datei-Eingabefeld verwendet.

## Neu: Show-Modus, Teilen, Vorladen, Hitboxen, DVD-Logo

### Paket teilen (`lib/pack.js`, `lib/zip.js`)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/admin/package/info` | Größen, Anzahl Inhalte/Fotos/Benutzer, Warnungen (Startpasswort aktiv, Benutzer ohne Passwort) – nur Global Admin |
| GET | `/api/admin/package.zip?photos=1&node=1` | ZIP als Stream – nur Global Admin, immer nur ein Export gleichzeitig |
| GET | `/js/qrcode.js` | Paket `qrcode`, beim ersten Abruf für den Browser gebündelt (`window.QRLite.svg()`, Teilen-Dialog) |

Inhalt der ZIP (Ordner `Wall-of-Content/`): `server.js`, `package*.json`, `README.md`, `Start-Mac.command`, `lib/`,
`public/`, `docs/`, `node_modules/` (inkl. `.woc-installed`, daher kein `npm ci`), `assets/`, `data/uploads/` und eine
aufbereitete `data/db.json`; optional `.runtime/node/bin/node`. Ausgelassen: `admin-password.txt`, `https-*.pem`,
`.DS_Store`, Symlinks. In der db.json wird `publicUrl` geleert; ohne Gäste-Fotos werden Foto-Einträge entfernt und
Color-Hunt-Fotos geleert. Passwörter bleiben scrypt-Hashes (Salt + 32 Byte), daher gelten beim Empfänger dieselben
Passwörter. Passt das mitgelieferte Node nicht zur Prozessor-Architektur, lädt `Start-Mac.command` das passende.

`ZipWriter`: berechnet CRC32 (nativ `zlib.crc32` ab Node 22.2) und Größe vorab und schreibt keine Data-Descriptors
(verträglich mit dem macOS-Archivprogramm); Textdateien und das Node-Programm werden asynchron im Thread-Pool
komprimiert, Medien unkomprimiert gestreamt; ZIP64 automatisch über 4 GB; Unix-Rechte bleiben erhalten
(`Start-Mac.command` ist nach dem Entpacken ausführbar). Getestet mit `unzip -t` und `ditto -x -k`, ZIP64 erzwungen.

### Weitere Endpunkte und Einstellungen

- `GET /api/items/:id/qr.svg` – QR-Code zur Download-Seite eines Inhalts (Viewer der Wall). `/p/:id` zeigt jetzt neben
  Fotos auch Bilder/Videos, solange sie auf der Wall sind.
- `POST /api/admin/command` kennt zusätzlich `random`, `dvd` und `wake`.
- `GET /api/state` liefert `settingsVersion`; ändert sie sich, holt die Wall ihre QR-Codes neu.
- Neue Einstellungen: `preloadMedia`, `qrSize` (50–200 %), `autoFullscreen`, `viewerQr`, `dvdMode`, `dvdCorners`,
  `dvdIdle` (Minuten), `dvdSpeed`.

### Wall: Videos, Vorladen, Hitboxen, DVD-Logo (`public/js/wall.js`)

- **Videoplayer freigeben:** Entfernte Kacheln und geschlossene Viewer rufen `pause()`, entfernen `src` und `load()`.
  Vorher blieben Player bis zur Speicherbereinigung bestehen; Chrome erlaubt nur begrenzt viele gleichzeitig (Android ~40),
  danach starteten Videos nicht mehr.
- **Viewer:** kein `backdrop-filter` mehr (wurde jedes Frame neu berechnet, während die Kacheln darunter liefen –
  Videos ruckelten); die Physik pausiert, solange ein Inhalt offen ist. Fehler zeigen einen Hinweis statt sofort zu
  schließen; vorgeladener Blob fällt bei Fehlern auf die Server-Adresse zurück; Autoplay ohne Ton → stumm + „Tippen für Ton“.
- **Vorladen (`Preload`):** Bilder über `Image.decode()`, Videos bis zu einer Größengrenze als Blob im Speicher
  (Budget nach `navigator.deviceMemory`, auf iPad/iPhone 160 MB), größere Videos puffern in einem versteckten
  `<video preload="auto">`, das beim Öffnen direkt weiterverwendet wird. Sichtbare Kacheln zuerst, Bilder vor Videos;
  während ein nicht vorgeladenes Video läuft, pausiert das Vorladen.
- **Vorschaubilder:** Das Admin-Panel erzeugt fehlende Vorschaubilder (Video-Standbild per Canvas) automatisch.
- **Hitboxen:** `measureObstacles()` misst Titel und Untertitel pro Textzeile (`Range.getClientRects()`, Höhe über
  `measureText` auf die echte Schrift zugeschnitten) sowie QR-Kästen, Logo und Rangliste. Lücken zum Rand oder zwischen
  Hindernissen, in die keine Kachel passt, werden mit gefüllt, damit nichts eingeklemmt wird. Hindernisse sind unbeweglich.
- **DVD-Logo:** eigene Animationsschleife, die Wall-Physik ruht solange. Logo per CSS-`mask` eingefärbt. Ecken-Modus:
  Jede Strecke von Ecke *i* zu Ecke *i+1* wird „aufgefaltet“ geplant (z. B. oben links → oben rechts: Δx = W, Δy = 2·m·H mit
  m ∈ {1,2,3}); die Position ergibt sich durch Zurückfalten (Dreieckswelle), dadurch landet das Logo exakt in der Ecke.

### Vollbild (`common.js`)

`Fullscreen.install()` fügt auf allen Seiten außer Besucher-App, Download- und Teilen-Seite einen Knopf ein (nur wenn
die Fullscreen-API vorhanden ist, auch `webkit`-Variante), Taste F schaltet um. `Fullscreen.auto()` fordert bei
`autoFullscreen` beim ersten `pointerup` Vollbild an.

## Sicherheit

- **Passwörter** werden mit scrypt und zufälligem Salt gespeichert; der Vergleich läuft in konstanter Zeit.
- **Admin-Sitzungen:** zufälliges Token im Cookie `woc_admin` (`HttpOnly`, `SameSite=Strict`), 12 Stunden gültig,
  nur im Arbeitsspeicher – nach einem Neustart des Servers muss man sich neu anmelden. Beim Passwortwechsel werden
  andere Sitzungen desselben Benutzers beendet.
- **Rollen:** Nur der Global Admin darf Benutzer anlegen, löschen und Passwörter vergeben – das prüft der Server.
- **Schutz vor fremden Seiten:** Ändernde Admin-Anfragen werden nur von derselben Herkunft (`Origin`) angenommen.
- **Begrenzungen:** Anmeldeversuche (10 pro 10 Minuten und Gerät), Passwortänderungen, Fotos, Color-Hunt- und
  Quiz-Anfragen, neue Besucherprofile, Scans, Käufe, Feedback und Besucher-Code-Eingaben sind mengenbegrenzt.
- **Uploads:** Dateityp wird geprüft (Fotos müssen echte JPEGs sein), Größen sind begrenzt, Dateinamen erzeugt der
  Server selbst. Hochgeladene Dateien werden mit einer strengen Content-Security-Policy (`sandbox`) ausgeliefert.
- **Seiten:** Content-Security-Policy ohne fremde Skripte, `X-Frame-Options: SAMEORIGIN`, `nosniff`, kein Referrer.
- **Datenschutz:** Fotos ohne Haken „auf der Wall anzeigen“ erscheinen nie auf der Wall, sind aber über ihren
  (nicht erratbaren) Download-Link erreichbar. Optional werden Fotos nach X Stunden automatisch gelöscht (Einstellungen).

Die Wall of Content ist für ein **vertrauenswürdiges lokales Netz** gedacht. Nicht ohne zusätzlichen Schutz
(z. B. Reverse-Proxy mit echtem Zertifikat) ins Internet stellen.

## Grenzen

- Quiz-Runden und Admin-Sitzungen liegen im Arbeitsspeicher; ein Neustart beendet laufende Quizrunden.
- Ausgelegt für eine Veranstaltung mit einigen hundert Gästen (max. 2000 Live-Verbindungen; Besucher-Handys laden bei
  Änderungen leicht zeitversetzt nach, damit der Laptop nicht überlastet wird).
- Das HTTPS-Zertifikat ist selbst signiert; Browser zeigen beim ersten Aufruf der Fotostation eine Warnung.
