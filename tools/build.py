# Copies only the files the game needs into dist/, ready to upload to any static host
# (Netlify, GitHub Pages, Cloudflare Pages...). Working files are never touched.
# Usage: python tools/build.py
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

FILES = [
    "index.html",
    "manifest.webmanifest",
    "src/main.js",
    "src/verbs.js",
    "src/sfx.js",
    "src/style.css",
    "assets/teacher-closeup.webp",
    "assets/icon-192.png",
    "assets/icon-512.png",
    "vendor/three/three.module.min.js",
    "vendor/three/LICENSE",
    "vendor/three/addons/geometries/RoundedBoxGeometry.js",
    "vendor/three/addons/environments/RoomEnvironment.js",
    "vendor/three/addons/utils/BufferGeometryUtils.js",
]

if DIST.exists():
    shutil.rmtree(DIST)
total = 0
for rel in FILES:
    src, dst = ROOT / rel, DIST / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    total += src.stat().st_size
print(f"dist/ ready: {len(FILES)} files, {total / 1024:.0f} KB")
