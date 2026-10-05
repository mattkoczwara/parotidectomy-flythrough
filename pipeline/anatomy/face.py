"""Replace the CT donor's skin with a generic MakeHuman (MPFB, CC0) head that fits the anatomy beneath it.

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/face.py      (after surfaces.py)

1. Extract the MPFB base mesh (body group) down to the upper chest and the eye helpers, with MakeHuman's macro
   modifiers for a generic adult; convert to the CT RAS frame (mm).
2. Similarity ICP (trimmed) of the MPFB head to the CT skin.
3. Conform only where surgical anatomy lies beneath (right preauricular, parotid, cheek and upper neck), using a
   smooth displacement field fitted to MPFB-to-CT offsets and blended by a weight that falls to zero over the
   eyes, nose and lips. Fine features of the donor are not reproduced; the central face stays generic.
4. Build a closed 2 mm skin shell (outer surface, inner offset, walls on every boundary) and write
   work/meshes/skin.npz and eyes.npz, replacing the CT skin; append checks to docs/qc/m1-anatomy/checks.json.
"""
import json
import zipfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
import trimesh
import yaml
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree

from common import ROOT, WORK, body_mask, load_ct

OUT = WORK / "meshes"
QC = ROOT / "docs/qc/m1-anatomy"
ARCHIVE = ROOT / "pipeline/sources/raw/mpfb/add-on-mpfb-v2.0.17.zip"


def read_target(name):
    """A MakeHuman target (CC0) as per-vertex offsets in the same RAS mm frame as read_base()."""
    import gzip

    d = np.zeros((19158, 3))
    for line in gzip.decompress(zipfile.ZipFile(ARCHIVE).read(f"data/targets/{name}.target.gz")).decode().splitlines():
        t = line.split()
        if len(t) == 4 and not line.startswith("#"):
            d[int(t[0])] = [-float(t[1]), float(t[3]), float(t[2])]
    return d * 100.0


def macro(v, spec):
    """MakeHuman's macro modifiers for a generic adult: the raw base mesh is an androgynous neutral that MakeHuman
    itself never shows unmodified. Gender and age weights as MakeHuman applies them; the three ancestry targets
    are mixed equally (its default), so the face stays generic. Exterior presentation only: the surgical region
    is conformed to the CT afterwards."""
    old = spec["age_old_weight"]
    g = spec["gender"]
    out = v.copy()
    for eth in ("caucasian", "african", "asian"):
        out += (1 - old) / 3 * read_target(f"macrodetails/{eth}-{g}-young") + old / 3 * read_target(f"macrodetails/{eth}-{g}-old")
    out += (1 - old) * read_target(f"macrodetails/universal-{g}-young-averagemuscle-averageweight") + old * read_target(f"macrodetails/universal-{g}-old-averagemuscle-averageweight")
    return out


def read_base():
    """Body-group triangles and eye-helper triangles from MPFB's base.obj (decimetres, Y up, +X = model's left)."""
    text = zipfile.ZipFile(ARCHIVE).read("data/3dobjs/base.obj").decode()
    verts, groups, g = [], {}, None
    for line in text.splitlines():
        if line.startswith("v "):
            verts.append([float(t) for t in line.split()[1:4]])
        elif line.startswith("g "):
            g = line.split()[1]
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
            groups.setdefault(g, []).extend([[idx[0], idx[i], idx[i + 1]] for i in range(1, len(idx) - 1)])
    v = np.array(verts)
    # MakeHuman (dm, Y up, facing +Z, +X model's left) -> RAS mm (+x patient right, +y anterior, +z superior)
    ras = np.c_[-v[:, 0], v[:, 2], v[:, 1]] * 100.0
    return ras, {k: np.array(f) for k, f in groups.items()}


def submesh(v, faces, keep_vertex):
    f = faces[keep_vertex[faces].all(1)]
    m = trimesh.Trimesh(v, f, process=False)
    m.remove_unreferenced_vertices()
    return m


def axis_scale_icp(src, dst, iters=60, trim=0.8):
    """Trimmed ICP solving a per-axis scale and a translation, with no rotation: both models are already in
    standard anatomical orientation, and a nearly symmetric head lets a free rotation converge wrongly."""
    tree = cKDTree(dst)
    s, t = np.ones(3), dst.mean(0) - src.mean(0)
    for _ in range(iters):
        p = src * s + t
        d, j = tree.query(p)
        keep = d <= np.quantile(d, trim)
        a, b = src[keep], dst[j[keep]]
        for k in range(3):
            A = np.c_[a[:, k], np.ones(len(a))]
            s[k], t[k] = np.linalg.lstsq(A, b[:, k], rcond=None)[0]
    return s, t


def measure(p, z_top):
    """Pronasale, soft-tissue pogonion, head length (pronasale to occiput at nose level), maximum breadth and
    lower-face height (pronasale to pogonion), from surface points in the RAS frame."""
    mid = np.abs(p[:, 0]) < 12
    face = mid & (p[:, 2] > z_top - 190) & (p[:, 2] < z_top - 90)
    prn = p[face][np.argmax(p[face][:, 1])]
    chin = mid & (p[:, 2] < prn[2] - 40) & (p[:, 2] > prn[2] - 110)
    pog = p[chin][np.argmax(p[chin][:, 1])]
    level = np.abs(p[:, 2] - prn[2]) < 6
    occ = p[level & mid][:, 1].min()
    band = np.abs(p[:, 2] - (prn[2] + 55)) < 6
    return {"pronasale": prn, "pogonion": pog, "length": prn[1] - occ, "breadth": p[band][:, 0].max() - p[band][:, 0].min(), "lower_face": prn[2] - pog[2]}


def in_face_soft(p, fx):
    """1 inside the facial region (with soft lateral and vertical edges), 0 outside."""
    lat = 1 - smoothstep(fx["x_half"] - 10, fx["x_half"] + 10, np.abs(p[:, 0]))
    vert = smoothstep(fx["z"][0] - 10, fx["z"][0] + 10, p[:, 2]) * (1 - smoothstep(fx["z"][1] - 10, fx["z"][1] + 10, p[:, 2]))
    return lat * vert


def smoothstep(e0, e1, x):
    k = np.clip((x - e0) / (e1 - e0), 0, 1)
    return k * k * (3 - 2 * k)


def main() -> None:
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))["face"]
    ct, aff, zooms = load_ct()
    body = body_mask(ct)
    from scipy import ndimage

    surf_idx = np.argwhere(body & ~ndimage.binary_erosion(body))
    # drop "skin" that is only the edge of the CT grid (the body continues beyond it)
    edge = np.any((surf_idx[:, :2] <= 1) | (surf_idx[:, :2] >= np.array(body.shape[:2]) - 2), axis=1)
    surf_idx = surf_idx[~edge]
    skin_pts = nib.affines.apply_affine(aff, surf_idx)
    z_top_ct = skin_pts[:, 2].max()
    skin_pts = skin_pts[skin_pts[:, 2] > spec["neck_cut_z"] - 20]
    skin_tree = cKDTree(skin_pts)

    v, groups = read_base()
    v = macro(v, spec["mpfb_macro"])
    # The surface is kept down to the upper chest: above the scene cut it is the skin, below it the exterior body
    # (neck, shoulders, upper chest), a presentation surface with no anatomy beneath it.
    head_keep = v[:, 2] > spec["mpfb_body_cut_dm"] * 100
    head = submesh(v, groups["body"], head_keep)
    kept_index = np.unique(groups["body"][head_keep[groups["body"]].all(1)])  # original MPFB index of each head vertex
    eyes = trimesh.util.concatenate([submesh(v, groups[g], head_keep) for g in ("helper-l-eye", "helper-r-eye")])

    # 2) alignment by craniofacial measurements taken the same way on both surfaces (no rotation: both are in
    #    standard anatomical orientation), then a translation-only trimmed refinement on the face region.
    hv = head.vertices
    ct_m, mp_m = measure(skin_pts, z_top_ct), measure(hv, hv[:, 2].max())
    s = np.array([ct_m["breadth"] / mp_m["breadth"], ct_m["length"] / mp_m["length"], ct_m["lower_face"] / mp_m["lower_face"]])
    t = ct_m["pronasale"] - mp_m["pronasale"] * s
    face_zone = lambda p: (p[:, 2] > ct_m["pogonion"][2] - 10) & (p[:, 2] < z_top_ct - 5)
    tree_s = cKDTree(skin_pts)
    for _ in range(30):
        p = hv * s + t
        sel = face_zone(p)
        d, j = tree_s.query(p[sel])
        keep = d <= np.quantile(d, 0.7)
        t += (skin_pts[j[keep]] - p[sel][keep]).mean(0)
    aligned = hv * s + t
    eyes_aligned = eyes.vertices * s + t
    # 3a) global envelope, outward only and never over the face: where the generic head is too small to contain
    #     the cadaver's cranium and jaw, push its skin out to the CT skin; everywhere else leave it generic.
    tree_s = cKDTree(skin_pts)
    d0, j0 = tree_s.query(aligned)
    off = skin_pts[j0] - aligned
    head_c = aligned.mean(0)
    outward = np.einsum("ij,ij->i", off, aligned - head_c) > 0  # CT skin lies outside the generic head here
    fx = spec["face_region"]
    in_face = (aligned[:, 1] > fx["y_min"]) & (np.abs(aligned[:, 0]) < fx["x_half"]) & (aligned[:, 2] > fx["z"][0]) & (aligned[:, 2] < fx["z"][1])
    usable = (aligned[:, 2] > spec["neck_cut_z"]) & (aligned[:, 2] < z_top_ct - 3) & (d0 < spec["envelope_max_offset_mm"]) & ~in_face
    gi = np.nonzero(usable)[0]
    gi = gi[np.linspace(0, len(gi) - 1, min(len(gi), 600)).astype(int)]
    target = np.where(outward[gi, None], off[gi], 0.0)
    envelope = RBFInterpolator(aligned[gi], target, kernel="thin_plate_spline", smoothing=spec["envelope_smoothing"], degree=1)
    face_w = 1 - np.clip((aligned[:, 1] - (fx["y_min"] - 25)) / 25, 0, 1) * in_face_soft(aligned, fx)
    # Below the scene cut the envelope fades out over the lower neck: the thin-plate spline was fitted above it and
    # would extrapolate into the shoulders. Above the cut the factor is 1.
    face_w = face_w * smoothstep(spec["scene_cut_z"] - spec["body_fade_mm"], spec["scene_cut_z"], aligned[:, 2])
    aligned = aligned + face_w[:, None] * envelope(aligned)
    eyes_aligned = eyes_aligned + envelope(eyes_aligned) * 0  # eyes stay with the (unchanged) face

    # 3b) conform where anatomy lies beneath: weight by distance from the right parotid region.
    c = np.array(spec["conform_center"])
    dist = np.linalg.norm(aligned - c, axis=1)
    # the facial region keeps its generic features: no local conform there (same region as the envelope)
    w = (1 - smoothstep(spec["conform_full_mm"], spec["conform_zero_mm"], dist)) * smoothstep(spec["midline_x"][0], spec["midline_x"][1], aligned[:, 0]) * (1 - in_face_soft(aligned, fx))
    # Offset along each vertex normal to the CT skin (found by sampling the body mask along the normal), then
    # Laplacian-smoothed over the mesh: normal-only displacement cannot slide neighbours across each other, which
    # nearest-point correspondences did in the concave jaw-neck crease.
    tmp = trimesh.Trimesh(aligned, head.faces, process=False)
    tmp.fix_normals()
    nrm = tmp.vertex_normals
    ts = np.linspace(-spec["max_offset_mm"], spec["max_offset_mm"], int(spec["max_offset_mm"] * 4) + 1)
    inv_aff = np.linalg.inv(aff)
    samples = aligned[:, None, :] + nrm[:, None, :] * ts[None, :, None]
    ijk_s = nib.affines.apply_affine(inv_aff, samples.reshape(-1, 3)).T
    inside = ndimage.map_coordinates(body.astype(np.float32), ijk_s, order=1, mode="constant").reshape(len(aligned), len(ts)) > 0.5
    # outermost inside->outside transition along the normal: the skin crossing
    trans = inside[:, :-1] & ~inside[:, 1:]
    has = trans.any(1)
    last = len(ts) - 2 - np.argmax(trans[:, ::-1], axis=1)
    offset = np.where(has, (ts[last] + ts[last + 1]) / 2, 0.0) * (w > 0.02)
    # smooth the scalar offset over the mesh (uniform Laplacian)
    adj = tmp.vertex_neighbors
    for _ in range(spec["offset_smoothing_iters"]):
        offset = 0.5 * offset + 0.5 * np.array([offset[nb].mean() if len(nb) else offset[i] for i, nb in enumerate(adj)])
    fitted = aligned + (w * offset)[:, None] * nrm
    # The auricle is thin and projecting, so normal projection crumples it: move it rigidly with the mean
    # displacement of the skin ring around its root instead (both ears, so the head stays symmetric in form).
    helices, helix_right = [], None
    for side in (1, -1):
        band = (np.abs(aligned[:, 2] - spec["ear_level_z"]) < 25) & (aligned[:, 0] * side > 0)
        helix = aligned[band][np.argmax(aligned[band][:, 0] * side)]
        r = np.linalg.norm(aligned - helix, axis=1)
        ear = r < spec["ear_radius_mm"]
        ring = (r >= spec["ear_radius_mm"]) & (r < spec["ear_radius_mm"] + 10)
        if ring.any():
            shift = (fitted[ring] - aligned[ring]).mean(0)
            fitted[ear] = aligned[ear] + shift
            helices.append(helix + shift)
            if side == 1:
                helix_right = helix + shift
    # the fitted right helix locates the auricle for the incision and flap (flap.py)
    (WORK / "face.resolved.json").write_text(json.dumps({"helix_right": [round(float(v), 2) for v in helix_right]}, indent=2), encoding="utf-8")

    # Coverage: wherever segmented bone or muscle comes within `coverage_mm` of the skin (the cadaver's neck
    # flares faster than the envelope follows; the generic face is thin over the nasal bones), push the skin out
    # along its normal by the shortfall, smoothed so the correction adds no bumps.
    anat = np.zeros(body.shape, bool)
    for rel in spec["coverage_masks"]:
        anat |= np.asarray(nib.load(str(WORK / "seg" / f"{rel}.nii.gz")).dataobj) > 0
    # Authored superficial structures (nerves and veins drawn from the literature, not segmented) count too.
    for sid in spec.get("coverage_meshes", []):
        p = np.load(OUT / f"{sid}.npz")["positions"]
        ijk_m = np.round(nib.affines.apply_affine(inv_aff, p)).astype(int)
        ok_m = np.all((ijk_m >= 0) & (ijk_m < np.array(body.shape)), axis=1)
        anat[tuple(ijk_m[ok_m].T)] = True
    sdf_anat = ndimage.distance_transform_edt(~anat, sampling=zooms)
    cov = trimesh.Trimesh(fitted, head.faces, process=False)
    cov.fix_normals()
    for _ in range(3):
        dist_a = ndimage.map_coordinates(sdf_anat, nib.affines.apply_affine(inv_aff, cov.vertices).T, order=1, mode="nearest")
        push = np.clip(spec["coverage_mm"] - dist_a, 0, None)
        for _ in range(4):
            push = np.maximum(push, 0.5 * push + 0.5 * np.array([push[nb].mean() if len(nb) else push[i] for i, nb in enumerate(adj)]))
        cov.vertices = cov.vertices + push[:, None] * cov.vertex_normals
    fitted = np.asarray(cov.vertices)

    full = trimesh.Trimesh(fitted, head.faces, process=False)
    full = full.subdivide_loop(iterations=1)
    # a clean horizontal neck cut shared with the anatomy (surfaces.py crops at the same plane)
    outer = full.slice_plane([0, 0, spec["scene_cut_z"]], [0, 0, 1], cap=False)
    outer.remove_unreferenced_vertices()
    # The exterior body below the same cut, so its top loop is the skin's bottom loop vertex for vertex
    # (exterior.py welds the normals across the seam).
    body_below = full.slice_plane([0, 0, spec["scene_cut_z"]], [0, 0, -1], cap=False)
    body_below.remove_unreferenced_vertices()
    np.savez_compressed(OUT / "exterior_body.npz", positions=body_below.vertices.astype(np.float32), normals=body_below.vertex_normals.astype(np.float32), indices=body_below.faces.astype(np.uint32).ravel(), kind="surface")
    # The fitted MPFB vertices with their original indices: exterior.py locates regions (lips, ears, brows) by the
    # vertex sets of MakeHuman's own targets.
    np.savez_compressed(WORK / "face_basis.npz", fitted=fitted.astype(np.float32), index=kept_index.astype(np.int32), eyes=eyes_aligned.astype(np.float32))
    # recompute weights on the subdivided mesh for the residual report
    wv = (1 - smoothstep(spec["conform_full_mm"], spec["conform_zero_mm"], np.linalg.norm(outer.vertices - c, axis=1))) * smoothstep(spec["midline_x"][0], spec["midline_x"][1], outer.vertices[:, 0]) * (1 - in_face_soft(outer.vertices, fx))
    resid = skin_tree.query(outer.vertices)[0]
    ear_zone = np.zeros(len(outer.vertices), bool)
    for h in helices:
        ear_zone |= np.linalg.norm(outer.vertices - h, axis=1) < spec["ear_radius_mm"] + 5
    eac = np.array(json.loads((ROOT / "pipeline/specs/landmarks.vhp-male.json").read_text(encoding="utf-8"))["landmarks"]["eac_lateral"]["xyz"])
    ear_zone |= np.linalg.norm(outer.vertices - eac, axis=1) < spec["ear_radius_mm"]  # the cadaver's own auricle
    full = (wv > 0.9) & ~ear_zone  # auricles are generic by design; the residual describes conformed skin only
    report = {
        "axis_scales_xyz": [round(float(v), 4) for v in s],
        "measurements_ct_mm": {k: (round(float(v), 1) if np.isscalar(v) else [round(float(x), 1) for x in v]) for k, v in ct_m.items()},
        "conform_region_residual_mm": {"median": round(float(np.median(resid[full])), 2), "p95": round(float(np.percentile(resid[full], 95)), 2)},
        "unconformed_face_residual_mm": {"median": round(float(np.median(resid[wv < 0.1])), 2)},
        "fraction_of_head_vertices_conformed": round(float((wv > 0.5).mean()), 3),
        "high_residual_centroid": [round(float(v), 1) for v in outer.vertices[full & (resid > 6)].mean(0)] if (full & (resid > 6)).any() else None,
        "high_residual_count": int((full & (resid > 6)).sum()),
        "conformed_count": int(full.sum()),
    }

    # 4) closed skin shell: outer surface, inner offset, walls along every boundary loop
    n_out = len(outer.vertices)
    inner_v = outer.vertices - outer.vertex_normals * spec["skin_thickness_mm"]
    V = np.vstack([outer.vertices, inner_v])
    F = [outer.faces, outer.faces[:, ::-1] + n_out]
    edges = outer.edges_sorted
    uniq, counts = np.unique(edges, axis=0, return_counts=True)
    boundary = {tuple(e) for e in uniq[counts == 1]}
    walls = []
    for f in outer.faces:
        for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            if (min(a, b), max(a, b)) in boundary:
                walls += [[b, a, a + n_out], [b, a + n_out, b + n_out]]
    F.append(np.array(walls))
    shell = trimesh.Trimesh(V, np.vstack(F), process=False)
    np.savez_compressed(OUT / "skin.npz", positions=shell.vertices.astype(np.float32), normals=shell.vertex_normals.astype(np.float32), indices=shell.faces.astype(np.uint32).ravel(), kind="surface", n_outer=np.int64(n_out))  # outer surface = the first n_outer vertices (flap.py appends refined ones)
    eyes_m = trimesh.Trimesh(eyes_aligned, eyes.faces, process=False)
    np.savez_compressed(OUT / "eyes.npz", positions=eyes_m.vertices.astype(np.float32), normals=eyes_m.vertex_normals.astype(np.float32), indices=eyes_m.faces.astype(np.uint32).ravel(), kind="surface")

    # Voxelise the final head (skin surface plus eyes) into the CT grid for the layer shells.
    shape = body.shape
    inv = np.linalg.inv(aff)
    pts = np.vstack([outer.sample(3_000_000, seed=7), eyes_m.sample(200_000, seed=8)])
    ijk = np.round(nib.affines.apply_affine(inv, pts)).astype(int)
    ok_ijk = np.all((ijk >= 0) & (ijk < np.array(shape)), axis=1)
    head_mask = np.zeros(shape, bool)
    head_mask[tuple(ijk[ok_ijk].T)] = True
    head_mask = ndimage.binary_dilation(head_mask, iterations=1)
    for k in range(shape[2]):
        head_mask[:, :, k] = ndimage.binary_fill_holes(head_mask[:, :, k])
    nib.save(nib.Nifti1Image(head_mask.astype(np.uint8), aff), str(WORK / "skin_mask.nii.gz"))

    # Anatomy must stay beneath the new skin: signed depth inside the voxelised head (robust in concave folds,
    # where a nearest-vertex normal test gives false alarms). Structures below the neck cut are excluded.
    depth_in = ndimage.distance_transform_edt(head_mask, sampling=zooms) - ndimage.distance_transform_edt(~head_mask, sampling=zooms)
    sd = {}
    # Instruments and schematic overlays are not anatomy: a probe leaves the wound, regrowth fibres lie a hand's breadth under the skin.
    skip = {"skin", "eyes", "subcutaneous_fat", "smas", "nerve_plane", "exterior_body", "hair", *spec.get("depth_check_exclude", [])}
    probes = [p.stem for p in OUT.glob("*.npz") if p.stem not in skip]
    for n in probes:
        path = OUT / f"{n}.npz"
        if not path.exists():
            continue
        pts = np.load(path)["positions"]
        pts = pts[pts[:, 2] > spec["scene_cut_z"] + 3]
        ijk_p = nib.affines.apply_affine(inv, pts).T
        sd[n] = round(float(ndimage.map_coordinates(depth_in, ijk_p, order=1, mode="nearest").min()), 2)
    report["min_depth_below_skin_mm"] = sd
    bones = {"skull", "mandible"}
    soft_min = min(v for k, v in sd.items() if k not in bones)
    bone_min = min(v for k, v in sd.items() if k in bones)
    report["min_depth_soft_tissue_mm"], report["min_depth_bone_mm"] = soft_min, bone_min
    ok = report["conform_region_residual_mm"]["median"] <= 1.5 and soft_min >= spec["min_anatomy_depth_mm"] and bone_min >= spec["min_bone_depth_mm"]

    checks_path = QC / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8"))
    checks["face_fit"] = {"pass": ok, **report, "summary": f"conform-region residual median {report['conform_region_residual_mm']['median']} mm (p95 {report['conform_region_residual_mm']['p95']}); shallowest soft tissue {soft_min} mm and bone {bone_min} mm below the skin; {report['fraction_of_head_vertices_conformed']:.0%} of head vertices conformed"}
    checks_path.write_text(json.dumps(checks, indent=2), encoding="utf-8")
    print(("PASS" if ok else "FAIL"), "face_fit:", checks["face_fit"]["summary"])
    render(outer, skin_pts, wv, resid)


def render(outer, skin_pts, w, resid):
    from matplotlib.collections import PolyCollection

    fig, axes = plt.subplots(1, 3, figsize=(21, 8), dpi=100)
    tri = outer.vertices[outer.faces]
    nrm = outer.face_normals
    for ax, (title, a, b, flip, depth, vdir) in zip(axes, [("lateral (patient's right)", 1, 2, 1, 0, 1), ("anterior", 0, 2, -1, 1, 1), ("conform weight / residual, lateral", 1, 2, 1, 0, 1)]):
        order = np.argsort(tri[:, :, depth].mean(1) * vdir)
        if title.startswith("conform"):
            val = np.clip(resid[outer.faces].mean(1) / 4.0, 0, 1)
            cols = plt.cm.magma(val)[:, :3] * (0.4 + 0.6 * w[outer.faces].mean(1))[:, None]
        else:
            shade = 0.35 + 0.65 * np.clip(nrm[:, depth] * vdir, 0, 1)
            cols = np.array([0.86, 0.68, 0.58]) * shade[:, None]
        ax.add_collection(PolyCollection(np.stack([tri[order][:, :, a] * flip, tri[order][:, :, b]], -1), facecolors=cols[order], edgecolors="none"))
        sel = skin_pts[np.abs(skin_pts[:, depth] - np.percentile(skin_pts[:, depth], 50 if depth == 1 else 50)) < 0.6]
        ax.scatter(sel[:, a] * flip, sel[:, b], s=0.3, c="#39c", alpha=0.6)
        ax.autoscale()
        ax.set_aspect("equal")
        ax.set_facecolor("#20262a")
        ax.set_title(title, fontsize=9)
    fig.suptitle("MPFB (CC0) head fitted to the CT frame. Blue dots: CT skin at the mid-plane. Right panel: magenta-bright = residual to CT skin (0-4 mm), darkened where unconformed", fontsize=9)
    fig.tight_layout()
    fig.savefig(QC / "face_fit.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
