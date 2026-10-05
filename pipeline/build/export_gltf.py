"""Assemble the M1 slice scene as glTF 2.0 from pipeline/segment/work/meshes/*.npz.

    pipeline/segment/.venv/Scripts/python pipeline/build/export_gltf.py

Frame: the canonical CT RAS frame (mm) is mapped to glTF (metres, +Y up, model facing +Z):
    X = -(x - ox), Y = (z - oz), Z = (y - oy), scaled by 0.001, with origin o = right-parotid centroid.
This is a proper rotation (patient right = -X, the viewer's left when facing the model).

Every node is named with its structure id (the key used by content/structures and the stage). Custom per-vertex
attributes use glTF's underscore convention (_PEEL; _CUT, _CUTS, _FLAPW for the incision and flap). Label anchors are empty nodes named `anchor__<structureId>`.
Writes pipeline/build/out/slice.raw.glb and pipeline/build/out/frame.json. gltf-transform then optimises into
apps/site/public/assets/ (see pipeline/build/README.md).
"""
import json
from pathlib import Path

import numpy as np
import pygltflib as g

ROOT = Path(__file__).resolve().parents[2]
MESHES = ROOT / "pipeline/segment/work/meshes"
OUT = ROOT / "pipeline/build/out"
SPECS = ROOT / "pipeline/specs"

# Structures in the M1 slice, in nesting/render order (outer tissue first).
SCENE = [
    "skin", "eyes", "exterior_body", "hair", "subcutaneous_fat", "smas", "parotid_fascia",
    # the superficial and deep lobes are groups of ESGS-level pieces (pieces.py); the tumour travels with level II
    "parotid_level_1", "parotid_level_2", "parotid_ecd_cuff", "pleomorphic_adenoma", "pleomorphic_adenoma_deep", "pleomorphic_adenoma_tail", "pleomorphic_adenoma_accessory", "parotid_level_3", "parotid_level_4", "parotid_accessory_lobe",
    "facial_nerve_trunk", "facial_nerve_temporofacial", "facial_nerve_cervicofacial", "facial_nerve_temporal",
    "facial_nerve_zygomatic", "facial_nerve_buccal", "facial_nerve_marginal_mandibular", "facial_nerve_cervical",
    "facial_nerve_posterior_auricular", "facial_nerve_digastric_branch",
    "facial_nerve_ic_buccal_a", "facial_nerve_ic_buccal_b", "facial_nerve_ic_divisions", "auriculotemporal_nerve", "frey_regrowth",
    "great_auricular_nerve", "great_auricular_nerve_anterior", "great_auricular_nerve_posterior",
    "parotid_duct",
    "retromandibular_vein", "retromandibular_vein_anterior", "retromandibular_vein_posterior", "external_jugular_vein",
    "external_carotid_artery", "maxillary_artery", "superficial_temporal_artery",
    "masseter_r", "temporalis_r", "sternocleidomastoid_main", "scm_flap", "digastric_posterior_belly", "stimulator_probe", "smas_flap", "barrier_graft", "sialocele_pocket", "recurrence_nodules", "needle", "us_probe", "us_plane", "ct_tumour_outline", "drain_tube", "submandibular_gland_r",
    "internal_jugular_vein_r", "mandible", "skull", "styloid_process", "nerve_plane",
]
ATTRS = {"peel_order": "_PEEL", "cut": "_CUT", "cut_s": "_CUTS", "flap_w": "_FLAPW", "cutface": "_CUTFACE", "ink": "_INK", "mob": "_MOB", "cut2": "_CUT2", "cut_s2": "_CUTS2", "foldw": "_FOLDW", "tint": "_TINT", "hair_h": "_HAIRH", "flow": "_FLOW", "hair_kind": "_HAIRK", "axis": "_AXIS", "foot": "_FOOT"}


# Muscles whose fibre direction the stage draws (fascicles): the principal axis of the belly, or a fan converging on
# the lowest point (temporalis: fibres converge on the coronoid process).
FIBRES = {"masseter_r": "pca", "sternocleidomastoid_main": "pca", "scm_flap": "pca", "digastric_posterior_belly": "pca", "temporalis_r": "fan"}


def fibre_axis(sid: str, d) -> np.ndarray | None:
    """Per-vertex fibre direction (CT RAS, unit) for the material's directional structure: tubes follow their
    centreline tangent (nerves, vessels, duct); listed muscles follow FIBRES. Presentation only."""
    p = d["positions"].astype(np.float64)
    if "centre" in d.files and len(d["centre"]) > 2:
        from scipy.spatial import cKDTree

        c = d["centre"].astype(np.float64)
        t = np.gradient(c, axis=0)
        t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
        return t[cKDTree(c).query(p)[1]]
    mode = FIBRES.get(sid)
    if mode == "pca":
        q = p - p.mean(0)
        a = np.linalg.svd(q, full_matrices=False)[2][0]
        return np.tile(a, (len(p), 1))
    if mode == "fan":
        apex = p[np.argmin(p[:, 2])]
        a = p - apex
        return a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-9)
    return None


def to_gltf(p: np.ndarray, origin: np.ndarray) -> np.ndarray:
    q = p - origin
    return np.c_[-q[:, 0], q[:, 2], q[:, 1]] * 0.001


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    landmarks = json.loads((SPECS / "landmarks.vhp-male.json").read_text(encoding="utf-8"))["landmarks"]
    origin = np.array(landmarks["parotid_centroid"]["xyz"], float)

    blob = bytearray()
    gltf = g.GLTF2(asset=g.Asset(generator="parotid-atlas pipeline/build/export_gltf.py", version="2.0"))
    gltf.scenes = [g.Scene(nodes=[])]
    gltf.materials = [g.Material(name="default", pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorFactor=[0.8, 0.8, 0.8, 1], metallicFactor=0, roughnessFactor=0.6), doubleSided=True)]

    def add_view(data: bytes, target=None) -> int:
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        gltf.bufferViews.append(g.BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        return len(gltf.bufferViews) - 1

    def add_accessor(arr: np.ndarray, kind: str, target, minmax=False) -> int:
        comp = g.UNSIGNED_INT if arr.dtype == np.uint32 else g.FLOAT
        view = add_view(arr.tobytes(), target)
        acc = g.Accessor(bufferView=view, componentType=comp, count=len(arr) if arr.ndim > 1 else arr.size, type=kind)
        if minmax:
            acc.min = arr.min(0).tolist()
            acc.max = arr.max(0).tolist()
        gltf.accessors.append(acc)
        return len(gltf.accessors) - 1

    summary = {}
    for sid in SCENE:
        path = MESHES / f"{sid}.npz"
        if not path.exists():
            raise SystemExit(f"missing mesh {sid}")
        d = np.load(path)
        pos = to_gltf(d["positions"].astype(np.float64), origin).astype(np.float32)
        nrm = d["normals"].astype(np.float32)
        nrm = np.c_[-nrm[:, 0], nrm[:, 2], nrm[:, 1]].astype(np.float32)
        extra = {}
        if "flow" in d.files:  # a direction, mapped to the glTF frame like the normals
            f = d["flow"]
            extra["flow"] = np.c_[-f[:, 0], f[:, 2], f[:, 1]].astype(np.float32)
        axis = fibre_axis(sid, d)
        if axis is not None:
            extra["axis"] = np.c_[-axis[:, 0], axis[:, 2], axis[:, 1]].astype(np.float32)
        idx = d["indices"].astype(np.uint32)
        attrs = {"POSITION": add_accessor(pos, "VEC3", g.ARRAY_BUFFER, True), "NORMAL": add_accessor(nrm, "VEC3", g.ARRAY_BUFFER)}
        for key, name in ATTRS.items():
            if key in d.files or key in extra:
                a = (extra[key] if key in extra else d[key]).astype(np.float32)
                attrs[name] = add_accessor(a, {3: "VEC3", 4: "VEC4"}[a.shape[1]] if a.ndim == 2 else "SCALAR", g.ARRAY_BUFFER)
        prim = g.Primitive(attributes=g.Attributes(**attrs), indices=add_accessor(idx, "SCALAR", g.ELEMENT_ARRAY_BUFFER), material=0)
        gltf.meshes.append(g.Mesh(name=sid, primitives=[prim]))
        gltf.nodes.append(g.Node(name=sid, mesh=len(gltf.meshes) - 1))
        gltf.scenes[0].nodes.append(len(gltf.nodes) - 1)
        summary[sid] = {"vertices": int(len(pos)), "triangles": int(len(idx) // 3)}

    # Label anchors: authored points in the CT frame.
    nodes = json.loads((SPECS / "nodes.resolved.json").read_text(encoding="utf-8"))
    def lateral_point(sid, a, s):
        """The most lateral surface point of a mesh within an (A, S) window (mm): a visible anchor on its face."""
        p = np.load(MESHES / f"{sid}.npz")["positions"]
        sel = p[(p[:, 1] > a[0]) & (p[:, 1] < a[1]) & (p[:, 2] > s[0]) & (p[:, 2] < s[1])]
        return sel[np.argmax(sel[:, 0])]

    def mid(sid):
        c = np.load(MESHES / f"{sid}.npz")["centre"]
        return c[len(c) // 2]
    def outer_point(sid, toward=(1.0, 0.0, 0.0), k=40):
        """Mean of the k vertices of a mesh that lie furthest along `toward` (a point on its visible face)."""
        p = np.load(MESHES / f"{sid}.npz")["positions"]
        order = np.argsort(p @ np.asarray(toward))[-k:]
        return p[order].mean(0)
    def us_probe_face():
        """The centre of the probe's lateral face (the body the viewer sees), not the mean of body and cable: a plane
        x = f(y, z) is fitted through the lateral 14 mm of the probe and the point is placed on it."""
        p = np.load(MESHES / "us_probe.npz")["positions"]
        q = p[p[:, 0] > p[:, 0].max() - 14.0]
        c = np.linalg.lstsq(np.c_[q[:, 1], q[:, 2], np.ones(len(q))], q[:, 0], rcond=None)[0]
        y, z = q[:, 1].mean(), q[:, 2].mean()
        return np.array([c[0] * y + c[1] * z + c[2], y, z])
    anchors = {
        "parotid_level_1": outer_point("parotid_level_1"),
        "parotid_level_2": outer_point("parotid_level_2"),
        "parotid_ecd_cuff": outer_point("parotid_ecd_cuff"),
        "parotid_level_3": outer_point("parotid_level_3"),
        "parotid_level_4": outer_point("parotid_level_4"),
        "parotid_accessory_lobe": outer_point("parotid_accessory_lobe", k=12),
        "parotid_duct": np.load(MESHES / "parotid_duct.npz")["centre"][int(len(np.load(MESHES / "parotid_duct.npz")["centre"]) * 0.45)],
        "parotid_superficial_lobe": np.array(landmarks["parotid_lateral"]["xyz"]) + [1, 0, 3],  # on the lateral surface
        "pleomorphic_adenoma": np.array(json.loads((SPECS / "tumour.resolved.json").read_text())["center"]) if (SPECS / "tumour.resolved.json").exists() else np.array(landmarks["parotid_centroid"]["xyz"]),
        "facial_nerve_trunk": mid("facial_nerve_trunk"),
        "facial_nerve_temporal": mid("facial_nerve_temporal"),
        "facial_nerve_zygomatic": mid("facial_nerve_zygomatic"),
        "facial_nerve_buccal": mid("facial_nerve_buccal"),
        "facial_nerve_marginal_mandibular": mid("facial_nerve_marginal_mandibular"),
        "facial_nerve_cervical": mid("facial_nerve_cervical"),
        "pes_anserinus": np.array(nodes["pes"]),
        "retromandibular_vein": mid("retromandibular_vein"),
        "external_carotid_artery": mid("external_carotid_artery"),
        # nerve and neck muscle anchors lie in the field exposed by the flap (above the incision's neck limb)
        "great_auricular_nerve": np.load(MESHES / "great_auricular_nerve.npz")["centre"][-3],
        "external_jugular_vein": np.load(MESHES / "external_jugular_vein.npz")["centre"][1],
        "digastric_posterior_belly": mid("digastric_posterior_belly"),
        "smas_flap": outer_point("smas_flap", k=40),
        "barrier_graft": outer_point("barrier_graft", k=40),
        "sialocele_pocket": np.load(MESHES / "sialocele_pocket.npz")["positions"].mean(0),
        "recurrence_nodules": outer_point("recurrence_nodules", k=30),
        "scm_flap": outer_point("scm_flap", k=40),
        "needle": np.load(MESHES / "needle.npz")["positions"][::4].mean(0),
        "us_probe": us_probe_face(),
        "us_plane": np.load(MESHES / "us_plane.npz")["positions"][:4].mean(0),
        "ct_tumour_outline": np.load(MESHES / "ct_tumour_outline.npz")["positions"][::10].mean(0),
        "drain_tube": np.array(json.loads((ROOT / "pipeline/segment/work/drain.json").read_text())["nodes_mm"][4]),
        "auriculotemporal_nerve": np.load(MESHES / "auriculotemporal_nerve.npz")["centre"][-12],
        "facial_nerve_ic_buccal_a": mid("facial_nerve_ic_buccal_a"),
        "facial_nerve_ic_buccal_b": mid("facial_nerve_ic_buccal_b"),
        "facial_nerve_ic_divisions": mid("facial_nerve_ic_divisions"),
        "frey_regrowth": np.load(MESHES / "frey_regrowth.npz")["positions"][::20].mean(0),
        "pleomorphic_adenoma_deep": np.array(json.loads((SPECS / "tumour_alternates.resolved.json").read_text())["deep"]["centre_mm"]),
        "pleomorphic_adenoma_tail": np.array(json.loads((SPECS / "tumour_alternates.resolved.json").read_text())["tail"]["centre_mm"]),
        "pleomorphic_adenoma_accessory": np.array(json.loads((SPECS / "tumour_alternates.resolved.json").read_text())["accessory"]["centre_mm"]),
        "stimulator_probe": np.load(MESHES / "stimulator_probe.npz")["centre"][-6],
        "styloid_process": mid("styloid_process"),
        "stylomastoid_foramen": np.array(landmarks["stylomastoid_foramen"]["xyz"]),
        "tragal_pointer": np.array(landmarks["tragal_pointer"]["xyz"]),
        "tympanomastoid_suture": np.array(landmarks["tympanomastoid_dropoff"]["xyz"]),
        "mastoid_process": np.array(landmarks["mastoid_tip_visual"]["xyz"]),
        "masseter_r": np.array([63, 112, 236]),
        "parotid_deep_lobe": np.array([54, 72, 238]),
        "nerve_plane": np.array(nodes["cf_1"]) + [1, 6, 4],
        "smas": np.array(landmarks["parotid_anterior"]["xyz"]) + [12, 14, 6],
        "subcutaneous_fat": np.array(landmarks["parotid_anterior"]["xyz"]) + [14, 22, 20],
        "skin": np.array(landmarks["parotid_anterior"]["xyz"]) + [16, 34, 30],
        "parotid_fascia": np.array(landmarks["parotid_lateral"]["xyz"]) + [2, 8, 8],
        "sternocleidomastoid_r": lateral_point("sternocleidomastoid_r", a=(60, 72), s=(206, 220)),
        "mandible": np.array(landmarks["mandible_lower_border_mid"]["xyz"]),  # visible below the masseter
    }
    # Every mesh gets an anchor: authored where a label needs a particular point, otherwise a point on its lateral face.
    for sid in SCENE:
        if sid not in anchors:
            anchors[sid] = outer_point(sid, k=30)
    for sid, p in anchors.items():
        t = to_gltf(np.atleast_2d(p), origin)[0]
        gltf.nodes.append(g.Node(name=f"anchor__{sid}", translation=t.tolist()))  # "__": three.js sanitises "." out of node names
        gltf.scenes[0].nodes.append(len(gltf.nodes) - 1)

    gltf.buffers = [g.Buffer(byteLength=len(blob))]
    gltf.set_binary_blob(bytes(blob))
    gltf.save_binary(str(OUT / "slice.raw.glb"))
    peel = json.loads((MESHES / "peel.json").read_text(encoding="utf-8"))
    flap = json.loads((MESHES / "flap.json").read_text(encoding="utf-8"))
    bounds = {}
    for sid in SCENE:
        pos = to_gltf(np.load(MESHES / f"{sid}.npz")["positions"].astype(np.float64), origin)
        bounds[sid] = {"min": pos.min(0).round(5).tolist(), "max": pos.max(0).round(5).tolist()}
    # Named boxes for camera framing (structure records without a mesh): RAS mm corners (x lateral, y anterior, z up).
    for rid, (lo, hi) in {"incision_field": ([38, 30, 168], [105, 125, 298]), "portrait_field": ([-60, -45, 75], [95, 200, 400])}.items():
        corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])], float)
        gp = to_gltf(corners, origin)
        bounds[rid] = {"min": gp.min(0).round(5).tolist(), "max": gp.max(0).round(5).tolist()}
    # Groups (structure records with `members`) stand for several meshes: bounds are the union of the members'.
    groups = {}
    for f in sorted((ROOT / "apps/site/src/content/structures").glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        if rec.get("members"):
            groups[rec["id"]] = rec["members"]
    def leaves(sid):
        return [m for c in groups[sid] for m in (leaves(c) if c in groups else [c])]
    for gid in groups:
        mem = [bounds[m] for m in leaves(gid) if m in bounds]
        bounds[gid] = {"min": np.min([b["min"] for b in mem], 0).round(5).tolist(), "max": np.max([b["max"] for b in mem], 0).round(5).tolist()}
    # Complication territories on the skin: ellipsoids in glTF metres (anatomy.yaml `zones`).
    import yaml
    zspec = yaml.safe_load((SPECS / "anatomy.yaml").read_text(encoding="utf-8")).get("zones", {})
    skin_p = np.load(MESHES / "skin.npz")["positions"]
    zones = []
    for key, z in zspec.items():
        cx, cy, cz = z["centre"]
        if z.get("lateral"):
            near = skin_p[(np.abs(skin_p[:, 1] - cy) < 3) & (np.abs(skin_p[:, 2] - cz) < 3) & (skin_p[:, 0] > 20)]
            cx = float(near[:, 0].max()) - 1.0
        c = to_gltf(np.array([[cx, cy, cz]], float), origin)[0]
        zones.append({"key": key, "weight": z["weight"], "centre": c.round(6).tolist(), "radii": [z["radii"][0] * 0.001, z["radii"][2] * 0.001, z["radii"][1] * 0.001]})
    frame = {
        "description": "glTF = [-(x-ox), (z-oz), (y-oy)] * 0.001 from CT RAS mm (ADR-0002)",
        "origin_ras_mm": origin.tolist(),
        # Peel of the superficial lobe (and tumour) in glTF metres: fold about a vertical (Y) hinge on the lobe's
        # lateral surface (X = hinge_x), at a dissection front moving from front_z0 (posterior) to front_z1.
        "peel": {"hinge_x": -(peel["hinge_x"] - origin[0]) * 0.001, "front_z0": (peel["y_min"] - origin[1]) * 0.001, "front_z1": (peel["y_max"] - origin[1]) * 0.001},
        # Incision and flap (flap.py): fold axis (point in metres, unit direction) in the glTF frame; `cut`
        # attributes are stored as signed mm / cut_scale_mm.
        "flap": {"axis_point": to_gltf(np.array([flap["axis_point"]]), origin)[0].round(6).tolist(), "axis_dir": [0.0, flap["axis_dir"][2], flap["axis_dir"][1]], "max_angle": flap["max_angle_rad"], "cut_scale_mm": flap["cut_scale_mm"]},
        "bounds": bounds,
        # The one horizontal cut shared by the skin and the anatomy (anatomy.yaml face.scene_cut_z), glTF Y in metres:
        # the stage fades the anatomy into the field just above it (presentation).
        "scene_cut_y": round((yaml.safe_load((SPECS / "anatomy.yaml").read_text(encoding="utf-8"))["face"]["scene_cut_z"] - origin[2]) * 0.001, 6),
        "groups": groups,
        "zones": zones,
        "pieces": {k: {"volume_ml": p["volume_ml"], "share": p["share"]} for k, p in json.loads((MESHES / "pieces.json").read_text())["pieces"].items()} | {"total_gland_ml": json.loads((MESHES / "pieces.json").read_text())["total_gland_ml"]},
        "barriers": {"smas_hinge": [-(json.loads((ROOT / "pipeline/segment/work/barriers.json").read_text())["smas"]["hinge_x_mm"] - origin[0]) * 0.001, (json.loads((ROOT / "pipeline/segment/work/barriers.json").read_text())["smas"]["hinge_y_mm"] - origin[1]) * 0.001], "scm_pivot": to_gltf(np.array([json.loads((ROOT / "pipeline/segment/work/barriers.json").read_text())["scm"]["pivot_mm"]], float), origin)[0].round(6).tolist()},
        "imaging": {**json.loads((ROOT / "pipeline/segment/work/imaging.json").read_text()), "origin_ras_mm": origin.tolist()},
        "imaging": {**json.loads((ROOT / "pipeline/segment/work/imaging.json").read_text()), "origin_ras_mm": origin.tolist()},

        "structures": summary,
        "triangles_total": int(sum(v["triangles"] for v in summary.values())),
    }
    (OUT / "frame.json").write_text(json.dumps(frame, indent=2), encoding="utf-8")
    print(f"{len(summary)} structures, {frame['triangles_total']:,} triangles, {len(anchors)} anchors -> {OUT / 'slice.raw.glb'}")


if __name__ == "__main__":
    main()
