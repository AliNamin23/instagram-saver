#!/bin/bash
# Starts Instagram Saver. Keep this Terminal window open while you use the app; close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")"
clear
echo "=============================================="
echo "  Instagram Saver"
echo "  Keep this window open while you use the app."
echo "  Close it, or press Ctrl+C, to stop."
echo "=============================================="
if [ ! -d venv ]; then
  echo "First-time setup (about a minute)..."
  python3 -m venv venv
fi
./venv/bin/pip install --quiet --upgrade gallery-dl imageio-ffmpeg >/dev/null 2>&1
./venv/bin/python app.py
echo
echo "Instagram Saver has stopped. Press Return to close this window."
read -r
