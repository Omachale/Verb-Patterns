# Draws the home-screen icons (a door with a green EXIT sign) into assets/.
# Usage: python tools/make_icons.py
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets"


def icon(size):
    s = size / 512
    img = Image.new("RGB", (size, size), "#2b2433")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([60 * s, 60 * s, 452 * s, 452 * s], radius=70 * s, fill="#9cc4aa")       # wall
    d.rectangle([150 * s, 150 * s, 362 * s, 452 * s], fill="#7a5236")                            # frame
    d.rectangle([168 * s, 168 * s, 344 * s, 452 * s], fill="#fff1c4")                             # light behind
    d.polygon([(168 * s, 168 * s), (290 * s, 200 * s), (290 * s, 452 * s), (168 * s, 452 * s)], fill="#e0703f")  # open door
    d.ellipse([255 * s, 300 * s, 277 * s, 322 * s], fill="#e8c14a")                               # handle
    d.rounded_rectangle([190 * s, 92 * s, 322 * s, 136 * s], radius=10 * s, fill="#2fae5a")       # EXIT sign
    d.rectangle([220 * s, 108 * s, 292 * s, 120 * s], fill="#ffffff")
    return img


for size in (192, 512):
    icon(size).save(OUT / f"icon-{size}.png")
print("icons written")
