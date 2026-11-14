#!/bin/bash
# Double-click in Finder to preview the site at http://localhost:8000
cd "$(dirname "$0")" || exit 1
exec python3 serve.py
