"""The opening's hero portrait (presentation only, no claims): a separate realtime asset authored from Blender Studio's
Human Base Meshes (CC0), handed off to the fitted exterior before any anatomy shows (ADR-0005, opening hero amendment).

    blender -b --python pipeline/blender/hero.py          (after pipeline/anatomy/hero_prep.py)

Reads pipeline/segment/work/hero/{spec.json, fitted.npz}; writes pipeline/build/out/hero.raw.glb, the working file
pipeline/segment/work/hero/hero.blend and QC renders to docs/qc/m1-anatomy/hero_*.png.

1. The realistic male figure's multires sculpt is evaluated twice: at `web_level` (the realtime mesh) and at
   `high_level` (the source its detail is baked from), so both are the same surface.
2. Both are placed on the fitted eyes (scale from their distance, then the authored pitch and offset) and cropped to
   a bust below the eyes, the same cut for both.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import groom  # noqa: E402
import handoff  # noqa: E402
import skin  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work/hero"
OUT = ROOT / "pipeline/build/out"
QC = ROOT / "docs/qc/m1-anatomy"


def eval_mesh(obj, level, name):
    """The object's multires surface at `level` as a new mesh in world space (UVs kept)."""
    for m in obj.modifiers:
        if m.type == "MULTIRES":
            m.levels = level
            m.render_levels = level
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.name = name
    me.transform(obj.matrix_world)
    return me


def mesh_object(me, name):
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def verts(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_verts(me, p):
    me.vertices.foreach_set("co", np.ascontiguousarray(p, dtype=np.float64).ravel())
    me.update()


def apply_affine(me, M):
    p = verts(me)
    set_verts(me, p @ M[:3, :3].T + M[:3, 3])


def crop(me, keep):
    """Delete the vertices outside `keep` (and their faces)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context="VERTS")
    bm.to_mesh(me)
    bm.free()


def placement(spec, hbm_eyes, fit_eyes):
    """Similarity from the figure onto the fitted eyes: scale from the eye distance (times spec scale), the authored
    pitch about the eyes' midpoint (positive tips the face up), then the authored offset (mm)."""
    pl = spec["place"]
    s = np.linalg.norm(fit_eyes[0] - fit_eyes[1]) / np.linalg.norm(hbm_eyes[0] - hbm_eyes[1]) * pl["scale"]
    a = -math.radians(pl["pitch_deg"])
    R = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    src, dst = hbm_eyes.mean(0), fit_eyes.mean(0) + np.array(pl["offset_mm"], float) * 0.001
    M = np.eye(4)
    M[:3, :3] = s * R
    M[:3, 3] = dst - s * R @ src
    return M, s


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def edit(p, spec, eye, mid_x):
    """The authored shape edits (anatomy.yaml `hero.edits`) on positions p (Blender frame, metres), in the eyes'
    frame: lat = x - mid, ant = -(y - eye y), up = z - eye z (mm)."""
    ed = spec.get("edits") or {}
    lat, ant, up = (p[:, 0] - mid_x) * 1000, -(p[:, 1] - eye[1]) * 1000, (p[:, 2] - eye[2]) * 1000
    if "torso_pitch" in ed:
        e = ed["torso_pitch"]
        w = 1 - smooth(e["full_below"], e["none_above"], up)
        a = np.radians(e["deg"]) * w
        da, du = ant - e["pivot"][0], up - e["pivot"][1]
        ant, up = e["pivot"][0] + da * np.cos(a) - du * np.sin(a), e["pivot"][1] + da * np.sin(a) + du * np.cos(a)
    if "occiput" in ed:
        e = ed["occiput"]
        ant = ant - e["mm"] * smooth(e["from_ant"], e["full_ant"], ant) * smooth(e["from_up"], e["full_up"], up)
    if "ears" in ed:
        e = ed["ears"]
        r = e["radius_mm"]
        for side in (1, -1):
            # the helix: the most lateral tissue at the ear's height, behind the cheek
            sel = (lat * side > 70) & (up > -60) & (up < 20) & (ant < -60) & (ant > -140)
            if not sel.any():
                continue
            c = np.array([lat[sel].mean(), ant[sel].mean(), up[sel].mean()])
            c[0] = side * (abs(c[0]) - 8)  # the ear's root, not its rim
            d = np.sqrt((lat - c[0]) ** 2 + (ant - c[1]) ** 2 + (up - c[2]) ** 2)
            w = 1 - smooth(0.55 * r, r, d)
            t = np.radians(e.get("tilt_deg", 0)) * w
            da, du = ant - c[1], up - c[2]
            ra, ru = da * np.cos(t) + du * np.sin(t), -da * np.sin(t) + du * np.cos(t)  # top forward
            lat = lat + w * ((lat - c[0]) * (e["scale"] - 1))
            ant = c[1] + ra + w * (ra * (e["scale"] - 1) - e["back_mm"])
            up = c[2] + ru + w * (ru * (e["scale"] - 1) + e["raise_mm"])
    for b in ed.get("blobs") or []:
        for side in ((1, -1) if b.get("sym") else (1,)):
            c = np.array(b["at"], float) * [side, 1, 1]
            v = np.array(b["by"], float) * [side, 1, 1]
            w = np.exp(-((lat - c[0]) ** 2 + (ant - c[1]) ** 2 + (up - c[2]) ** 2) / b["r"] ** 2)
            lat, ant, up = lat + w * v[0], ant + w * v[1], up + w * v[2]
    return np.c_[lat * 0.001 + mid_x, eye[1] - ant * 0.001, eye[2] + up * 0.001]


def ridges(me, spec, eye, mid_x):
    """Authored muscle and bone relief (anatomy.yaml `hero.edits.ridges`): each segment, mirrored about the midline,
    lifts the surface along its normal by a Gaussian of the distance to it."""
    rs = (spec.get("edits") or {}).get("ridges") or []
    if not rs:
        return
    me.update()
    p = verts(me)
    n = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", n)
    n = n.reshape(-1, 3)
    q = np.c_[(p[:, 0] - mid_x) * 1000, -(p[:, 1] - eye[1]) * 1000, (p[:, 2] - eye[2]) * 1000]
    h = np.zeros(len(p))
    for r in rs:
        for side in (1, -1):
            a, b = np.array(r["a"], float) * [side, 1, 1], np.array(r["b"], float) * [side, 1, 1]
            ab = b - a
            t = np.clip(((q - a) @ ab) / (ab @ ab), 0, 1)
            d = np.linalg.norm(q - (a + t[:, None] * ab), axis=1)
            # tapered toward the ends, so a muscle swells and fades rather than stopping
            taper = np.sin(np.pi * np.clip(t * 0.9 + 0.05, 0, 1)) ** 0.5
            h += r["h"] * taper * np.exp(-(d / r["w"]) ** 2)
    set_verts(me, p + n * (h[:, None] * 0.001))


def eye_pair(p):
    """Two eye centres from the vertices of both globes: [left (+x), right]."""
    mid = p[:, 0].mean()
    return np.array([p[p[:, 0] > mid].mean(0), p[p[:, 0] <= mid].mean(0)])


def main():
    spec = json.loads((WORK / "spec.json").read_text(encoding="utf-8"))
    fitted = np.load(WORK / "fitted.npz")
    src = spec["source"]
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / src["blend"]))
    body = bpy.data.objects[src["object"]]
    eyes_src = [bpy.data.objects[n] for n in src["eyes"]]

    web = eval_mesh(body, spec["web_level"], "hero_skin")
    high = eval_mesh(body, spec["high_level"], "hero_skin_high")
    eye_me = []
    for e in eyes_src:
        me = e.data.copy()
        me.transform(e.matrix_world)
        eye_me.append(me)
    hbm_eyes = np.array([verts(m).mean(0) for m in eye_me])
    if hbm_eyes[0, 0] < hbm_eyes[1, 0]:
        hbm_eyes = hbm_eyes[::-1]
    fit_eyes = eye_pair(fitted["eyes_p"])
    M, s = placement(spec, hbm_eyes, fit_eyes)

    # A clean scene holding only the hero.
    keep_names = set()
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in [web, high, *eye_me]:
        apply_affine(me, M)
    eye_z, mid_x = fit_eyes[:, 2].mean(), fit_eyes[:, 0].mean()
    eye = verts(eye_me[0]).mean(0) * 0.5 + verts(eye_me[1]).mean(0) * 0.5
    for me in (web, high, *eye_me):
        set_verts(me, edit(verts(me), spec, eye, mid_x))
    for me in (web, high):
        ridges(me, spec, eye, mid_x)
    back = (spec.get("edits") or {}).get("eyes_back_mm", 0) * 0.001
    for me in eye_me:
        set_verts(me, verts(me) + [0, back, 0])  # (+y is posterior)
    cr = spec["crop"]
    for me in (web, high):
        p = verts(me)
        crop(me, (p[:, 2] > eye_z - cr["below_eye_mm"] * 0.001) & (np.abs(p[:, 0] - mid_x) < cr["half_width_mm"] * 0.001))
    ob_web = mesh_object(web, "hero_skin")
    ob_high = mesh_object(high, "hero_skin_high")
    ob_high.hide_render = True
    eyes = eye_me[0]
    bm = bmesh.new()
    for me in eye_me:
        bm.from_mesh(me)
    bm.to_mesh(eyes)
    bm.free()
    eyes.name = "hero_eyes"
    ob_eyes = mesh_object(eyes, "hero_eyes")
    for me in (web, high, eyes):
        for poly in me.polygons:
            poly.use_smooth = True

    hair_ob, cover, hair_report = build_hair(web, spec, eye, mid_x)
    # Skin maps (skin.py): a single-tile UV map, then the bake from the bake mesh (with the hair's coverage of the
    # scalp evaluated on it).
    skin.layout(web, eye_z - 0.13, spec["skin"]["head_density"])
    pw = verts(web)
    ph = verts(high)
    cover_high = groom.coverage(ph, eye, mid_x, spec["hair"], ear_roots(pw, eye, mid_x))
    q_high = np.c_[(ph[:, 0] - mid_x) * 1000, -(ph[:, 1] - eye[1]) * 1000, (ph[:, 2] - eye[2]) * 1000]
    skin.bake(ob_web, ob_high, q_high, cover_high, ear_roots(pw, eye, mid_x), spec, OUT, eye[2])
    # The handoff (handoff.py): each part's displacement onto the fitted exterior, and the outline field.
    edges = np.empty(len(web.edges) * 2, int)
    web.edges.foreach_get("vertices", edges)
    pw = verts(web)
    # the hero's ear canal, against the donor's: in front of and below the helix's root centre
    ec = spec["handoff"]["canal_from_root_mm"]
    ears_b = [[mid_x + c[0] * 0.001, eye[1] - (c[1] + ec[0]) * 0.001, eye[2] + (c[2] + ec[1]) * 0.001] for c in ear_roots(pw, eye, mid_x)]
    disp, foot, eye_disp, hand_report = handoff.build(pw, edges.reshape(-1, 2), verts(eyes), ears_b, fitted, spec["handoff"])
    g = build_hair.groom
    sd = handoff.strand_disp(g["root"], pw, disp)
    K = g["P"].shape[1]
    hair_disp = np.repeat(np.repeat(sd, K, axis=0), 2, axis=0)
    # The opening's pose: the finished figure turned a few degrees toward the viewer about a vertical axis through
    # the eyes (everything above is authored in the eyes' frame, face ahead). The morph targets stay where they are:
    # the handoff turns him back as it settles him into the fitted shape.
    R = yaw_matrix(spec["place"].get("yaw_deg", 0.0))
    pivot = verts(eyes).mean(0)
    for me, d in ((web, disp), (eyes, eye_disp), (hair_ob.data, hair_disp)):
        p0 = verts(me)
        p1 = (p0 - pivot) @ R.T + pivot
        set_verts(me, p1)
        d[:] = p0 + d - p1
    for name in ("_flow", "_hairn"):
        a = hair_ob.data.attributes[name]
        v = np.empty(len(a.data) * 3, np.float32)
        a.data.foreach_get("vector", v)
        b = from_gltf(v.reshape(-1, 3)) @ R.T
        a.data.foreach_set("vector", np.ascontiguousarray(to_gltf(b), dtype=np.float32).ravel())
    vec_attr(web, "_hdisp", to_gltf(disp))
    a = web.attributes.new("_foot", "FLOAT", "POINT")
    a.data.foreach_set("value", foot)
    vec_attr(eyes, "_hdisp", to_gltf(eye_disp))
    vec_attr(hair_ob.data, "_hdisp", to_gltf(hair_disp))
    report = {"handoff": hand_report, "hair": hair_report, "scale": round(float(s), 4), "web_vertices": len(web.vertices), "high_vertices": len(high.vertices), "portrait_bust": framing(spec, verts(web), eye_z)}
    WORK.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / "hero.blend"))
    export(OUT / "hero.raw.glb", [ob_web, ob_eyes, hair_ob])
    (WORK / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("hero:", report)


def vec_attr(me, name, data):
    a = me.attributes.new(name, "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", np.ascontiguousarray(data, dtype=np.float32).ravel())


def yaw_matrix(deg):
    """Rotation about the vertical axis turning the face (-y) toward the opening's camera (-x, the patient's right)
    for positive degrees."""
    a = -math.radians(deg)
    return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])


def from_gltf(v):
    return np.c_[v[:, 0], -v[:, 2], v[:, 1]]


def to_gltf(v):
    """Blender-frame vectors as glTF's (the exporter converts positions and normals, not custom attributes)."""
    return np.c_[v[:, 0], v[:, 2], -v[:, 1]]


def ear_roots(p, eye, mid_x):
    """Each ear's root centre in the eyes' frame (mm): the helix's centroid, 8 mm toward the head."""
    q = np.c_[(p[:, 0] - mid_x) * 1000, -(p[:, 1] - eye[1]) * 1000, (p[:, 2] - eye[2]) * 1000]
    out = []
    for side in (1, -1):
        sel = (q[:, 0] * side > 70) & (q[:, 2] > -60) & (q[:, 2] < 25) & (q[:, 1] < -60) & (q[:, 1] > -140)
        c = q[sel].mean(0)
        c[0] = side * (abs(c[0]) - 8)
        out.append(c.tolist())
    return out


def build_hair(web, spec, eye, mid_x):
    """The groom on the finished skin (groom.py) as a ribbon mesh with its strand attributes."""
    web.calc_loop_triangles()
    F = np.empty(len(web.loop_triangles) * 3, int)
    web.loop_triangles.foreach_get("vertices", F)
    F = F.reshape(-1, 3)
    P = verts(web)
    N = np.empty(len(web.vertices) * 3)
    web.vertices.foreach_get("normal", N)
    N = N.reshape(-1, 3)
    g, cover, rep = groom.build(P, F, N, eye, mid_x, spec["hair"], ear_roots(P, eye, mid_x))
    build_hair.groom = g
    V, quads, side, per_vertex = groom.ribbon_mesh(g)
    me = bpy.data.meshes.new("hero_hair")
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", V.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", (np.arange(len(quads)) * 4).astype(np.int32))
    me.polygons.foreach_set("loop_total", np.full(len(quads), 4, np.int32))
    me.update()
    S, K = g["P"].shape[:2]
    def attr(name, data):
        a = me.attributes.new(name, "FLOAT_VECTOR", "POINT")
        a.data.foreach_set("vector", np.ascontiguousarray(data, dtype=np.float32).ravel())
    attr("_flow", to_gltf(per_vertex(g["tangent"])))
    attr("_hairn", to_gltf(per_vertex(np.repeat(g["root_n"][:, None, :], K, axis=1))))
    attr("_hair", np.c_[per_vertex(g["t"])[:, 0], side, per_vertex(g["width_mm"])[:, 0]])
    attr("_hrnd", np.c_[np.repeat(np.repeat(g["rnd"], K), 2), np.repeat(np.repeat(g["kind"].astype(float), K), 2), per_vertex(g["ao"])[:, 0]])
    ob = mesh_object(me, "hero_hair")
    return ob, cover, rep


def framing(spec, p, eye_z):
    """The opening's framing box (glTF metres): a cube whose bounding sphere has the authored radius, centred the
    authored distances below the crown and behind the middle of the head (front to back, above the eyes' level less
    10 cm: the skull, not the shoulders)."""
    fr = spec["frame"]
    crown = p[:, 2].max() + fr["crown_allowance_mm"] * 0.001
    head = p[p[:, 2] > eye_z - 0.10]
    by = (head[:, 1].min() + head[:, 1].max()) / 2 + fr["centre_behind_mm"] * 0.001
    bx = (head[:, 0].min() + head[:, 0].max()) / 2
    bz = crown - fr["centre_below_crown_mm"] * 0.001
    h = fr["radius_mm"] * 0.001 / math.sqrt(3)
    c = np.array([bx, bz, -by])  # glTF (x, y, z) = Blender (x, z, -y)
    return {"min": (c - h).round(5).tolist(), "max": (c + h).round(5).tolist()}


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_tangents=True, export_materials="NONE", export_attributes=True)


if __name__ == "__main__":
    main()
