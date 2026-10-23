# Build monument models with Blender from each record's sourced `model` block (spec 6.4).
# Run headless:  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python viewer/models/build_models.py
# Output per record: viewer/models/<id>.json (compact mesh the viewer loads) and viewer/models/<id>.glb (for refinement in Blender).
# Shapes are procedural interpretations of the measurements (marked "procedural" in the record); nothing here adds facts.
import bpy, bmesh, json, math, os, glob, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RECORDS = os.path.join(ROOT, 'atlas', 'records')

PALETTE = [  # (keyword in the record's materials, RGB)
    ('marble', (0.92, 0.90, 0.85)), ('limestone', (0.85, 0.78, 0.62)), ('sandstone', (0.80, 0.55, 0.38)),
    ('granite', (0.62, 0.58, 0.55)), ('brick', (0.66, 0.36, 0.26)), ('mudbrick', (0.70, 0.56, 0.40)),
    ('adobe', (0.72, 0.58, 0.42)), ('basalt', (0.30, 0.29, 0.28)), ('tuff', (0.55, 0.52, 0.48)),
    ('iron', (0.42, 0.33, 0.27)), ('steel', (0.62, 0.64, 0.67)), ('copper', (0.38, 0.62, 0.55)),
    ('concrete', (0.70, 0.70, 0.68)), ('travertine', (0.86, 0.82, 0.72)), ('stone', (0.70, 0.66, 0.58)),
]

def colour_of(rec):
    text = ' '.join(m.get('material', '') for m in rec['model'].get('materials', [])).lower()
    for key, rgb in PALETTE:
        if key in text:
            return rgb
    return (0.80, 0.74, 0.60)

GENERIC = {'height', 'base', 'length', 'width', 'diameter', 'side', 'total', 'approximate', 'maximum', 'original', 'lower',
           'upper', 'plan', 'major', 'minor', 'axis', 'each', 'from', 'with', 'restored', 'present', 'about', 'tower', 'structure'}
def subject_words(part):
    return {w for w in re.findall(r'[a-zà-ÿ]{4,}', (part or '').lower()) if w not in GENERIC}

def meas(rec, *patterns, like=None):
    """First metre measurement whose part matches; with `like`, prefer parts naming the same structure as that part."""
    ms = [m for m in rec['model']['geometry'].get('measurements', [])
          if (m.get('unit') or '').lower() in ('m', 'metre', 'metres', 'meter', 'meters') and isinstance(m.get('value'), (int, float))]
    want = subject_words(like) if like else set()
    order = ms
    if want:   # same structure first, then everything else
        same = [m for m in ms if subject_words(m.get('part')) & want]
        order = same + [m for m in ms if m not in same]
    for m in order:   # record order within each group: authors list the main structure's dimensions first
        if any(re.search(p, m.get('part', ''), re.I) for p in patterns):
            return float(m['value'])
    return None

def height_part(rec):
    for m in rec['model']['geometry'].get('measurements', []):
        if re.search(r'height', m.get('part', ''), re.I) and (m.get('unit') or '').lower() in ('m', 'metre', 'metres', 'meter', 'meters'):
            return m.get('part')
    return None

def count_of(rec, *patterns):
    for m in rec['model']['geometry'].get('measurements', []):
        unit = (m.get('unit') or '').lower()
        if unit in ('m', 'metre', 'metres', 'meter', 'meters', 'ft', 'km'):
            continue   # a length is never a count
        if any(re.search(p, m.get('part', ''), re.I) for p in patterns) and isinstance(m.get('value'), (int, float)):
            return int(m['value'])
    return None

# ---------- primitive builders (all in metres, Z up, base on z = 0)
def box(bm, cx, cy, z0, sx, sy, sz):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=r['verts'])
    bmesh.ops.translate(bm, vec=(cx, cy, z0 + sz / 2), verts=r['verts'])

def cone(bm, cx, cy, z0, r1, r2, h, segs):
    r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.translate(bm, vec=(cx, cy, z0 + h / 2), verts=r['verts'])
    return r

def hemisphere(bm, cx, cy, z0, rad, h=None):
    r = bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=rad)
    kill = [v for v in r['verts'] if v.co.z < -1e-6]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    verts = [v for v in bm.verts if v in set(r['verts']) and v.is_valid]
    sz = (h / rad) if h else 1.0
    for v in verts:
        v.co.z *= sz
    bmesh.ops.translate(bm, vec=(cx, cy, z0), verts=verts)

def infer_shape(rec):
    """The record's own shape, or one its measurements state plainly; None for linear works drawn as paths."""
    g = rec['model']['geometry']
    if rec['model'].get('no_mesh'):
        return None   # measurements kept as data, but they don't describe one buildable form
    if g.get('shape'):
        return None if g['shape'].lower() == 'wall' else g['shape'].lower()   # walls are linear: drawn as paths
    parts = ' '.join(m.get('part', '') for m in g.get('measurements', [])).lower()
    if rec['model'].get('linear') or re.search(r'wall', rec.get('title', ''), re.I):
        return None
    if 'pyramid' in parts:
        return 'pyramid'
    if re.search(r'temple|platform|terrace', parts):
        return 'stepped_pyramid'
    return 'block'

def build(rec, bm):
    shape = infer_shape(rec)
    H = meas(rec, r'height') or 20.0
    hp = height_part(rec)   # plan dimensions are taken from the same structure as the height where the parts name it
    L = meas(rec, r'base length', r'length', r'side', r'^(?!.*(diameter|circumference)).*base', like=hp) or None   # a "diameter at base" is D, not a side
    if L is None:   # a sourced floor area (m2) gives the side of a square of the same area
        for m in rec['model']['geometry'].get('measurements', []):
            if (m.get('unit') or '').lower() in ('m2', 'm²', 'sq m') and re.search(r'area|footprint|foundation', m.get('part', ''), re.I) and isinstance(m.get('value'), (int, float)):
                L = math.sqrt(float(m['value'])); break
    W = meas(rec, r'base width', r'width', like=hp) or L
    D = meas(rec, r'diameter', like=hp)
    if D is None:   # a sourced circumference gives the diameter of the same circle
        C = meas(rec, r'circumference', like=hp)
        D = C / math.pi if C else None
    if shape == 'pyramid':
        side = L or H * 1.5
        r = cone(bm, 0, 0, 0, side / math.sqrt(2), 0.01, H, 4)
        bmesh.ops.rotate(bm, verts=r['verts'], cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 4, 3, 'Z'))
    elif shape in ('stepped_pyramid', 'ziggurat'):
        tiers = count_of(rec, r'tier', r'terrace', r'level', r'platform') or (3 if shape == 'ziggurat' else 7)
        l, w = (L or H * 2), (W or L or H * 2)
        top = 0.35 if shape == 'stepped_pyramid' else 0.5
        for i in range(tiers):
            f = 1 - (1 - top) * i / max(1, tiers - 1)
            box(bm, 0, 0, H * i / tiers, l * f, w * f, H / tiers)
    elif shape in ('dome', 'domed_building'):
        base = L or (D * 1.3 if D else H)
        dome_r = (D / 2) if D else base * 0.3
        box(bm, 0, 0, 0, base, (W or base), H * 0.45)
        hemisphere(bm, 0, 0, H * 0.45, dome_r, H * 0.55)
        if shape == 'domed_building' and base > 40:   # corner towers (minarets/turrets) as slim cylinders
            for sx in (-1, 1):
                for sy in (-1, 1):
                    cone(bm, sx * base * 0.62, sy * base * 0.62, 0, base * 0.025, base * 0.02, H * 0.85, 12)
    elif shape in ('tower', 'obelisk'):
        base = L or D or H * 0.2
        n = min(count_of(rec, r'count', r'tower') or 1, 4)
        if n > 1:   # twin or multiple straight towers (e.g. the World Trade Center): prisms side by side
            for i in range(n):
                box(bm, (i - (n - 1) / 2) * base * 1.9, 0, 0, base, base, H)
        elif D and not L:   # a sourced diameter means a round (or many-sided) shaft, tapering toward the top
            cone(bm, 0, 0, 0, D / 2, D / 2 * (0.45 if shape == 'tower' else 0.6), H, 24)
        else:
            cone(bm, 0, 0, 0, base / math.sqrt(2), base * (0.08 if shape == 'tower' else 0.55) / math.sqrt(2), H, 4)
    elif shape == 'spiral_minaret':   # helical-ramp minaret (e.g. Samarra's Malwiya): stacked round tiers on a square plinth
        side = L or D or H * 0.6; n = 6
        box(bm, 0, 0, 0, side, side, H * 0.05)
        for i in range(n):
            f = 1 - 0.8 * i / n
            cone(bm, 0, 0, H * 0.05 + (H * 0.95) * i / n, side * 0.42 * f, side * 0.42 * (f - 0.8 / n), H * 0.95 / n, 32)
    elif shape == 'arena':
        a = (L or D or 180) / 2; b = (W or a * 0.85 * 2) / 2
        n = 72
        for i in range(n):
            t = 2 * math.pi * i / n
            box(bm, a * math.cos(t), b * math.sin(t), 0, 2 * math.pi * a / n * 1.02, (a - b * 0.55) * 0.5 + 6, H)
    elif shape == 'ring':
        rad = (D or L or 30) / 2; n = count_of(rec, r'stone', r'pillar', r'count') or 30
        for i in range(n):
            t = 2 * math.pi * i / n
            box(bm, rad * math.cos(t), rad * math.sin(t), 0, max(1.0, rad * 0.07), max(0.6, rad * 0.035), H)
    elif shape == 'stupa':
        base = L or D or H
        for i in range(3):
            f = 1 - 0.18 * i
            box(bm, 0, 0, H * 0.12 * i, base * f, base * f, H * 0.12)
        hemisphere(bm, 0, 0, H * 0.36, base * 0.28, H * 0.4)
        cone(bm, 0, 0, H * 0.76, base * 0.03, base * 0.005, H * 0.24, 12)
    elif shape == 'temple_colonnade':
        if re.search(r'column', hp or '', re.I): H = H / 0.7   # a sourced column height: the columns are 0.7 of the whole
        l, w = (L or 70), (W or (L or 70) * 0.45)
        box(bm, 0, 0, 0, l, w, H * 0.12)                       # stylobate
        nx, ny = 8, max(4, int(8 * w / l) + 1)
        for i in range(nx):
            for j in range(ny):
                if 0 < i < nx - 1 and 0 < j < ny - 1:
                    continue
                cone(bm, -l / 2 + l * 0.06 + (l * 0.88) * i / (nx - 1), -w / 2 + w * 0.1 + (w * 0.8) * j / (ny - 1), H * 0.12, l * 0.012, l * 0.011, H * 0.7, 12)
        box(bm, 0, 0, H * 0.82, l * 0.98, w * 0.96, H * 0.18)   # entablature/roof
    elif shape in ('statue_group', 'statue'):
        n = count_of(rec, r'count', r'statue', r'moai') or (1 if shape == 'statue' else 7)
        n = min(n, 15)
        for i in range(n):
            x = (i - (n - 1) / 2) * H * 0.55
            box(bm, x, 0, 0, H * 0.32, H * 0.22, H * 0.78)
            box(bm, x, 0, H * 0.78, H * 0.26, H * 0.2, H * 0.22)
    elif shape == 'round_hall':   # circular hall: stacked drums, each under a conical roof (tier count from the record)
        rad = (D or L or H * 0.6) / 2; n = max(1, min(count_of(rec, r'tier', r'eave', r'roof') or 1, 5))
        base = H * 0.12
        cone(bm, 0, 0, 0, rad * 1.25, rad * 1.25, base, 48)                       # terrace
        z = base; step = (H - base) / n
        for i in range(n):
            f = 1 - 0.22 * i
            cone(bm, 0, 0, z, rad * f, rad * f, step * 0.55, 48)                  # drum
            cone(bm, 0, 0, z + step * 0.55, rad * f * 1.12, rad * f * 0.55 if i < n - 1 else 0.01, step * 0.45, 48)   # roof
            z += step
    elif shape == 'pagoda':   # square storeys, each under a wide eave, with a spire (storey count from the record)
        side = L or W or D or H * 0.2; n = max(1, min(count_of(rec, r'tier', r'stor', r'level') or 1, 13))
        body = H * 0.82; step = body / n
        for i in range(n):
            f = 1 - 0.35 * i / max(1, n - 1)
            box(bm, 0, 0, step * i, side * f, side * f, step * 0.72)                      # storey
            cone(bm, 0, 0, step * (i + 0.72), side * f * 1.25, side * f * 0.62, step * 0.28, 4)   # eave
        cone(bm, 0, 0, body, side * 0.05, side * 0.01, H - body, 8)                    # spire
    elif shape == 'mound':
        hemisphere(bm, 0, 0, 0, (L or D or H * 6) / 2, H)
    else:  # block, wall and unknown: a solid of the sourced footprint
        box(bm, 0, 0, 0, L or H, W or L or H, H)

def export(rec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bpy.data.meshes.new(rec['id']); obj = bpy.data.objects.new(rec['id'], mesh)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new(); build(rec, bm)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh); bm.free()
    mat = bpy.data.materials.new('stone'); mat.use_nodes = True
    rgb = colour_of(rec)
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    mesh.materials.append(mat)
    # compact JSON for the viewer: Y-up (x, z, -y), flat-shaded triangles
    pos, nor = [], []
    mesh.calc_loop_triangles() if hasattr(mesh, 'calc_loop_triangles') else None
    for tri in mesh.loop_triangles:
        n = tri.normal
        for vi in tri.vertices:
            co = mesh.vertices[vi].co
            pos += [round(co.x, 2), round(co.z, 2), round(-co.y, 2)]
            nor += [round(n.x, 3), round(n.z, 3), round(-n.y, 3)]
    out = {'id': rec['id'], 'shape': infer_shape(rec), 'color': rgb, 'positions': pos, 'normals': nor,
           'note': 'Procedural Blender model built from the record\'s sourced measurements; not a scan.'}
    with open(os.path.join(HERE, rec['id'] + '.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, rec['id'] + '.glb'), export_format='GLB')
    return len(pos) // 9

built = []
for path in sorted(glob.glob(os.path.join(RECORDS, '*.json'))):
    with open(path, encoding='utf-8') as f:
        rec = json.load(f)
    if rec.get('status') not in ('published', 'outline') or not rec.get('model') or not rec['model'].get('geometry'):
        continue
    if meas(rec, r'height') is None or infer_shape(rec) is None:
        continue   # no sourced height, or a linear work drawn as a path: no 3D model
    tris = export(rec)
    built.append({'id': rec['id'], 'shape': infer_shape(rec), 'triangles': tris})
with open(os.path.join(HERE, 'index.json'), 'w') as f:
    json.dump(built, f, indent=1)
print('BUILT', len(built), 'models:', ', '.join(f"{b['id']}({b['shape']},{b['triangles']})" for b in built))
