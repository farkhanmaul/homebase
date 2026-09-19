#!/usr/bin/env python3
"""Generate deterministic room-detail V2 current and before/after contact sheets."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PREVIEWS = ROOT / "docs" / "previews"
ITEMS = (
    ("TOP ROOMS", "v1-detail-top-rooms.png"),
    ("RECEPTION + LOBBY", "v1-detail-reception-lobby.png"),
    ("SERVICE CORE", "v1-detail-core.png"),
    ("DESK COLLECTION", "v1-detail-desk-collection.png"),
    ("TELE / CS / CA", "v1-detail-tele.png"),
    ("PANTRY", "v1-detail-pantry.png"),
)
CELL_WIDTH = 720
CELL_HEIGHT = 330
BACKGROUND = (235, 232, 222)
INK = (30, 34, 36)
BORDER = (80, 85, 88)


def make_current() -> Image.Image:
    sheet = Image.new("RGB", (CELL_WIDTH * 2, CELL_HEIGHT * 3), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (label, filename) in enumerate(ITEMS):
        image = Image.open(PREVIEWS / filename).convert("RGB")
        image.thumbnail((CELL_WIDTH - 24, CELL_HEIGHT - 42), Image.Resampling.LANCZOS)
        x = (index % 2) * CELL_WIDTH
        y = (index // 2) * CELL_HEIGHT
        draw.rectangle((x, y, x + CELL_WIDTH - 1, y + CELL_HEIGHT - 1), outline=BORDER, width=1)
        draw.text((x + 12, y + 10), label, fill=INK, font=font)
        offset_x = x + (CELL_WIDTH - image.width) // 2
        offset_y = y + 32 + (CELL_HEIGHT - 42 - image.height) // 2
        sheet.paste(image, (offset_x, offset_y))
    return sheet


def main() -> None:
    current = make_current()
    current_path = PREVIEWS / "v2-current-contact-sheet.png"
    current.save(current_path, optimize=True)

    baseline = Image.open(PREVIEWS / "v2-baseline-contact-sheet.png").convert("RGB")
    if baseline.size != current.size:
        raise SystemExit(f"baseline {baseline.size} != current {current.size}")

    header = 30
    comparison = Image.new("RGB", (baseline.width + current.width, baseline.height + header), BACKGROUND)
    comparison.paste(baseline, (0, header))
    comparison.paste(current, (baseline.width, header))
    draw = ImageDraw.Draw(comparison)
    font = ImageFont.load_default()
    draw.text((12, 10), "BASELINE e630d26", fill=INK, font=font)
    draw.text((baseline.width + 12, 10), "ROOM-DETAIL V2 CURRENT", fill=INK, font=font)
    draw.line((baseline.width, 0, baseline.width, comparison.height), fill=BORDER, width=1)
    comparison.save(PREVIEWS / "v2-before-after-contact-sheet.png", optimize=True)

    print(current_path.relative_to(ROOT), current.size)
    print((PREVIEWS / "v2-before-after-contact-sheet.png").relative_to(ROOT), comparison.size)


if __name__ == "__main__":
    main()
