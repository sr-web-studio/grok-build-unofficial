"""Build social promo images from the real extension screenshot (pixel-faithful UI)."""
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / ".grok-attachments" / "grok-build.png"
# Fallback if user moved the file
if not SRC.exists():
    SRC = ROOT / "media" / "promo" / "source.png"
OUT = ROOT / "media" / "promo"
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source screenshot: {SRC}")

    panel = Image.open(SRC).convert("RGBA")
    # 1) Exact UI — best for trust
    panel.save(OUT / "reddit-real.png", "PNG", optimize=True)
    print("wrote", OUT / "reddit-real.png", panel.size)

    # 2) 16:9 social card with real UI centered + soft shadow
    W, H = 1280, 720
    bg = Image.new("RGB", (W, H), (18, 18, 20))
    max_h, max_w = H - 72, W - 120
    scale = min(max_w / panel.width, max_h / panel.height)
    nw, nh = max(1, int(panel.width * scale)), max(1, int(panel.height * scale))
    scaled = panel.resize((nw, nh), Image.Resampling.LANCZOS)

    shadow = Image.new("RGBA", (nw + 48, nh + 48), (0, 0, 0, 0))
    blob = Image.new("RGBA", (nw, nh), (0, 0, 0, 150))
    shadow.paste(blob, (18, 20))
    shadow = shadow.filter(ImageFilter.GaussianBlur(20))

    canvas = bg.convert("RGBA")
    x = (W - nw) // 2
    y = (H - nh) // 2
    canvas.paste(shadow, (x - 8, y - 6), shadow)
    canvas.paste(scaled, (x, y), scaled)
    out = ImageEnhance.Sharpness(canvas.convert("RGB")).enhance(1.04)
    out.save(OUT / "reddit-social-16x9.png", "PNG", optimize=True)
    print("wrote", OUT / "reddit-social-16x9.png", out.size)

    # 3) Also keep a JPEG for easy upload size
    out.save(OUT / "reddit-social-16x9.jpg", "JPEG", quality=92, optimize=True)
    print("wrote", OUT / "reddit-social-16x9.jpg")


if __name__ == "__main__":
    main()
