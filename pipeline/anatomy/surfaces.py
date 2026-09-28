"""Surface meshes for the scene: segmented structures, tissue layers, the pleomorphic adenoma, and the
superficial/deep split of the parotid along the facial-nerve plane.

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/surfaces.py

Reads the segmentations, pipeline/specs/anatomy.yaml (tumour, layers) and the authored nerve centrelines
(work/meshes/facial_nerve_*.npz, from author.py). Writes work/meshes/<id>.npz and appends its checks to
docs/qc/m1-anatomy/checks.json.
"""
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
import yaml
from scipy import ndimage
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree
from skimage import measure

from common import body_mask, load_ct

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work"
SEG = WORK / "seg"
OUT = WORK / "meshes"
QC = ROOT / "docs/qc/m1-anatomy"

SEGMENTED = {
    # id: (mask, triangle budget)
    "mandible": ("craniofacial_structures/mandible", 40000),
    "skull": ("craniofacial_structures/skull", 90000),
    "masseter_r": ("head_muscles/masseter_right", 12000),
    "temporalis_r": ("head_muscles/temporalis_right", 10000),
    "sternocleidomastoid_r": ("headneck_muscles/sternocleidomastoid_right", 12000),
    "internal_jugular_vein_r": ("headneck_bones_vessels/internal_jugular_vein_right", 6000),
    "submandibular_gland_r": ("head_glands_cavities/submandibular_gland_right", 6000),
}


def mesh_from_mask(mask: np.ndarray, affine: np.ndarray, budget: int, sigma: float = 1.0, smooth_iter: int = 8) -> trimesh.Trimesh:
    vol = ndimage.gaussian_filter(np.pad(mask.astype(np.float32), 2), sigma)
    verts, faces, _, _ = measure.marching_cubes(vol, 0.5)
    verts -= 2
    m = trimesh.Trimesh(nib.affines.apply_affine(affine, verts), faces[:, ::-1] if np.linalg.det(affine[:3, :3]) < 0 else faces, process=True)
    trimesh.smoothing.filter_taubin(m, iterations=smooth_iter)
    if len(m.faces) > budget:
        m = m.simplify_quadric_decimation(face_count=budget)
    m.fix_normals()
    return m


SCENE_CUT_Z = 150.0  # mm; shared with face.py (anatomy.yaml face.scene_cut_z)


def save(mid: str, m: trimesh.Trimesh, **attrs):
    if m.vertices[:, 2].min() < SCENE_CUT_Z and not attrs:
        # crop at the scene's neck cut, capping the section so it reads as a cut surface
        m = m.slice_plane([0, 0, SCENE_CUT_Z], [0, 0, 1], cap=True)
    np.savez_compressed(
        OUT / f"{mid}.npz",
        positions=m.vertices.astype(np.float32),
        normals=m.vertex_normals.astype(np.float32),
        indices=m.faces.astype(np.uint32).ravel(),
        kind="surface",
        **{k: np.asarray(v, dtype=np.float32) for k, v in attrs.items()},
    )


def lobulated(center, radii, seed, subdiv=4) -> trimesh.Trimesh:
    rng = np.random.default_rng(seed)
    m = trimesh.creation.icosphere(subdivisions=subdiv)
    d = m.vertices / np.linalg.norm(m.vertices, axis=1, keepdims=True)
    bumps = rng.normal(size=(40, 3))
    bumps /= np.linalg.norm(bumps, axis=1, keepdims=True)
    amp = 0.06 * (0.5 + rng.random(40))
    r = 1 + (np.clip(d @ bumps.T, 0, None) ** 14 * amp).sum(1)
    m.vertices = d * r[:, None] * np.asarray(radii) + np.asarray(center)
    trimesh.smoothing.filter_taubin(m, iterations=4)
    return m


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    checks_path = QC / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8")) if checks_path.exists() else {}

    ref = nib.load(str(SEG / "head_glands_cavities/parotid_gland_right.nii.gz"))
    aff = ref.affine
    zooms = ref.header.get_zooms()[:3]
    load = lambda rel: np.asarray(nib.load(str(SEG / f"{rel}.nii.gz")).dataobj) > 0

    for mid, (rel, budget) in SEGMENTED.items():
        save(mid, mesh_from_mask(load(rel), aff, budget))
        print("segmented", mid)

    # ── Solid body and depth below the CT skin (layer shells are built by layers.py from the final skin) ────────────────────────────────
    ct, _, _ = load_ct()
    head = body_mask(ct)  # solid body; see common.body_mask
    parotid = load("head_glands_cavities/parotid_gland_right")
    depth = ndimage.distance_transform_edt(head, sampling=zooms)  # mm below the skin
    layers = spec["layers"]

    # ── Nerve plane and lobe split ────────────────────────────────────────────────────────
    ids = ["facial_nerve_trunk", "facial_nerve_temporofacial", "facial_nerve_cervicofacial", "facial_nerve_temporal", "facial_nerve_zygomatic", "facial_nerve_buccal", "facial_nerve_marginal_mandibular", "facial_nerve_cervical"]
    pts = np.concatenate([np.load(OUT / f"{i}.npz")["centre"] for i in ids])
    par_world = nib.affines.apply_affine(aff, np.argwhere(parotid))
    lo, hi = par_world.min(0) - 16, par_world.max(0) + 6
    keep = np.all((pts >= lo) & (pts <= hi), axis=1)
    pts = pts[keep]
    # Height field x = h(y, z): the nerve plane as a smooth sheet through the nerve inside the gland.
    rbf = RBFInterpolator(pts[:, 1:], pts[:, 0], kernel="thin_plate_spline", smoothing=40.0, degree=1)
    # ── Deep-lobe completion (authored region; see anatomy.yaml `deep_lobe_completion`) ─────
    g = spec["deep_lobe_completion"]
    blocked = np.zeros_like(parotid)
    for rel in g["exclude"]:
        blocked |= load(rel)
    blocked = ndimage.binary_dilation(blocked, iterations=1)
    near = ndimage.distance_transform_edt(~parotid, sampling=zooms) <= g["max_mm_from_segmented"]
    cand_idx = np.argwhere(near & ~blocked & head & (depth > layers["smas_depth_mm"] + layers["smas_thickness_mm"]))
    cw = nib.affines.apply_affine(aff, cand_idx)
    # posterior border of the ramus per axial level (most posterior right-mandible voxel)
    mand_w = nib.affines.apply_affine(aff, np.argwhere(load("craniofacial_structures/mandible")))
    mand_w = mand_w[mand_w[:, 0] > 15]
    zb = np.round(mand_w[:, 2]).astype(int)
    border = {z: mand_w[zb == z, 1].min() for z in np.unique(zb)}
    ramus_y = np.array([border.get(int(round(z)), np.inf) for z in cw[:, 2]])
    ok = (cw[:, 0] < rbf(cw[:, 1:])) & (cw[:, 0] > g["medial_limit_x"]) & (cw[:, 1] < ramus_y - g["ramus_margin_mm"]) & (cw[:, 2] >= g["z_range"][0]) & (cw[:, 2] <= g["z_range"][1])
    # keep clear of the authored digastric belly and styloid
    for sid in g["exclude_authored"]:
        tdat = np.load(OUT / f"{sid}.npz")
        dist, j = cKDTree(tdat["centre"]).query(cw)
        ok &= dist > tdat["radii"][j] + g["authored_margin_mm"]
    region = np.zeros_like(parotid)
    region[tuple(cand_idx[ok].T)] = True
    lab, _ = ndimage.label(region | parotid)
    grown = np.isin(lab, np.unique(lab[parotid])) & (region | parotid)
    grown = ndimage.binary_closing(grown, iterations=2) & (grown | region) | parotid
    added_ml = float((grown & ~parotid).sum() * np.prod(zooms) / 1000)
    checks["deep_lobe_completion"] = {"pass": True, "method": "authored region (anatomical bounds; CT does not resolve the deep-lobe boundary)", "added_ml": round(added_ml, 2), "summary": f"authored retromandibular portion adds {added_ml:.1f} mL to the {parotid.sum() * np.prod(zooms) / 1000:.1f} mL segmented gland"}
    original = parotid
    parotid = grown
    save("parotid_gland_r_complete", mesh_from_mask(parotid, aff, 20000, sigma=0.8, smooth_iter=6))
    # The capsule as a closed surface about 1.5 mm outside the gland (a one-voxel shell's inner and outer
    # surfaces crossed after smoothing and rendered as stripes). The cutaway window reveals the gland inside it.
    fascia = ndimage.binary_dilation(parotid, iterations=2)
    save("parotid_fascia", mesh_from_mask(fascia, aff, 20000, sigma=0.8, smooth_iter=6))

    superficial = parotid.copy()
    coords = nib.affines.apply_affine(aff, np.argwhere(parotid))
    lateral = coords[:, 0] > rbf(coords[:, 1:])
    idx = np.argwhere(parotid)
    superficial[:] = False
    superficial[tuple(idx[lateral].T)] = True
    deep = parotid & ~superficial
    frac = float(superficial.sum() / parotid.sum())
    rng = spec["checks"]["superficial_fraction"]["range"]
    # Reported against the literature, not used to tune geometry: an individual gland may differ.
    checks["superficial_fraction"] = {"pass": rng[0] <= frac <= rng[1], "value": round(frac, 3), "range": rng, "summary": f"{frac:.1%} of the completed gland lies lateral to the nerve plane (Pujol-Olmo 2020: 61–69% by weight in 19 specimens; reported, not tuned)"}
    # The retromandibular vein runs within the gland, deep to the nerve (claim eca-rmv-in-gland).
    rmv = np.load(OUT / "retromandibular_vein.npz")["centre"]
    rmv_in = rmv[(rmv[:, 2] > g["z_range"][0] + 4) & (rmv[:, 2] < g["z_range"][1] - 4)]
    ijk_r = np.round(nib.affines.apply_affine(np.linalg.inv(aff), rmv_in)).astype(int)
    frac_in = float(ndimage.binary_dilation(parotid, iterations=1)[tuple(ijk_r.T)].mean())
    checks["vessels_within_gland"] = {"pass": frac_in >= 0.8, "rmv_fraction_in_gland": round(frac_in, 2), "summary": f"{frac_in:.0%} of the retromandibular vein centreline within the gland between its entry and lower pole"}

    sup_mesh = mesh_from_mask(superficial, aff, 16000, sigma=0.8, smooth_iter=6)
    deep_mesh = mesh_from_mask(deep, aff, 12000, sigma=0.8, smooth_iter=6)
    # Plane sheet for display and the plane gauge: sample the height field over the gland footprint.
    ys = np.linspace(lo[1] + 4, hi[1] - 4, 40)
    zs = np.linspace(lo[2] + 4, hi[2] - 4, 50)
    Y, Z = np.meshgrid(ys, zs, indexing="ij")
    X = rbf(np.c_[Y.ravel(), Z.ravel()]).reshape(Y.shape)
    V = np.stack([X, Y, Z], -1).reshape(-1, 3)
    F = []
    for i in range(len(ys) - 1):
        for j in range(len(zs) - 1):
            a = i * len(zs) + j
            F += [[a, a + len(zs), a + 1], [a + 1, a + len(zs), a + len(zs) + 1]]
    plane = trimesh.Trimesh(V, np.array(F), process=False)
    save("nerve_plane", plane)

    # ── Tumour ─────────────────────────────────────────────────────────────────────────
    t = spec["tumour"]
    tumour = lobulated(t["center"], t["radii"], t["seed"])
    nerve_all = np.concatenate([np.load(OUT / f"{i}.npz")["centre"] for i in ids])
    nerve_r = np.concatenate([np.load(OUT / f"{i}.npz")["radii"] for i in ids])
    # Clearance: distance from nerve centrelines to the tumour surface minus nerve radius; the tumour is
    # star-shaped about its centre, so a nerve point is inside if it is nearer the centre than the surface there.
    surf = tumour.sample(30000, seed=4)
    dist, k = cKDTree(surf).query(nerve_all)
    c0 = np.asarray(t["center"])
    inside = np.linalg.norm(nerve_all - c0, axis=1) < np.linalg.norm(surf[k] - c0, axis=1)
    clearance = float(np.where(inside, -dist, dist - nerve_r).min())
    tv = tumour.sample(4000, seed=3)
    tumour_lateral = float((tv[:, 0] > rbf(tv[:, 1:])).mean())
    ijk_t = np.round(nib.affines.apply_affine(np.linalg.inv(aff), tv)).astype(int)
    inside_gland = float(ndimage.binary_dilation(parotid, iterations=3)[tuple(ijk_t.T)].mean())
    checks["tumour_placement"] = {
        "pass": clearance >= t["min_nerve_clearance_mm"] and tumour_lateral >= 0.9 and inside_gland >= t["min_within_gland"],
        "nerve_clearance_mm": round(clearance, 2),
        "fraction_lateral_to_nerve_plane": round(tumour_lateral, 3),
        "fraction_within_gland": round(inside_gland, 3),
        "max_diameter_mm": round(float(np.ptp(tumour.vertices, axis=0).max()), 1),
        "summary": f"{np.ptp(tumour.vertices, axis=0).max():.0f} mm, {tumour_lateral:.0%} superficial to the nerve plane, {inside_gland:.0%} within the gland, nerve clearance {clearance:.1f} mm",
    }

    # ── Peel field on the superficial lobe (and tumour, which travels with it) ─────────────
    # d = 0 at the posterior (trunk) border, 1 at the anterior border: antegrade dissection order.
    y0, y1 = sup_mesh.vertices[:, 1].min(), sup_mesh.vertices[:, 1].max()
    peel = lambda v: (v[:, 1] - y0) / (y1 - y0)
    hinge_x = float(np.percentile(sup_mesh.vertices[:, 0], 99))
    save("parotid_superficial_lobe", sup_mesh, peel_order=peel(sup_mesh.vertices))
    save("parotid_deep_lobe", deep_mesh)
    save("pleomorphic_adenoma", tumour, peel_order=peel(tumour.vertices))
    (ROOT / "pipeline/specs/tumour.resolved.json").write_text(json.dumps({"center": [float(v) for v in tumour.vertices.mean(0)], "max_diameter_mm": float(np.ptp(tumour.vertices, axis=0).max())}, indent=2) + chr(10), encoding="utf-8")
    (OUT / "peel.json").write_text(json.dumps({"y_min": float(y0), "y_max": float(y1), "hinge_x": hinge_x, "axis": "z (superior)"}, indent=2), encoding="utf-8")

    checks_path.write_text(json.dumps(checks, indent=2), encoding="utf-8")
    render_split_qc(ct, aff, original, parotid, superficial, rbf, tumour)
    for k in ("deep_lobe_completion", "superficial_fraction", "tumour_placement", "vessels_within_gland"):
        v = checks[k]
        print(f"{'PASS' if v['pass'] else 'FAIL'}  {k}: {v['summary']}")


def render_split_qc(ct, aff, original, gland, superficial, rbf, tumour):
    """Axial and coronal CT (narrow window, anterior up, lateral left) with the segmented gland, the grown deep
    portion, the nerve-plane trace, the tumour outline and authored tube cross-sections."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    inv = np.linalg.inv(aff)
    tubes = {n: np.load(OUT / f"{n}.npz") for n in ("facial_nerve_trunk", "facial_nerve_temporofacial", "facial_nerve_cervicofacial", "facial_nerve_buccal", "facial_nerve_marginal_mandibular", "facial_nerve_cervical", "facial_nerve_zygomatic", "retromandibular_vein", "external_carotid_artery", "digastric_posterior_belly", "styloid_process")}
    col = lambda n: "#f3e7a8" if n.startswith("facial") else "#6c86c4" if "vein" in n else "#e0484d" if "artery" in n else "#c77dff" if "digastric" in n else "#ffffff"
    x0, x1, y0, y1 = 30, 92, 50, 115
    levels = [254, 248, 242, 236, 230, 224, 218, 210]
    fig, axes = plt.subplots(2, 4, figsize=(24, 13), dpi=95)
    grown_only = gland & ~original
    deep_part = gland & ~superficial
    for ax, z in zip(axes.ravel(), levels):
        k = int(round(nib.affines.apply_affine(inv, [0, 0, z])[2]))
        i0, i1 = int(nib.affines.apply_affine(inv, [x1, 0, 0])[0]), int(nib.affines.apply_affine(inv, [x0, 0, 0])[0])
        j0, j1 = int(nib.affines.apply_affine(inv, [0, y1, 0])[1]), int(nib.affines.apply_affine(inv, [0, y0, 0])[1])
        ax.imshow(ct[i0:i1, j0:j1, k].T, cmap="gray", vmin=-120, vmax=140, extent=[x1, x0, y0, y1], origin="upper")
        to_xy = lambda c: (x1 - c[:, 0] * 0.75, y1 - c[:, 1] * 0.75)
        for m, color, ls in ((original, "#ff9a3c", "-"), (grown_only, "#ffe14d", "-"), (deep_part, "#00d0ff", ":")):
            for c in measure.find_contours(m[i0:i1, j0:j1, k].astype(float), 0.5):
                ax.plot(*to_xy(c), color=color, lw=1.1, ls=ls)
        ys = np.linspace(y0, y1, 80)
        ax.plot(rbf(np.c_[ys, np.full_like(ys, z)]), ys, color="#00d0ff", lw=0.8, alpha=0.8)
        sec = tumour.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        if sec is not None:
            for poly in sec.discrete:
                ax.plot(poly[:, 0], poly[:, 1], color="#ff4fd8", lw=1.3)
        for n, tdat in tubes.items():
            ce, rr = tdat["centre"], tdat["radii"]
            for p, r in zip(ce[np.abs(ce[:, 2] - z) < 0.6], rr[np.abs(ce[:, 2] - z) < 0.6]):
                ax.add_patch(plt.Circle((p[0], p[1]), r, color=col(n), fill=False, lw=1.0))
        ax.set_xlim(x1, x0)
        ax.set_ylim(y0, y1)
        ax.set_title(f"axial z = {z} mm", fontsize=9)
        ax.tick_params(labelsize=6)
    fig.suptitle("Orange: segmented gland · yellow: grown deep portion · cyan line: nerve plane (dotted cyan: deep part) · magenta: tumour · ivory nerve, blue RMV, red ECA, violet digastric, white styloid. Anterior up, lateral (patient right) to the left.", fontsize=10)
    fig.tight_layout()
    fig.savefig(QC / "lobe_split_axial.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
