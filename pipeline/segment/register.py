"""M0 registration spike: do the HRA meshes, the TotalSegmentator segmentations and the Visible Human
cryosections share one frame?

    pipeline/segment/.venv/Scripts/python pipeline/segment/register.py

1. Meshes every TotalSegmentator mask in world mm (RAS, see build_ct_volume.py).
2. Rigidly aligns the HRA male mandible to the CT mandible (PCA initialisations + ICP, no reflection, no
   scale; scale is estimated separately as a unit check) and reports symmetric mean surface distance.
3. Applies the same transform to the HRA parotids and checks side labels and surface distance.
4. Draws the segmentation contours on the source CT (axial levels through the right parotid, coronal and
   sagittal cuts) and an orthographic contact sheet with the registered HRA parotid, for visual QC.
5. Writes docs/qc/m0-registration/ (report.json and the QC images).
"""
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage import measure

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work"
SEG = WORK / "seg"
RAW = ROOT / "pipeline/sources/raw"
QC = ROOT / "docs/qc/m0-registration"

STRUCTURES = {
    "mandible": "craniofacial_structures/mandible",
    "skull": "craniofacial_structures/skull",
    "parotid_r": "head_glands_cavities/parotid_gland_right",
    "parotid_l": "head_glands_cavities/parotid_gland_left",
    "submandibular_r": "head_glands_cavities/submandibular_gland_right",
    "auditory_canal_r": "head_glands_cavities/auditory_canal_right",
    "masseter_r": "head_muscles/masseter_right",
    "digastric_r": "head_muscles/digastric_right",
    "styloid_r": "headneck_bones_vessels/styloid_process_right",
    "zygomatic_arch_r": "headneck_bones_vessels/zygomatic_arch_right",
    "ica_r": "headneck_bones_vessels/internal_carotid_artery_right",
    "ijv_r": "headneck_bones_vessels/internal_jugular_vein_right",
    "scm_r": "headneck_muscles/sternocleidomastoid_right",
}
COLORS = {
    "mandible": "#f2f2f2", "skull": "#bbbbbb", "parotid_r": "#ff9a3c", "parotid_l": "#ff9a3c",
    "submandibular_r": "#ffd166", "auditory_canal_r": "#9bf6ff", "masseter_r": "#ef476f",
    "digastric_r": "#c77dff", "styloid_r": "#ffffff", "zygomatic_arch_r": "#dddddd",
    "ica_r": "#ff2d2d", "ijv_r": "#4d7cff", "scm_r": "#e56b6f", "hra_parotid_r": "#00e5a0",
}


def mask_mesh(path: Path) -> trimesh.Trimesh | None:
    img = nib.load(str(path))
    data = np.asarray(img.dataobj) > 0
    if data.sum() < 20:
        return None
    data = ndimage.binary_closing(np.pad(data, 1), iterations=1)
    verts, faces, _, _ = measure.marching_cubes(data.astype(np.float32), 0.5)
    verts -= 1  # undo padding
    world = nib.affines.apply_affine(img.affine, verts)
    mesh = trimesh.Trimesh(world, faces, process=True)
    trimesh.smoothing.filter_taubin(mesh, iterations=10)
    return mesh


def hra_meshes() -> dict[str, trimesh.Trimesh]:
    scene = trimesh.load(RAW / "hra/3d-vh-m-mouth.glb", force="scene")
    out = {}
    for node in scene.graph.nodes_geometry:
        transform, geom = scene.graph[node]
        mesh = scene.geometry[geom].copy()
        mesh.apply_transform(transform)
        mesh.apply_scale(1000.0)  # metres -> mm
        out[node] = mesh
    return out


def surface_distance(a: trimesh.Trimesh, b: trimesh.Trimesh, n: int = 20000) -> dict:
    pa = a.sample(n, seed=1)
    pb = b.sample(n, seed=2)
    da = cKDTree(b.sample(4 * n, seed=3)).query(pa)[0]
    db = cKDTree(a.sample(4 * n, seed=4)).query(pb)[0]
    d = np.concatenate([da, db])
    return {"mean_mm": float(d.mean()), "median_mm": float(np.median(d)), "p95_mm": float(np.percentile(d, 95)), "max_mm": float(d.max())}


def rigid_align(moving: trimesh.Trimesh, fixed: trimesh.Trimesh, proper: bool = True) -> tuple[np.ndarray, float]:
    """PCA-seeded ICP over all axis-sign combinations with the requested handedness (det +1 or -1)."""
    def frame(m):
        c = m.vertices.mean(0)
        _, _, vt = np.linalg.svd(m.vertices - c, full_matrices=False)
        return c, vt

    cm, vm = frame(moving)
    cf, vf = frame(fixed)
    best = (None, np.inf)
    fixed_pts = fixed.sample(30000, seed=5)
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (1, -1):
                r = vf.T @ np.diag([sx, sy, sz]) @ vm
                if (np.linalg.det(r) > 0) != proper:
                    continue
                init = np.eye(4)
                init[:3, :3] = r
                init[:3, 3] = cf - r @ cm
                m, _, cost = trimesh.registration.icp(moving.sample(8000, seed=6), fixed_pts, initial=init, threshold=1e-6, max_iterations=80, reflection=not proper, scale=False)
                if cost < best[1]:
                    best = (m, cost)
    return best


def slice_contours(mask: np.ndarray, k: int):
    sl = mask[:, :, k]
    return measure.find_contours(sl.astype(float), 0.5) if sl.any() else []


def largest(mask: np.ndarray) -> np.ndarray:
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    return lab == (np.argmax(ndimage.sum(mask, lab, range(1, n + 1))) + 1)


def main() -> None:
    QC.mkdir(parents=True, exist_ok=True)
    report: dict = {"structures": {}}
    ct_img = nib.load(str(WORK / "vhp_male_ct_head.nii.gz"))
    ct = np.asarray(ct_img.dataobj)
    levels = dict(line.split("=") for line in (WORK / "vhp_male_ct_head.levels.txt").read_text().split())
    first_slice, z_first = int(levels["first_slice"]), float(levels["z_first_mm"])

    masks, meshes = {}, {}
    for key, rel in STRUCTURES.items():
        p = SEG / f"{rel}.nii.gz"
        if not p.exists():
            report["structures"][key] = "missing"
            continue
        masks[key] = np.asarray(nib.load(str(p)).dataobj) > 0
        m = mask_mesh(p)
        if m is None:
            report["structures"][key] = "empty"
            continue
        meshes[key] = m
        report["structures"][key] = {"volume_ml": float(masks[key].sum() * np.prod(ct_img.header.get_zooms()) / 1000), "centroid_mm": m.vertices.mean(0).round(1).tolist()}

    # ── HRA ↔ CT rigid registration on the mandible ──────────────────────────────────────
    hra = hra_meshes()
    report["hra_nodes"] = sorted(hra)
    find = lambda s: next(k for k in hra if s in k.lower())
    hra_mand = hra[find("mandible")]
    T, cost = rigid_align(hra_mand, meshes["mandible"])
    moved = {k: v.copy().apply_transform(T) for k, v in hra.items()}
    # Unit/scale check: best similarity scale with the rigid result as initial guess.
    Ts, _, _ = trimesh.registration.icp(moved[find("mandible")].sample(8000, seed=7), meshes["mandible"].sample(30000, seed=8), threshold=1e-6, max_iterations=60, reflection=False, scale=True)
    scale = float(np.cbrt(abs(np.linalg.det(Ts[:3, :3]))))
    rot = T[:3, :3]
    angle = float(np.degrees(np.arccos(np.clip((np.trace(rot) - 1) / 2, -1, 1))))
    report["hra_to_ct"] = {
        "transform": T.round(5).tolist(),
        "rotation_deg": angle,
        "translation_mm": T[:3, 3].round(2).tolist(),
        "similarity_scale": scale,
        "mandible": surface_distance(moved[find("mandible")], meshes["mandible"]),
    }
    hra_pr, hra_pl = moved[find("parotid_gland_r")], moved[find("parotid_gland_l")]
    if "parotid_r" in meshes and "parotid_l" in meshes:
        report["hra_to_ct"]["parotid_right_vs_ts_right"] = surface_distance(hra_pr, meshes["parotid_r"])
        report["hra_to_ct"]["parotid_right_vs_ts_left"] = surface_distance(hra_pr, meshes["parotid_l"])
        report["hra_to_ct"]["parotid_left_vs_ts_left"] = surface_distance(hra_pl, meshes["parotid_l"])
        report["hra_to_ct"]["sides_consistent"] = report["hra_to_ct"]["parotid_right_vs_ts_right"]["mean_mm"] < report["hra_to_ct"]["parotid_right_vs_ts_left"]["mean_mm"]
        report["hra_to_ct"]["patient_right_is_negative_x"] = bool(meshes["parotid_r"].vertices[:, 0].mean() < meshes["parotid_l"].vertices[:, 0].mean())
        vol = lambda m: abs(m.volume) / 1000 if m.is_watertight else float("nan")
        report["hra_to_ct"]["parotid_volume_ml"] = {"hra_right": vol(hra_pr), "hra_left": vol(hra_pl), "ts_right": report["structures"]["parotid_r"]["volume_ml"], "ts_left": report["structures"]["parotid_l"]["volume_ml"]}
    for k, m in moved.items():
        m.export(WORK / f"hra_aligned_{k}.ply")
    for k, m in meshes.items():
        m.export(WORK / f"ts_{k}.ply")

    # ── Visual QC on the source CT ─────────────────────────────────────────────────────
    # Segmentation contours on the CT they were derived from: axial levels through the right parotid, and a
    # coronal and a sagittal cut through its centroid. (Cryosection overlays need landmark registration: the
    # fresh CT and the frozen block differ in posture; see ADR-0002.)
    report["ct_qc"] = {}
    pr = masks["parotid_r"]
    ks = np.nonzero(pr.any((0, 1)))[0]
    levels_k = np.linspace(ks.min() + 2, ks.max() - 2, 6).round().astype(int)
    ci, cj, ck = (int(round(v)) for v in ndimage.center_of_mass(pr))

    def overlay(img2d, contours_by_key, title, fname, aspect=1.0):
        fig, ax = plt.subplots(figsize=(7, 7 * img2d.shape[0] / img2d.shape[1] * aspect), dpi=120)
        ax.imshow(img2d, cmap="gray", vmin=-160, vmax=240, aspect=aspect)
        for key, cs in contours_by_key.items():
            for c in cs:
                ax.plot(c[:, 1], c[:, 0], color=COLORS.get(key, "w"), lw=1.0)
        ax.set_title(title, fontsize=8)
        ax.axis("off")
        fig.savefig(QC / fname, bbox_inches="tight", pad_inches=0.03)
        plt.close(fig)

    def crop_axes(sl):
        # right half of the head around the parotid: axis0 (R->L) and axis1 (A->P) windows
        return slice(max(ci - 90, 0), ci + 70), slice(max(cj - 90, 0), cj + 80)

    ri, ra = crop_axes(None)
    for k in levels_k:
        img = ct[ri, ra, k].T  # rows = A->P, cols = patient right -> left
        cs = {key: [c[:, ::-1] for c in measure.find_contours(m[ri, ra, k].astype(float), 0.5)] for key, m in masks.items() if m[ri, ra, k].any()}
        n = first_slice + int(k)
        overlay(img, cs, f"CT slice {n} (axial; anterior up, patient right on the left) · segmentation contours", f"ct_axial_{n}.png")
        report["ct_qc"][f"axial_{n}"] = sorted(cs)
    # coronal through the parotid centroid (rows = superior->inferior, cols = patient right -> left)
    img = ct[ri, cj, :].T
    cs = {key: [c[:, ::-1] for c in measure.find_contours(m[ri, cj, :].astype(float), 0.5)] for key, m in masks.items() if m[ri, cj, :].any()}
    overlay(img, cs, "Coronal cut through the right parotid centroid (superior up)", "ct_coronal.png", aspect=1 / 0.75)
    # sagittal through the parotid centroid (rows = superior->inferior, cols = anterior -> posterior)
    img = ct[ci, ra, :].T
    cs = {key: [c[:, ::-1] for c in measure.find_contours(m[ci, ra, :].astype(float), 0.5)] for key, m in masks.items() if m[ci, ra, :].any()}
    overlay(img, cs, "Sagittal cut through the right parotid centroid (superior up, anterior left)", "ct_sagittal.png", aspect=1 / 0.75)

    # ── Orthographic contact sheet ─────────────────────────────────────────────────────
    views = {"lateral (from patient's right)": (1, 2, 1), "anterior": (0, 2, -1), "inferior": (0, 1, -1)}
    fig, axes = plt.subplots(1, 3, figsize=(18, 7), dpi=110)
    draw = {**{k: v for k, v in meshes.items() if k not in ("skull",)}, "hra_parotid_r": hra_pr}
    from matplotlib.colors import to_rgba
    from matplotlib.collections import PolyCollection

    decimated = {k: (m.simplify_quadric_decimation(face_count=6000) if len(m.faces) > 6000 else m) for k, m in draw.items()}
    for ax, (title, (a, b, flip)) in zip(axes, views.items()):
        # Painter's algorithm across all structures together, far to near, with simple Lambert shading.
        depth_axis = ({0, 1, 2} - {a, b}).pop()
        view_dir = np.zeros(3)
        view_dir[depth_axis] = {"lateral (from patient's right)": 1.0, "anterior": 1.0, "inferior": -1.0}[title]
        polys, cols, depth = [], [], []
        for key, m in decimated.items():
            tri = m.vertices[m.faces]
            shade = 0.45 + 0.55 * np.abs(m.face_normals @ view_dir)
            base = np.array(to_rgba(COLORS.get(key, "w")))
            alpha = 0.45 if key == "hra_parotid_r" else 1.0
            for f in range(len(tri)):
                polys.append(np.stack([tri[f, :, a] * flip, tri[f, :, b]], -1))
                cols.append((*(base[:3] * shade[f]), alpha))
                depth.append(tri[f, :, depth_axis].mean() * view_dir[depth_axis])
        order = np.argsort(depth)
        ax.add_collection(PolyCollection([polys[i] for i in order], facecolors=[cols[i] for i in order], edgecolors="none"))
        ax.autoscale()
        ax.set_aspect("equal")
        ax.set_facecolor("#20262a")
        ax.set_title(title, fontsize=10)
        ax.set_xticks([])
        ax.set_yticks([])
    fig.suptitle("TotalSegmentator structures (solid) with HRA right parotid after mandible registration (translucent green)", fontsize=10)
    fig.savefig(QC / "contact_sheet.png", bbox_inches="tight")
    plt.close(fig)

    (QC / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("hra_to_ct",)}, indent=1))


if __name__ == "__main__":
    main()
