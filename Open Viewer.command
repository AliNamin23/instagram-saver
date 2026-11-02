#!/bin/bash
# Opens the saved-posts viewer. Works offline; keep this file inside the downloads folder.
cd "$(dirname "$0")"
python3 viewer_server.py
