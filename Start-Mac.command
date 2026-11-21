#!/bin/bash
# ---------------------------------------------------------------------------
#  Wall of Content – Start für macOS
#
#  Im Finder doppelklicken (beim allerersten Mal: Rechtsklick -> „Öffnen“).
#  Das Skript
#    1. nimmt ein installiertes Node.js (ab Version 18) oder lädt Node.js
#       einmalig in den Ordner „.runtime“ herunter – es muss also nichts
#       installiert werden,
#    2. installiert beim ersten Start die benötigten Pakete,
#    3. startet den Server, hält den Mac wach und öffnet das Admin-Panel.
#
#  Beenden: dieses Fenster schließen oder Ctrl + C drücken.
#  Funktioniert auch unter Linux:  bash Start-Mac.command
# ---------------------------------------------------------------------------

NODE_VERSION="22.23.4"   # erprobte Version, wird nur geladen, wenn kein passendes Node da ist

cd "$(dirname "$0")" || exit 1
APP_DIR="$(pwd)"
RUNTIME="$APP_DIR/.runtime"

say()  { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[1;31m✖ %s\033[0m\n' "$*"
  echo
  echo "  Hilfe: docs/MAC.md im Ordner der Wall of Content."
  if [ -t 0 ]; then echo; read -r -p "Zum Schließen Enter drücken … " _; fi
  exit 1
}

echo
echo "  ================================="
echo "        Wall of Content – Start"
echo "  ================================="

# --- 1. Node.js finden oder herunterladen -----------------------------------
node_ok() {
  # $1 = Pfad zu node; true, wenn Version >= 18
  [ -x "$1" ] || return 1
  major="$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [ -n "$major" ] && [ "$major" -ge 18 ] 2>/dev/null
}

NODE_BIN=""
# WOC_EIGENES_NODE=1 erzwingt das mitgelieferte Node (hilft bei kaputtem/altem installierten Node)
if [ -x "$RUNTIME/node/bin/node" ] && node_ok "$RUNTIME/node/bin/node"; then
  NODE_BIN="$RUNTIME/node/bin/node"
elif [ "${WOC_EIGENES_NODE:-0}" = "1" ]; then
  :   # nichts suchen – unten wird heruntergeladen
elif command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
else
  # Homebrew-Pfade sind bei Doppelklick oft nicht im PATH
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if node_ok "$candidate"; then NODE_BIN="$candidate"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) fail "Unbekanntes Betriebssystem: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) fail "Unbekannter Prozessor: $(uname -m)" ;;
  esac
  name="node-v$NODE_VERSION-$os-$arch"
  base="https://nodejs.org/dist/v$NODE_VERSION"
  say "Node.js wird einmalig heruntergeladen ($name, ca. 50 MB) …"
  tmp="$(mktemp -d)" || fail "Kein temporärer Ordner verfügbar."
  curl -fL --progress-bar -o "$tmp/$name.tar.gz" "$base/$name.tar.gz" \
    || fail "Download von Node.js fehlgeschlagen. Ist der Mac mit dem Internet verbunden?"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" \
    || fail "Prüfsummen von Node.js konnten nicht geladen werden."
  expected="$(grep " $name.tar.gz\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp/$name.tar.gz" | cut -d' ' -f1)"
  else
    actual="$(sha256sum "$tmp/$name.tar.gz" | cut -d' ' -f1)"
  fi
  [ -n "$expected" ] && [ "$expected" = "$actual" ] \
    || fail "Der Download von Node.js ist beschädigt (Prüfsumme stimmt nicht). Bitte erneut starten."
  mkdir -p "$RUNTIME" && tar -xzf "$tmp/$name.tar.gz" -C "$tmp" \
    || fail "Node.js konnte nicht entpackt werden."
  # eine ältere Version beiseitelegen (landet im temporären Ordner)
  if [ -d "$RUNTIME/node" ]; then mv "$RUNTIME/node" "$tmp/old-node"; fi
  mv "$tmp/$name" "$RUNTIME/node" || fail "Node.js konnte nicht eingerichtet werden."
  NODE_BIN="$RUNTIME/node/bin/node"
  node_ok "$NODE_BIN" || fail "Node.js lässt sich nicht starten."
fi

export PATH="$(dirname "$NODE_BIN"):$PATH"
echo "  Node.js $("$NODE_BIN" -v)  ($NODE_BIN)"

# --- 2. Pakete installieren (nur beim ersten Start oder nach einem Update) ---
lock_hash() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 package-lock.json | cut -d' ' -f1
  else sha256sum package-lock.json | cut -d' ' -f1; fi
}
want="$(lock_hash)"
have="$(cat node_modules/.woc-installed 2>/dev/null)"
if [ ! -d node_modules ] || [ "$want" != "$have" ]; then
  say "Benötigte Pakete werden installiert …"
  npm ci --omit=dev --no-audit --no-fund || fail "Die Pakete konnten nicht installiert werden. Ist der Mac mit dem Internet verbunden?"
  echo "$want" > node_modules/.woc-installed
fi

# --- 3. Starten --------------------------------------------------------------
say "Server startet …"
echo "  Beenden: dieses Fenster schließen oder Ctrl + C drücken."
echo "  Fragt der Mac, ob „node“ eingehende Verbindungen annehmen darf: bitte „Erlauben“."

# Admin-Panel öffnen, sobald der Server antwortet
(
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    sleep 1
    if curl -fs -o /dev/null "http://localhost:${PORT:-3000}/api/state"; then
      if command -v open >/dev/null 2>&1; then open "http://localhost:${PORT:-3000}/admin"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${PORT:-3000}/admin" >/dev/null 2>&1
      fi
      break
    fi
  done
) &

if command -v caffeinate >/dev/null 2>&1; then
  # Mac während der Veranstaltung wach halten (Bildschirm und System)
  caffeinate -dims "$NODE_BIN" server.js
else
  "$NODE_BIN" server.js
fi
status=$?

# 130/143 = mit Ctrl + C bzw. Schließen beendet – das ist kein Fehler
if [ $status -ne 0 ] && [ $status -ne 130 ] && [ $status -ne 143 ]; then
  fail "Der Server wurde mit einem Fehler beendet (siehe Meldung oben)."
fi
if [ -t 0 ]; then echo; read -r -p "Server beendet. Zum Schließen Enter drücken … " _; fi
