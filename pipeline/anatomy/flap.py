"""Incision and skin flap fields for the operative plates (plan §8, "Incision" and "Skin flap").

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/flap.py view    (lateral picking view)
    pipeline/segment/.venv/Scripts/python pipeline/anatomy/flap.py         (after layers.py)

The incision is authored in anatomy.yaml `incision` as control points in the sagittal (A, S) projection of the
right side, placed against the fitted skin and landmarks in the picking view. No mesh is cut: per-vertex fields
are baked into the skin and the subcutaneous fat, and the stage cuts and folds with them (the same mechanism
as the cutaway windows and the peel):

    cut     signed distance (mm) to the incision in the (A, S) projection, positive on the flap side; its zero
            crossing interpolates linearly across triangles, so the cut and the ink line are sub-triangle exact.
            Stored as cut / CUT_SCALE, clipped to [-1, 1], so glTF quantisation keeps sub-0.1 mm precision.
    cut_s   path parameter (0 at the preauricular start, 1 at the cervical end) of the nearest incision point:
            drives the ink as it is drawn.
    flap_w  0..1 flap weight: rises with distance from the fold axis toward the incision, is capped to 0 just
            past both ends of the incision (the skin beyond them is uncut) and on the auricle, which stays with
            the ear. The stage rotates flap vertices about the fold axis by progress * max_angle * flap_w (a curl
            that leaves the attached border in place).

The fold axis lies in the sagittal plane, parallel to the chord joining the incision's ends and `axis_offset_mm`
in front of it, on the skin surface: the flap is raised forward and folded over the cheek, clear of the field.

The flap is skin and subcutaneous fat, raised superficial to the parotid fascia (claim flap-plane); the SMAS and
fascia stay on the gland. In the neck the flap is subplatysmal; there is no platysma mesh, and folding the model's
SMAS layer with the flap below the jaw line only (its weight falling to zero far from the fold axis) sheared it,
so the operative plates hide the SMAS outside the gland capsule instead (QC log). Any flap-weight gradient away
from the fold axis shears the fold; weights only fall to zero toward the axis or at the incision.
"""
import json
import sys

import numpy as np
import trimesh
import yaml
from scipy import ndimage
from scipy.spatial import cKDTree

from common import ROOT, WORK

OUT = WORK / "meshes"
PICK = WORK / "flap"
QC = ROOT / "docs/qc/m1-anatomy"
CUT_SCALE = 64.0  # mm represented by 1.0 in the stored `cut` attribute
BIN = 0.5  # mm, lateral depth raster


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def load(mid):
    return dict(np.load(OUT / f"{mid}.npz"))


def lateral_raster(pos, faces, x_min, samples=2_500_000, seed=5):
    """Max-x (most lateral) surface height over the (A, S) plane, from dense surface samples."""
    import trimesh

    m = trimesh.Trimesh(pos, faces, process=False)
    pts, _ = trimesh.sample.sample_surface(m, samples, seed=seed)
    pts = pts[pts[:, 0] > x_min]
    a0, s0 = pts[:, 1].min(), pts[:, 2].min()
    ia = ((pts[:, 1] - a0) / BIN).astype(int)
    js = ((pts[:, 2] - s0) / BIN).astype(int)
    img = np.full((js.max() + 1, ia.max() + 1), -np.inf)
    np.maximum.at(img, (js, ia), pts[:, 0])
    hole = ~np.isfinite(img)
    img[hole] = ndimage.grey_dilation(np.where(hole, -1e9, img), size=3)[hole]
    return img, a0, s0


def catmull_rom(p, step=0.5):
    """Centripetal Catmull-Rom through 2D control points, resampled at about `step` mm."""
    p = np.asarray(p, float)
    q = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(q) - 2):
        p0, p1, p2, p3 = q[i - 1 : i + 3]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5
        n = max(2, int(np.linalg.norm(p2 - p1) / step))
        for t in np.linspace(t1, t2, n, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(p[-1])
    return np.array(out)


def signed_distance(pts2, path):
    """Signed distance from 2D points to an open polyline and the arc-length parameter (0..1) of the nearest
    point. Positive on the left of the direction of travel, which the spec orients toward the flap."""
    seg_a, seg_b = path[:-1], path[1:]
    d = seg_b - seg_a
    L = np.linalg.norm(d, axis=1)
    cum = np.r_[0, np.cumsum(L)]
    tree = cKDTree((seg_a + seg_b) / 2)
    k = min(24, len(seg_a))
    _, cand = tree.query(pts2, k=k)
    best = np.full(len(pts2), np.inf)
    s = np.zeros(len(pts2))
    sign = np.zeros(len(pts2))
    for j in range(k):
        i = cand[:, j]
        ap = pts2 - seg_a[i]
        t = np.clip((ap * d[i]).sum(1) / L[i] ** 2, 0, 1)
        foot = seg_a[i] + t[:, None] * d[i]
        dist = np.linalg.norm(pts2 - foot, axis=1)
        better = dist < best
        cross = d[i, 0] * ap[:, 1] - d[i, 1] * ap[:, 0]
        best = np.where(better, dist, best)
        s = np.where(better, (cum[i] + t * L[i]) / cum[-1], s)
        sign = np.where(better, np.sign(cross) + (cross == 0), sign)
    return sign * best, s


def refine(pos, nrm, faces, target):
    """Conforming longest-edge bisection until every triangle's longest edge is within target(centroids) (mm).
    Each pass bisects a set of edges no two of which share a triangle, splitting both triangles on the edge, so
    no T-junctions arise; new vertices take the endpoints' mean position and normalised mean normal (the shading
    stays smooth). Idempotent: a mesh already within the targets is returned unchanged."""
    P = np.asarray(pos, np.float64)
    N = np.asarray(nrm, np.float64)
    faces = faces.copy()
    for _ in range(40):
        tri = P[faces]
        e = np.stack([np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1), np.linalg.norm(tri[:, 2] - tri[:, 1], axis=1), np.linalg.norm(tri[:, 0] - tri[:, 2], axis=1)], 1)
        longest = e.argmax(1)
        want = target(tri.mean(1))
        cand = np.nonzero(e.max(1) > want)[0]
        if not len(cand):
            break
        edge_faces = {}
        for fi, f in enumerate(faces):
            for k in range(3):
                edge_faces.setdefault((min(f[k], f[(k + 1) % 3]), max(f[k], f[(k + 1) % 3])), []).append(fi)
        locked = np.zeros(len(faces), bool)
        split = []
        for fi in cand[np.argsort(-e.max(1)[cand])]:
            f = faces[fi]
            k = longest[fi]
            key = (min(f[k], f[(k + 1) % 3]), max(f[k], f[(k + 1) % 3]))
            adj = edge_faces[key]
            if locked[adj].any():
                continue
            locked[adj] = True
            split.append((key, adj))
        newP, newN, keep, add = [], [], np.ones(len(faces), bool), []
        base = len(P)
        for j, ((a, b), adj) in enumerate(split):
            m = base + j
            newP.append((P[a] + P[b]) / 2)
            n = N[a] + N[b]
            newN.append(n / (np.linalg.norm(n) or 1))
            for fi in adj:
                f = list(faces[fi])
                i = f.index(a)
                if f[(i + 1) % 3] == b:  # a -> b in winding order
                    c = f[(i + 2) % 3]
                    add += [[a, m, c], [m, b, c]]
                else:  # b -> a
                    c = f[(i + 1) % 3]
                    add += [[a, c, m], [m, c, b]]
                keep[fi] = False
        P = np.vstack([P, newP])
        N = np.vstack([N, newN])
        faces = np.vstack([faces[keep], np.array(add, dtype=faces.dtype)])
    return P.astype(np.float32), N.astype(np.float32), faces


def diffuse(values, faces, iterations):
    """Smooth a per-vertex field over the mesh graph (each pass averages with the mean of the neighbours), so
    fold angles vary gradually between neighbouring vertices and no triangle is stretched across a jump."""
    from scipy import sparse

    n = len(values)
    i = np.concatenate([faces[:, 0], faces[:, 1], faces[:, 2], faces[:, 1], faces[:, 2], faces[:, 0]])
    j = np.concatenate([faces[:, 1], faces[:, 2], faces[:, 0], faces[:, 0], faces[:, 1], faces[:, 2]])
    A = sparse.csr_matrix((np.ones(len(i)), (i, j)), shape=(n, n))
    A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel()
    deg[deg == 0] = 1
    v = values.astype(np.float64)
    for _ in range(iterations):
        v = 0.5 * v + 0.5 * (A @ v) / deg
    return v


def auricle_mask(pos, helix, radius, head_surface, a0, s0, lift_mm):
    """Skin of the auricle: within `radius` of the fitted helix and standing proud of the head surface
    interpolated beneath it (the raster built without the ear zone)."""
    near = np.linalg.norm(pos - helix, axis=1) < radius
    ia = np.clip(((pos[:, 1] - a0) / BIN).astype(int), 0, head_surface.shape[1] - 1)
    js = np.clip(((pos[:, 2] - s0) / BIN).astype(int), 0, head_surface.shape[0] - 1)
    return near & (pos[:, 0] > head_surface[js, ia] + lift_mm)


def head_without_ear(pos, faces, helix, radius, x_min):
    """Lateral raster with the ear zone removed and filled by inpainting from the surrounding head surface."""
    keep = np.linalg.norm(pos - helix, axis=1) >= radius
    f = faces[keep[faces].all(1)]
    img, a0, s0 = lateral_raster(pos, f, x_min)
    hole = img < -1e8
    # fill by repeated neighbourhood averaging (harmonic-style inpainting)
    filled = np.where(hole, np.nan, img)
    for _ in range(400):
        nan = np.isnan(filled)
        if not nan.any():
            break
        pad = np.pad(filled, 1, constant_values=np.nan)
        stack = np.stack([pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:]])
        with np.errstate(all="ignore"):
            avg = np.nanmean(stack, axis=0)
        filled = np.where(nan & ~np.isnan(avg), avg, filled)
    return np.nan_to_num(filled, nan=x_min), a0, s0


def view():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    inc = spec["incision"]
    skin = load("skin")
    faces = skin["indices"].reshape(-1, 3)
    img, a0, s0 = lateral_raster(skin["positions"], faces, inc["x_min"])
    lm = json.loads((ROOT / "pipeline/specs/landmarks.vhp-male.json").read_text(encoding="utf-8"))["landmarks"]
    fig, ax = plt.subplots(figsize=(11, 11), dpi=110)
    extent = [a0, a0 + img.shape[1] * BIN, s0, s0 + img.shape[0] * BIN]
    shade = np.gradient(np.where(np.isfinite(img), img, np.nan), axis=1)
    ax.imshow(np.where(img > -1e8, img, np.nan), origin="lower", extent=extent, cmap="bone", interpolation="bilinear")
    ax.imshow(np.clip(shade, -1, 1), origin="lower", extent=extent, cmap="gray", alpha=0.35, interpolation="bilinear")
    # structures projected (outline of sampled vertices), for orientation only
    for mid, c in (("parotid_superficial_lobe", "#ff9a3c"), ("sternocleidomastoid_r", "#b388ff"), ("mandible", "#ffffff"), ("masseter_r", "#ff5d73"), ("great_auricular_nerve", "#fff27a"), ("great_auricular_nerve_anterior", "#fff27a"), ("great_auricular_nerve_posterior", "#fff27a"), ("facial_nerve_marginal_mandibular", "#f3e7a8")):
        p = load(mid)["positions"]
        p = p[p[:, 0] > inc["x_min"]] if mid in ("mandible",) else p
        ax.scatter(p[:, 1], p[:, 2], s=0.2, color=c, alpha=0.35)
    for name in ("tragal_pointer", "eac_lateral", "mastoid_tip_visual", "stylomastoid_foramen", "mandible_lower_border_mid", "parotid_anterior"):
        if name in lm:
            x, y, z = lm[name]["xyz"]
            ax.plot(y, z, "c+", ms=10)
            ax.annotate(name, (y, z), color="c", fontsize=7, xytext=(4, 4), textcoords="offset points")
    if inc.get("points"):
        path = catmull_rom(np.array(inc["points"], float))
        ax.plot(path[:, 0], path[:, 1], color="#8a4fd8", lw=2)
        ax.plot(*np.array(inc["points"]).T, "o", color="#8a4fd8", ms=4)
        pt, u, _, _, _ = fold_frame(path, inc)
        ax.axline(pt, pt + u, color="#00ff88", ls="--", lw=1)
    ax.set_xlim(inc["view"]["a"][0], inc["view"]["a"][1])
    ax.set_ylim(inc["view"]["s"][0], inc["view"]["s"][1])
    ax.set_xticks(np.arange(inc["view"]["a"][0], inc["view"]["a"][1] + 1, 5))
    ax.set_yticks(np.arange(inc["view"]["s"][0], inc["view"]["s"][1] + 1, 5))
    ax.tick_params(labelsize=6)
    ax.grid(color="#00ffff", alpha=0.15)
    ax.set_xlabel("A (mm, anterior to the right)")
    ax.set_ylabel("S (mm)")
    ax.set_title("Right side, lateral projection of the fitted skin (brighter = more lateral); structure outlines projected", fontsize=8)
    PICK.mkdir(parents=True, exist_ok=True)
    fig.savefig(PICK / "lateral.png", bbox_inches="tight")
    print(PICK / "lateral.png")


def fold_frame(path, inc):
    """Fold axis (a 2D point and unit direction in (A, S)), its unit normal toward the incision, and the
    incision's end points and outward end tangents."""
    start, end = path[0], path[-1]
    u = (end - start) / np.linalg.norm(end - start)
    n = np.array([-u[1], u[0]])
    mid = (start + end) / 2
    if np.dot(path.mean(0) - mid, n) < 0:  # n points from the chord toward the incision curve
        n = -n
    point = mid - n * inc["axis_offset_mm"]
    t_start = (path[0] - path[1]) / np.linalg.norm(path[0] - path[1])
    t_end = (path[-1] - path[-2]) / np.linalg.norm(path[-1] - path[-2])
    return point, u, n, (start, t_start), (end, t_end)


def flap_weight(p2, path, inc):
    point, _, n, (start, ts), (end, te) = fold_frame(path, inc)
    w = smoothstep(0, inc["ramp_mm"], (p2 - point) @ n)
    for e, t in ((start, ts), (end, te)):
        w *= 1 - smoothstep(0, inc["end_cap_mm"], (p2 - e) @ t)
    return w


def transfer_from_skin(pos, sd_own, s_own, w_own, skin_fields, reach, tol_mm=6.0):
    """Cut distance, path parameter and flap weight for the fat, interpolated (barycentric) at the closest point of
    the flap-bearing skin within `reach`; elsewhere the fat keeps its own fields. A point whose interpolated cut
    distance disagrees with its own projection by more than `tol_mm`, or lies across the incision from it, keeps the
    nearest skin vertex's values instead (the skin it would otherwise map to is not the skin above it)."""
    P, F, eligible, sd_k, s_k, w_k = skin_fields
    Fe = F[eligible[F].all(1)]
    T = P[Fe].astype(np.float64)
    # candidate triangles by centroid (edges are at most 1.8 mm on the flap), then the exact closest point on each
    _, cand = cKDTree(T.mean(1)).query(pos, k=12)
    best = np.full(len(pos), np.inf)
    closest = np.zeros((len(pos), 3))
    tri = np.zeros(len(pos), int)
    for j in range(cand.shape[1]):
        c = trimesh.triangles.closest_point(T[cand[:, j]], pos)
        d = np.linalg.norm(c - pos, axis=1)
        better = d < best
        best, tri = np.where(better, d, best), np.where(better, cand[:, j], tri)
        closest[better] = c[better]
    dist = best
    bary = np.clip(trimesh.triangles.points_to_barycentric(T[tri], closest), 0, 1)
    bary /= bary.sum(1, keepdims=True)
    corners = Fe[tri]
    lerp = lambda f: (f[corners] * bary).sum(1)
    sd_i, s_i, w_i = lerp(sd_k), lerp(s_k), lerp(w_k)
    near = dist < reach
    across = (np.sign(sd_i) != np.sign(sd_own)) & (np.abs(sd_own) > 2.0)
    bad = near & ((np.abs(sd_i - sd_own) > tol_mm) | across)
    _, jn = cKDTree(P).query(pos)
    print(f"  fat <- skin: {near.sum()} interpolated, {bad.sum()} kept the nearest vertex; max |interp - own| within tolerance {np.abs(sd_i - sd_own)[near & ~bad].max():.2f} mm")
    pick = lambda fi, fk, own: np.where(bad, fk[jn], np.where(near, fi, own))
    return pick(sd_i, sd_k, sd_own), pick(s_i, s_k, s_own), pick(w_i, w_k, w_own)


def lump(pos, tumour, spec):
    """The palpable fullness over the tumour: skin, fat and SMAS pushed laterally together (so the layers stay
    stacked) by amplitude * exp(-(r / radius)^2), r measured in the sagittal plane from the tumour centre."""
    c = np.asarray(tumour["center"], float)
    r = np.linalg.norm(pos[:, 1:3] - c[1:3], axis=1)
    out = pos.astype(np.float64).copy()
    out[:, 0] += spec["amplitude_mm"] * np.exp(-((r / spec["radius_mm"]) ** 2)) * smoothstep(c[0], c[0] + 8, pos[:, 0])
    return out.astype(np.float32)


def build():
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    inc = spec["incision"]
    face = json.loads((WORK / "face.resolved.json").read_text(encoding="utf-8"))
    helix = np.array(face["helix_right"], float)
    tumour = json.loads((ROOT / "pipeline/specs/tumour.resolved.json").read_text(encoding="utf-8"))
    path = catmull_rom(np.array(inc["points"], float))
    # The facelift-type alternative is an incision line only (ink): it is drawn on the skin for comparison with the
    # modified Blair path; the flap in the operative plates is the Blair one.
    fl = spec.get("incision_facelift")
    path2 = catmull_rom(np.array(fl["points"], float)) if fl else None
    skin = load("skin")
    faces = skin["indices"].reshape(-1, 3)
    head, a0, s0 = head_without_ear(skin["positions"], faces, helix, inc["ear_radius_mm"], inc["x_min"])
    checks = {}
    def target(c):
        """Edge-length target (mm): fine along the incision, moderate over the flap, unchanged elsewhere."""
        sd_c, _ = signed_distance(c[:, 1:3], path)
        sd_c *= inc["flap_side"]
        lateral = c[:, 0] > inc["x_min"] - 4
        in_flap = (sd_c > 0) & (flap_weight(c[:, 1:3], path, inc) > 0)
        near2 = np.zeros(len(c), bool)
        if path2 is not None:
            near2 = np.abs(signed_distance(c[:, 1:3], path2)[0]) < 6
        return np.where(lateral & ((np.abs(sd_c) < 6) | near2), inc["edge_mm"][0], np.where(lateral & in_flap, inc["edge_mm"][1], np.inf))

    def lateral_factor(pos):
        """1 on the outermost lateral skin (within a few mm of the most lateral surface at that (A, S)), 0 on skin
        that only shares the projection, such as the underside of the jaw. Both faces of the 2 mm skin shell count.
        Depth alone: a test on the normal's lateral component also caught the skin crease under the lobule, which
        faces down and back while lying on the lateral surface, and held the flap's corner there below full weight
        (a sheared fold); on the flap side it changed nothing else."""
        ia = np.clip(((pos[:, 1] - a0) / BIN).astype(int), 0, head.shape[1] - 1)
        js = np.clip(((pos[:, 2] - s0) / BIN).astype(int), 0, head.shape[0] - 1)
        return smoothstep(-8, -4, pos[:, 0] - head[js, ia])

    skin_lat = None
    for mid in ("skin", "subcutaneous_fat"):
        d = load(mid)
        n0 = len(d["indices"]) // 3
        # positions_base: the layer before the lump, kept so a rerun starts from the same surface (idempotent)
        P, N, F = refine(d.get("positions_base", d["positions"]), d["normals"], d["indices"].reshape(-1, 3), target)
        d["positions_base"] = P
        d["positions"] = lump(P, tumour, inc["lump"])
        d["normals"] = trimesh.Trimesh(d["positions"], F, process=False).vertex_normals.astype(np.float32) if mid == "skin" else N
        d["indices"] = F.astype(np.uint32).ravel()
        print(f"{mid}: {n0} -> {len(F)} triangles")
        pos = d["positions"].astype(np.float64)
        sd, s = signed_distance(pos[:, 1:3], path)
        sd *= inc["flap_side"]
        right = smoothstep(inc["x_min"], inc["x_min"] + 6, pos[:, 0])
        F = d["indices"].reshape(-1, 3)
        aur = auricle_mask(pos, helix, inc["ear_radius_mm"], head, a0, s0, inc["auricle_lift_mm"])
        if mid == "skin":
            keep = lateral_factor(pos) * (~aur)
            keep = diffuse(keep, F, inc["smooth_passes"])
            # The fat takes its membership from skin that is not the auricle: the fat at the ear root lies nearer the
            # auricle's skin than the preauricular skin above it, and would otherwise stay behind as a hole in the flap.
            skin_lat = (cKDTree(pos[~aur]), keep[~aur])
            eligible = ~aur & (keep > 0)
        else:  # the fat lies under the skin: take the factor of the nearest skin (its inner surface faces inward)
            dist, j = skin_lat[0].query(pos)
            keep = skin_lat[1][j] * (dist < inc["fat_reach_mm"])
            keep = diffuse(keep, F, inc["smooth_passes"])
        w = flap_weight(pos[:, 1:3], path, inc) * right * keep
        if mid == "skin":
            skin_fields = (pos, F, eligible, sd, s, w)
        else:
            # The fat follows the skin directly above it: its own lateral projection would put the deep face of this
            # thick, curved slab across the fold and the incision at other places than the face under the skin, and
            # open windows in the raised flap. Within reach it takes the skin's cut distance and flap weight,
            # interpolated at the closest point of the flap-bearing skin (lateral, not the auricle): a nearest-vertex
            # copy was piecewise constant, so the fat's cut edge was serrated and lay beside the skin's.
            sd, s, w = transfer_from_skin(pos, sd, s, w, skin_fields, inc["fat_reach_mm"])
            # The fat's deep face is a voxel iso-surface (1 mm slices): its normals keep the terraces, which the raised
            # flap turns toward the viewer as streaks. On the flap the normals are taken from the lumped surface and
            # smoothed over the mesh (shading only; the positions are unchanged); elsewhere they are left as they were.
            smooth = trimesh.Trimesh(pos, F, process=False).vertex_normals.astype(np.float64)
            smooth = np.stack([diffuse(smooth[:, k], F, inc["fat_normal_passes"]) for k in range(3)], 1)
            mag = np.linalg.norm(smooth, axis=1, keepdims=True)
            smooth /= np.maximum(mag, 1e-9)
            # near a rim of the slab the deep and outer faces' normals cancel: keep the original normal there
            on = np.clip(w / 0.05, 0, 1)[:, None] * np.clip((mag - 0.4) / 0.3, 0, 1)
            blend = (1 - on) * d["normals"] + on * smooth
            d["normals"] = (blend / np.maximum(np.linalg.norm(blend, axis=1, keepdims=True), 1e-9)).astype(np.float32)
        d["cut"] = np.clip(sd / CUT_SCALE, -1, 1).astype(np.float32)
        d["cut_s"] = s.astype(np.float32)
        d["flap_w"] = w.astype(np.float32)
        if mid == "skin" and path2 is not None:
            sd2, s2 = signed_distance(pos[:, 1:3], path2)
            d["cut2"] = np.clip(sd2 / CUT_SCALE, -1, 1).astype(np.float32)
            d["cut_s2"] = s2.astype(np.float32)
        np.savez_compressed(OUT / f"{mid}.npz", **d)
        flap_v = (sd > 0) & (w > 0.01)
        checks[mid] = {"flap_vertices": int(flap_v.sum()), "auricle_vertices_excluded": int(aur.sum())}
    # Fold axis on the skin surface at its midpoint, in RAS mm: point (x, A, S) and direction (0, dA, dS).
    point, u, _, _, _ = fold_frame(path, inc)
    ia = int((point[0] - a0) / BIN)
    js = int((point[1] - s0) / BIN)
    axis_x = float(head[np.clip(js, 0, head.shape[0] - 1), np.clip(ia, 0, head.shape[1] - 1)])
    length = float(np.sum(np.linalg.norm(np.diff(path, axis=0), axis=1)))
    (OUT / "flap.json").write_text(json.dumps({"axis_point": [axis_x, float(point[0]), float(point[1])], "axis_dir": [0.0, float(u[0]), float(u[1])], "max_angle_rad": inc["max_angle_rad"], "cut_scale_mm": CUT_SCALE, "incision_length_mm": round(length, 1)}, indent=2), encoding="utf-8")
    # QC: the path in 3D (lifted onto the head surface) for the report and the review packet
    ia = np.clip(((path[:, 0] - a0) / BIN).astype(int), 0, head.shape[1] - 1)
    js = np.clip(((path[:, 1] - s0) / BIN).astype(int), 0, head.shape[0] - 1)
    path3 = np.c_[head[js, ia], path]
    (WORK / "incision.path.json").write_text(json.dumps(np.round(path3, 2).tolist()), encoding="utf-8")
    render_qc(path, inc)
    checks_path = QC / "checks.json"
    allc = json.loads(checks_path.read_text(encoding="utf-8"))
    allc["incision_flap"] = {"pass": all(c["flap_vertices"] > 0 for c in checks.values()), "incision_length_mm": round(length, 1), **checks, "summary": f"modified Blair incision {length:.0f} mm (projected); flap fields baked on skin and subcutaneous fat; auricle excluded"}
    checks_path.write_text(json.dumps(allc, indent=2), encoding="utf-8")
    print(f"{'PASS' if allc['incision_flap']['pass'] else 'FAIL'}  incision_flap: {allc['incision_flap']['summary']}")


def render_qc(path, inc):
    """Skin vertices in the lateral projection: flap weight (violet), resting skin (grey), auricle (cyan)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    d = load("skin")
    p = d["positions"]
    lat = p[:, 0] > inc["x_min"]
    sd, w = d["cut"] * CUT_SCALE, d["flap_w"]
    flap = lat & (sd > 0) & (w > 0.01)
    fig, ax = plt.subplots(figsize=(8, 9), dpi=110)
    ax.scatter(p[lat & ~flap, 1], p[lat & ~flap, 2], s=0.6, color="#777777")
    ax.scatter(p[flap, 1], p[flap, 2], s=0.8, c=w[flap], cmap="Purples", vmin=0, vmax=1)
    face = json.loads((WORK / "face.resolved.json").read_text(encoding="utf-8"))
    near = lat & (np.linalg.norm(p - np.array(face["helix_right"]), axis=1) < inc["ear_radius_mm"]) & (w == 0)
    ax.scatter(p[near, 1], p[near, 2], s=0.6, color="#00c8ff")
    ax.plot(path[:, 0], path[:, 1], color="#5b2a8c", lw=1.5)
    pt, u, _, _, _ = fold_frame(path, inc)
    ax.axline(pt, pt + u, color="#00aa55", ls="--", lw=0.8)
    ax.set_xlim(*inc["view"]["a"])
    ax.set_ylim(*inc["view"]["s"])
    ax.set_aspect("equal")
    ax.set_title("Incision (line) and flap weight on the right lateral skin (violet: flap, darker = lifted more; grey: stays; cyan: ear zone kept with the auricle). A anterior to the right, S up (mm).", fontsize=7)
    fig.savefig(QC / "incision_flap.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    view() if len(sys.argv) > 1 and sys.argv[1] == "view" else build()
