#!/usr/bin/env python3
"""
Local FAI Banner Studio

Runs a small local web app for interactively previewing, saving, and refining
banner generation requests without using the CLI directly.

Usage:
  .venv/bin/python scripts/banner_studio.py
  .venv/bin/python scripts/banner_studio.py --port 8787 --no-browser
"""

import argparse
import json
import re
import sys
import threading
import traceback
import webbrowser
from dataclasses import asdict
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_banner as banner

BASE_DIR = Path(__file__).resolve().parent.parent
STUDIO_DIR = BASE_DIR / "studio"
DEFAULT_REQUESTS_DIR = BASE_DIR / "output" / "banner-requests"


def clean_string(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_optional_int(value):
    if value in (None, ""):
        return None
    return int(value)


def parse_optional_float(value):
    if value in (None, ""):
        return None
    return float(value)


def normalize_string_list(value) -> list[str]:
    if value in (None, ""):
        return []

    if isinstance(value, list):
        raw_values = []
        for item in value:
            raw_values.extend(str(item).replace("\n", ",").split(","))
    else:
        raw_values = str(value).replace("\n", ",").split(",")

    return [item.strip() for item in raw_values if item and item.strip()]


def parse_dimensions(payload: dict) -> tuple[int, int]:
    explicit = payload.get("dimensions")
    if isinstance(explicit, (list, tuple)) and len(explicit) == 2:
        return banner.normalize_dimensions(explicit)

    width = parse_optional_int(payload.get("width"))
    height = parse_optional_int(payload.get("height"))
    if width is None and height is None:
        return (1920, 960)
    return (
        width if width is not None else 1920,
        height if height is not None else 960,
    )


def request_from_payload(payload: dict) -> banner.BannerRequest:
    continuity_strength = parse_optional_float(payload.get("continuity_strength"))
    symmetry_strength = parse_optional_float(payload.get("symmetry_strength"))
    rhythm_strength = parse_optional_float(payload.get("rhythm_strength"))
    candidate_count = parse_optional_int(payload.get("candidate_count"))

    return banner.BannerRequest(
        name=clean_string(payload.get("name")),
        energy=clean_string(payload.get("energy")) or "medium",
        seed=parse_optional_int(payload.get("seed")),
        dimensions=parse_dimensions(payload),
        color_bias=clean_string(payload.get("color_bias")),
        topic_description=clean_string(payload.get("topic_description")),
        continuity_strength=0.7 if continuity_strength is None else continuity_strength,
        symmetry_strength=0.85 if symmetry_strength is None else symmetry_strength,
        rhythm_strength=0.75 if rhythm_strength is None else rhythm_strength,
        template=clean_string(payload.get("template")),
        candidate_count=24 if candidate_count is None else candidate_count,
        primary_families=normalize_string_list(payload.get("primary_families")),
        accent_families=normalize_string_list(payload.get("accent_families")),
        tile_ids=normalize_string_list(payload.get("tile_ids")),
    ).normalized()


def relative_display_path(path: Path) -> str:
    try:
        return str(path.relative_to(BASE_DIR))
    except ValueError:
        return str(path)


def next_request_index(request_dir: Path) -> int:
    highest = 0
    for json_path in request_dir.glob("request-*.json"):
        match = re.match(r"request-(\d+)", json_path.stem)
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


def default_request_path(request_dir: Path, request: banner.BannerRequest) -> Path:
    index = next_request_index(request_dir)
    parts = [f"request-{index:03d}"]
    if request.name:
        parts.append(banner.slugify(request.name))
    return request_dir / f"{'-'.join(parts)}.json"


def recent_generations(output_dir: Path, limit: int = 10) -> list[dict]:
    items = []
    for json_path in output_dir.glob("banner-*.json"):
        try:
            with open(json_path) as handle:
                sidecar = json.load(handle)
        except Exception:
            continue

        svg_path = json_path.with_suffix(".svg")
        label = sidecar.get("request", {}).get("name") or svg_path.stem
        sort_key = sidecar.get("generated_at") or str(json_path.stat().st_mtime)
        items.append(
            {
                "label": label,
                "svg_path": relative_display_path(svg_path),
                "json_path": relative_display_path(json_path),
                "energy": sidecar.get("energy"),
                "template": sidecar.get("template"),
                "score": sidecar.get("score"),
                "generated_at": sidecar.get("generated_at"),
                "_sort_key": sort_key,
            }
        )

    items.sort(key=lambda item: item["_sort_key"], reverse=True)
    return [{k: v for k, v in item.items() if k != "_sort_key"} for item in items[:limit]]


class BannerStudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STUDIO_DIR), **kwargs)

    def log_message(self, format, *args):
        message = format % args
        print(f"[banner-studio] {message}")

    def send_json(self, payload: dict, status: int = HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Request body must be a JSON object")
        return data

    def api_options(self):
        manifest = banner.load_manifest(self.server.manifest_path)
        payload = banner.generator_options(manifest)
        payload["history"] = recent_generations(self.server.output_dir)
        self.send_json(payload)

    def send_generation_response(self, request: banner.BannerRequest, save_output: bool, topic_style: dict | None = None):
        result, banner_root = banner.generate_banner(
            manifest_path=self.server.manifest_path,
            tiles_dir=self.server.tiles_dir,
            request=request,
        )

        svg_markup = etree.tostring(
            banner_root,
            encoding="unicode",
            pretty_print=True,
        )

        saved = {}
        if save_output:
            svg_path = banner.default_single_output_path(self.server.output_dir, request, result)
            banner.write_banner_artifacts(result, banner_root, svg_path)
            saved = {
                "svg": relative_display_path(svg_path),
                "json": relative_display_path(svg_path.with_suffix(".json")),
            }

        self.send_json(
            {
                "request": result.request,
                "result": asdict(result),
                "svg": svg_markup,
                "saved": saved,
                "topic_style": topic_style,
                "history": recent_generations(self.server.output_dir),
            }
        )

    def run_generation(self, payload: dict, save_output: bool):
        request = request_from_payload(payload)
        self.send_generation_response(request, save_output=save_output)

    def run_topic_preview(self, payload: dict):
        request = request_from_payload(payload)
        if not request.topic_description:
            raise ValueError("Add a topic description before using topic preview.")

        manifest = banner.load_manifest(self.server.manifest_path)
        styled_request, topic_style = banner.apply_topic_style_to_request(request, manifest)
        self.send_generation_response(styled_request, save_output=False, topic_style=topic_style)

    def save_spec(self, payload: dict):
        manifest = banner.load_manifest(self.server.manifest_path)
        request = request_from_payload(payload)
        banner.validate_request(manifest, request)

        self.server.request_dir.mkdir(parents=True, exist_ok=True)
        spec_path = default_request_path(self.server.request_dir, request)
        with open(spec_path, "w") as handle:
            json.dump(banner.request_payload(request), handle, indent=2)

        self.send_json(
            {
                "request": banner.request_payload(request),
                "saved": {
                    "spec": relative_display_path(spec_path),
                },
                "history": recent_generations(self.server.output_dir),
            }
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/options":
            try:
                self.api_options()
            except Exception as exc:
                traceback.print_exc()
                self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self.read_json_body()
            if parsed.path == "/api/preview":
                self.run_generation(payload, save_output=False)
                return
            if parsed.path == "/api/generate":
                self.run_generation(payload, save_output=True)
                return
            if parsed.path == "/api/save-spec":
                self.save_spec(payload)
                return
            if parsed.path == "/api/topic-preview":
                self.run_topic_preview(payload)
                return
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            traceback.print_exc()
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local FAI Banner Studio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--manifest", type=Path, default=banner.DEFAULT_MANIFEST)
    parser.add_argument("--tiles-dir", type=Path, default=banner.DEFAULT_TILES_DIR)
    parser.add_argument("--output-dir", type=Path, default=banner.DEFAULT_OUTPUT_DIR)
    parser.add_argument("--request-dir", type=Path, default=DEFAULT_REQUESTS_DIR)
    return parser


def main():
    args = build_parser().parse_args()

    if not STUDIO_DIR.exists():
        raise SystemExit(f"Studio assets not found: {STUDIO_DIR}")

    server = ThreadingHTTPServer((args.host, args.port), BannerStudioHandler)
    server.manifest_path = args.manifest
    server.tiles_dir = args.tiles_dir
    server.output_dir = args.output_dir
    server.request_dir = args.request_dir

    url = f"http://{args.host}:{args.port}"
    print(f"FAI Banner Studio running at {url}")
    print(f"Generated banners: {relative_display_path(args.output_dir)}")
    print(f"Saved request specs: {relative_display_path(args.request_dir)}")

    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Banner Studio...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
