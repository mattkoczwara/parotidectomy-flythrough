"""Exterior presentation layer: nothing here is anatomy, and no claim rests on it.

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/exterior.py      (after flap.py and barriers.py)

1. Weld the normals across the neck cut, where the skin (above scene_cut_z) meets the exterior body (neck,
   shoulders and upper chest from the same fitted MPFB surface, face.py), so the seam does not shade.
2. A regional pigment map on the skin and body (`tint`, per vertex): r = redness (ears, nose, cheeks), g = lip,
   b = darkening at the brows and the upper lash line, a = scalp under the hair. Regions are the vertex sets of
   MakeHuman's own CC0 targets (eyebrows, lips, nose, cheeks, ears), weighted by their displacement magnitude.
3. A short, controlled haircut and the eyebrows as one root surface (`hair`) for shell rendering: per-vertex
   length (`hair_h`, mm), combing direction (`flow`) and kind (`hair_kind`: 0 scalp, 1 brow). The hairline is
   authored (anatomy.yaml `exterior`) to keep the ear, the preauricular skin and the parotid region clear.

Appends an `exterior` check to docs/qc/m1-anatomy/checks.json and renders docs/qc/m1-anatomy/exterior.png.
"""
import gzip
import json
import zipfile

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
import yaml
from scipy.spatial import cKDTree

from common import ROOT, WORK

OUT = WORK / "meshes"
QC = ROOT / "docs/qc/m1-anatomy"
ARCHIVE = ROOT / "pipeline/sources/raw/mpfb/add-on-mpfb-v2.0.17.zip"


def smoothstep(e0, e1, x):
    k = np.clip((x - e0) / (e1 - e0), 0, 1)
    return k * k * (3 - 2 * k)


def target_weight(names):
    """Displacement magnitude of MakeHuman targets per original vertex, normalised to 0..1."""
    z = zipfile.ZipFile(ARCHIVE)
    w = np.zeros(19158)
    for name in names:
        for line in gzip.decompress(z.read(f"data/targets/{name}.target.gz")).decode().splitlines():
            t = line.split()
            if len(t) == 4 and not line.startswith("#"):
                w[int(t[0])] = max(w[int(t[0])], float(np.linalg.norm([float(t[1]), float(t[2]), float(t[3])])))
    return w / max(w.max(), 1e-9)


def transfer(values, src, dst, k=4):
    """Per-vertex values carried from the fitted MPFB vertices to the final surface by inverse-distance weighting."""
    d, j = cKDTree(src).query(dst, k=k)
    wt = 1.0 / np.maximum(d, 0.3) ** 2
    return (values[j] * wt).sum(1) / wt.sum(1)


def footprint(points, normals, lobe, ear_w):
    """Signed distance (mm, positive inside) from each lateral skin point to the outline of the superficial lobe seen
    from the side (its projection on the sagittal plane): the localisation contour of the opening. Elsewhere -50."""
    from scipy import ndimage

    res = 0.5
    pts = lobe.sample(400_000, seed=11)[:, 1:3]
    lo = pts.min(0) - 25
    shape = np.ceil((pts.max(0) + 25 - lo) / res).astype(int) + 1
    grid = np.zeros(shape, bool)
    ij = np.round((pts - lo) / res).astype(int)
    grid[ij[:, 0], ij[:, 1]] = True
    grid = ndimage.binary_fill_holes(ndimage.binary_closing(grid, iterations=4))
    sd = ndimage.gaussian_filter(ndimage.distance_transform_edt(grid) - ndimage.distance_transform_edt(~grid), 3.0) * res
    val = ndimage.map_coordinates(sd, ((points[:, 1:3] - lo) / res).T, order=1, mode="nearest")
    lateral = (points[:, 0] > 30) & (normals[:, 0] > 0.15) & (ear_w < 0.3)
    return np.where(lateral, val, -50.0)


def outer_vertices(faces, n, n0):
    """True for vertices of the skin shell's outer surface. face.py writes the outer surface first (n0 vertices) and
    its inner offset next; flap.py appends the vertices of its refinement, which take the label of their neighbours
    (faces joining both surfaces are the walls at the shell's boundary, and are skipped)."""
    lab = np.full(n, -1)
    lab[:n0] = 1
    lab[n0:2 * n0] = 0
    for _ in range(200):
        lf = lab[faces]
        todo = (lf == -1).any(1) & (lf != -1).any(1) & ~((lf == 1).any(1) & (lf == 0).any(1))
        if not todo.any():
            break
        f = faces[todo]
        known = lab[f].max(1)
        for k in range(3):
            idx = f[:, k]
            sel = lab[idx] == -1
            lab[idx[sel]] = known[sel]
    lab[lab == -1] = 0
    return lab == 1


def main() -> None:
    spec_all = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    spec, face = spec_all["exterior"], spec_all["face"]
    skin = dict(np.load(OUT / "skin.npz"))
    body = dict(np.load(OUT / "exterior_body.npz"))
    basis = np.load(WORK / "face_basis.npz")
    fitted, index, eyes = basis["fitted"].astype(float), basis["index"], basis["eyes"].astype(float)

    # 1) seam: the skin's outer surface and the body share their cut loop vertex for vertex.
    sp = skin["positions"].astype(float)
    sf = skin["indices"].reshape(-1, 3)
    outer = outer_vertices(sf, len(sp), int(skin["n_outer"]))
    O = np.nonzero(outer)[0]
    n_out = len(O)
    loc = -np.ones(len(sp), int)
    loc[O] = np.arange(n_out)
    outer_f = loc[sf[outer[sf].all(1)]]
    so = sp[O]
    bp, bf = body["positions"].astype(float), body["indices"].reshape(-1, 3)
    allp = np.vstack([so, bp])
    keys = np.round(allp * 1000).astype(np.int64)
    _, merged, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.ravel()
    m = trimesh.Trimesh(allp[merged], inverse[np.vstack([outer_f, bf + n_out])], process=False)
    nrm = m.vertex_normals[inverse]
    shared = np.bincount(inverse, minlength=len(merged))[inverse] > 1
    seam_local = np.nonzero(shared[:n_out])[0]
    skin_n = skin["normals"].copy()
    skin_n[O[seam_local]] = nrm[seam_local]
    skin["normals"] = skin_n.astype(np.float32)
    body["normals"] = nrm[n_out:].astype(np.float32)
    so_n = skin_n[O].astype(float)

    # 2) regional pigment from MakeHuman target vertex sets (per original vertex, carried to any point set)
    def region(names, lo, hi):
        return smoothstep(lo, hi, target_weight(names)[index])
    ears_r = region(["ears/r-ear-flap-incr", "ears/l-ear-flap-incr"], 0.02, 0.1)  # the auricle only (scale targets move the whole temple)
    nose_r = region(["nose/nose-scale-horiz-incr", "nose/nose-scale-depth-incr"], 0.15, 0.7)
    cheek_r = region(["cheek/r-cheek-volume-incr", "cheek/l-cheek-volume-incr"], 0.2, 0.9)
    lip_r = region(["mouth/mouth-lowerlip-volume-incr", "mouth/mouth-upperlip-volume-incr"], 0.25, 0.65)
    surf = np.vstack([so, bp])
    ears_w = transfer(ears_r, fitted, surf)

    # landmarks for the hairline
    eac = np.array(json.loads((ROOT / "pipeline/specs/landmarks.vhp-male.json").read_text(encoding="utf-8"))["landmarks"]["eac_lateral"]["xyz"], float)
    eye_c = [eyes[eyes[:, 0] > 0].mean(0), eyes[eyes[:, 0] < 0].mean(0)]
    ze, za, yc = float(np.mean([c[2] for c in eye_c])), float(eac[2]), float(eac[1])
    ear_tree = cKDTree(so[ears_w[:n_out] > 0.5])

    def hair_fields(P, N):
        """Scalp and brow weights, hair length (mm), kind and combing direction at points P with normals N."""
        # Authored hairline height (mm, relative to the eye centre or the ear canal): on the sides by front-back
        # position from the ear canal, on the forehead a constant height, blended across the temple.
        hl = spec["hairline"]
        ref = np.array([ze if r == "eye" else za for r in hl["ref"]])
        z_side = np.interp(P[:, 1] - yc, hl["y"], ref + np.array(hl["dz"]))
        # The forehead rule applies only on the front of the head; the back follows the side table across the midline.
        w_side = 1 - (1 - smoothstep(hl["side_from_mm"][0], hl["side_from_mm"][1], np.abs(P[:, 0]))) * smoothstep(20, 50, P[:, 1] - yc)
        z_line = ze + hl["front_dz"] + (z_side - ze - hl["front_dz"]) * w_side
        scalp = smoothstep(z_line, z_line + spec["hairline_soft_mm"], P[:, 2])
        d_ear = ear_tree.query(P)[0]
        scalp = scalp * smoothstep(spec["ear_clear_mm"][0], spec["ear_clear_mm"][1], d_ear)
        # Eyebrows over each eye: a band from medial (thicker, flat) to the tail (thinner, falling slightly), on the
        # forward-facing skin of the brow ridge. Authored from the eye centres (MakeHuman's eyebrow target moves the
        # whole forehead, so it cannot outline the brow).
        brows = np.zeros(len(P))
        b = spec["brow"]
        for c in eye_c:
            u = (np.abs(P[:, 0]) - (abs(c[0]) - b["medial_mm"])) / (b["medial_mm"] + b["lateral_mm"])
            zc = c[2] + b["height_mm"] + b["arch_mm"] * np.sin(np.pi * np.clip(u, 0, 1) * 0.85) - b["tail_drop_mm"] * smoothstep(0.7, 1.0, u)
            half = b["half_medial_mm"] * (1 - u) + b["half_tail_mm"] * u
            across = 1 - smoothstep(half * 0.55, half, np.abs(P[:, 2] - zc))
            along = smoothstep(-0.02, 0.06, u) * (1 - smoothstep(0.9, 1.0, u))
            front = (P[:, 1] > c[1] - 20) & (np.sign(P[:, 0]) == np.sign(c[0]))
            brows = np.maximum(brows, across * along * front)
        brows = np.clip(brows, 0, 1)
        length = np.maximum(scalp * (spec["side_mm"] + (spec["top_mm"] - spec["side_mm"]) * smoothstep(za + 35, za + 90, P[:, 2])), brows * spec["brow_mm"])
        kind = (brows * spec["brow_mm"] > scalp * spec["side_mm"]).astype(np.float32)
        side = 1 - smoothstep(za + 40, za + 85, P[:, 2])
        d = np.c_[np.sign(P[:, 0]) * spec["part_spread"], -np.ones(len(P)), -spec["comb_down"] - spec["side_down"] * side]
        lateral = smoothstep(eye_c[0][0] - 25, eye_c[0][0] + 12, np.abs(P[:, 0]))
        d_brow = np.c_[np.sign(P[:, 0]), 0.15 * np.ones(len(P)), 0.35 * (1 - lateral) - 0.3 * lateral]
        d = np.where(kind[:, None] > 0.5, d_brow, d)
        flow = d - N * (d * N).sum(1, keepdims=True)
        flow /= np.maximum(np.linalg.norm(flow, axis=1, keepdims=True), 1e-9)
        return scalp, brows, length, kind, flow, d_ear

    scalp, brows, _, _, _, d_ear = hair_fields(so, so_n)

    # upper lash line: skin margin resting on the upper half of the eye
    lash = np.zeros(len(surf))
    d_eye, _ = cKDTree(eyes).query(surf)
    for c in eye_c:
        near = (d_eye < spec["lash_mm"]) & (np.linalg.norm(surf - c, axis=1) < 22) & (surf[:, 2] > c[2] - 1.5)
        lash = np.maximum(lash, near * (1 - smoothstep(0.4, spec["lash_mm"], d_eye)))

    # the ear canal entrance (and the inner shell seen through it) is shadowed
    lash = np.maximum(lash, 1 - smoothstep(3.0, 9.0, np.linalg.norm(surf - eac, axis=1)))

    # 3) the hair root surface: the scalp and brow patches of the outer skin, subdivided once so the hairline is
    #    finer than the skin triangles, with the fields evaluated at the new vertices.
    w_hair = np.maximum(scalp, brows)
    hf = outer_f[(w_hair[outer_f] > 0.01).any(1)]
    used = np.unique(hf)
    remap = -np.ones(n_out, int)
    remap[used] = np.arange(len(used))
    hv, hfaces, hattr = trimesh.remesh.subdivide(so[used], remap[hf], vertex_attributes={"n": so_n[used]})
    hn = hattr["n"] / np.maximum(np.linalg.norm(hattr["n"], axis=1, keepdims=True), 1e-9)
    h_scalp, h_brows, h_len, h_kind, h_flow, _ = hair_fields(hv, hn)
    np.savez_compressed(OUT / "hair.npz", positions=hv.astype(np.float32), normals=hn.astype(np.float32), indices=hfaces.astype(np.uint32).ravel(), hair_h=h_len.astype(np.float32), flow=h_flow.astype(np.float32), hair_kind=h_kind.astype(np.float32), kind="surface")

    scalp_all = np.r_[scalp, np.zeros(len(bp))]  # no hair on the exterior body (the nape hairline lies above the scene cut)
    brows_all = np.r_[brows, np.zeros(len(bp))]
    tint = np.c_[np.clip(0.55 * ears_w + 0.6 * transfer(nose_r, fitted, surf) + 0.45 * transfer(cheek_r, fitted, surf), 0, 1), transfer(lip_r, fitted, surf), np.clip(np.maximum(0.6 * brows_all, lash), 0, 1), np.clip(scalp_all, 0, 1)].astype(np.float32)
    # The inner shell (seen only through cuts) takes the tint of the nearest outer vertex.
    tint_skin = tint[:n_out][cKDTree(so).query(sp)[1]]
    tint_skin[O] = tint[:n_out]
    skin["tint"] = tint_skin.astype(np.float32)
    lobe_d = np.load(OUT / "parotid_superficial_lobe.npz")
    lobe = trimesh.Trimesh(lobe_d["positions"].astype(float), lobe_d["indices"].reshape(-1, 3), process=False)
    foot = np.full(len(sp), -100.0)  # -100 marks the inner shell (the stage colours it as fat where a raised flap shows it)
    foot[O] = footprint(so, so_n, lobe, ears_w[:n_out])
    skin["foot"] = foot.astype(np.float32)
    body["tint"] = tint[n_out:]
    np.savez_compressed(OUT / "skin.npz", **skin)
    np.savez_compressed(OUT / "exterior_body.npz", **body)
    seam_skin = seam_local
    scalp = scalp_all
    length = np.r_[np.maximum(scalp[:n_out] * spec["top_mm"], 0), np.zeros(len(bp))]
    flow = np.zeros_like(surf)
    d_ear = np.r_[d_ear, np.full(len(bp), 99.0)]
    used = hv

    # QC: the hair keeps the ear, the preauricular skin and the parotid region clear.
    centre = np.array(face["conform_center"], float)
    parotid_zone = (np.linalg.norm(surf - centre, axis=1) < spec["parotid_clear_mm"]) & (surf[:, 0] > 0)
    report = {
        "seam_vertices": int(len(seam_skin)),
        "hair_vertices": int(len(used)),
        "hair_max_in_parotid_zone": round(float(scalp[parotid_zone].max()), 3) if parotid_zone.any() else 0.0,
        "hair_min_ear_clearance_mm": round(float(d_ear[scalp > 0.05].min()), 1) if (scalp > 0.05).any() else None,
        "body_vertices": int(len(bp)),
    }
    ok = report["seam_vertices"] > 50 and report["hair_max_in_parotid_zone"] < 0.01 and (report["hair_min_ear_clearance_mm"] or 99) >= spec["ear_clear_mm"][0]
    checks_path = QC / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8"))
    checks["exterior"] = {"pass": bool(ok), **report, "summary": f"presentation only: seam welded at {report['seam_vertices']} vertices; hair clear of the parotid region (max {report['hair_max_in_parotid_zone']}) and at least {report['hair_min_ear_clearance_mm']} mm from the ear"}
    checks_path.write_text(json.dumps(checks, indent=2), encoding="utf-8")
    print(("PASS" if ok else "FAIL"), "exterior:", checks["exterior"]["summary"])
    render(surf, np.vstack([outer_f, bf + n_out]), tint, length, flow)


def render(p, f, tint, length, flow):
    from matplotlib.collections import PolyCollection

    fig, axes = plt.subplots(1, 3, figsize=(21, 9), dpi=90)
    tri = p[f]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
    views = [("lateral (right)", np.array([1.0, 0, 0]), 1, 1), ("three-quarter", np.array([0.7, 0.7, 0]), None, 1), ("anterior", np.array([0, 1.0, 0]), 0, -1)]
    for ax, (title, vdir, _, _) in zip(axes, views):
        right = np.cross([0, 0, 1.0], vdir)
        right /= np.linalg.norm(right)
        u = tri @ right * -1
        v = tri[:, :, 2]
        depth = (tri @ vdir).mean(1)
        order = np.argsort(depth)
        shade = 0.3 + 0.7 * np.clip(fn @ (vdir * 0.8 + np.array([0, 0, 0.5])), 0, 1)
        t = tint[f].mean(1)
        h = length[f].mean(1)
        col = np.array([0.86, 0.68, 0.58])[None, :] * np.ones((len(f), 1))
        col = col * (1 - 0.25 * t[:, 0:1]) + np.array([0.8, 0.35, 0.3]) * 0.25 * t[:, 0:1]
        col = col * (1 - 0.5 * t[:, 1:2]) + np.array([0.6, 0.3, 0.3]) * 0.5 * t[:, 1:2]
        col = col * (1 - 0.7 * t[:, 2:3])
        hair = np.clip(h / 6, 0, 1)[:, None]
        col = col * (1 - hair) + np.array([0.18, 0.13, 0.1]) * hair
        col = col * shade[:, None]
        ax.add_collection(PolyCollection(np.stack([u[order], v[order]], -1), facecolors=np.clip(col[order], 0, 1), edgecolors="none"))
        ax.autoscale()
        ax.set_aspect("equal")
        ax.set_facecolor("#20262a")
        ax.set_title(title, fontsize=9)
    fig.suptitle("Exterior presentation (no anatomy): skin + exterior body, regional tint, hair length (dark = longer). Seam at the scene cut.", fontsize=9)
    fig.tight_layout()
    fig.savefig(QC / "exterior.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
