#!/usr/bin/env bash
# Dusky SAM - Clipboard-to-TTS wrapper
# Usage: ./run.sh [options] [text...]
#        ./run.sh (reads from clipboard)
#        ./run.sh --sing --pitch 76 "ohohoh"
#        ./run.sh --json song.json
#
# Requires: node, mpv, wl-paste (Wayland) or xclip (X11)
#
# Options:
#   --sing, -s         Enable singing mode
#   --pitch, -P <n>     Voice pitch (default: 64)
#   --speed, -S <n>     Speed (default: 72, lower = slower)
#   --json, -j <file>   Sing from JSON song file

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Run the Node.js script with all arguments
exec node index.js "$@"
