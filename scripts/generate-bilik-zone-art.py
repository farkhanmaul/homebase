#!/usr/bin/env python3
"""Deterministic Bilik Geng Kami raster art underlay.

Cover-fits the user-owned detailed source ``public/room/bilik-geng-v4.png`` into
the exact integer box of the ``bilik-geng-kami`` zone (386x185), clears the bottom
few rows to transparency so the manifest wall / door opening keeps showing through
the vector fallback underneath, and writes ``public/room/bilik-geng-zone.png``.

Usage::

    python3 scripts/generate-bilik-zone-art.py [--out PATH] [--source PATH]

The target size is derived from an explicit expected-zone contract and validated
against ``lib/office-map.json`` before anything is written, so the raster can never
silently drift from the approved manifest geometry. The source has no characters
on it; the raster is a pure visual layer. Re-running produces byte-identical
output for the same source and Pillow version.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "lib" / "office-map.json"
DEFAULT_SOURCE = ROOT / "public" / "room" / "bilik-geng-v4.png"
DEFAULT_OUT = ROOT / "public" / "room" / "bilik-geng-zone.png"

# The approved zone contract: rect of `bilik-geng-kami` in the generated manifest.
ZONE_ID = "bilik-geng-kami"
EXPECTED_ZONE = {"x": 1450.0, "y": 40.0, "w": 386.25, "h": 185.0}
COLUMN_ID = "col-geng-1"
EXPECTED_COLUMN = {"x": 1672.5, "y": 56.25, "w": 60.0, "h": 57.5}

# Rows at the bottom of the raster kept fully transparent, so the manifest wall
# and the door opening (`op-geng-kami`) stay visible from the vector fallback.
TRANSPARENT_BOTTOM_ROWS = 6

MAX_BYTES = 150 * 1024


def expected_zone() -> dict[str, float]:
    """Reads the manifest zone and asserts it matches the explicit contract."""
    manifest = json.loads(MANIFEST.read_text())
    zone = next((entry for entry in manifest["zones"] if entry["id"] == ZONE_ID), None)
    if zone is None:
        raise SystemExit(f"manifest has no zone {ZONE_ID!r}")
    rect = {key: float(zone["rect"][key]) for key in ("x", "y", "w", "h")}
    for key, expected in EXPECTED_ZONE.items():
        if abs(rect[key] - expected) > 1e-9:
            raise SystemExit(f"zone {ZONE_ID!r} {key}={rect[key]} != approved {expected}")
    return rect


def target_size(rect: dict[str, float]) -> tuple[int, int]:
    """The exact zone dimensions rounded to integer pixels."""
    return round(rect["w"]), round(rect["h"])


def expected_column(zone: dict[str, float]) -> dict[str, int]:
    """Validate the approved column and return its integer zone-local box."""
    manifest = json.loads(MANIFEST.read_text())
    column = next((entry for entry in manifest["columns"] if entry["id"] == COLUMN_ID), None)
    if column is None:
        raise SystemExit(f"manifest has no column {COLUMN_ID!r}")
    rect = {key: float(column["rect"][key]) for key in ("x", "y", "w", "h")}
    for key, expected in EXPECTED_COLUMN.items():
        if abs(rect[key] - expected) > 1e-9:
            raise SystemExit(f"column {COLUMN_ID!r} {key}={rect[key]} != approved {expected}")
    return {
        "x": round(rect["x"] - zone["x"]),
        "y": round(rect["y"] - zone["y"]),
        "w": round(rect["w"]),
        "h": round(rect["h"]),
    }


def paint_column(image: Image.Image, rect: dict[str, int]) -> None:
    """Paint a layered pillar so its authoritative collider is never invisible."""
    x, y, w, h = (rect[key] for key in ("x", "y", "w", "h"))
    draw = ImageDraw.Draw(image)
    # Contact shadow, outlined body/front face, top cap, and right side face.
    draw.rectangle((x + 4, y + 5, x + w + 5, y + h + 5), fill=(65, 72, 74, 255))
    draw.rectangle((x, y + 7, x + w - 1, y + h - 1), fill=(50, 55, 62, 255))
    draw.rectangle((x + 2, y + 9, x + w - 3, y + h - 3), fill=(185, 179, 161, 255))
    draw.rectangle((x + w - 8, y + 9, x + w - 3, y + h - 3), fill=(139, 133, 116, 255))
    draw.rectangle((x, y, x + w - 1, y + 11), fill=(50, 55, 62, 255))
    draw.rectangle((x + 2, y + 2, x + w - 3, y + 9), fill=(216, 210, 192, 255))
    draw.line((x + 3, y + 3, x + w - 4, y + 3), fill=(255, 250, 234, 255), width=1)
    for row in (22, 36, 50):
        if row < h - 3:
            draw.line((x + 3, y + row, x + w - 9, y + row), fill=(163, 157, 140, 255), width=1)


def cover_fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Scales with LANCZOS to cover ``size`` exactly, then centre-crops."""
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    scaled = image.resize((max(target_w, round(image.width * scale)), max(target_h, round(image.height * scale))), Image.LANCZOS)
    left = (scaled.width - target_w) // 2
    top = (scaled.height - target_h) // 2
    return scaled.crop((left, top, left + target_w, top + target_h))


def build(source: Path, out: Path) -> None:
    rect = expected_zone()
    size = target_size(rect)

    with Image.open(source) as raw:
        source_size = raw.size
        covered = cover_fit(raw.convert("RGBA"), size)

    paint_column(covered, expected_column(rect))

    # Bottom rows fully transparent: a clean cut, not a fade.
    covered.paste((0, 0, 0, 0), (0, size[1] - TRANSPARENT_BOTTOM_ROWS, size[0], size[1]))

    out.parent.mkdir(parents=True, exist_ok=True)
    covered.save(out, format="PNG", optimize=True)

    with Image.open(out) as written:
        if written.size != size or written.mode != "RGBA":
            raise SystemExit(f"wrote {written.size} {written.mode}, expected {size} RGBA")
    byte_size = out.stat().st_size
    if byte_size > MAX_BYTES:
        raise SystemExit(f"artifact {byte_size} bytes exceeds the {MAX_BYTES} byte budget")

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"bilik-zone {source.name} {source_size[0]}x{source_size[1]} -> {out.name} {size[0]}x{size[1]} RGBA {byte_size} bytes sha256 {digest}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the Bilik Geng Kami zone raster underlay.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="detailed source PNG")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output PNG path")
    args = parser.parse_args(argv)
    build(args.source, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
