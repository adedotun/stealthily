#!/bin/zsh
# Build the ScreenCaptureKit system-audio helper and sign it with the
# local Apple Development identity so its Screen Recording grant stays
# stable across rebuilds. An ad-hoc binary gets TCC error -3801.
set -e
cd "$(dirname "$0")"
mkdir -p build
swiftc -O main.swift -o build/sysaudio \
  -framework ScreenCaptureKit -framework AVFoundation \
  -framework CoreMedia -framework CoreGraphics
IDENTITY=$(security find-identity -v -p codesigning | grep 'Apple Development' | head -1 | sed -E 's/^.*"(.*)".*$/\1/')
if [ -n "$IDENTITY" ]; then
  codesign -s "$IDENTITY" --force build/sysaudio
  echo "Signed with: $IDENTITY"
else
  echo "WARNING: no Apple Development identity found; helper left ad-hoc and ScreenCaptureKit will refuse capture (TCC -3801)."
fi
echo "Built build/sysaudio"
