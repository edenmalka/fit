"""Builds assets/demo-sofa.glb: a modern 3-seat sofa, 200 x 90 x 85 cm, using only the Python standard library.

Rounded, slightly puffy cushions, a woven linen texture (color + normal map) and tapered oak legs.
glTF units are meters, Y is up, the front faces +Z.

Run:  python3 tools/make_demo_sofa.py
"""
import json, math, random, struct, zlib, os

# ---------------------------------------------------------------- geometry helpers

def edge_samples(h, r, k):
    """Coordinates along one axis of a box of half-size h, dense near the rounded edges."""
    r = min(r, h * 0.999)
    arc = [-h + r * (1 - math.cos(t)) for t in (i / k * math.pi / 2 for i in range(k + 1))]
    flat_n = max(2, int(round((2 * (h - r)) / 0.04)))
    flat = [-(h - r) + 2 * (h - r) * i / flat_n for i in range(1, flat_n)]
    return arc + flat + [-a for a in reversed(arc)]

def rounded_box(hx, hy, hz, r, puff=0.0, puff_faces=("+y",), k=6):
    """Returns (positions, triangles). puff pushes the chosen faces outward like a cushion."""
    xs, ys, zs = edge_samples(hx, r, k), edge_samples(hy, r, k), edge_samples(hz, r, k)
    pos, tris = [], []
    # each face: (fixed axis, sign, axis u, axis v, samples u, samples v)
    faces = [(0, 1, 2, 1, zs, ys), (0, -1, 2, 1, zs, ys), (1, 1, 0, 2, xs, zs),
             (1, -1, 0, 2, xs, zs), (2, 1, 0, 1, xs, ys), (2, -1, 0, 1, xs, ys)]
    half = (hx, hy, hz)
    for ax, sgn, au, av, su, sv in faces:
        base = len(pos)
        for v in sv:
            for u in su:
                p = [0.0, 0.0, 0.0]
                p[ax], p[au], p[av] = sgn * half[ax], u, v
                inner = [max(-half[i] + r, min(half[i] - r, p[i])) for i in range(3)]
                d = [p[i] - inner[i] for i in range(3)]
                l = math.sqrt(sum(c * c for c in d)) or 1.0
                q = [inner[i] + d[i] / l * r for i in range(3)]
                # cushion bulge: strongest in the middle of a face, zero at the edges
                for f in puff_faces:
                    fa = "xyz".index(f[1]); fs = 1 if f[0] == "+" else -1
                    if q[fa] * fs > 0:
                        o = [i for i in range(3) if i != fa]
                        w = 1.0
                        for i in o:
                            w *= max(0.0, 1 - (q[i] / half[i]) ** 2)
                        q[fa] += fs * puff * w * min(1.0, abs(q[fa]) / half[fa])
                pos.append(q)
        nu = len(su)
        for j in range(len(sv) - 1):
            for i in range(nu - 1):
                a, b = base + j * nu + i, base + j * nu + i + 1
                c, d = a + nu, b + nu
                tris += [(a, b, d), (a, d, c)]  # winding is fixed in weld_and_orient
    return weld_and_orient(pos, tris)

def weld_and_orient(pos, tris):
    """Merge duplicate vertices along face seams and make every triangle face outward."""
    key = {}; remap = []; out = []
    for p in pos:
        k = tuple(round(c, 6) for c in p)
        if k not in key:
            key[k] = len(out); out.append(p)
        remap.append(key[k])
    cx = sum(p[0] for p in out) / len(out); cy = sum(p[1] for p in out) / len(out); cz = sum(p[2] for p in out) / len(out)
    fixed = []
    for a, b, c in tris:
        a, b, c = remap[a], remap[b], remap[c]
        if len({a, b, c}) < 3:
            continue
        n = cross(sub(out[b], out[a]), sub(out[c], out[a]))
        m = [(out[a][i] + out[b][i] + out[c][i]) / 3 - (cx, cy, cz)[i] for i in range(3)]
        fixed.append((a, b, c) if dot(n, m) >= 0 else (a, c, b))
    return out, fixed

def tapered_leg(r_top, r_bot, h, seg=24):
    pos, tris = [], []
    for y, r in ((h, r_top), (0.0, r_bot)):
        for i in range(seg):
            t = 2 * math.pi * i / seg
            pos.append([r * math.cos(t), y, r * math.sin(t)])
    for i in range(seg):
        j = (i + 1) % seg
        tris += [(i, j, seg + j), (i, seg + j, seg + i)]
    top_c = len(pos); pos.append([0, h, 0]); bot_c = len(pos); pos.append([0, 0, 0])
    for i in range(seg):
        j = (i + 1) % seg
        tris += [(top_c, j, i), (bot_c, seg + i, seg + j)]
    return weld_and_orient(pos, tris)

def sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return [a[0] / l, a[1] / l, a[2] / l]

def place(mesh, t=(0, 0, 0), rx=0.0):
    pos, tris = mesh
    c, s = math.cos(rx), math.sin(rx)
    out = [[p[0] + t[0], p[1] * c - p[2] * s + t[1], p[1] * s + p[2] * c + t[2]] for p in pos]
    return out, tris

def smooth_normals(pos, tris):
    n = [[0.0, 0.0, 0.0] for _ in pos]
    for a, b, c in tris:
        f = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]))
        for i in (a, b, c):
            n[i][0] += f[0]; n[i][1] += f[1]; n[i][2] += f[2]
    return [norm(v) for v in n]

def box_uv(pos, nor, tiles_per_m):
    uv = []
    for p, n in zip(pos, nor):
        ax = max(range(3), key=lambda i: abs(n[i]))
        u, v = [(p[2], p[1]), (p[0], p[2]), (p[0], p[1])][ax]
        uv.append([u * tiles_per_m, v * tiles_per_m])
    return uv

def merge(meshes):
    pos, tris = [], []
    for p, t in meshes:
        o = len(pos); pos += p; tris += [(a + o, b + o, c + o) for a, b, c in t]
    return pos, tris

# ---------------------------------------------------------------- the sofa (meters)
W, D, H = 2.00, 0.90, 0.85
LEG_H = 0.13
ARM_W = 0.17
random.seed(7)

fabric_parts = [
    place(rounded_box(W / 2, 0.135, D / 2, 0.05), (0, LEG_H + 0.135, 0)),                      # base frame
    place(rounded_box(ARM_W / 2, 0.255, D / 2, 0.07, puff=0.012, puff_faces=("+y",)),
          (-W / 2 + ARM_W / 2, LEG_H + 0.255, 0)),                                               # left arm
    place(rounded_box(ARM_W / 2, 0.255, D / 2, 0.07, puff=0.012, puff_faces=("+y",)),
          (W / 2 - ARM_W / 2, LEG_H + 0.255, 0)),                                                # right arm
    place(rounded_box(W / 2 - ARM_W, 0.22, 0.08, 0.05), (0, LEG_H + 0.27 + 0.18, -D / 2 + 0.08)),  # back frame
]
inner_w = W - 2 * ARM_W
seat_w = inner_w / 2 - 0.006
cushions = []
for side in (-1, 1):
    cx = side * (seat_w / 2 + 0.006)
    cushions.append(place(rounded_box(seat_w / 2, 0.065, 0.32, 0.045, puff=0.028, puff_faces=("+y", "+z")),
                          (cx, LEG_H + 0.27 + 0.06, D / 2 - 0.32 - 0.03)))                      # seat cushion
    cushions.append(place(rounded_box(seat_w / 2 - 0.004, 0.19, 0.085, 0.07, puff=0.035, puff_faces=("+z", "+y")),
                          (cx, H - 0.19 - 0.035, -D / 2 + 0.25), rx=-0.20))                      # back cushion

legs = [place(tapered_leg(0.022, 0.015, LEG_H), (x, 0, z)) for x in (-0.90, 0.90) for z in (-0.34, 0.34)]

# ---------------------------------------------------------------- textures (tileable linen)

def png(w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

S, THREADS = 256, 48
noise = [[random.random() for _ in range(S)] for _ in range(S)]
thread_var = [random.uniform(-1, 1) for _ in range(THREADS)]
def height(x, y):
    u, v = x / S * THREADS, y / S * THREADS
    i, j = int(u) % THREADS, int(v) % THREADS
    fu, fv = u - int(u), v - int(v)
    if (i + j) % 2 == 0:
        h = math.sin(math.pi * fu) * (0.85 + 0.15 * thread_var[i])
    else:
        h = math.sin(math.pi * fv) * (0.85 + 0.15 * thread_var[j])
    return h + 0.18 * noise[y % S][x % S]
Hm = [[height(x, y) for x in range(S)] for y in range(S)]
normal_rows, color_rows = [], []
for y in range(S):
    nr, cr = [], []
    for x in range(S):
        dx = Hm[y][(x + 1) % S] - Hm[y][(x - 1) % S]
        dy = Hm[(y + 1) % S][x] - Hm[(y - 1) % S][x]
        n = norm([-dx * 1.4, -dy * 1.4, 1.0])
        nr += [int((c * 0.5 + 0.5) * 255) for c in n]
        g = 0.86 + 0.12 * Hm[y][x] / 1.18 + 0.03 * (noise[(y * 7) % S][(x * 3) % S] - 0.5)
        cr += [max(0, min(255, int(g * 255)))] * 3
    normal_rows.append(nr); color_rows.append(cr)
fabric_color_png = png(S, S, color_rows)
fabric_normal_png = png(S, S, normal_rows)

# ---------------------------------------------------------------- glTF writer
binbuf = bytearray(); views = []; accessors = []

def add_view(data, target=None):
    while len(binbuf) % 4: binbuf.append(0)
    v = {"buffer": 0, "byteOffset": len(binbuf), "byteLength": len(data)}
    if target: v["target"] = target
    views.append(v); binbuf.extend(data)
    return len(views) - 1

def add_acc(values, comp, typ, target, minmax=False):
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[typ]
    fmt = {5126: "f", 5125: "I"}[comp]
    flat = [c for v in values for c in (v if n > 1 else [v])]
    view = add_view(struct.pack("<%d%s" % (len(flat), fmt), *flat), target)
    acc = {"bufferView": view, "componentType": comp, "count": len(values), "type": typ}
    if minmax:
        acc["min"] = [min(v[i] for v in values) for i in range(n)]
        acc["max"] = [max(v[i] for v in values) for i in range(n)]
    accessors.append(acc)
    return len(accessors) - 1

def add_mesh(name, mesh, material, tiles=None):
    pos, tris = mesh
    nor = smooth_normals(pos, tris)
    attrs = {"POSITION": add_acc(pos, 5126, "VEC3", 34962, True), "NORMAL": add_acc(nor, 5126, "VEC3", 34962)}
    if tiles:
        attrs["TEXCOORD_0"] = add_acc(box_uv(pos, nor, tiles), 5126, "VEC2", 34962)
    idx = [i for t in tris for i in t]
    prim = {"attributes": attrs, "indices": add_acc(idx, 5125, "SCALAR", 34963), "material": material}
    return {"name": name, "primitives": [prim]}

img_color = add_view(fabric_color_png); img_normal = add_view(fabric_normal_png)
images = [{"bufferView": img_color, "mimeType": "image/png"}, {"bufferView": img_normal, "mimeType": "image/png"}]
textures = [{"source": 0, "sampler": 0}, {"source": 1, "sampler": 0}]
samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]

linen = [0.50, 0.43, 0.36, 1]  # warm oatmeal (linear color)
materials = [
    {"name": "Linen", "pbrMetallicRoughness": {"baseColorFactor": linen, "baseColorTexture": {"index": 0},
     "metallicFactor": 0, "roughnessFactor": 0.92},
     "normalTexture": {"index": 1, "scale": 0.6},
     "extensions": {"KHR_materials_sheen": {"sheenColorFactor": [0.55, 0.52, 0.48], "sheenRoughnessFactor": 0.6}}},
    {"name": "Linen cushion", "pbrMetallicRoughness": {"baseColorFactor": [0.56, 0.49, 0.41, 1], "baseColorTexture": {"index": 0},
     "metallicFactor": 0, "roughnessFactor": 0.9},
     "normalTexture": {"index": 1, "scale": 0.6},
     "extensions": {"KHR_materials_sheen": {"sheenColorFactor": [0.6, 0.57, 0.52], "sheenRoughnessFactor": 0.6}}},
    {"name": "Oak", "pbrMetallicRoughness": {"baseColorFactor": [0.20, 0.11, 0.055, 1], "metallicFactor": 0, "roughnessFactor": 0.55}},
]
meshes = [add_mesh("Frame", merge(fabric_parts), 0, tiles=7),
          add_mesh("Cushions", merge(cushions), 1, tiles=7),
          add_mesh("Legs", merge(legs), 2)]
while len(binbuf) % 4: binbuf.append(0)

gltf = {
    "asset": {"version": "2.0", "generator": "Fit demo sofa"},
    "extensionsUsed": ["KHR_materials_sheen"],
    "scene": 0, "scenes": [{"nodes": [0]}],
    "nodes": [{"name": "DemoSofa", "children": [1, 2, 3]}] + [{"name": m["name"], "mesh": i} for i, m in enumerate(meshes)],
    "meshes": meshes, "materials": materials, "textures": textures, "images": images, "samplers": samplers,
    "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(binbuf)}],
}
j = json.dumps(gltf, separators=(",", ":")).encode()
while len(j) % 4: j += b" "
glb = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(j) + 8 + len(binbuf)) + struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(binbuf), b"BIN\0") + binbuf
out = os.path.join(os.path.dirname(__file__), "..", "assets", "demo-sofa.glb")
open(out, "wb").write(glb)
allp = [p for m in fabric_parts + cushions + legs for p in m[0]]
print("wrote", os.path.normpath(out), len(glb) // 1024, "KB")
print("bbox cm:", [round((max(p[i] for p in allp) - min(p[i] for p in allp)) * 100, 1) for i in range(3)],
      "min y:", round(min(p[1] for p in allp), 4))
