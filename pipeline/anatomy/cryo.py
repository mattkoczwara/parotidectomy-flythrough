"""Local landmark registration of Visible Human cryosections to the canonical CT frame, and tracing QC of the
authored nerve and vessels against them (ADR-0002 decision 4).

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/cryo.py view CT_SLICE [R0 R1 A0 A1]
    pipeline/segment/.venv/Scripts/python pipeline/anatomy/cryo.py cryo N X0 Y0 X1 Y1
    pipeline/segment/.venv/Scripts/python pipeline/anatomy/cryo.py fit

`view` and `cryo` write gridded crops (to pipeline/segment/work/cryo/) for picking landmarks. `fit` reads
pipeline/specs/cryo_landmarks.json and, per level, fits a 2D similarity from cryosection pixels to CT (R, A)
at that level's CT z. It reports landmark residuals and leave-one-out errors, then draws the authored and
segmented structure sections onto the photograph (docs/qc/m1-cryo/cryo_N.jpg, registration.json).

Orientation (established from the asymmetric mastoid pneumatisation, QC log): the photographs show anterior
down and the patient's right on the image left, i.e. viewed from above. CT slice number n lies at
z = 390 - (n - 1012) mm (vhp_male_ct_head.levels.txt). The mapping is local and in-plane only; the frozen
body's posture differs from the CT, so residual out-of-plane tilt is a stated limit, not corrected.
"""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work"
MESHES = WORK / "meshes"
RAW = ROOT / "pipeline/sources/raw/vhp/cryo"
PICK = WORK / "cryo"
QC = ROOT / "docs/qc/m1-cryo"
SPEC = ROOT / "pipeline/specs/cryo_landmarks.json"

# structure id -> (colour, line width); drawn as sections at the level's z
STRUCTURES = {
    "parotid_superficial_lobe": ("#ff9a3c", 1.0),
    "parotid_deep_lobe": ("#00d0ff", 1.0),
    "masseter_r": ("#ff5d73", 0.8),
    "mandible": ("#ffffff", 0.8),
    "sternocleidomastoid_r": ("#b388ff", 0.8),
    "internal_jugular_vein_r": ("#6c86c4", 1.0),
    "digastric_posterior_belly": ("#c77dff", 0.8),
    "styloid_process": ("#dddddd", 0.8),
    "retromandibular_vein": ("#4f7cff", 1.4),
    "retromandibular_vein_anterior": ("#4f7cff", 1.2),
    "retromandibular_vein_posterior": ("#4f7cff", 1.2),
    "external_jugular_vein": ("#4f7cff", 1.2),
    "external_carotid_artery": ("#ff3030", 1.4),
    "maxillary_artery": ("#ff3030", 1.2),
    "superficial_temporal_artery": ("#ff3030", 1.2),
    "pleomorphic_adenoma": ("#ff4fd8", 1.2),
    "great_auricular_nerve": ("#fff27a", 1.2),
}
NERVES = [p.stem for p in sorted(MESHES.glob("facial_nerve_*.npz"))]


def ct_z(n: int) -> float:
    return 390.0 - (n - 1012)


def load_mesh(mid: str) -> trimesh.Trimesh:
    d = np.load(MESHES / f"{mid}.npz")
    return trimesh.Trimesh(d["positions"], d["indices"].reshape(-1, 3), process=False)


def sections(z: float) -> dict[str, list[np.ndarray]]:
    """(R, A) polylines of every drawn structure cut by the axial plane at z."""
    out = {}
    for mid in [*STRUCTURES, *NERVES]:
        if not (MESHES / f"{mid}.npz").exists():
            continue
        sec = load_mesh(mid).section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        if sec is not None:
            out[mid] = [p[:, :2] for p in sec.discrete]
    return out


def style(mid: str):
    return STRUCTURES.get(mid, ("#f3e7a8", 1.4))


# ── Picking views ──────────────────────────────────────────────────────────────────────────────
def view_ct(n: int, r0=20.0, r1=100.0, a0=40.0, a1=130.0):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import nibabel as nib

    from common import load_ct

    ct, aff, _ = load_ct()
    inv = np.linalg.inv(aff)
    z = ct_z(n)
    k = int(round(nib.affines.apply_affine(inv, [0, 0, z])[2]))
    fig, ax = plt.subplots(figsize=(9, 9 * (a1 - a0) / (r1 - r0)), dpi=110)
    # voxel (i, j) -> world R = ox - 0.75 i, A = oy - 0.75 j (negative-diagonal affine)
    ox, oy = aff[0, 3], aff[1, 3]
    extent = [ox, ox + aff[0, 0] * ct.shape[0], oy + aff[1, 1] * ct.shape[1], oy]
    ax.imshow(ct[:, :, k].T, cmap="gray", vmin=-160, vmax=240, extent=extent, origin="upper", interpolation="bilinear")
    for mid, polys in sections(z).items():
        c, w = style(mid)
        for p in polys:
            ax.plot(p[:, 0], p[:, 1], color=c, lw=w)
    ax.set_xlim(r1, r0)  # patient right on the left
    ax.set_ylim(a1, a0)  # anterior down
    ax.set_xticks(np.arange(np.ceil(r0 / 5) * 5, r1 + 1, 5))
    ax.set_yticks(np.arange(np.ceil(a0 / 5) * 5, a1 + 1, 5))
    ax.tick_params(labelsize=6)
    ax.grid(color="#00ffff", alpha=0.25, lw=0.5)
    ax.set_title(f"CT slice {n} (z = {z:.0f} mm), anterior down, patient right on the left", fontsize=8)
    PICK.mkdir(parents=True, exist_ok=True)
    fig.savefig(PICK / f"ct_{n}.png", bbox_inches="tight")
    print(PICK / f"ct_{n}.png")


def view_cryo(n: int, x0: int, y0: int, x1: int, y1: int):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image

    im = np.asarray(Image.open(RAW / f"a_vm{n}.png").convert("RGB"))
    fig, ax = plt.subplots(figsize=(9, 9 * (y1 - y0) / (x1 - x0)), dpi=110)
    ax.imshow(im, interpolation="bilinear")
    ax.set_xlim(x0, x1)
    ax.set_ylim(y1, y0)
    ax.set_xticks(np.arange(np.ceil(x0 / 10) * 10, x1 + 1, 10))
    ax.set_yticks(np.arange(np.ceil(y0 / 10) * 10, y1 + 1, 10))
    ax.tick_params(labelsize=5)
    ax.grid(color="#00ffff", alpha=0.2, lw=0.4)
    ax.set_title(f"Cryosection a_vm{n} (pixels; anterior down, patient right on the left)", fontsize=8)
    PICK.mkdir(parents=True, exist_ok=True)
    fig.savefig(PICK / f"cryo_{n}.png", bbox_inches="tight")
    print(PICK / f"cryo_{n}.png")


# ── Fit ────────────────────────────────────────────────────────────────────────────────────────
def to_ra_frame(px: np.ndarray) -> np.ndarray:
    """Image (x right, y down) to a right-handed frame matching (R, A): R grows to the image left."""
    return np.c_[-px[:, 0], px[:, 1]]


def similarity(src: np.ndarray, dst: np.ndarray):
    """Least-squares 2D similarity (Umeyama, no reflection): dst ~ s R src + t."""
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    u, sig, vt = np.linalg.svd(b.T @ a)
    d = np.diag([1, np.sign(np.linalg.det(u @ vt))])
    rot = u @ d @ vt
    s = np.trace(np.diag(sig) @ d) / (a**2).sum()
    return s, rot, md - s * rot @ ms


def apply(tf, px: np.ndarray) -> np.ndarray:
    s, rot, t = tf
    return (s * (rot @ to_ra_frame(px).T)).T + t


def invert(tf, ra: np.ndarray) -> np.ndarray:
    s, rot, t = tf
    q = (rot.T @ ((ra - t).T)).T / s
    return np.c_[-q[:, 0], q[:, 1]]


def joint(levels, drop=None, scale=None):
    """Shared scale and rotation (one camera, one block orientation for consecutive photographs), with a
    translation per level. Linear least squares in (a, b, t_1..t_L) for dst = [[a, -b], [b, a]] src + t_l.
    `drop` = (level index, landmark index) is left out (for leave-one-out)."""
    rows, rhs = [], []
    L = len(levels)
    for li, lvl in enumerate(levels):
        for pi, p in enumerate(lvl["landmarks"]):
            if drop == (li, pi):
                continue
            x, y = to_ra_frame(np.array([p["cryo_px"]], float))[0]
            for axis in (0, 1):
                row = np.zeros(2 + 2 * L)
                row[0], row[1] = (x, -y) if axis == 0 else (y, x)
                row[2 + 2 * li + axis] = 1
                rows.append(row)
                rhs.append(p["ct_ra"][axis])
    if scale is None:
        sol, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
        a, b = sol[:2]
        s = float(np.hypot(a, b))
        rot = np.array([[a, -b], [b, a]]) / s
        return [(s, rot, sol[2 + 2 * li : 4 + 2 * li]) for li in range(L)]
    # Known pixel size: rotation from the pooled cross-covariance of per-level centred point sets.
    cov, cents = np.zeros((2, 2)), []
    for li, lvl in enumerate(levels):
        keep = [pi for pi in range(len(lvl["landmarks"])) if drop != (li, pi)]
        src = to_ra_frame(np.array([lvl["landmarks"][pi]["cryo_px"] for pi in keep], float))
        dst = np.array([lvl["landmarks"][pi]["ct_ra"] for pi in keep], float)
        cents.append((src.mean(0), dst.mean(0)))
        cov += (dst - dst.mean(0)).T @ (src - src.mean(0))
    u, _, vt = np.linalg.svd(cov)
    rot = u @ np.diag([1, np.sign(np.linalg.det(u @ vt))]) @ vt
    return [(scale, rot, md - scale * rot @ ms) for ms, md in cents]


def fit():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image

    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    QC.mkdir(parents=True, exist_ok=True)
    report = {"method": spec["method"], "levels": {}}
    levels = spec["levels"]
    scale = spec.get("mm_per_px")
    tfs = joint(levels, scale=scale)
    for li, lvl in enumerate(levels):
        n, ctn = lvl["cryo"], lvl["ct_slice"]
        pairs = lvl["landmarks"]
        px = np.array([p["cryo_px"] for p in pairs], float)
        ra = np.array([p["ct_ra"] for p in pairs], float)
        tf = tfs[li]
        res = np.linalg.norm(apply(tf, px) - ra, axis=1)
        loo = []
        for i in range(len(pairs) if len(pairs) > 1 else 0):  # one landmark only fixes the translation
            t_i = joint(levels, drop=(li, i), scale=scale)[li]
            loo.append(float(np.linalg.norm(apply(t_i, px[i : i + 1])[0] - ra[i])))
        s, rot, _ = tf
        entry = {
            "cryo": n,
            "ct_slice": ctn,
            "z_mm": ct_z(ctn),
            "mm_per_px": float(s),
            "rotation_deg": float(np.degrees(np.arctan2(rot[1, 0], rot[0, 0]))),
            "residual_mm": {p["name"]: round(float(r), 2) for p, r in zip(pairs, res)},
            "rms_mm": round(float(np.sqrt((res**2).mean())), 2),
            "leave_one_out_mm": {p["name"]: round(v, 2) for p, v in zip(pairs, loo)},
            "loo_max_mm": round(max(loo), 2) if loo else None,
        }
        report["levels"][str(n)] = entry
        print(f"cryo {n} ~ CT {ctn} (z {ct_z(ctn):.0f}): {s:.3f} mm/px, rot {entry['rotation_deg']:.1f} deg, rms {entry['rms_mm']} mm, LOO max {entry['loo_max_mm']} mm")

        # Overlay: photograph with the CT-frame sections mapped back into pixels, beside the bare photograph.
        im = np.asarray(Image.open(RAW / f"a_vm{n}.png").convert("RGB"))
        x0, y0, x1, y1 = lvl["crop"]
        fig, axes = plt.subplots(1, 2, figsize=(16, 8 * (y1 - y0) / (x1 - x0)), dpi=110)
        for ax, overlay in zip(axes, (False, True)):
            ax.imshow(im, interpolation="bilinear")
            ax.set_xlim(x0, x1)
            ax.set_ylim(y1, y0)
            ax.set_xticks([])
            ax.set_yticks([])
            if overlay:
                for mid, polys in sections(ct_z(ctn)).items():
                    c, w = style(mid)
                    for p in polys:
                        q = invert(tf, p)
                        ax.plot(q[:, 0], q[:, 1], color=c, lw=w)
                ax.scatter(px[:, 0], px[:, 1], s=14, marker="+", color="#00ff66", lw=0.8)
                back = invert(tf, ra)
                ax.scatter(back[:, 0], back[:, 1], s=10, facecolors="none", edgecolors="#00ff66", lw=0.8)
        axes[0].set_title(f"a_vm{n} (anterior down, patient right on the left). Courtesy of the U.S. National Library of Medicine.", fontsize=7)
        axes[1].set_title(
            f"Sections at CT slice {ctn} (z {ct_z(ctn):.0f} mm) mapped in; similarity fit rms {entry['rms_mm']} mm, LOO max {entry['loo_max_mm']} mm. "
            "Nerve ivory, vein blue, artery red, superficial lobe orange, deep lobe cyan, tumour magenta.",
            fontsize=6,
        )
        fig.tight_layout()
        fig.savefig(QC / f"cryo_{n}.jpg", bbox_inches="tight", pil_kwargs={"quality": 85})
        plt.close(fig)
    (QC / "registration.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "view":
        view_ct(int(sys.argv[2]), *map(float, sys.argv[3:7]))
    elif cmd == "cryo":
        view_cryo(int(sys.argv[2]), *map(int, sys.argv[3:7]))
    elif cmd == "fit":
        fit()
