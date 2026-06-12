"""Generate WakeScan PNG icons (192/512/maskable-512/180).

Pure-Pillow redraw of icon.svg: dark rounded square, cyan clock at 7:00,
QR finder badge in the corner. Run: python3 make_icons.py
"""
from PIL import Image, ImageDraw

BG = (12, 19, 34, 255)
CYAN = (34, 211, 238, 255)
CYAN_DEEP = (8, 145, 178, 255)
WHITE = (234, 241, 255, 255)

S = 1024  # draw large, downscale for crisp edges


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def draw_icon(rounded=True, pad_scale=1.0):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)

    def sc(v):  # scale 512-design coords to canvas, honoring maskable padding
        return (v - 256) * 2 * pad_scale + S / 2

    def ring(cx, cy, r, width, color):
        d.ellipse([sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)],
                  outline=color, width=int(width * 2 * pad_scale))

    def thick_line(x1, y1, x2, y2, width, color):
        w = width * 2 * pad_scale
        d.line([sc(x1), sc(y1), sc(x2), sc(y2)], fill=color, width=int(w))
        for (x, y) in [(x1, y1), (x2, y2)]:
            d.ellipse([sc(x) - w / 2, sc(y) - w / 2, sc(x) + w / 2, sc(y) + w / 2], fill=color)

    # clock face (two-tone ring approximates the gradient)
    ring(256, 276, 150, 30, CYAN)
    ring(256, 276, 150, 30, lerp(CYAN, CYAN_DEEP, 0.0))
    # bells
    thick_line(118, 122, 76, 164, 30, CYAN)
    thick_line(394, 122, 436, 164, 30, CYAN_DEEP)
    # hands at 7:00
    thick_line(256, 276, 256, 196, 26, WHITE)
    thick_line(256, 276, 204, 328, 26, WHITE)
    # QR badge
    d.rounded_rectangle([sc(316), sc(316), sc(448), sc(448)],
                        radius=int(28 * 2 * pad_scale), fill=BG,
                        outline=CYAN, width=int(18 * 2 * pad_scale))
    d.rounded_rectangle([sc(356), sc(356), sc(408), sc(408)],
                        radius=int(10 * 2 * pad_scale), fill=CYAN)
    return img


def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(name, 'PNG')
    print('wrote', name)


regular = draw_icon(rounded=True)
save(regular, 512, 'icon-512.png')
save(regular, 192, 'icon-192.png')
save(regular, 180, 'icon-180.png')

maskable = draw_icon(rounded=False, pad_scale=0.78)  # safe zone for maskable
save(maskable, 512, 'icon-maskable-512.png')
