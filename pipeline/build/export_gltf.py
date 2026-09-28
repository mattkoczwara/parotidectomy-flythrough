"""Assemble the M1 slice scene as glTF 2.0 from pipeline/segment/work/meshes/*.npz.

    pipeline/segment/.venv/Scripts/python pipeline/build/export_gltf.py

Frame: the canonical CT RAS frame (mm) is mapped to glTF (metres, +Y up, model facing +Z):
    X = -(x - ox), Y = (z - oz), Z = (y - oy), scaled by 0.001, with origin o = right-parotid centroid.
This is a proper rotation (patient right = -X, the viewer's left when facing the model).

Every node is named with its structure id (the key used by content/structures and the stage). Custom per-vertex
attributes use glTF's underscore convention (_PEEL). Label anchors are empty nodes named `anchor__<structureId>`.
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
    "skin", "eyes", "subcutaneous_fat", "smas", "parotid_fascia",
    "parotid_superficial_lobe", "pleomorphic_adenoma", "parotid_deep_lobe",
    "facial_nerve_trunk", "facial_nerve_temporofacial", "facial_nerve_cervicofacial", "facial_nerve_temporal",
    "facial_nerve_zygomatic", "facial_nerve_buccal", "facial_nerve_marginal_mandibular", "facial_nerve_cervical",
    "facial_nerve_posterior_auricular", "facial_nerve_digastric_branch",
    "great_auricular_nerve", "great_auricular_nerve_anterior", "great_auricular_nerve_posterior",
    "retromandibular_vein", "retromandibular_vein_anterior", "retromandibular_vein_posterior", "external_jugular_vein",
    "external_carotid_artery", "maxillary_artery", "superficial_temporal_artery",
    "masseter_r", "temporalis_r", "sternocleidomastoid_r", "digastric_posterior_belly", "submandibular_gland_r",
    "internal_jugular_vein_r", "mandible", "skull", "styloid_process", "nerve_plane",
]
ATTRS = {"peel_order": "_PEEL"}


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
        idx = d["indices"].astype(np.uint32)
        attrs = {"POSITION": add_accessor(pos, "VEC3", g.ARRAY_BUFFER, True), "NORMAL": add_accessor(nrm, "VEC3", g.ARRAY_BUFFER)}
        for key, name in ATTRS.items():
            if key in d.files:
                attrs[name] = add_accessor(d[key].astype(np.float32), "SCALAR", g.ARRAY_BUFFER)
        prim = g.Primitive(attributes=g.Attributes(**attrs), indices=add_accessor(idx, "SCALAR", g.ELEMENT_ARRAY_BUFFER), material=0)
        gltf.meshes.append(g.Mesh(name=sid, primitives=[prim]))
        gltf.nodes.append(g.Node(name=sid, mesh=len(gltf.meshes) - 1))
        gltf.scenes[0].nodes.append(len(gltf.nodes) - 1)
        summary[sid] = {"vertices": int(len(pos)), "triangles": int(len(idx) // 3)}

    # Label anchors: authored points in the CT frame.
    nodes = json.loads((SPECS / "nodes.resolved.json").read_text(encoding="utf-8"))
    def mid(sid):
        c = np.load(MESHES / f"{sid}.npz")["centre"]
        return c[len(c) // 2]
    anchors = {
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
        "great_auricular_nerve": mid("great_auricular_nerve"),
        "digastric_posterior_belly": mid("digastric_posterior_belly"),
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
        "sternocleidomastoid_r": np.array(landmarks["mastoid_tip_visual"]["xyz"]) + [8, -2, -40],
        "mandible": np.array(landmarks["mandible_lower_border_mid"]["xyz"]),  # visible below the masseter
    }
    for sid, p in anchors.items():
        t = to_gltf(np.atleast_2d(p), origin)[0]
        gltf.nodes.append(g.Node(name=f"anchor__{sid}", translation=t.tolist()))  # "__": three.js sanitises "." out of node names
        gltf.scenes[0].nodes.append(len(gltf.nodes) - 1)

    gltf.buffers = [g.Buffer(byteLength=len(blob))]
    gltf.set_binary_blob(bytes(blob))
    gltf.save_binary(str(OUT / "slice.raw.glb"))
    peel = json.loads((MESHES / "peel.json").read_text(encoding="utf-8"))
    bounds = {}
    for sid in SCENE:
        pos = to_gltf(np.load(MESHES / f"{sid}.npz")["positions"].astype(np.float64), origin)
        bounds[sid] = {"min": pos.min(0).round(5).tolist(), "max": pos.max(0).round(5).tolist()}
    frame = {
        "description": "glTF = [-(x-ox), (z-oz), (y-oy)] * 0.001 from CT RAS mm (ADR-0002)",
        "origin_ras_mm": origin.tolist(),
        # Peel of the superficial lobe (and tumour) in glTF metres: fold about a vertical (Y) hinge on the lobe's
        # lateral surface (X = hinge_x), at a dissection front moving from front_z0 (posterior) to front_z1.
        "peel": {"hinge_x": -(peel["hinge_x"] - origin[0]) * 0.001, "front_z0": (peel["y_min"] - origin[1]) * 0.001, "front_z1": (peel["y_max"] - origin[1]) * 0.001},
        "bounds": bounds,
        "structures": summary,
        "triangles_total": int(sum(v["triangles"] for v in summary.values())),
    }
    (OUT / "frame.json").write_text(json.dumps(frame, indent=2), encoding="utf-8")
    print(f"{len(summary)} structures, {frame['triangles_total']:,} triangles, {len(anchors)} anchors -> {OUT / 'slice.raw.glb'}")


if __name__ == "__main__":
    main()
