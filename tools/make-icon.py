"""Generate media/icon.png (128x128) for the VS Marketplace gallery."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "media" / "icon.png"

SIZE = 128
BG = (13, 17, 23, 255)
ACCENT = (74, 158, 255, 255)
FG = (230, 237, 243, 255)


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), BG)
    draw = ImageDraw.Draw(img)

    margin = 18
    draw.rounded_rectangle(
        [margin, margin + 6, SIZE - margin, SIZE - margin - 10],
        radius=18,
        fill=ACCENT,
    )
    # Speech-bubble tail
    draw.polygon(
        [
            (36, SIZE - margin - 10),
            (52, SIZE - margin - 10),
            (30, SIZE - 12),
        ],
        fill=ACCENT,
    )

    # Star
    cx, cy, r = SIZE // 2, SIZE // 2 - 4, 18
    pts: list[tuple[float, float]] = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rad = r if i % 2 == 0 else r * 0.42
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    draw.polygon(pts, fill=FG)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG")
    print(f"wrote {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
