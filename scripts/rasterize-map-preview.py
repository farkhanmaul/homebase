#!/usr/bin/env python3
"""Paint the preview op list with Pillow.

Usage: rasterize-map-preview.py <ops.json> <out.png>

`ops.json` is written by scripts/generate-map-preview.ts and is the exact same op
list the SVG serializer consumes, so the PNG is just another backend for the
single manifest-derived scene (it is not a second, hand-maintained map). This is
only used when no real SVG rasterizer is installed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

_fonts: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key not in _fonts:
        try:
            _fonts[key] = ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)
        except OSError:
            _fonts[key] = ImageFont.load_default(size=size)
    return _fonts[key]


def color(value: str, opacity: float | None = None) -> tuple[int, int, int] | tuple[int, int, int, int]:
    value = value.lstrip("#")
    rgb = (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))
    if opacity is None or opacity >= 0.999:
        return rgb
    return (*rgb, max(0, min(255, round(opacity * 255))))


ANCHORS = {"start": "ls", "middle": "ms", "end": "rs"}


def draw_rotated_text(image: Image.Image, op: dict, text_font: ImageFont.FreeTypeFont, stroke_width: int) -> None:
    """Paints a rotate(-90) label the way the SVG does: baseline at (x, y), reading upward."""
    text = op["text"]
    ascent, descent = text_font.getmetrics()
    text_w = int(text_font.getlength(text)) + 4
    text_h = ascent + descent + 4

    layer = Image.new("RGBA", (text_w, text_h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(
        (2, 2),
        text,
        font=text_font,
        fill=color(op["fill"]),
        anchor="la",
        stroke_width=stroke_width,
        stroke_fill=(11, 23, 32) if stroke_width else None,
    )

    # rotate(90) is counter-clockwise, so the source baseline (bottom) becomes the
    # rotated image's left column and the text reads bottom-to-top. Pasted so that
    # baseline lands on op["x"] and the first glyph on op["y"].
    rotated = layer.rotate(90, expand=True)
    image.paste(rotated, (round(op["x"]) - ascent - 2, round(op["y"]) - text_w + 3), rotated)


def main() -> int:
    ops_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    scene = json.loads(ops_path.read_text())

    image = Image.new("RGB", (int(scene["width"]), int(scene["height"])), (13, 26, 38))
    draw = ImageDraw.Draw(image)

    for op in scene["ops"]:
        kind = op["t"]
        if kind == "rect":
            box = [round(op["x"]), round(op["y"]), round(op["x"] + op["w"]), round(op["y"] + op["h"])]
            fill = color(op["fill"], op.get("opacity"))
            outline = color(op["stroke"]) if op.get("stroke") else None
            if len(fill) == 4:
                layer = Image.new("RGBA", (max(1, box[2] - box[0]), max(1, box[3] - box[1])), fill)
                image.paste(layer, (box[0], box[1]), layer)
                if outline:
                    draw.rectangle(box, outline=outline, width=int(op.get("strokeWidth", 1)))
            else:
                draw.rectangle(box, fill=fill, outline=outline, width=int(op.get("strokeWidth", 1)) if outline else 0)
        elif kind == "circle":
            cx, cy, r = op["cx"], op["cy"], op["r"]
            box = [round(cx - r), round(cy - r), round(cx + r), round(cy + r)]
            fill = color(op["fill"], op.get("opacity"))
            outline = color(op["stroke"]) if op.get("stroke") else None
            if len(fill) == 4:
                layer = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
                ImageDraw.Draw(layer).ellipse([0, 0, box[2] - box[0] - 1, box[3] - box[1] - 1], fill=fill)
                image.paste(layer, (box[0], box[1]), layer)
            else:
                draw.ellipse(box, fill=fill, outline=outline, width=int(op.get("strokeWidth", 1)) if outline else 0)
        elif kind == "text":
            stroke_width = 4 if op.get("halo") else 0
            text_font = font(int(op["size"]), bool(op.get("weight", 400) >= 600))
            if op.get("rotate"):
                draw_rotated_text(image, op, text_font, stroke_width)
                continue
            draw.text(
                (round(op["x"]), round(op["y"])),
                op["text"],
                font=text_font,
                fill=color(op["fill"]),
                anchor=ANCHORS.get(op.get("anchor", "start"), "ls"),
                stroke_width=stroke_width,
                stroke_fill=(11, 23, 32) if stroke_width else None,
            )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
