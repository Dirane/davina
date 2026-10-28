"""Generate the app icons (sprout on sage). Run: python3 tools/make-icons.py
Needs Pillow. Output goes to icons/. Only needed when the icon design changes."""
import math
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
SAGE = (79, 122, 92, 255)
CREAM = (251, 248, 243, 255)
SS = 4  # supersampling factor


def leaf(p0, p1, width, steps=80):
    """Points of a leaf shape from p0 (base) to p1 (tip)."""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    side_a, side_b = [], []
    for i in range(steps + 1):
        t = i / steps
        half = width / 2 * 1.3 * math.sin(math.pi * t ** 0.85) * (1 - t) ** 0.35
        cx, cy = x0 + dx * t, y0 + dy * t
        side_a.append((cx + nx * half, cy + ny * half))
        side_b.append((cx - nx * half, cy - ny * half))
    return side_a + side_b[::-1]


def draw_sprout(d, box, color):
    """Draw the sprout inside box=(x, y, size)."""
    bx, by, s = box

    def P(u, v):
        return (bx + u * s, by + v * s)

    stem_w = s * 0.07
    # Curved stem: a sampled quadratic curve.
    a, c, b = P(0.5, 0.86), P(0.47, 0.62), P(0.53, 0.40)
    pts = []
    for i in range(161):
        t = i / 160
        x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0]
        y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]
        pts.append((x, y))
    # Stamp discs along the curve: smooth edges with no join artefacts.
    r = stem_w / 2
    for p in pts:
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=color)
    d.polygon(leaf(P(0.49, 0.60), P(0.14, 0.40), s * 0.26), fill=color)
    d.polygon(leaf(P(0.52, 0.44), P(0.86, 0.14), s * 0.30), fill=color)


def render(size, *, rounded, symbol_scale, mono=False):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not mono:
        if rounded:
            d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.22), fill=SAGE)
        else:
            d.rectangle((0, 0, big, big), fill=SAGE)
    s = big * symbol_scale
    off = (big - s) / 2
    draw_sprout(d, (off, off, s), (255, 255, 255, 255) if mono else CREAM)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    render(192, rounded=True, symbol_scale=0.66).save(os.path.join(OUT, "icon-192.png"), optimize=True)
    render(512, rounded=True, symbol_scale=0.66).save(os.path.join(OUT, "icon-512.png"), optimize=True)
    # Maskable: full bleed, symbol inside the 80% safe zone.
    render(512, rounded=False, symbol_scale=0.56).save(os.path.join(OUT, "maskable-512.png"), optimize=True)
    # iOS rounds corners itself, so the touch icon is full bleed.
    render(180, rounded=False, symbol_scale=0.6).save(os.path.join(OUT, "apple-touch-icon-180.png"), optimize=True)
    render(32, rounded=True, symbol_scale=0.7).save(os.path.join(OUT, "favicon-32.png"), optimize=True)
    # Android notification badge: white silhouette on transparent.
    render(96, rounded=False, symbol_scale=0.85, mono=True).save(os.path.join(OUT, "badge-96.png"), optimize=True)


if __name__ == "__main__":
    main()
