#!/usr/bin/env bash
# Rasterize the icon SVGs into the PNGs the manifest and iOS need.
set -euo pipefail
cd "$(dirname "$0")/../public/icons"

rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-icon.png
rsvg-convert -w 64 -h 64 icon.svg -o favicon-64.png
rsvg-convert -w 512 -h 512 maskable.svg -o maskable-512.png

echo "icons written:"
ls -la *.png
