#!/usr/bin/env python3
"""Build Heartland Crew home-screen icons from the website logo.

Source: the transparent header logo on https://heartlandprogutters.com
(clientuploads/design_setup/logo-tranparent-768x232.png), saved as
scripts/brand-logo.png. The 32 px favicon uses the site favicon mark
(clientuploads/design_setup/favicon.png), saved as scripts/brand-mark.png.
Icons sit on the site's primary red (#d80000).
"""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "brand-logo.png"
MARK = ROOT / "scripts" / "brand-mark.png"
# Website --primary / og:image background.
RED = (216, 0, 0, 255)


def decode_png(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    pos = 8
    width = height = color = None
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if tag == b"IHDR":
            width, height, bit, color, comp, filt, inter = struct.unpack(">IIBBBBB", chunk)
            if bit != 8 or color != 6 or inter != 0:
                raise SystemExit("Expected 8-bit non-interlaced RGBA")
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"IEND":
            break
        pos += 12 + length
    raw = zlib.decompress(idat)
    bpp = 4
    stride = width * bpp
    rows = []
    index = 0
    prev = bytearray(stride)

    def paeth(a, b, c):
        estimate = a + b - c
        pa, pb, pc = abs(estimate - a), abs(estimate - b), abs(estimate - c)
        if pa <= pb and pa <= pc:
            return a
        return b if pb <= pc else c

    for _y in range(height):
        filt = raw[index]
        index += 1
        row = bytearray(raw[index:index + stride])
        index += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                up = prev[x]
                up_left = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(left, up, up_left)) & 255
        elif filt != 0:
            raise SystemExit(f"Unsupported PNG filter {filt}")
        rows.append(row)
        prev = row
    return width, height, rows


def content_box(width, height, rows):
    min_x, min_y, max_x, max_y = width, height, 0, 0
    for y in range(height):
        row = rows[y]
        for x in range(width):
            if row[x * 4 + 3] > 20:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    return min_x, min_y, max_x, max_y


def sample(rows, width, height, x, y):
    if x < 0 or y < 0 or x >= width or y >= height:
        return (0, 0, 0, 0)
    i = x * 4
    row = rows[y]
    return (row[i], row[i + 1], row[i + 2], row[i + 3])


def paint(size, width_ratio, logo):
    src_w, src_h, rows, box = logo
    min_x, min_y, max_x, max_y = box
    content_w = max_x - min_x + 1
    content_h = max_y - min_y + 1
    target_w = max(1, int(round(size * width_ratio)))
    scale = target_w / content_w
    target_h = max(1, int(round(content_h * scale)))
    if target_h > size * 0.8:
        target_h = int(size * 0.8)
        scale = target_h / content_h
        target_w = max(1, int(round(content_w * scale)))
    origin_x = (size - target_w) / 2
    origin_y = (size - target_h) / 2
    pixels = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            # Map the output pixel center back into the source content box.
            sx = min_x + ((x + 0.5 - origin_x) / scale)
            sy = min_y + ((y + 0.5 - origin_y) / scale)
            x0, y0 = int(sx), int(sy)
            tx, ty = sx - x0, sy - y0
            acc = [0, 0, 0, 0]
            for oy, wy in ((0, 1 - ty), (1, ty)):
                for ox, wx in ((0, 1 - tx), (1, tx)):
                    r, g, b, a = sample(rows, src_w, src_h, x0 + ox, y0 + oy)
                    weight = wx * wy * (a / 255)
                    acc[0] += r * weight
                    acc[1] += g * weight
                    acc[2] += b * weight
                    acc[3] += weight
            cover = acc[3]
            if cover <= 0:
                color = RED
            else:
                color = tuple(int(RED[i] * (1 - cover) + acc[i]) for i in range(3)) + (255,)
            i = (y * size + x) * 4
            pixels[i:i + 4] = bytes(color)
    return pixels


def write_png(path, size, rgba):
    raw = b"".join(b"\x00" + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def load(path):
    width, height, rows = decode_png(path)
    return (width, height, rows, content_box(width, height, rows))


def main():
    wordmark = load(SOURCE)
    # The site favicon is the Pr + droplet mark. The full wordmark turns into
    # a smear at 32 px, so the browser icon uses that mark.
    mark = load(MARK)
    # width_ratio is the artwork width as a fraction of the icon.
    # Maskable keeps the wordmark inside the center 80% safe zone.
    icons = {
        "public/favicon.png": (32, 0.78, mark),
        "public/icons/apple-touch-icon.png": (180, 0.84, wordmark),
        "public/icons/icon-192.png": (192, 0.84, wordmark),
        "public/icons/icon-512.png": (512, 0.84, wordmark),
        "public/icons/icon-maskable-512.png": (512, 0.62, wordmark),
    }
    for rel, (size, ratio, artwork) in icons.items():
        write_png(ROOT / rel, size, paint(size, ratio, artwork))
        print(rel)


if __name__ == "__main__":
    main()
