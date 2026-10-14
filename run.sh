#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3.11 -m venv .venv
fi
.venv/bin/python -m pip install -q -r requirements.txt
exec .venv/bin/python -m uvicorn app.server:app --host 127.0.0.1 --port 8000
