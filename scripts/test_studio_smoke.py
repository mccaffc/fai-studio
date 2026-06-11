#!/usr/bin/env python3
"""Flask smoke checks for the banner studio generation endpoint."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_studio import app  # noqa: E402


def test_generate_all_color_modes() -> None:
    client = app.test_client()
    for mode in ("full", "duotone", "vertical", "extended"):
        payload = {
            "color_mode": mode,
            "vertical_hex": "#4997D0",
            "candidates": 8,
            "keep": 1,
            "seed": 202606,
        }
        if mode == "extended":
            payload["extra_hex"] = ["#7150D6"]
            payload["allow_unratified_hex"] = True
        response = client.post("/generate", json=payload)
        assert response.status_code == 200, (mode, response.get_data(as_text=True))
        data = response.get_json()
        assert data["banners"], mode
        assert "<svg" in data["banners"][0]["svg"]


if __name__ == "__main__":
    test_generate_all_color_modes()
    print("studio smoke: all 4 color modes returned 200")
