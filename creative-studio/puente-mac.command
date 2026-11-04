#!/bin/bash
# DropEC Creative Studio — puente local gratuito (macOS).
# Vigila SOLO ~/Downloads/DropEC-Creativos/Entrada y envía PNGs a Supabase
# mediante cuatro enlaces temporales creados por el propietario en la app.
set -u
set -o pipefail
ROOT="$HOME/Downloads/DropEC-Creativos"
INBOX="$ROOT/Entrada"
DONE="$ROOT/Procesadas"
STATE="$ROOT/estado.txt"
mkdir -p "$INBOX" "$DONE"
echo "DropEC | Puente local (Mac)"
echo "1) En Creative Studio pulsa 'Preparar recepción automática para Mac'."
echo "2) Guarda las imágenes generadas en: $INBOX"
echo "3) Enviaremos automáticamente, en orden, portada, problema, solución, cierre."
echo "   Ctrl+C detiene el puente. NO se publican imágenes en redes."
echo ""
current=""
slot=0
while true; do
  manifest="$(find "$HOME/Downloads" -maxdepth 1 -type f -name 'DropEC-puente-*.json' -print | sort | tail -n 1)"
  if [ -z "$manifest" ]; then sleep 5; continue; fi
  id=$(/usr/bin/plutil -extract job_id raw -o - "$manifest" 2>/dev/null || true)
  if [ -z "$id" ]; then echo "Manifiesto inválido. Esperando…"; sleep 5; continue; fi
  if [ "$current" != "$id" ]; then
    current="$id"
    slot=0
    if [ -f "$STATE" ]; then
      saved="$(cat "$STATE")"
      case "$saved" in "$id:"*) slot="$(echo "$saved" | cut -d: -f2)";; esac
    fi
    echo "Producto en cola: $id | Próxima diapositiva: $((slot+1))"
  fi
  if [ "$slot" -ge 4 ]; then sleep 5; continue; fi
  url=$(/usr/bin/plutil -extract "uploads.$slot.url" raw -o - "$manifest" 2>/dev/null || true)
  case "$url" in
    https://ubxkqbnzdtgfvphwohzm.supabase.co/storage/v1/object/upload/sign/*) ;;
    *) echo "URL no válida o manifest caducado. Genera un manifiesto nuevo."; sleep 8; continue ;;
  esac
  file="$(find "$INBOX" -maxdepth 1 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) | sort | head -n 1)"
  if [ -z "$file" ]; then sleep 3; continue; fi
  before="$(wc -c < "$file" | tr -d ' ')"
  sleep 2
  after="$(wc -c < "$file" | tr -d ' ')"
  if [ "$before" != "$after" ] || [ "$after" -lt 1000 ]; then continue; fi
  tmp=""
  upload="$file"
  case "$file" in
    *.png|*.PNG) ;;
    *)
      tmp="$(mktemp -t dropec)"
      if ! /usr/bin/sips -s format png "$file" --out "$tmp" >/dev/null 2>&1; then
        echo "No se pudo convertir esta fotografía en PNG: $file"; rm -f "$tmp"; sleep 5; continue
      fi
      upload="$tmp"
      ;;
  esac
  echo "Subiendo diapositiva $((slot+1)) de 4…"
  if /usr/bin/curl --fail --silent --show-error --max-time 90 --request PUT --header 'Content-Type: image/png' --data-binary "@$upload" "$url" >/dev/null; then
    newname="slide-$((slot+1))-$(date +%s)-$(basename "$file")"
    mv "$file" "$DONE/$newname"
    slot=$((slot+1))
    printf "%s:%s\n" "$id" "$slot" > "$STATE"
    echo "Subida confirmada ($slot/4). Verifica la recepción en Creative Studio."
    if [ "$slot" -eq 4 ]; then echo "Carrusel completo. Esperando otro manifiesto."; fi
  else
    echo "No se pudo subir. Revisa conexión y vigencia (máximo 2 horas)."
    sleep 8
  fi
  [ -z "$tmp" ] || rm -f "$tmp"
done
