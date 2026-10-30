"""Builds favicon / home-screen icons from the 8-ball photo.
Usage: python3 scripts/make-icons.py path/to/8ball.png
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

src = Image.open(sys.argv[1]).convert('RGB')
CX, CY, R = 112, 117, 77  # ball centre / radius in the 225px source


def ball(size):
    """The ball alone, circular, transparent outside, rendered at `size` px diameter."""
    ss = 4
    crop = src.crop((CX - R - 2, CY - R - 2, CX + R + 2, CY + R + 2))
    big = crop.resize((size * ss, size * ss), Image.LANCZOS)
    mask = Image.new('L', big.size, 0)
    m = int(2 / (2 * R + 4) * big.size[0])
    ImageDraw.Draw(mask).ellipse((m, m, big.size[0] - m, big.size[1] - m), fill=255)
    out = big.convert('RGBA')
    out.putalpha(mask)
    out = out.resize((size, size), Image.LANCZOS)
    return out.filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=2)) if size > 64 else out


def tile(size, fill):
    """Opaque square icon: light yellow gradient with the ball at `fill` of the width and a soft shadow."""
    bg = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(bg)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=(255, int(247 - 17 * t), int(184 - 44 * t)))
    bd = int(size * fill)
    b = ball(bd)
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(((size - bd) // 2, (size - bd) // 2 + size // 40, (size + bd) // 2, (size + bd) // 2 + size // 40), fill=(90, 70, 0, 90))
    sh = sh.filter(ImageFilter.GaussianBlur(size / 48))
    bg = Image.alpha_composite(bg.convert('RGBA'), sh)
    bg.alpha_composite(b, ((size - bd) // 2, (size - bd) // 2))
    return bg.convert('RGB')


tile(180, 0.74).save('public/apple-touch-icon.png')
tile(192, 0.64).save('public/icon-192.png')  # extra margin keeps it inside the maskable safe zone
tile(512, 0.64).save('public/icon-512.png')
ball(32).save('public/favicon-32.png')
ball(16).save('public/favicon-16.png')
ball(64).save('public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('ok')
