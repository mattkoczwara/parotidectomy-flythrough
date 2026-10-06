"""The hero portrait's handoff to the fitted exterior (presentation only, no claims): where each hero vertex goes.

Called by hero.py. The hero morphs onto the fitted surface before it dissolves over it (packages/stage/src/hero.ts),
so every vertex needs a target on that surface that keeps features on their counterparts:

1. Landmarks found alike on both surfaces, each in its own eyes' frame (nose tip, nasion, glabella, forehead, chin,
   menton, crown, occiput, the sternal notch, the nape, the shoulders), the eyes' centres, and the ears (the hero's
   ear roots against the donor's ear-canal landmark).
2. A thin-plate spline through the landmark pairs carries the hero toward the fitted shape.
3. Each warped vertex goes to the closest point of the fitted skin or body; the displacement is smoothed over the
   hero mesh (no tears where the closest point jumps) and projected again, so the end of the morph lies on the
   fitted surface.

Also: the fitted skin's localisation field (`foot`, the parotid's outline) at each target, so the hero shows the
same outline; the eyes move with their fitted globes; each hair strand moves rigidly with its root.
"""
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


def eyes_frame(eye_p):
    """The eyes' midpoint and the two centres [left (+x), right] from the vertices of both globes."""
    mid = eye_p[:, 0].mean()
    c = np.array([eye_p[eye_p[:, 0] > mid].mean(0), eye_p[eye_p[:, 0] <= mid].mean(0)])
    return c.mean(0), c


def landmarks(P, eye):
    """Named points (Blender frame) on a head-and-bust surface P, found from its eyes' frame."""
    q = np.c_[(P[:, 0] - eye[0]) * 1000, -(P[:, 1] - eye[1]) * 1000, (P[:, 2] - eye[2]) * 1000]
    lat, ant, up = q.T
    sag = np.abs(lat) < 4
    out = {}

    def pick(name, sel, key):
        if sel.any():
            i = np.nonzero(sel)[0]
            out[name] = P[i[np.argmax(key[i])]]

    pick("nose", sag & (up > -55) & (up < -5), ant)
    pick("nasion", sag & (up > -12) & (up < 18), -ant)
    pick("glabella", sag & (up > 10) & (up < 30), ant)
    pick("forehead", sag & (up > 42) & (up < 58), ant)
    pick("chin", sag & (up > -118) & (up < -75), ant)
    if "chin" in out:
        cu = (out["chin"][2] - eye[2]) * 1000
        ca = -(out["chin"][1] - eye[1]) * 1000
        pick("menton", sag & (ant > ca - 22) & (up > cu - 45), -up)
    pick("crown", np.abs(lat) < 15, up)
    pick("occiput", sag & (up > -10) & (up < 40), -ant)
    pick("notch", sag & (up > -235) & (up < -150) & (ant > -90), -ant)
    pick("nape", sag & (up > -185) & (up < -155) & (ant < -80), -ant)
    # (the ears come from the caller: on the donor's fuller face the most lateral tissue at the ear's height is the
    # cheek, not the ear; the jaw's angle and the cheek are as unreliable there, and are not used)
    for side, tag in ((1, "l"), (-1, "r")):
        pick(f"shoulder_{tag}", (lat * side > 140) & (lat * side < 170), up)
    return out


def tps(src, dst, reg=1e-4):
    """Thin-plate spline (3D, phi = r) from src to dst points; returns a function of points."""
    n = len(src)
    K = np.linalg.norm(src[:, None] - src[None], axis=2) + np.eye(n) * reg
    Pm = np.c_[np.ones(n), src]
    A = np.zeros((n + 4, n + 4))
    A[:n, :n], A[:n, n:], A[n:, :n] = K, Pm, Pm.T
    b = np.zeros((n + 4, 3))
    b[:n] = dst - src
    w = np.linalg.solve(A, b)

    def f(x):
        r = np.linalg.norm(x[:, None] - src[None], axis=2)
        return x + r @ w[:n] + np.c_[np.ones(len(x)), x] @ w[n:]
    return f


def nearest(bvh, X):
    T = np.empty_like(X)
    face = np.full(len(X), -1)
    for i, x in enumerate(X):
        loc, _, idx, _ = bvh.find_nearest(Vector(x))
        T[i] = loc if loc is not None else x
        face[i] = -1 if idx is None else idx
    return T, face


def smooth_field(D, edges, iters, lam=0.5):
    n = len(D)
    a, b = edges[:, 0], edges[:, 1]
    deg = np.bincount(a, minlength=n) + np.bincount(b, minlength=n)
    for _ in range(iters):
        acc = np.zeros_like(D)
        np.add.at(acc, a, D[b])
        np.add.at(acc, b, D[a])
        D = D + lam * (acc / np.maximum(deg, 1)[:, None] - D)
    return D


def bary(tri, p):
    a, b, c = tri
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
    den = (d00 * d11 - d01 * d01) or 1e-18
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return np.clip([1 - v - w, v, w], 0, 1)


def build(P, edges, hero_eyes_p, hero_ears, fitted, spec):
    """Displacements of the hero skin vertices P onto the fitted exterior, the skin's `foot` at its targets, and the
    eyes' displacements. `hero_ears` are the hero's ear roots [left, right] (Blender frame); the fitted ears are the
    donor's ear-canal landmark (right) and its mirror about the eyes' midline (left). `fitted` is hero_prep's
    fitted.npz."""
    sp, sf = fitted["skin_p"], fitted["skin_f"]
    bp, bf = fitted["body_p"], fitted["body_f"]
    fe, fc = eyes_frame(fitted["eyes_p"])
    he, hc = eyes_frame(hero_eyes_p)
    allp = np.vstack([sp, bp])
    allf = np.vstack([sf, bf + len(sp)])
    lf = landmarks(allp, fe)
    lh = landmarks(P, he)
    eac = np.asarray(fitted["eac"], float)
    lf["ear_r"], lf["ear_l"] = eac, np.array([2 * fe[0] - eac[0], eac[1], eac[2]])
    lh["ear_l"], lh["ear_r"] = np.asarray(hero_ears[0], float), np.asarray(hero_ears[1], float)
    names = sorted(set(lf) & set(lh))
    src = np.array([lh[k] for k in names] + list(hc))
    dst = np.array([lf[k] for k in names] + list(fc))
    warp = tps(src, dst)
    W = warp(P)
    bvh_all = BVHTree.FromPolygons([tuple(v) for v in allp], [tuple(f) for f in allf])
    T, _ = nearest(bvh_all, W)
    D = smooth_field(T - P, edges, spec["smooth_iters"])
    T, face = nearest(bvh_all, P + D)
    disp = T - P
    # the localisation field at each target (the fitted body has none: outside the outline)
    foot = np.full(len(P), -100.0, np.float32)
    on_skin = (face >= 0) & (face < len(sf))
    for i in np.nonzero(on_skin)[0]:
        f = sf[face[i]]
        foot[i] = bary(sp[f], T[i]) @ fitted["skin_foot"][f]
    # each eye with its fitted globe
    left = hero_eyes_p[:, 0] > he[0]
    eye_disp = np.where(left[:, None], fc[0] - hc[0], fc[1] - hc[1])
    report = {"landmarks": names, "landmark_residual_mm": round(float(np.abs(warp(src) - dst).max() * 1000), 3),
              "max_displacement_mm": round(float(np.linalg.norm(disp, axis=1).max() * 1000), 1),
              "median_displacement_mm": round(float(np.median(np.linalg.norm(disp, axis=1)) * 1000), 1)}
    return disp, foot, eye_disp, report


def strand_disp(roots, P, disp):
    """Each strand moves rigidly with its root's nearest skin vertex."""
    tree = KDTree(len(P))
    for i, v in enumerate(P):
        tree.insert(v, i)
    tree.balance()
    return disp[[tree.find(r)[1] for r in roots]]
