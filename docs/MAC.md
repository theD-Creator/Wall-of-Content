# Wall of Content auf dem Mac starten

Diese Anleitung ist für alle, die die Wall of Content auf einem **Mac** (MacBook, iMac, Mac mini) laufen lassen wollen –
auch ohne Programmierkenntnisse. Es muss **nichts installiert** werden: Das Startskript lädt beim ersten Mal alles
Nötige selbst herunter.

Läuft alles, geht es mit der normalen [Anleitung](ANLEITUNG.md) weiter (Admin-Panel, Wall, Fotostation, Quiz …).

**Voraussetzungen**

- macOS 11 (Big Sur) oder neuer, Apple-Chip (M1–M4) oder Intel
- Beim **ersten Start** Internet (ca. 60 MB Download). Danach läuft alles auch ohne Internet – nur das WLAN für die
  Geräte vor Ort wird gebraucht.

---

## Kurzfassung

1. Code als ZIP herunterladen und entpacken.
2. Im entpackten Ordner **`Start-Mac.command`** mit **Rechtsklick → Öffnen** starten.
3. Warten, bis sich das Admin-Panel im Browser öffnet. Fertig.

---

## Schritt für Schritt

### 1. Herunterladen und entpacken

1. Diesen Link öffnen – der Download startet sofort:
   <https://github.com/theD-Creator/Wall-of-Content/archive/refs/heads/claude/wall-of-content-photo-stations-blixdl.zip>

   Erscheint stattdessen „404 – Page not found“, ist das Repository privat: zuerst bei
   [github.com](https://github.com) mit einem Konto anmelden, das Zugriff auf das Repository hat, und den Link dann
   erneut öffnen. Alternativ kann jemand mit Zugriff die ZIP-Datei herunterladen und weitergeben (z. B. per AirDrop
   oder USB-Stick).
2. Die ZIP-Datei im Ordner **Downloads** doppelklicken. Es entsteht ein Ordner wie
   `Wall-of-Content-claude-wall-of-content-photo-stations-blixdl`.
3. Den Ordner an einen festen Ort ziehen, z. B. in **Dokumente**, und am besten in **Wall of Content** umbenennen.
   (Bitte nicht im Papierkorb oder auf einem USB-Stick lassen.)

### 2. Starten

Im Ordner liegt die Datei **`Start-Mac.command`**.

**Beim allerersten Mal** blockiert macOS Dateien aus dem Internet. So startest du sie trotzdem:

- **macOS 14 (Sonoma) und älter:** **Rechtsklick** (oder Ctrl + Klick) auf `Start-Mac.command` → **Öffnen** →
  im Hinweisfenster noch einmal **Öffnen**.
- **macOS 15 (Sequoia) und neuer:** Doppelklicken → die Meldung „… wurde nicht geöffnet“ mit **Fertig** schließen →
  **Systemeinstellungen → Datenschutz & Sicherheit** → ganz unten bei „Start-Mac.command wurde blockiert“ auf
  **Dennoch öffnen** klicken → mit Passwort/Touch ID bestätigen.

Ab dann reicht ein **Doppelklick**.

Es öffnet sich ein **Terminal-Fenster** (schwarzes Fenster mit Text). Beim ersten Start passiert dort:

```
▶ Node.js wird einmalig heruntergeladen (node-v22.23.4-darwin-arm64, ca. 50 MB) …
▶ Benötigte Pakete werden installiert …
▶ Server startet …

  Wall of Content läuft

  Wall (Bildschirm):   http://localhost:3000/        (im Netzwerk: http://192.168.178.34:3000/)
  Fotostation (Handy): https://192.168.178.34:3443/station
  Admin-Panel:         http://localhost:3000/admin   (im Netzwerk: http://192.168.178.34:3000/admin)
  Color Hunt (Gäste):  http://192.168.178.34:3000/hunt
  Quiz (iPad):         http://192.168.178.34:3000/quiz

  Anmeldung im Admin-Panel als David R. (Global Admin)
  Passwort:            Ab3xY7kQ9zLm   (Startpasswort, steht auch in data/admin-password.txt)
```

Danach öffnet sich automatisch das **Admin-Panel** im Browser.

> **Das Terminal-Fenster offen lassen!** Solange es offen ist, läuft die Wall of Content. Der Mac geht in dieser Zeit
> nicht in den Ruhezustand.

### 3. Netzwerkzugriff erlauben

Beim ersten Start fragt macOS eventuell:

> *Soll das Programm „node“ eingehende Netzwerkverbindungen akzeptieren?*

→ **Erlauben** klicken. Sonst können iPads, Handys und der große Bildschirm den Mac nicht erreichen.

Falls du versehentlich „Ablehnen“ geklickt hast: **Systemeinstellungen → Netzwerk → Firewall → Optionen** → bei
„node“ auf **Eingehende Verbindungen erlauben** stellen.

### 4. Beenden

Im Terminal-Fenster **Ctrl + C** drücken oder das Fenster einfach schließen. Alle Fotos, Einstellungen, Benutzer und
Ranglisten bleiben im Ordner **`data`** gespeichert und sind beim nächsten Start wieder da.

---

## Die Adresse des Macs im WLAN

Die anderen Geräte brauchen die Adresse des Macs, z. B. `192.168.178.34`. Sie steht

- im Terminal-Fenster (Zeile „im Netzwerk: …“),
- im Admin-Panel unter **Übersicht** (dort mit QR-Codes zum Abscannen),
- in **Systemeinstellungen → WLAN → Details…** (neben dem verbundenen Netz) → **IP-Adresse**.

Ist dort eine falsche Adresse zu sehen (z. B. wenn ein VPN läuft), VPN ausschalten und neu starten – oder die Adresse
fest vorgeben, siehe [Für Fortgeschrittene](#für-fortgeschrittene).

---

## Tipps für den Veranstaltungstag

- **Netzteil anschließen.** Das Startskript hält den Mac zwar wach, aber im Akkubetrieb kann macOS trotzdem schlafen gehen.
- **Deckel offen lassen** (außer der Mac hängt an einem externen Bildschirm mit Tastatur).
- **Mitteilungen ausschalten:** Kontrollzentrum → **Nicht stören**, damit keine Pop-ups auf der Wall erscheinen.
- Läuft die **Wall auf demselben Mac** (z. B. per HDMI am Beamer): `http://localhost:3000/` in Safari oder Chrome
  öffnen, Fenster auf den Beamer ziehen, Taste **F** für Vollbild.
- **Sicherung:** Nach der Veranstaltung den Ordner **`data`** kopieren – darin sind alle Fotos.

---

## Aktualisieren auf eine neue Version

1. Neue ZIP herunterladen und entpacken (wie oben).
2. Aus dem **alten** Ordner den Ordner **`data`** in den **neuen** Ordner kopieren
   (dort sind Fotos, Einstellungen, Benutzer und Passwörter gespeichert).
3. Den neuen `Start-Mac.command` starten. Fehlende Pakete werden automatisch nachinstalliert.

Hast du eigene Bilder in `assets/frames`, `assets/backgrounds` oder `assets/media` gelegt, diese ebenfalls mitkopieren.

---

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| „Start-Mac.command kann nicht geöffnet werden, da Apple nicht prüfen kann …“ | Siehe [Starten](#2-starten): Rechtsklick → Öffnen bzw. „Dennoch öffnen“ in Datenschutz & Sicherheit. |
| Doppelklick öffnet die Datei in einem Texteditor | Rechtsklick → **Öffnen mit → Terminal**. |
| „Permission denied“ / „Keine Berechtigung“ | Plan B unten verwenden. |
| „Download von Node.js fehlgeschlagen“ | Beim ersten Start wird Internet gebraucht. WLAN prüfen und erneut starten. |
| „Port 3000 ist schon belegt“ | Die Wall of Content läuft schon in einem anderen Terminal-Fenster – dieses benutzen oder schließen. |
| iPads/Handys erreichen den Mac nicht | Gleiches WLAN? Netzwerkzugriff für „node“ erlaubt (siehe oben)? Im Gäste-WLAN mancher Router sind Geräte voneinander abgeschirmt – dann ein anderes WLAN oder einen eigenen Router verwenden. |
| Fotostation am iPhone zeigt keine Kamera | Adresse muss mit `https://` und `:3443` beginnen. Bei der Warnung in Safari **Details einblenden → diese Website besuchen** wählen. Klappt die Live-Kamera trotzdem nicht, öffnet der Auslöser automatisch die normale Kamera-App. |
| Das Admin-Panel öffnet sich nicht von selbst | Im Browser `http://localhost:3000/admin` eingeben. |
| Passwort vergessen | Siehe [Für Fortgeschrittene](#für-fortgeschrittene). |

### Plan B: Start über das Terminal

Funktioniert der Doppelklick gar nicht, geht es immer so:

1. Das Programm **Terminal** öffnen (Spotlight: `Cmd + Leertaste`, „Terminal“ tippen, Enter).
2. `bash ` eintippen (mit Leerzeichen am Ende).
3. Die Datei **`Start-Mac.command`** aus dem Finder ins Terminal-Fenster **ziehen** – der Pfad wird eingefügt.
4. **Enter** drücken.

### Plan C: Mit installiertem Node.js

1. Node.js von <https://nodejs.org> herunterladen (Version „LTS“, Datei `.pkg`) und installieren.
2. Im Terminal in den Ordner wechseln (`cd ` tippen, Ordner hineinziehen, Enter) und dann:

```bash
npm install
```

```bash
npm start
```

---

## Für Fortgeschrittene

Im Terminal lassen sich beim Start Optionen mitgeben. Dafür im Terminal in den Ordner wechseln
(`cd ` tippen, Ordner hineinziehen, Enter) und z. B.:

| Befehl | Wirkung |
|---|---|
| `ADMIN_PASSWORD=neuesPasswort ./Start-Mac.command` | Setzt das Passwort des Global Admins (David R.) – hilft, wenn es vergessen wurde. |
| `LAN_IP=192.168.178.34 ./Start-Mac.command` | Gibt die Adresse des Macs im WLAN fest vor. |
| `PORT=3001 ./Start-Mac.command` | Anderen Port verwenden. |
| `WOC_EIGENES_NODE=1 ./Start-Mac.command` | Lädt ein eigenes Node.js herunter, auch wenn schon eines installiert ist (bei Problemen mit einer alten Node-Installation). |

Das heruntergeladene Node.js liegt im versteckten Ordner `.runtime` im Projektordner und betrifft den Rest des Macs nicht.
Zum Entfernen genügt es, den ganzen Ordner der Wall of Content zu löschen.
