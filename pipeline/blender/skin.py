"""The hero portrait's skin maps (presentation only, no claims), baked in Cycles onto the realtime mesh.

Called by hero.py once the realtime and bake meshes are final. Everything is authored, nothing is photographic:

- UVs: the base mesh's own islands (Human Base Meshes), scaled to an even texel density with the head's islands
  denser (`head_density`), shelf-packed into one tile.
- normal: the bake mesh's surface (the multires level above the realtime one, with every shape edit) plus an authored
  micro-relief in its material: pores (denser and deeper on the nose and cheeks), a fine cross-hatched skin texture,
  faint forehead lines and neck creases.
- albedo: a base tone with broad uneven pigment, regional redness (cheeks, nose, ears, the lower neck), the beard's
  shadow with stubble, the lips, darker lids, the scalp under the hair, freckles and a few moles on the shoulders.
- orm: R ambient occlusion (baked from the bake mesh), G roughness (an oilier T-zone and lips, a drier beard and
  scalp, pores and broad patches), B thickness for the subsurface term (ears, nostrils, eyelids).

Region fields are computed in the eyes' frame (mm: lat toward the patient's left, ant anterior, up) on the bake
mesh's vertices and reach the shaders as colour attributes.
"""
import numpy as np
import bmesh
import bpy


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def gauss(q, c, r):
    """Gaussian of the distance to c, per axis radii r (mm)."""
    d = (q - np.asarray(c, float)) / np.asarray(r, float)
    return np.exp(-(d * d).sum(1))


# --- UVs --------------------------------------------------------------------------------------------------------------

def islands(bm, uvl):
    """Face islands: faces joined across edges whose two loops agree in UV."""
    parent = np.arange(len(bm.faces))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f0, f1 = e.link_faces
        same = True
        for v in e.verts:
            u0 = next(l[uvl].uv for l in f0.loops if l.vert == v)
            u1 = next(l[uvl].uv for l in f1.loops if l.vert == v)
            if (u0 - u1).length > 1e-6:
                same = False
                break
        if same:
            a, b = find(f0.index), find(f1.index)
            if a != b:
                parent[a] = b
    return np.array([find(i) for i in range(len(bm.faces))])


def layout(me, head_z, head_density, margin=0.004):
    """A new single-tile UV map `bake` from the mesh's own islands: even texel density, head islands denser,
    shelf-packed."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    src = bm.loops.layers.uv[0]
    isl = islands(bm, src)
    dst = bm.loops.layers.uv.new("bake")
    groups = {}
    for f in bm.faces:
        groups.setdefault(isl[f.index], []).append(f)
    boxes = []
    for k, fs in groups.items():
        uv = np.array([[l[src].uv.x, l[src].uv.y] for f in fs for l in f.loops])
        a3 = sum(f.calc_area() for f in fs)
        a2 = 0.0
        for f in fs:
            p = np.array([[l[src].uv.x, l[src].uv.y] for l in f.loops])
            a2 += 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], 1)) - np.dot(p[:, 1], np.roll(p[:, 0], 1)))
        z = np.mean([f.calc_center_median().z for f in fs])
        s = np.sqrt(a3 / max(a2, 1e-12)) * (head_density if z > head_z else 1.0)
        lo = uv.min(0)
        boxes.append((k, fs, lo, s, (uv.max(0) - lo) * s))
    # shelf packing, tallest first, into a square of side W (grown until everything fits)
    boxes.sort(key=lambda b: -b[4][1])
    area = sum(b[4][0] * b[4][1] for b in boxes)
    W = np.sqrt(area) * 1.05
    while True:
        x = y = row = 0.0
        place = []
        for b in boxes:
            w, h = b[4] + margin * W
            if x + w > W:
                x, y, row = 0.0, y + row, 0.0
            place.append((x, y))
            x += w
            row = max(row, h)
        if y + row <= W:
            break
        W *= 1.03
    for (k, fs, lo, s, size), (px, py) in zip(boxes, place):
        for f in fs:
            for l in f.loops:
                u = (np.array([l[src].uv.x, l[src].uv.y]) - lo) * s + [px, py]
                l[dst].uv = (u + margin * W * 0.5) / W
    bm.to_mesh(me)
    bm.free()
    # the bake map becomes the only UV map (TEXCOORD_0)
    for u in [u for u in me.uv_layers if u.name != "bake"]:
        me.uv_layers.remove(u)
    return W


# --- region fields ----------------------------------------------------------------------------------------------------

def fields(q, cover, ears):
    """Per-vertex fields (0..1) in the eyes' frame q (mm): redness, beard, lips, lids, scalp, T-zone, thin."""
    lat, ant, up = q[:, 0], q[:, 1], q[:, 2]
    a = np.abs(lat)
    front = smooth(-15, 5, ant)
    ear = np.zeros(len(q))
    for c in ears:
        ear = np.maximum(ear, 1 - smooth(18, 34, np.linalg.norm(q - np.asarray(c), axis=1)))
    qa = np.c_[a, ant, up]
    red = (0.75 * gauss(qa, [42, 10, -30], [20, 22, 20]) + 0.8 * gauss(q, [0, 36, -32], [9, 10, 9])
           + 0.6 * gauss(qa, [15, 24, -42], [7, 8, 7]) + 0.45 * ear + 0.25 * gauss(q, [0, 18, -95], [16, 12, 12])
           + 0.15 * gauss(q, [0, 18, 45], [35, 20, 20]) + 0.25 * gauss(q, [0, -20, -175], [40, 30, 25]))
    lips = gauss(q, [0, 28, -66], [22, 14, 7.5]) * front
    lips = smooth(0.35, 0.7, lips)
    # beard: below a line from the sideburn's foot to the mouth's corner, the moustache, the chin, under the jaw
    # and down the front of the neck
    line = np.interp(ant, [-75, -55, -30, -5, 15, 40], [-12, -22, -38, -44, -44, -44])
    beard = smooth(-4, 6, line - up) * smooth(-82, -66, ant) * smooth(-165, -125, up)
    moustache = gauss(q, [0, 30, -52], [26, 10, 5]) * front
    beard = np.clip(np.maximum(beard, moustache) - lips * 1.2, 0, 1)
    beard *= 1 - 0.55 * smooth(-125, -165, up)  # thinner down the neck
    lids = sum(gauss(q, [s * 29.5, 4, 0], [17, 12, 13]) for s in (1, -1)) * front
    # the lash line along each upper lid's margin, and the nostrils' openings
    lash = sum(gauss(q, [s * 29.5, 12.5, 4.5], [11, 4, 1.6]) for s in (1, -1)) * front
    nostril = gauss(qa, [9, 24, -45], [5, 5, 2.6]) * front
    tz = np.clip(gauss(q, [0, 18, 40], [30, 20, 30]) + gauss(q, [0, 28, -20], [12, 22, 22]), 0, 1)
    thin = np.clip(ear + 0.6 * gauss(qa, [14, 26, -42], [6, 7, 6]) + 0.4 * lids, 0, 1)
    dark = np.clip(lash * 1.2 + nostril, 0, 1)
    return {"red": np.clip(red, 0, 1), "beard": beard, "lips": lips, "lids": np.clip(lids, 0, 1), "scalp": np.clip(np.maximum(cover, dark), 0, 1), "tz": tz, "thin": thin}


def set_colour(me, name, rgba):
    a = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    a.data.foreach_set("color", np.ascontiguousarray(rgba, dtype=np.float32).ravel())


# --- materials --------------------------------------------------------------------------------------------------------

def _n(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def source_material(spec, eye_z_mm):
    """The bake mesh's material: emission carries the colour or roughness being baked (`mode` input switched by
    hero.py), the normal carries the micro-relief."""
    m = bpy.data.materials.new("hero_source")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links
    out = _n(nt, "ShaderNodeOutputMaterial")
    tc = _n(nt, "ShaderNodeTexCoord")
    mm = _n(nt, "ShaderNodeVectorMath", operation="SCALE")
    mm.inputs[3].default_value = 1000.0  # object metres -> mm
    L.new(tc.outputs["Object"], mm.inputs[0])
    P = mm.outputs[0]
    A = _n(nt, "ShaderNodeAttribute", attribute_name="fieldsA")  # r red, g beard, b lips, a lids
    B = _n(nt, "ShaderNodeAttribute", attribute_name="fieldsB")  # r scalp, g tz, b thin, a pores weight
    sa = _n(nt, "ShaderNodeSeparateColor")
    L.new(A.outputs["Color"], sa.inputs[0])
    sb = _n(nt, "ShaderNodeSeparateColor")
    L.new(B.outputs["Color"], sb.inputs[0])
    red, beard, lips = sa.outputs[0], sa.outputs[1], sa.outputs[2]
    lids = A.outputs["Alpha"]
    scalp, tz, thin = sb.outputs[0], sb.outputs[1], sb.outputs[2]
    poreW = B.outputs["Alpha"]

    def noise(scale, detail=4.0, rough=0.55, offset=(0, 0, 0)):
        add = _n(nt, "ShaderNodeVectorMath", operation="ADD")
        add.inputs[1].default_value = offset
        L.new(P, add.inputs[0])
        n = _n(nt, "ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 1.0 / scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        L.new(add.outputs[0], n.inputs["Vector"])
        return n.outputs["Fac"]

    def voronoi(scale, feature="F1", offset=(0, 0, 0), randomness=1.0):
        add = _n(nt, "ShaderNodeVectorMath", operation="ADD")
        add.inputs[1].default_value = offset
        L.new(P, add.inputs[0])
        v = _n(nt, "ShaderNodeTexVoronoi", feature=feature)
        v.inputs["Scale"].default_value = 1.0 / scale
        v.inputs["Randomness"].default_value = randomness
        L.new(add.outputs[0], v.inputs["Vector"])
        return v

    def math(op, a, b=None, clamp=False):
        n = _n(nt, "ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                L.new(x, n.inputs[i])
        return n.outputs[0]

    def mixc(a, b, f):
        n = _n(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        for sock, x in ((6, a), (7, b)):
            if isinstance(x, tuple):
                n.inputs[sock].default_value = (*x, 1.0)
            else:
                L.new(x, n.inputs[sock])
        if isinstance(f, (int, float)):
            n.inputs[0].default_value = f
        else:
            L.new(f, n.inputs[0])
        return n.outputs[2]

    def mulc(a, b):
        n = _n(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        n.inputs[0].default_value = 1.0
        for sock, x in ((6, a), (7, b)):
            if isinstance(x, tuple):
                n.inputs[sock].default_value = (*x, 1.0)
            else:
                L.new(x, n.inputs[sock])
        return n.outputs[2]

    def gray(x):
        n = _n(nt, "ShaderNodeCombineColor")
        for i in range(3):
            L.new(x, n.inputs[i])
        return n.outputs[0]

    s = spec["skin"]
    # --- colour (linear) ---
    broad = noise(28, 3, 0.5, (3.1, 7.7, 1.9))           # centimetre-scale uneven pigment
    mid = noise(6, 4, 0.6, (8.2, 0.4, 5.5))
    tone = math("ADD", math("MULTIPLY", math("SUBTRACT", broad, 0.5), s["broad"]), 1.0)
    tone = math("ADD", tone, math("MULTIPLY", math("SUBTRACT", mid, 0.5), s["mottle"]))
    c = mulc(tuple(s["base"]), gray(tone))
    c = mixc(c, mulc(c, tuple(s["red_tint"])), math("MULTIPLY", red, s["red"]))
    # beard: a blue-grey shadow and stubble dots (sub-millimetre, resolving to a speckle at portrait distance)
    st = voronoi(s["stubble_mm"], "F1", (1.3, 4.2, 0.6))
    dots = math("SUBTRACT", 1.0, math("MULTIPLY", st.outputs["Distance"], 1.0 / 0.32), clamp=True)
    c = mixc(c, mulc(c, tuple(s["beard_tint"])), math("MULTIPLY", beard, s["beard"]))
    c = mixc(c, tuple(s["stubble_colour"]), math("MULTIPLY", math("MULTIPLY", beard, dots), s["stubble"]))
    c = mixc(c, tuple(s["lips"]), math("MULTIPLY", lips, 0.85))
    c = mixc(c, mulc(c, tuple(s["lid_tint"])), math("MULTIPLY", lids, 0.5))
    # freckles and a few moles below the neck
    fr = voronoi(2.2, "F1", (5.5, 1.1, 9.9))
    frk = math("SUBTRACT", 1.0, math("MULTIPLY", fr.outputs["Distance"], 1 / 0.25), clamp=True)
    body = _n(nt, "ShaderNodeSeparateXYZ")
    L.new(P, body.inputs[0])
    # (Object coordinates are the frame's mm: below the eyes by `freckle_below_mm`, over 30 mm)
    below = math("MULTIPLY", math("SUBTRACT", eye_z_mm - s["freckle_below_mm"], body.outputs["Z"]), 1 / 30, clamp=True)
    frw = _n(nt, "ShaderNodeSeparateColor")
    L.new(fr.outputs["Color"], frw.inputs[0])
    frk = math("MULTIPLY", math("MULTIPLY", frk, math("GREATER_THAN", frw.outputs[0], 0.82)), below)
    c = mixc(c, mulc(c, (0.72, 0.6, 0.52)), math("MULTIPLY", frk, 0.5))
    c = mixc(c, tuple(s["scalp_colour"]), math("MULTIPLY", scalp, s["scalp"]))
    # --- roughness ---
    pores = voronoi(s["pore_mm"], "F1", (2.2, 9.1, 4.4))
    pore = math("SUBTRACT", 1.0, math("MULTIPLY", pores.outputs["Distance"], 1 / 0.35), clamp=True)
    patch = noise(9, 3, 0.5, (4.4, 2.2, 8.8))
    r = math("ADD", s["roughness"], math("MULTIPLY", math("SUBTRACT", patch, 0.5), 0.14))
    grain_r = noise(s["grain_mm"] * 1.7, 3, 0.5, (1.4, 8.8, 2.6))
    r = math("ADD", r, math("MULTIPLY", math("SUBTRACT", grain_r, 0.5), 0.16))
    r = math("SUBTRACT", r, math("MULTIPLY", tz, s["tz_gloss"]))
    r = math("SUBTRACT", r, math("MULTIPLY", lips, 0.1))
    r = math("ADD", r, math("MULTIPLY", beard, 0.06))
    r = math("ADD", r, math("MULTIPLY", scalp, 0.18))
    r = math("ADD", r, math("MULTIPLY", pore, math("MULTIPLY", poreW, 0.1)), clamp=True)
    # --- micro-relief (Bump) ---
    fine = noise(0.35, 6, 0.6, (0.7, 0.3, 0.1))
    hatch1 = _n(nt, "ShaderNodeTexWave", wave_type="BANDS", bands_direction="DIAGONAL")
    hatch1.inputs["Scale"].default_value = 1.0 / 0.55
    hatch1.inputs["Distortion"].default_value = 6.0
    L.new(P, hatch1.inputs["Vector"])
    h = math("ADD", math("MULTIPLY", fine, 0.5), math("MULTIPLY", hatch1.outputs["Fac"], 0.15))
    h = math("SUBTRACT", h, math("MULTIPLY", pore, math("ADD", 0.25, math("MULTIPLY", poreW, 0.75))))
    # the texture that survives at portrait distance: a millimetre-scale unevenness (it breaks up the specular
    # sheen) and the stubble's points in the beard
    grain = noise(s["grain_mm"], 3, 0.5, (6.1, 2.7, 3.3))
    h = math("ADD", h, math("MULTIPLY", math("SUBTRACT", grain, 0.5), s["grain"]))
    h = math("ADD", h, math("MULTIPLY", math("MULTIPLY", dots, beard), s["stubble_relief"]))
    # forehead lines and neck creases: faint horizontal bands
    bands = _n(nt, "ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z")
    bands.inputs["Scale"].default_value = 1.0 / 6.0
    bands.inputs["Distortion"].default_value = 1.5
    bands.inputs["Detail"].default_value = 1.0
    L.new(P, bands.inputs["Vector"])
    h = math("ADD", h, math("MULTIPLY", math("MULTIPLY", bands.outputs["Fac"], s["lines"]), tz))
    # the thin parts (the ears, the nostrils' rims) keep only a trace of the micro-relief: on the auricle's folds it
    # read as a distracting grain
    h = math("MULTIPLY", h, math("SUBTRACT", 1.0, math("MULTIPLY", thin, s["thin_relief_cut"])))
    bump = _n(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = s["relief_mm"] * 0.001
    L.new(h, bump.inputs["Height"])
    # outputs: the switch picks what the emission bakes (0 colour, 1 roughness, 2 thickness)
    mode = _n(nt, "ShaderNodeValue")
    mode.name = "mode"
    mode.outputs[0].default_value = 0
    is_r = math("COMPARE", mode.outputs[0], 1.0)
    is_t = math("COMPARE", mode.outputs[0], 2.0)
    e = mixc(c, gray(r), is_r)
    e = mixc(e, gray(thin), is_t)
    em = _n(nt, "ShaderNodeEmission")
    L.new(e, em.inputs["Color"])
    bsdf = _n(nt, "ShaderNodeBsdfDiffuse")
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    add = _n(nt, "ShaderNodeAddShader")
    L.new(em.outputs[0], add.inputs[0])
    L.new(bsdf.outputs[0], add.inputs[1])
    L.new(add.outputs[0], out.inputs["Surface"])
    return m


def target_material(img):
    m = bpy.data.materials.new("hero_target")
    m.use_nodes = True
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    return m, tex


def bake(web_ob, high_ob, q_high, cover_high, ears, spec, out_dir, eye_z):
    """All maps; writes hero_albedo.png, hero_normal.png, hero_orm.png into out_dir. Returns the map size."""
    s = spec["skin"]
    F = fields(q_high, cover_high, ears)
    pw = np.clip(0.35 + 0.65 * (F["tz"] + 0.7 * gauss(np.c_[np.abs(q_high[:, 0]), q_high[:, 1], q_high[:, 2]], [38, 12, -25], [22, 20, 22])), 0, 1)
    pw *= 1 - F["scalp"]
    set_colour(high_ob.data, "fieldsA", np.c_[F["red"], F["beard"], F["lips"], F["lids"]])
    set_colour(high_ob.data, "fieldsB", np.c_[F["scalp"], F["tz"], F["thin"], pw])
    src = source_material(spec, eye_z * 1000)
    high_ob.data.materials.clear()
    high_ob.data.materials.append(src)
    size = s["texture_px"]
    imgs = {k: bpy.data.images.new(f"hero_{k}", size, size, alpha=False, float_buffer=(k == "normal")) for k in ("albedo", "normal", "rough", "thin", "ao")}
    for k in ("normal", "rough", "thin", "ao"):
        imgs[k].colorspace_settings.name = "Non-Color"
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dev in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dev
            prefs.get_devices()
            if any(d.type == dev for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == dev
                scene.cycles.device = "GPU"
                break
        except TypeError:
            continue
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = s["cage_mm"] * 0.001
    scene.render.bake.max_ray_distance = s["ray_mm"] * 0.001
    scene.render.bake.margin = 16
    bpy.ops.object.select_all(action="DESELECT")
    high_ob.hide_render = False
    high_ob.select_set(True)
    web_ob.select_set(True)
    bpy.context.view_layer.objects.active = web_ob
    mode = src.node_tree.nodes["mode"].outputs[0]

    def run(kind, key, samples, m=None, selected=True):
        scene.render.bake.use_selected_to_active = selected
        high_ob.select_set(selected)
        tm, _ = target_material(imgs[key])
        web_ob.data.materials.clear()
        web_ob.data.materials.append(tm)
        if m is not None:
            mode.default_value = m
        scene.cycles.samples = samples
        bpy.ops.object.bake(type=kind, pass_filter={"EMIT"} if kind == "EMIT" else set(), use_clear=True)
    run("EMIT", "albedo", 4, 0)
    run("EMIT", "rough", 4, 1)
    run("EMIT", "thin", 1, 2)
    scene.render.bake.normal_space = "TANGENT"
    run("NORMAL", "normal", 4)
    scene.world = scene.world or bpy.data.worlds.new("w")
    run("AO", "ao", 48, selected=False)  # (on the realtime mesh itself: the coincident bake mesh would occlude it)
    # A second albedo in the fitted exterior's tone, without the beard: the hero blends into it as it settles onto
    # the fitted surface, so the dissolve to the fitted skin shows no change of tone (stage hero.ts).
    fit = {**spec, "skin": {**s, **s["fitted_tone"]}}
    high_ob.data.materials.clear()
    high_ob.data.materials.append(source_material(fit, eye_z * 1000))
    imgs["albedo_fit"] = bpy.data.images.new("hero_albedo_fit", size, size, alpha=False)
    run("EMIT", "albedo_fit", 4, None)
    web_ob.data.materials.clear()
    px = lambda k: np.array(imgs[k].pixels[:], dtype=np.float32).reshape(size, size, 4)
    orm = np.ones((size, size, 4), np.float32)
    orm[..., 0] = px("ao")[..., 0]
    orm[..., 1] = px("rough")[..., 0]
    orm[..., 2] = px("thin")[..., 0]
    o = bpy.data.images.new("hero_orm", size, size, alpha=False)
    o.colorspace_settings.name = "Non-Color"
    o.pixels.foreach_set(orm.ravel())
    for key, img in (("albedo", imgs["albedo"]), ("albedo_fit", imgs["albedo_fit"]), ("normal", imgs["normal"]), ("orm", o)):
        img.filepath_raw = str(out_dir / f"hero_{key}.png")
        img.file_format = "PNG"
        if key == "normal":
            # 8-bit is enough for a tangent-space normal map
            n8 = bpy.data.images.new("hero_normal8", size, size, alpha=False)
            n8.colorspace_settings.name = "Non-Color"
            n8.pixels.foreach_set(np.array(img.pixels[:], dtype=np.float32))
            img = n8
            img.filepath_raw = str(out_dir / "hero_normal.png")
            img.file_format = "PNG"
        img.save()
    return size
