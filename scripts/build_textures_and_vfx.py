import os
import math
from PIL import Image, ImageDraw, ImageFilter

BASE_DIR = r"E:\ai\cyber-survivors-3d\public"
TEX_DIR = os.path.join(BASE_DIR, "textures")
VFX_DIR = os.path.join(BASE_DIR, "vfx")
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(VFX_DIR, exist_ok=True)


def build_pbr_floor_textures():
    size = 512
    # Height map (0..255) for brushed titanium hex/grid plates + circuit trenches
    height_img = Image.new("L", (size, size), 180)
    h_draw = ImageDraw.Draw(height_img)

    albedo = Image.new("RGB", (size, size), (10, 15, 29))
    a_draw = ImageDraw.Draw(albedo)

    emissive = Image.new("RGB", (size, size), (0, 0, 0))
    e_draw = ImageDraw.Draw(emissive)

    # Tileable 4x4 armor panels (128px each)
    tile = 128
    for gy in range(4):
        for gx in range(4):
            x0, y0 = gx * tile, gy * tile
            x1, y1 = x0 + tile, y0 + tile
            shade = 14 + ((gx + gy) % 2) * 4
            a_draw.rectangle([x0 + 3, y0 + 3, x1 - 4, y1 - 4], fill=(shade, shade + 6, shade + 20))
            h_draw.rectangle([x0, y0, x1 - 1, y1 - 1], outline=70, width=4)
            h_draw.rectangle([x0 + 5, y0 + 5, x1 - 6, y1 - 6], outline=215, width=2)

            # Corner bevel rivets
            for rx in (x0 + 12, x1 - 13):
                for ry in (y0 + 12, y1 - 13):
                    h_draw.ellipse([rx - 3, ry - 3, rx + 3, ry + 3], fill=240)
                    a_draw.ellipse([rx - 2, ry - 2, rx + 2, ry + 2], fill=(38, 52, 78))

            # Diagonal tech groove inside alternating plates
            if (gx + gy) % 2 == 0:
                h_draw.line([x0 + 24, y0 + 64, x1 - 24, y0 + 64], fill=95, width=3)
                e_draw.line([x0 + 28, y0 + 64, x1 - 28, y0 + 64], fill=(12, 130, 175), width=2)
            else:
                h_draw.line([x0 + 64, y0 + 24, x0 + 64, y1 - 24], fill=95, width=3)
                e_draw.line([x0 + 64, y0 + 28, x0 + 64, y1 - 28], fill=(115, 38, 175), width=2)

    # Seamless main glowing cyber grid seams + intersection nodes
    for i in range(0, size, tile):
        e_draw.line([i, 0, i, size], fill=(20, 165, 205), width=2)
        e_draw.line([0, i, size, i], fill=(20, 165, 205), width=2)
    for gy in range(4):
        for gx in range(4):
            cx, cy = gx * tile, gy * tile
            for ox in (0, size) if gx == 0 else (0,):
                for oy in (0, size) if gy == 0 else (0,):
                    px, py = cx + ox, cy + oy
                    e_draw.ellipse([px - 6, py - 6, px + 6, py + 6], fill=(56, 225, 255))

    emissive = emissive.filter(ImageFilter.GaussianBlur(radius=1.1))

    # Compute seamless tangent-space normal map from height_img
    h_px = height_img.load()
    normal = Image.new("RGB", (size, size))
    n_px = normal.load()
    strength = 2.6
    for y in range(size):
        ym = (y - 1) % size
        yp = (y + 1) % size
        for x in range(size):
            xm = (x - 1) % size
            xp = (x + 1) % size
            dx = (h_px[xp, y] - h_px[xm, y]) / 255.0 * strength
            dy = (h_px[x, yp] - h_px[x, ym]) / 255.0 * strength
            nx, ny, nz = -dx, dy, 1.0
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
            r = int(max(0, min(255, (nx * inv * 0.5 + 0.5) * 255)))
            g = int(max(0, min(255, (ny * inv * 0.5 + 0.5) * 255)))
            b = int(max(0, min(255, (nz * inv * 0.5 + 0.5) * 255)))
            n_px[x, y] = (r, g, b)

    albedo.save(os.path.join(TEX_DIR, "floor_albedo.png"))
    normal.save(os.path.join(TEX_DIR, "floor_normal.png"))
    emissive.save(os.path.join(TEX_DIR, "floor_emissive.png"))
    print("Saved PBR floor textures (albedo, normal, emissive).")


def build_vfx_sprites():
    # 1. fx_shockwave.png: Tech-rune concentric shockwave ring (256x256 RGBA, true alpha!)
    s = 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = s // 2, s // 2
    d.ellipse([10, 10, s - 10, s - 10], outline=(255, 255, 255, 235), width=7)
    d.ellipse([24, 24, s - 24, s - 24], outline=(180, 245, 255, 160), width=3)
    for k in range(16):
        a0 = k * (360 / 16) + 4
        a1 = a0 + 12
        d.arc([36, 36, s - 36, s - 36], start=a0, end=a1, fill=(255, 255, 255, 210), width=5)
    for k in range(8):
        ang = k * (math.tau / 8)
        x0 = cx + math.cos(ang) * 78
        y0 = cy + math.sin(ang) * 78
        x1 = cx + math.cos(ang) * 112
        y1 = cy + math.sin(ang) * 112
        d.line([x0, y0, x1, y1], fill=(255, 255, 255, 200), width=3)
    glow = img.filter(ImageFilter.GaussianBlur(radius=4))
    out = Image.alpha_composite(glow, img)
    out.save(os.path.join(VFX_DIR, "fx_shockwave.png"))

    # 2. fx_flare.png: Anamorphic starburst hit-flare sprite (128x128 RGBA)
    fs = 128
    fimg = Image.new("RGBA", (fs, fs), (0, 0, 0, 0))
    px = fimg.load()
    fc = fs / 2.0
    for y in range(fs):
        for x in range(fs):
            dx = (x - fc) / fc
            dy = (y - fc) / fc
            r = math.hypot(dx, dy)
            if r >= 1.0:
                continue
            core = math.exp(-r * r * 14.0)
            horiz = math.exp(-abs(dy) * 18.0) * math.exp(-abs(dx) * 2.6)
            vert = math.exp(-abs(dx) * 18.0) * math.exp(-abs(dy) * 3.2)
            diag = math.exp(-abs(dx - dy) * 20.0) * math.exp(-r * 4.2) * 0.55
            val = min(1.0, core + horiz * 0.85 + vert * 0.65 + diag)
            a = int(val * 255)
            if a > 2:
                px[x, y] = (255, 255, 255, a)
    fimg.save(os.path.join(VFX_DIR, "fx_flare.png"))

    # 3. fx_laser.png: Scrolling plasma laser beam with electric corona (256x64 RGBA)
    lw, lh = 256, 64
    limg = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    lpx = limg.load()
    for y in range(lh):
        ny = abs((y - lh / 2.0) / (lh / 2.0))
        for x in range(lw):
            wave = 0.14 * math.sin((x / lw) * math.tau * 4.0 + ny * 3.0) + 0.08 * math.cos((x / lw) * math.tau * 7.0)
            dist = max(0.0, ny + wave * ny)
            if dist >= 1.0:
                continue
            core = math.exp(-dist * dist * 12.0)
            corona = math.exp(-dist * 3.2) * (0.7 + 0.3 * math.sin((x / lw) * math.tau * 5.0))
            alpha = int(min(1.0, core + corona * 0.75) * 255)
            bright = int(min(1.0, 0.55 + core * 0.7) * 255)
            if alpha > 3:
                lpx[x, y] = (bright, 245, 255, alpha)
    limg.save(os.path.join(VFX_DIR, "fx_laser.png"))

    # 4. fx_slash.png: Crescent cyber-blade slash wave (256x256 RGBA)
    simg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    spx = simg.load()
    for y in range(s):
        for x in range(s):
            dx = (x - 128) / 128.0
            dy = (y - 128) / 128.0
            r = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            # Forward arc centered around -Y (top of texture)
            arc_d = abs(ang + math.pi / 2)
            if arc_d < 1.35 and 0.48 < r < 0.96:
                ring_f = math.sin(((r - 0.48) / 0.48) * math.pi)
                ang_f = math.cos((arc_d / 1.35) * (math.pi / 2))
                val = (ring_f ** 1.4) * (ang_f ** 1.3)
                a = int(min(1.0, val * 1.35) * 255)
                if a > 3:
                    spx[x, y] = (220, 252, 255, a)
    simg.save(os.path.join(VFX_DIR, "fx_slash.png"))
    print("Saved 4 RGBA VFX sprite textures.")


if __name__ == "__main__":
    build_pbr_floor_textures()
    build_vfx_sprites()
