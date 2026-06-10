#!/usr/bin/env python3
"""Compatibility shim — the old studio entrypoint now boots the new Flask studio.

The long-lived Render service (`fai-banner-studio`) was created before
render.yaml blueprints and its dashboard start command launches
`scripts/banner_studio.py`. The hand-rolled http.server studio that used to
live here was retired in the June 2026 rebuild (see scripts/_retired/), so
this file now simply serves the current Flask app from fai_studio.py on the
same entrypoint. Local users should run `python scripts/fai_studio.py`.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fai_studio import app  # noqa: E402

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8765)))
