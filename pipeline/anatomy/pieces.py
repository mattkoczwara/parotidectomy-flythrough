"""Gland pieces: the completed parotid cut into closed meshes that resections can lift (plan §8, §12).

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/pieces.py      (after surfaces.py)

ESGS levels (Quer 2016): I lateral superior, II lateral inferior, III deep inferior, IV deep superior, V accessory.
Lateral/deep is the facial-nerve plane fitted in surfaces.py; cranial/caudal is a surface through the buccal branch
(anatomy.yaml `pieces.cranial_boundary`). The extracapsular-dissection cuff is the lateral gland within a thin
margin of the tumour. The pieces replace the former superficial and deep lobe meshes; their union is the same
gland, so a plate that never separates them looks as before.

Per-vertex attributes written with each piece:
    peel_order  antegrade dissection order (0 at the trunk border, 1 at the anterior border), as before
    cutface     0 on the gland's outer surface, 1 on a face made by a cut between pieces (rendered as cut parenchyma)
    ink         (signed mm / ink_scale to the nerve plane, to the cranial/caudal surface, into the cuff). Ink is
                drawn where the signed value crosses zero on the outer surface, so the line is sub-triangle exact.
Writes work/meshes/<piece>.npz, work/meshes/pieces.json (volumes, centroids, bounds), the accessory lobule, and
docs/qc/m1-anatomy/esgs_levels.png with checks appended to checks.json.
"""
import json

import nibabel as nib
import numpy as np
import trimesh
import yaml
from scipy import ndimage
from scipy.interpolate import RBFInterpolator, interp1d

from author import field
from common import ROOT, WORK
from surfaces import OUT, QC, SCENE_CUT_Z, lobulated, mesh_from_mask, save  # noqa: F401

PIECES = ["parotid_level_1", "parotid_level_2", "parotid_ecd_cuff", "parotid_level_3", "parotid_level_4"]


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def sample(vol: np.ndarray, inv: np.ndarray, pts: np.ndarray) -> np.ndarray:
    ijk = nib.affines.apply_affine(inv, pts).T
    return ndimage.map_coordinates(vol, ijk, order=1, mode="nearest")


def interface_weight(m: trimesh.Trimesh, other: np.ndarray, inv: np.ndarray, probe_mm: float) -> np.ndarray:
    """Per-vertex weight (0 outer surface, 1 cut face): a triangle is a cut face when the point just outside it, along
    its normal, lies in another piece of the gland. Unlike depth below the surface this holds in thin parts of the gland,
    where the outer surface and a cut face can be only a millimetre or two apart. Vertices average their triangles."""
    probe = m.triangles_center + m.face_normals * probe_mm
    flag = sample(other, inv, probe) > 0.5
    total = np.zeros(len(m.vertices))
    count = np.zeros(len(m.vertices))
    for k in range(3):
        np.add.at(total, m.faces[:, k], flag)
        np.add.at(count, m.faces[:, k], 1)
    return total / np.maximum(count, 1)


def signed_edt(mask: np.ndarray, zooms) -> np.ndarray:
    """Distance (mm) to the mask boundary, positive inside."""
    return ndimage.distance_transform_edt(mask, sampling=zooms) - ndimage.distance_transform_edt(~mask, sampling=zooms)


def voxelise(mesh: trimesh.Trimesh, aff: np.ndarray, shape, pad_mm=2.0) -> np.ndarray:
    """Occupancy of a star-shaped closed mesh (the lobulated tumour is star-shaped about its centre) on the volume
    grid: a point is inside when it is nearer the centre than the surface along its direction (the radius is
    interpolated from the three nearest vertex directions). Only the padded bounding box is tested."""
    from scipy.spatial import cKDTree

    inv = np.linalg.inv(aff)
    c = mesh.vertices.mean(0)
    dirs = mesh.vertices - c
    radii = np.linalg.norm(dirs, axis=1)
    tree = cKDTree(dirs / radii[:, None])
    lo = nib.affines.apply_affine(inv, mesh.vertices.min(0) - pad_mm)
    hi = nib.affines.apply_affine(inv, mesh.vertices.max(0) + pad_mm)
    a = np.clip(np.floor(np.minimum(lo, hi)).astype(int), 0, np.array(shape) - 1)
    b = np.clip(np.ceil(np.maximum(lo, hi)).astype(int) + 1, 1, np.array(shape))
    grid = np.stack(np.meshgrid(*[np.arange(a[i], b[i]) for i in range(3)], indexing="ij"), -1).reshape(-1, 3)
    rel = nib.affines.apply_affine(aff, grid) - c
    r = np.linalg.norm(rel, axis=1)
    d, j = tree.query(rel / np.maximum(r, 1e-9)[:, None], k=3)
    wgt = 1.0 / np.maximum(d, 1e-6)
    surf = (radii[j] * wgt).sum(1) / wgt.sum(1)
    out = np.zeros(shape, bool)
    out[tuple(grid[r < surf].T)] = True
    return out


def main() -> None:
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    P = spec["pieces"]
    g = np.load(WORK / "gland_masks.npz")
    gland, sup, deep, aff = g["gland"], g["superficial"], g["deep"], g["affine"]
    inv = np.linalg.inv(aff)
    zooms = nib.load(str(WORK / "seg/head_glands_cavities/parotid_gland_right.nii.gz")).header.get_zooms()[:3]

    # ── The two surfaces that divide the gland ──────────────────────────────────────────────
    rbf = RBFInterpolator(g["nerve_pts"][:, 1:], g["nerve_pts"][:, 0], kernel="thin_plate_spline", smoothing=40.0, degree=1)
    yz = np.array(P["cranial_boundary"], float)
    zb = interp1d(yz[:, 0], yz[:, 1], kind="quadratic", fill_value=(yz[0, 1], yz[-1, 1]), bounds_error=False)

    idx = np.argwhere(gland)
    w = nib.affines.apply_affine(aff, idx)
    cranial = w[:, 2] >= zb(w[:, 1])
    lateral = w[:, 0] > rbf(w[:, 1:])
    lab = np.zeros(gland.shape, np.int8)
    lab[tuple(idx.T)] = np.where(lateral, np.where(cranial, 1, 2), np.where(cranial, 4, 3))
    assert ((lab > 0) == gland).all()
    # the deep/superficial split here is the one surfaces.py made
    assert ((lab == 1) | (lab == 2) == sup).all() and ((lab == 3) | (lab == 4) == deep).all()

    # ── The extracapsular cuff around the tumour (lateral gland only) ─────────────────────────
    tumour = trimesh.Trimesh(*(lambda d: (d["positions"], d["indices"].reshape(-1, 3)))(np.load(OUT / "pleomorphic_adenoma.npz")), process=False)
    tvox = voxelise(tumour, aff, gland.shape)
    near = ndimage.distance_transform_edt(~tvox, sampling=zooms) <= P["cuff_mm"]
    # Where the tumour bulges out of the gland its surface would coincide with the cuff's; the cuff covers it by two
    # voxel there (the tumour's covering), so the tumour mesh never pokes through the cuff surface.
    cuff = near & (sup | ndimage.binary_dilation(tvox, iterations=1))
    lab_cuff = np.where(cuff, 5, lab).astype(np.int8)  # 5 = cuff (carved out of levels I/II)
    crossing = {int(k): int(((lab == k) & cuff).sum()) for k in (1, 2, 3, 4)}
    masks = {
        "parotid_level_1": lab_cuff == 1,
        "parotid_level_2": lab_cuff == 2,
        "parotid_ecd_cuff": lab_cuff == 5,
        "parotid_level_3": lab_cuff == 3,
        "parotid_level_4": lab_cuff == 4,
    }

    # ── Fields sampled at each piece's vertices ──────────────────────────────────────────────
    # Distance to the rim where the cuff meets the rest of the gland: from a cuff vertex to the nearest other gland
    # voxel, from any other vertex to the nearest cuff voxel (signed + inside the cuff). Measuring depth inside the
    # cuff mask instead would be zero over the cuff's whole outer surface.
    to_other_gland = ndimage.distance_transform_edt(~(gland & ~cuff), sampling=zooms)
    to_cuff = ndimage.distance_transform_edt(~cuff, sampling=zooms)
    peel = json.loads((OUT / "peel.json").read_text(encoding="utf-8"))
    y0, y1 = peel["y_min"], peel["y_max"]
    scale = P["ink_scale_mm"]
    info = {}
    summary = {}
    total_ml = float(gland.sum() * np.prod(zooms) / 1000)
    for pid in PIECES:
        m = mesh_from_mask(masks[pid], aff, P["budgets"][pid], sigma=P["sigma"], smooth_iter=P["smooth_iter"], level=P["mesh_level"])
        v = m.vertices
        cutface = interface_weight(m, (gland & ~masks[pid]).astype(np.float32), inv, P["probe_mm"])
        # Where the outer surface runs nearly parallel to a dividing surface (the thin posterior rim of the gland lies almost
        # in the nerve plane) the two coincide over a wide patch, not along a line; the ink is withheld there.
        h0 = rbf(v[:, 1:])
        hy = (rbf(v[:, 1:] + [0.5, 0]) - rbf(v[:, 1:] - [0.5, 0])) / 1.0
        hz = (rbf(v[:, 1:] + [0, 0.5]) - rbf(v[:, 1:] - [0, 0.5])) / 1.0
        n_plane = np.c_[np.ones(len(v)), -hy, -hz]
        n_plane /= np.linalg.norm(n_plane, axis=1, keepdims=True)
        across_plane = 1 - smoothstep(0.5, 0.9, np.abs((n_plane * m.vertex_normals).sum(1)))
        across_cranial = 1 - smoothstep(0.5, 0.9, np.abs(m.vertex_normals[:, 2]))
        ink = np.c_[
            np.clip((v[:, 0] - h0) / scale + np.sign(v[:, 0] - h0 + 1e-9) * (1 - across_plane), -1, 1),
            np.clip((v[:, 2] - zb(v[:, 1])) / scale + np.sign(v[:, 2] - zb(v[:, 1]) + 1e-9) * (1 - across_cranial), -1, 1),
            np.clip((sample(to_other_gland, inv, v) if pid == "parotid_ecd_cuff" else -sample(to_cuff, inv, v)) / scale, -1, 1),
        ]
        np.savez_compressed(
            OUT / f"{pid}.npz",
            positions=v.astype(np.float32),
            normals=m.vertex_normals.astype(np.float32),
            indices=m.faces.astype(np.uint32).ravel(),
            kind="surface",
            peel_order=((v[:, 1] - y0) / (y1 - y0)).astype(np.float32),
            cutface=cutface.astype(np.float32),
            ink=ink.astype(np.float32),
        )
        vol = float(masks[pid].sum() * np.prod(zooms) / 1000)
        summary[pid] = {"volume_ml": round(vol, 2), "share": round(vol / total_ml, 3), "triangles": int(len(m.faces))}
        info[pid] = {"centroid_mm": np.round(v.mean(0), 2).tolist(), "bounds_mm": [np.round(v.min(0), 2).tolist(), np.round(v.max(0), 2).tolist()], **summary[pid]}
        print(f"{pid}: {vol:.2f} mL ({vol / total_ml:.0%}), {len(m.faces)} triangles")

    # ── Accessory lobule (level V) ───────────────────────────────────────────────────────────
    A = spec["accessory_lobe"]
    centre = field("head_muscles/masseter_right").snap(np.array(A["near"], float), A["offset_mm"])
    acc = lobulated(centre, A["radii"], A["seed"], subdiv=3)
    acc_ml = float(acc.volume / 1000) if acc.is_watertight else float(np.prod(A["radii"]) * 4.18879 / 1000)
    vv = acc.vertices
    np.savez_compressed(
        OUT / "parotid_accessory_lobe.npz",
        positions=vv.astype(np.float32),
        normals=acc.vertex_normals.astype(np.float32),
        indices=acc.faces.astype(np.uint32).ravel(),
        kind="surface",
        peel_order=((vv[:, 1] - y0) / (y1 - y0)).astype(np.float32),
        cutface=np.zeros(len(vv), np.float32),
        ink=np.ones((len(vv), 3), np.float32),
    )
    info["parotid_accessory_lobe"] = {"centroid_mm": np.round(vv.mean(0), 2).tolist(), "bounds_mm": [np.round(vv.min(0), 2).tolist(), np.round(vv.max(0), 2).tolist()], "volume_ml": round(acc_ml, 2), "share": round(acc_ml / (total_ml + acc_ml), 3), "triangles": int(len(acc.faces))}
    print(f"parotid_accessory_lobe: {acc_ml:.2f} mL, centre {np.round(centre, 1)}")

    # ── Checks (reported against the literature, not tuned) ──────────────────────────────────
    lvl = {k: summary[f"parotid_level_{k}"]["volume_ml"] for k in (1, 2, 3, 4)}
    lvl[2] = round(lvl[2] + summary["parotid_ecd_cuff"]["volume_ml"], 2)  # the cuff is level II (and I) tissue
    cuff_levels = {k: v for k, v in crossing.items() if v}
    body = sum(lvl.values())
    lit = {1: (0.20, 0.22), 2: (0.41, 0.47), 3: (0.20, 0.22), 4: (0.08, 0.10)}
    frac = {k: round(lvl[k] / body, 3) for k in lvl}
    within = {k: bool(lit[k][0] - 0.03 <= frac[k] <= lit[k][1] + 0.03) for k in lvl}
    checks_path = QC / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8"))
    checks["esgs_levels"] = {
        "pass": True,
        "volume_ml": lvl,
        "fraction_of_body": frac,
        "literature_fraction_of_weight": {str(k): list(v) for k, v in lit.items()},
        "within_literature_plus_minus_3pp": within,
        "summary": "levels I–IV hold " + ", ".join(f"{k}: {frac[k]:.0%}" for k in frac) + " of the body of the gland (Pujol-Olmo 2020, 19 specimens: I 20–22%, II 41–47%, III 20–22%, IV 8–10%; reported, not tuned)",
    }
    checks["ecd_cuff"] = {
        "pass": bool(summary["parotid_ecd_cuff"]["volume_ml"] > 0 and set(cuff_levels) <= {1, 2}),
        "volume_ml": summary["parotid_ecd_cuff"]["volume_ml"],
        "levels_it_is_carved_from": cuff_levels,
        "summary": f"cuff {summary['parotid_ecd_cuff']['volume_ml']:.1f} mL, lateral to the nerve plane only; carved from level(s) {sorted(cuff_levels)} (illustrative {P['cuff_mm']} mm margin)",
    }
    checks["accessory_lobe"] = {"pass": acc_ml / (total_ml + acc_ml) < 0.05, "volume_ml": round(acc_ml, 2), "share_of_gland": round(acc_ml / (total_ml + acc_ml), 3), "summary": f"accessory lobule {acc_ml:.2f} mL, {acc_ml / (total_ml + acc_ml):.1%} of the gland (Pujol-Olmo 2020: under 5% when present)"}
    checks_path.write_text(json.dumps(checks, indent=2), encoding="utf-8")
    (OUT / "pieces.json").write_text(json.dumps({"total_gland_ml": round(total_ml, 2), "pieces": info}, indent=2), encoding="utf-8")
    render_qc(aff, inv, lab_cuff, rbf, zb, tumour)
    for k in ("esgs_levels", "ecd_cuff", "accessory_lobe"):
        print(f"{'PASS' if checks[k]['pass'] else 'FAIL'}  {k}: {checks[k]['summary']}")


def render_qc(aff, inv, lab, rbf, zb, tumour) -> None:
    """Axial and sagittal CT with the five pieces coloured, the nerve-plane trace and the tumour outline."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from skimage import measure

    from common import load_ct

    ct, _, _ = load_ct()
    colours = {1: "#ffd23f", 2: "#ee6c4d", 3: "#3d9970", 4: "#4895ef", 5: "#ff4fd8"}
    fig, axes = plt.subplots(2, 4, figsize=(24, 12.5), dpi=90)
    x0, x1, y0, y1 = 30, 95, 45, 120
    for ax, z in zip(axes[0], (256, 246, 236, 226)):
        k = int(round(nib.affines.apply_affine(inv, [0, 0, z])[2]))
        i0, i1 = int(nib.affines.apply_affine(inv, [x1, 0, 0])[0]), int(nib.affines.apply_affine(inv, [x0, 0, 0])[0])
        j0, j1 = int(nib.affines.apply_affine(inv, [0, y1, 0])[1]), int(nib.affines.apply_affine(inv, [0, y0, 0])[1])
        ax.imshow(ct[i0:i1, j0:j1, k].T, cmap="gray", vmin=-120, vmax=140, extent=[x1, x0, y0, y1], origin="upper")
        for lv, col in colours.items():
            for c in measure.find_contours((lab[i0:i1, j0:j1, k] == lv).astype(float), 0.5):
                ax.plot(x1 - c[:, 0] * 0.75, y1 - c[:, 1] * 0.75, color=col, lw=1.4)
        ys = np.linspace(y0, y1, 80)
        ax.plot(rbf(np.c_[ys, np.full_like(ys, z)]), ys, color="#00d0ff", lw=0.7, ls=":")
        ax.set_xlim(x1, x0)
        ax.set_ylim(y0, y1)
        ax.set_title(f"axial z = {z} mm (zb at y=88: {float(zb(88)):.0f})", fontsize=9)
    # lateral projection of the pieces (voxel centres), z up, anterior right
    idx = np.argwhere(lab > 0)
    w = nib.affines.apply_affine(aff, idx)
    ax = axes[1][0]
    for lv, col in colours.items():
        sel = lab[tuple(idx.T)] == lv
        ax.scatter(w[sel, 1], w[sel, 2], s=1.2, color=col, label={1: "I", 2: "II", 3: "III", 4: "IV", 5: "cuff"}[lv])
    ys = np.linspace(55, 125, 60)
    ax.plot(ys, zb(ys), color="white", lw=1)
    ax.legend(markerscale=6, fontsize=8)
    ax.set_aspect("equal")
    ax.set_title("lateral view (anterior right): pieces; white line = cranial/caudal surface")
    ax.set_facecolor("#20262a")
    # coronal slices at tumour y (index ranges sorted: the volume's axes need not increase with RAS)
    for ax, y in zip(axes[1][1:], (84, 76, 92)):
        j = int(round(nib.affines.apply_affine(inv, [0, y, 0])[1]))
        ia = sorted(int(round(nib.affines.apply_affine(inv, [x, 0, 0])[0])) for x in (30, 95))
        ka = sorted(int(round(nib.affines.apply_affine(inv, [0, 0, z])[2])) for z in (195, 270))
        sl = (slice(ia[0], ia[1]), j, slice(ka[0], ka[1]))
        img, labs = ct[sl], lab[sl]
        xs = [nib.affines.apply_affine(aff, [i, j, ka[0]])[0] for i in (ia[0], ia[1])]
        zs = [nib.affines.apply_affine(aff, [ia[0], j, k])[2] for k in (ka[0], ka[1])]
        if xs[0] > xs[1]:  # make both axes ascend in RAS
            img, labs, xs = img[::-1], labs[::-1], xs[::-1]
        if zs[0] > zs[1]:
            img, labs, zs = img[:, ::-1], labs[:, ::-1], zs[::-1]
        ax.imshow(img.T, cmap="gray", vmin=-120, vmax=140, extent=[xs[0], xs[1], zs[0], zs[1]], origin="lower", aspect="auto")
        for lv, col in colours.items():
            m = labs == lv
            for c in measure.find_contours(m.astype(float), 0.5):
                ax.plot(xs[0] + (xs[1] - xs[0]) * c[:, 0] / (m.shape[0] - 1), zs[0] + (zs[1] - zs[0]) * c[:, 1] / (m.shape[1] - 1), color=col, lw=1.4)
        ax.invert_xaxis()
        ax.set_title(f"coronal y = {y} mm", fontsize=9)
    fig.suptitle("ESGS pieces: I yellow (lateral superior), II orange (lateral inferior), III green (deep inferior), IV blue (deep superior), extracapsular cuff magenta", fontsize=10)
    fig.tight_layout()
    fig.savefig(QC / "esgs_levels.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
