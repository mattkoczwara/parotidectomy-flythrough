"""Measure right-side anatomical landmarks in the canonical CT frame (RAS, mm; +x = patient right).

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/landmarks.py

Automatic landmarks come from the TotalSegmentator masks and the CT. Landmarks that cannot be derived
reliably (the stylomastoid foramen, the tympanomastoid fissure) are picked visually on the CT and recorded in
pipeline/specs/landmarks.picked.json with the slice and the QC image used. Everything is written to
pipeline/specs/landmarks.vhp-male.json, which the authoring scripts read. QC crops go to docs/qc/m1-landmarks/.
"""
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work"
SEG = WORK / "seg"
SPECS = ROOT / "pipeline/specs"
QC = ROOT / "docs/qc/m1-landmarks"


def load(rel: str):
    img = nib.load(str(SEG / f"{rel}.nii.gz"))
    return np.asarray(img.dataobj) > 0, img.affine


def world(mask: np.ndarray, affine: np.ndarray) -> np.ndarray:
    return nib.affines.apply_affine(affine, np.argwhere(mask))


def extreme(points: np.ndarray, direction) -> np.ndarray:
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    proj = points @ d
    # mean of the top 0.5 % to be robust to single-voxel noise
    top = points[proj >= np.percentile(proj, 99.5)]
    return top.mean(0)


def main() -> None:
    ct_img = nib.load(str(WORK / "vhp_male_ct_head.nii.gz"))
    ct = np.asarray(ct_img.dataobj)
    aff = ct_img.affine
    lm: dict[str, dict] = {}

    def put(name, xyz, method):
        lm[name] = {"xyz": [round(float(v), 1) for v in xyz], "method": method}

    eac, _ = load("head_glands_cavities/auditory_canal_right")
    eac_pts = world(eac, aff)
    put("eac_centroid", eac_pts.mean(0), "centroid of TotalSegmentator auditory_canal_right")
    put("eac_lateral", extreme(eac_pts, [1, 0, 0]), "lateral-most 0.5% of auditory_canal_right")

    skull, _ = load("craniofacial_structures/skull")
    sk = world(skull, aff)
    e = np.array(lm["eac_centroid"]["xyz"])
    mastoid_region = sk[(sk[:, 1] < e[1] - 5) & (sk[:, 1] > e[1] - 40) & (sk[:, 0] > e[0] - 30) & (sk[:, 2] < e[2])]
    put("mastoid_tip", extreme(mastoid_region, [0, 0, -1]), "lowest skull voxels posterior to the EAC and within 30 mm medial of it")

    sty, _ = load("headneck_bones_vessels/styloid_process_right")
    sp = world(sty, aff)
    put("styloid_fragment_top", extreme(sp, [0, 0, 1]), "highest voxels of the (fragmentary) styloid segmentation")
    put("styloid_fragment_bottom", extreme(sp, [0, 0, -1]), "lowest voxels of the (fragmentary) styloid segmentation")

    mand, _ = load("craniofacial_structures/mandible")
    mp = world(mand, aff)
    right = mp[mp[:, 0] > 15]
    put("condyle_top", extreme(right, [0, 0, 1]), "highest right mandible voxels")
    put("gonion", extreme(right, [0, -1, -1]), "right mandible extreme along posterior-inferior diagonal")
    put("mandible_lower_border_mid", extreme(right[(right[:, 1] > np.percentile(right[:, 1], 45)) & (right[:, 1] < np.percentile(right[:, 1], 70))], [0, 0, -1]), "lowest right mandible voxels mid-body")
    # posterior border of the ramus: per 2 mm band in z between gonion and condyle, the most posterior voxel
    g, c = np.array(lm["gonion"]["xyz"]), np.array(lm["condyle_top"]["xyz"])
    border = []
    for z in np.arange(g[2] + 4, c[2] - 8, 3):
        band = right[np.abs(right[:, 2] - z) < 1.5]
        if len(band):
            border.append(band[np.argmin(band[:, 1])])
    lm["ramus_posterior_border"] = {"polyline": [[round(float(v), 1) for v in p] for p in border], "method": "most posterior right-mandible voxel per 3 mm z band, gonion to condylar neck"}

    arch = sk[(sk[:, 1] > e[1] + 10) & (sk[:, 1] < e[1] + 60) & (sk[:, 2] > e[2] - 12) & (sk[:, 2] < e[2] + 12)]
    lateral = arch[arch[:, 0] > np.percentile(arch[:, 0], 90)]
    put("zygomatic_arch_lateral", lateral.mean(0), "lateral-most 10% of skull voxels anterior to the EAC at its level")
    put("zygomatic_arch_lower_border", extreme(lateral, [0, 0, -1]), "lowest of those lateral arch voxels")

    hy, _ = load("headneck_bones_vessels/hyoid")
    hp = world(hy, aff)
    put("hyoid_greater_horn_tip_r", extreme(hp[hp[:, 0] > 0], [1, -1, 0]), "hyoid extreme posterolaterally on the right")

    head, _ = load("craniofacial_structures/head")
    # skin surface voxels: head mask boundary
    surf = head & ~ndimage.binary_erosion(head)
    skin = world(surf, aff)
    # Tragus: the skin point nearest to a point just anterior-lateral to the canal opening (the tragus covers
    # the opening from in front). Searching for a lateral extreme instead slides onto the cheek.
    el = np.array(lm["eac_lateral"]["xyz"])
    probe = el + np.array([6.0, 8.0, -2.0])
    put("tragus_skin", skin[np.argmin(np.linalg.norm(skin - probe, axis=1))], "skin point nearest to 6 mm lateral, 8 mm anterior, 2 mm inferior of the EAC opening")

    par, _ = load("head_glands_cavities/parotid_gland_right")
    pp = world(par, aff)
    put("parotid_centroid", pp.mean(0), "centroid of parotid_gland_right")
    for name, d in {"parotid_superior": [0, 0, 1], "parotid_inferior": [0, 0, -1], "parotid_anterior": [0, 1, 0], "parotid_posterior": [0, -1, 0], "parotid_lateral": [1, 0, 0], "parotid_medial": [-1, 0, 0]}.items():
        put(name, extreme(pp, d), f"parotid_gland_right extreme {d}")

    # Merge visually picked landmarks.
    picked_path = SPECS / "landmarks.picked.json"
    if picked_path.exists():
        for name, rec in json.loads(picked_path.read_text(encoding="utf-8")).items():
            lm[name] = rec

    SPECS.mkdir(parents=True, exist_ok=True)
    (SPECS / "landmarks.vhp-male.json").write_text(json.dumps({"frame": "VHP male normal CT, RAS mm (ADR-0002)", "side": "right", "landmarks": lm}, indent=2) + "\n", encoding="utf-8")

    # QC crops for picking the stylomastoid foramen: axial CT around the styloid/mastoid, mm grid in world coords.
    QC.mkdir(parents=True, exist_ok=True)
    inv = np.linalg.inv(aff)
    s_top = np.array(lm["styloid_fragment_top"]["xyz"])
    m_tip = np.array(lm["mastoid_tip"]["xyz"])
    zs = np.arange(round(m_tip[2]), round(e[2]) + 1, 3)
    fig, axes = plt.subplots(2, (len(zs) + 1) // 2, figsize=(4 * ((len(zs) + 1) // 2), 8), dpi=110)
    for ax, z in zip(axes.ravel(), zs):
        k = int(round(nib.affines.apply_affine(inv, [0, 0, z])[2]))
        x0, x1 = s_top[0] - 20, m_tip[0] + 20
        y0, y1 = m_tip[1] - 20, s_top[1] + 20
        i0, j0 = nib.affines.apply_affine(inv, [x1, y1, z])[:2].astype(int)
        i1, j1 = nib.affines.apply_affine(inv, [x0, y0, z])[:2].astype(int)
        crop = ct[min(i0, i1) : max(i0, i1), min(j0, j1) : max(j0, j1), k].T
        ax.imshow(crop, cmap="gray", vmin=-200, vmax=1500, extent=[max(x0, x1), min(x0, x1), min(y0, y1), max(y0, y1)], origin="upper")  # row 0 = most anterior
        ax.set_title(f"z = {z:.0f} mm (axial)", fontsize=8)
        ax.set_xlabel("x (mm, patient right +)", fontsize=7)
        ax.set_ylabel("y (mm, anterior +)", fontsize=7)
        ax.tick_params(labelsize=6)
        ax.grid(color="yellow", alpha=0.25, lw=0.4)
        for nm, col in (("styloid_fragment_top", "c"), ("mastoid_tip", "m"), ("eac_centroid", "y")):
            p = lm[nm]["xyz"]
            if abs(p[2] - z) < 2:
                ax.plot(p[0], p[1], "+", color=col, ms=10)
    fig.tight_layout()
    fig.savefig(QC / "stylomastoid_search.png")
    plt.close(fig)
    print(json.dumps({k: v.get("xyz") for k, v in lm.items() if "xyz" in v}, indent=0))


if __name__ == "__main__":
    main()
