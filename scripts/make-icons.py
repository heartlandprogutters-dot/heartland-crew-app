#!/usr/bin/env python3
"""Draw the Heartland Crew home-screen icons. No third-party image library."""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public"

GREEN = (20, 53, 42, 255)
COPPER = (197, 106, 50, 255)
CREAM = (244, 240, 230, 255)
WHITE = (255, 253, 248, 255)


def blend(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def cover(px, py, cx, cy, r):
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 <= r


def paint(size, pad):
    pixels = bytearray(size * size * 4)
    inner = size - 2 * pad

    def setpx(x, y, color):
        if x < 0 or y < 0 or x >= size or y >= size:
            return
        i = (y * size + x) * 4
        pixels[i:i + 4] = bytes(color)

    def sample(x, y):
        # x,y are pixel centers in 0..size
        nx = (x + 0.5 - pad) / inner
        ny = (y + 0.5 - pad) / inner
        # rounded square background
        dx = max(abs(nx - 0.5) - 0.38, 0)
        dy = max(abs(ny - 0.5) - 0.38, 0)
        outside = (dx * dx + dy * dy) ** 0.5 > 0.12
        if nx < 0 or ny < 0 or nx > 1 or ny > 1 or outside:
            return (0, 0, 0, 0)
        color = GREEN
        # house body
        if 0.30 <= nx <= 0.70 and 0.48 <= ny <= 0.74:
            color = CREAM
        # peaked roof, higher in the middle
        roof_top = 0.30 + abs(nx - 0.50) * 0.62
        if 0.26 <= nx <= 0.74 and roof_top <= ny <= 0.50:
            color = COPPER
        # gutter under the eave, slightly wider than the wall
        if 0.22 <= nx <= 0.78 and 0.485 <= ny <= 0.530:
            color = COPPER
        # downspout
        if 0.68 <= nx <= 0.73 and 0.50 <= ny <= 0.78:
            color = COPPER
        # door
        if 0.46 <= nx <= 0.56 and 0.58 <= ny <= 0.74:
            color = GREEN
        return color

    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            n = 0
            for sy in (0.25, 0.75):
                for sx in (0.25, 0.75):
                    c = sample(x + sx - 0.5, y + sy - 0.5)
                    for i in range(4):
                        acc[i] += c[i]
                    n += 1
            setpx(x, y, tuple(int(v / n) for v in acc))
    return pixels


def write_png(path, size, rgba):
    raw = b"".join(b"\x00" + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def main():
    icons = {
        "public/favicon.png": (32, 2),
        "public/icons/apple-touch-icon.png": (180, 16),
        "public/icons/icon-192.png": (192, 18),
        "public/icons/icon-512.png": (512, 36),
        "public/icons/icon-maskable-512.png": (512, 78),
    }
    for rel, (size, pad) in icons.items():
        write_png(ROOT / rel, size, paint(size, pad))
        print(rel)


if __name__ == "__main__":
    main()
