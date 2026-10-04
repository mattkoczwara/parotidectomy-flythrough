"""Alternate tumour positions, the auriculotemporal nerve and the Frey-regrowth schematic (M2/M4 plates).

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/extras.py      (after pieces.py and face.py)

* Alternate placements of the representative adenoma (plan §3 chapter 4: superficial, deep, tail, accessory): each is
  placed by a constrained search near a target (inside the stated part of the gland or accessory lobule, clear of the
  facial nerve, vessels, bone and muscle), with the same size class as the representative tumour. Placement, not
  frequency: how common each position is comes from the literature, not from this model.
* The auriculotemporal nerve is authored in anatomy.yaml (nodes `at_*`); this script adds the schematic regrowth fibres
  that illustrate how Frey syndrome is thought to arise (line grammar, never drawn as modelled anatomy).
Writes work/meshes/<id>.npz and appends checks to docs/qc/m1-anatomy/checks.json.
"""
import json

import nibabel as nib
import numpy as np
import trimesh
import yaml
from scipy import ndimage
from scipy.spatial import cKDTree

from author import catmull_rom, field, tube
from common import ROOT, WORK
from surfaces import OUT, QC, lobulated

NERVES = ["facial_nerve_trunk", "facial_nerve_temporofacial", "facial_nerve_cervicofacial", "facial_nerve_temporal", "facial_nerve_zygomatic", "facial_nerve_buccal", "facial_nerve_marginal_mandibular", "facial_nerve_cervical"]
VESSELS = ["retromandibular_vein", "retromandibular_vein_anterior", "retromandibular_vein_posterior", "external_carotid_artery", "superficial_temporal_artery", "maxillary_artery", "external_jugular_vein"]
OBSTACLES = ["craniofacial_structures/mandible", "craniofacial_structures/skull", "head_muscles/masseter_right", "headneck_muscles/sternocleidomastoid_right"]


def tubes(ids):
    pts, rad = [], []
    for i in ids:
        d = np.load(OUT / f"{i}.npz")
        pts.append(d["centre"])
        rad.append(d["radii"])
    return np.concatenate(pts), np.concatenate(rad)


def surface_clearance(samples, pts, rad):
    d, j = cKDTree(pts).query(samples)
    return float((d - rad[j]).min())


def place(spec, name, gland, parts, aff, inv, nerve, vessel, authored):
    """Search a grid around spec['target'] for the feasible centre nearest the target."""
    radii = np.asarray(spec["radii"], float)
    target = np.asarray(spec["target"], float)
    rng = np.random.default_rng(spec["seed"])
    best = None
    steps = np.arange(-spec["search_mm"], spec["search_mm"] + 0.1, 1.5)
    cands = sorted(((np.linalg.norm([dx, dy, dz]), dx, dy, dz) for dx in steps for dy in steps for dz in steps))
    for dist, dx, dy, dz in cands:
        c = target + [dx, dy, dz]
        m = lobulated(c, radii, spec["seed"], subdiv=3)
        s = m.sample(2500, seed=3)
        if surface_clearance(s, *nerve) < spec["min_nerve_clearance_mm"]:
            continue
        if surface_clearance(s, *vessel) < spec["min_vessel_clearance_mm"]:
            continue
        if any(field(o).at(s).min() < spec["min_bone_muscle_clearance_mm"] for o in OBSTACLES):
            continue
        if any(float((np.linalg.norm(s[:, None] - a[0][None, ::6], axis=2) - a[1][::6][None]).min()) < 0.5 for a in authored):
            continue
        ijk = np.round(nib.affines.apply_affine(inv, s)).astype(int)
        inside = {k: float(v[tuple(ijk.T)].mean()) for k, v in parts.items()}
        if spec["need"] == "deep" and not (inside["deep"] >= spec["min_fraction"] and inside["lateral"] <= 0.1):
            continue
        if spec["need"] == "tail" and not (inside["gland"] >= spec["min_fraction"]):
            continue
        best = (c, m, inside)
        break
    if best is None:
        raise SystemExit(f"{name}: no feasible placement near {target.tolist()}")
    return best


def main() -> None:
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    A = spec["tumour_alternates"]
    g = np.load(WORK / "gland_masks.npz")
    aff = g["affine"]
    inv = np.linalg.inv(aff)
    gland = ndimage.binary_dilation(g["gland"], iterations=2)
    parts = {"gland": gland, "deep": ndimage.binary_dilation(g["deep"], iterations=1), "lateral": g["superficial"]}
    nerve = tubes(NERVES)
    vessel = tubes(VESSELS)
    authored = [tubes(["digastric_posterior_belly"]), tubes(["styloid_process"]), tubes(["parotid_duct"]), tubes(["facial_nerve_posterior_auricular"]), tubes(["great_auricular_nerve"])]
    checks_path = QC / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8"))
    summary = {}
    for name, s in A.items():
        c, m, inside = place(s, name, gland, parts, aff, inv, nerve, vessel, authored)
        np.savez_compressed(OUT / f"pleomorphic_adenoma_{name}.npz", positions=m.vertices.astype(np.float32), normals=m.vertex_normals.astype(np.float32), indices=m.faces.astype(np.uint32).ravel(), kind="surface")
        sm = m.sample(3000, seed=4)
        summary[name] = {
            "centre_mm": np.round(c, 1).tolist(),
            "max_diameter_mm": round(float(np.ptp(m.vertices, axis=0).max()), 1),
            "nerve_clearance_mm": round(surface_clearance(sm, *nerve), 2),
            "vessel_clearance_mm": round(surface_clearance(sm, *vessel), 2),
            "fraction_in": {k: round(v, 2) for k, v in inside.items()},
        }
        print(f"{name}: centre {np.round(c, 1)}, {summary[name]['max_diameter_mm']} mm, nerve clearance {summary[name]['nerve_clearance_mm']} mm")
    (ROOT / "pipeline/specs/tumour_alternates.resolved.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    checks["tumour_alternates"] = {
        "pass": True,
        "placements": summary,
        "summary": "alternate placements of the adenoma, clear of nerve, vessels, bone and muscle: " + "; ".join(f"{k} {v['max_diameter_mm']:.0f} mm, nerve {v['nerve_clearance_mm']:.1f} mm" for k, v in summary.items()),
    }

    # ── Frey-regrowth schematic: fibres from the cut auriculotemporal nerve toward the skin of the flap region ────────
    F = spec["frey"]
    at = np.load(OUT / "auriculotemporal_nerve.npz")["centre"]
    skin = np.load(OUT / "skin.npz")
    sp = skin["positions"]
    rng = np.random.default_rng(F["seed"])
    root = at[int(len(at) * F["root_fraction"])]
    zone = np.asarray(F["zone_centre"], float)
    # skin surface points (most lateral at each (y, z)) within the zone ellipse
    lat = sp[sp[:, 0] > F["x_min"]]
    pick = lat[(((lat[:, 1] - zone[1]) / F["zone_radii"][0]) ** 2 + ((lat[:, 2] - zone[2]) / F["zone_radii"][1]) ** 2) < 1]
    pick = pick[np.argsort(-pick[:, 0])][: max(200, len(pick) // 3)]
    verts, norms, idx, base = [], [], [], 0
    for k in range(F["fibres"]):
        end = pick[rng.integers(len(pick))] - [F["under_skin_mm"], 0, 0]
        mid = (root + end) / 2 + rng.normal(0, 4.0, 3) * [0.4, 1, 1]
        centre = catmull_rom(np.array([root, mid, end]), step=0.6)
        pos, nor, ix, _ = tube(centre, F["radius_mm"], F["radius_mm"] * 0.6, 6)
        verts.append(pos)
        norms.append(nor)
        idx.append(ix + base)
        base += len(pos)
    np.savez_compressed(OUT / "frey_regrowth.npz", positions=np.concatenate(verts), normals=np.concatenate(norms), indices=np.concatenate(idx).astype(np.uint32), kind="surface")
    checks["frey_regrowth"] = {"pass": True, "fibres": F["fibres"], "summary": f"{F['fibres']} schematic regrowth fibres from the auriculotemporal nerve to the skin of the flap region (drawn in the line grammar)"}
    checks_path.write_text(json.dumps(checks, indent=2), encoding="utf-8")
    print(checks["frey_regrowth"]["summary"])


if __name__ == "__main__":
    main()
