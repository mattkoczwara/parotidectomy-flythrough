"""Closure barriers and the saliva collection (M3/M4 plates).

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/barriers.py      (after pieces.py, props.py and flap.py)

* smas_flap          the SMAS and parotid fascia over the outer lobe as a sheet hinged on its anterior edge (claim
                     barrier-options): raised during the dissection, laid back over the bed at closure. `foldw` is 0 at the
                     hinge and 1 at the free edge.
* sternocleidomastoid_main, scm_flap   the sternocleidomastoid split into the muscle that stays and a superiorly based strip
                     of its anterior part that can be turned up into the bed (rigid turn about the strip's upper end).
* barrier_graft      a thin sheet laid on the exposed bed (the cut faces of the inner levels): the "other barrier" (fascia, dermal
                     matrix or fat graft), drawn as a plain sheet; which material is not distinguished.
* sialocele_pocket   a schematic collection of saliva under the flap (line grammar), for the complications chapter.
* recurrence_nodules a few small nodules in the bed where the tumour lay (line grammar): recurrent pleomorphic adenoma is
                     typically multinodular (claim recurrence-factors); a schematic cluster, not a predicted site.
Writes work/meshes/<id>.npz, work/barriers.json (pivots, read by export_gltf.py) and appends checks.
"""
import json

import nibabel as nib
import numpy as np
import trimesh
import yaml
from scipy import ndimage
from scipy.interpolate import RBFInterpolator

from common import ROOT, WORK
from surfaces import OUT, QC, SEG, lobulated, mesh_from_mask


def save(mid, m: trimesh.Trimesh, **attrs):
    np.savez_compressed(
        OUT / f"{mid}.npz",
        positions=m.vertices.astype(np.float32),
        normals=m.vertex_normals.astype(np.float32),
        indices=m.faces.astype(np.uint32).ravel(),
        kind="surface",
        **{k: np.asarray(v, np.float32) for k, v in attrs.items()},
    )
    print(f"{mid}: {len(m.faces)} triangles")


def sheet(mesh: trimesh.Trimesh, keep: np.ndarray) -> trimesh.Trimesh:
    """The open sheet formed by the faces selected by `keep`."""
    m = trimesh.Trimesh(mesh.vertices, mesh.faces[keep], process=False)
    m.remove_unreferenced_vertices()
    return m


def main() -> None:
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))["barriers"]
    g = np.load(WORK / "gland_masks.npz")
    rbf = RBFInterpolator(g["nerve_pts"][:, 1:], g["nerve_pts"][:, 0], kernel="thin_plate_spline", smoothing=40.0, degree=1)
    checks_path = QC / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8"))
    info = {}

    # ── SMAS / fascia flap ──────────────────────────────────────────────────────────────
    S = spec["smas"]
    d = np.load(OUT / "parotid_fascia.npz")
    fascia = trimesh.Trimesh(d["positions"], d["indices"].reshape(-1, 3), process=False)
    c = fascia.triangles_center
    lateral = (c[:, 0] > rbf(c[:, 1:]) + S["lateral_of_plane_mm"]) & (fascia.face_normals[:, 0] > S["normal_x_min"])
    flap = sheet(fascia, lateral)
    flap.vertices = flap.vertices + flap.vertex_normals * S["offset_mm"]
    y = flap.vertices[:, 1]
    foldw = (y.max() - y) / (y.max() - y.min())
    save("smas_flap", flap, foldw=foldw)
    info["smas"] = {"hinge_y_mm": float(y.max()), "free_y_mm": float(y.min()), "hinge_x_mm": float(flap.vertices[:, 0].max())}

    # ── the graft sheet on the bed: cut faces of levels III and IV, offset off the surface ───────────────
    G = spec["graft"]
    parts = []
    for pid in ("parotid_level_3", "parotid_level_4"):
        p = np.load(OUT / f"{pid}.npz")
        m = trimesh.Trimesh(p["positions"], p["indices"].reshape(-1, 3), process=False)
        cut = p["cutface"][m.faces].mean(1) > G["cutface_min"]
        facing = m.face_normals[:, 0] > G["normal_x_min"]
        parts.append(sheet(m, cut & facing))
    graft = trimesh.util.concatenate(parts)
    graft.vertices = graft.vertices + graft.vertex_normals * G["offset_mm"]
    save("barrier_graft", graft)

    # ── the sternocleidomastoid split ─────────────────────────────────────────────────────
    C = spec["scm"]
    img = nib.load(str(SEG / "headneck_muscles/sternocleidomastoid_right.nii.gz"))
    aff = img.affine
    mask = np.asarray(img.dataobj) > 0
    idx = np.argwhere(mask)
    w = nib.affines.apply_affine(aff, idx)
    strip_sel = np.zeros(len(idx), bool)
    for z in np.unique(np.round(w[:, 2]).astype(int)):
        if not (C["z_range_mm"][0] <= z <= C["z_range_mm"][1]):
            continue
        sel = np.round(w[:, 2]).astype(int) == z
        ys = w[sel, 1]
        lo, hi = ys.min(), ys.max()
        strip_sel[np.nonzero(sel)[0][ys > lo + C["posterior_fraction"] * (hi - lo)]] = True
    strip = np.zeros(mask.shape, bool)
    strip[tuple(idx[strip_sel].T)] = True
    strip = ndimage.binary_opening(strip, iterations=1)
    main_mask = mask & ~strip
    save("sternocleidomastoid_main", mesh_from_mask(main_mask, aff, 11000, sigma=0.9, smooth_iter=6, level=0.45))
    flap_m = mesh_from_mask(strip, aff, 6000, sigma=0.9, smooth_iter=6, level=0.45)
    save("scm_flap", flap_m)
    sw = nib.affines.apply_affine(aff, np.argwhere(strip))
    top = sw[:, 2].max()
    upper = sw[sw[:, 2] > top - 6]
    pivot = [float(upper[:, 0].mean()), float(upper[:, 1].mean()), float(top)]
    info["scm"] = {"pivot_mm": pivot, "strip_ml": round(float(strip.sum() * np.prod(img.header.get_zooms()[:3]) / 1000), 1), "length_mm": float(top - sw[:, 2].min())}

    # ── saliva collection (schematic) ───────────────────────────────────────────────────────
    P = spec["sialocele"]
    pocket = lobulated(P["centre"], P["radii"], P["seed"], subdiv=3)
    save("sialocele_pocket", pocket)

    # ── recurrence nodules (schematic) ──────────────────────────────────────────────────────
    R = spec["recurrence"]
    tc = np.array(json.loads((ROOT / "pipeline/specs/tumour.resolved.json").read_text())["center"], float)
    nodules = [lobulated(tc + np.array(o, float), [r, r * 0.9, r * 1.05], R["seed"] + k, subdiv=3) for k, (o, r) in enumerate(zip(R["offsets_mm"], R["radii_mm"]))]
    save("recurrence_nodules", trimesh.util.concatenate(nodules))

    (WORK / "barriers.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    checks["barriers"] = {"pass": True, "summary": f"SMAS flap sheet, graft sheet, SCM strip {info['scm']['strip_ml']} mL ({info['scm']['length_mm']:.0f} mm long, hinged at its upper end), sialocele pocket, recurrence nodules", **info}
    checks_path.write_text(json.dumps(checks, indent=2), encoding="utf-8")
    print(checks["barriers"]["summary"])


if __name__ == "__main__":
    main()
