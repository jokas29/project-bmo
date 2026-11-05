#!/usr/bin/env bash
set -euo pipefail
# Official Google Fonts Anton, SIL Open Font License 1.1.
# This is a build-only download on the temporary GitHub runner.
# No font binary is committed or transmitted to end users.
url="https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf"
expected="4d65707db9d8663ccfa99cd28cd3a4e0025be178"
temporary="$(mktemp)"
trap 'rm -f "$temporary"' EXIT
curl --fail --location --silent --show-error --retry 2 --max-time 60 \
  --proto '=https' --tlsv1.2 "$url" --output "$temporary"
actual="$(git hash-object "$temporary")"
if [ "$actual" != "$expected" ]; then
  echo "Pinned open-source Anton font checksum mismatch" >&2
  exit 1
fi
directory="$HOME/.local/share/fonts/dropec"
mkdir -p "$directory"
install -m 0644 "$temporary" "$directory/Anton-Regular.ttf"
python3 - <<'PY'
from pathlib import Path
from PIL import ImageFont
p=Path.home()/".local/share/fonts/dropec/Anton-Regular.ttf"
font=ImageFont.truetype(str(p),90)
for text in ("MÁQUINA", "ELÉCTRICA", "NIÑO", "CAMIÓN", "ÁÉÍÓÚÜÑ"):
    assert font.getmask(text).getbbox(), text
print("Pinned Anton display font installed and Spanish accents verified")
PY
