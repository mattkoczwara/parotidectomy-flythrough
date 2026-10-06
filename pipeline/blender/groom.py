"""The hero portrait's groom (presentation only, no claims): an offline, deterministic strand groom over the hero's
scalp and brows, exported as ribbons that the stage turns toward the camera (packages/stage/src/hero.ts).

Called by hero.py on the finished realtime skin. Positions are Blender's frame (metres); the authored fields are in
the eyes' frame in mm: lat (toward the patient's left), ant (anterior), up. The cut (anatomy.yaml `hero.hair`):

- The hairline is a height above the eyes as a function of the angle around the head's vertical axis (0 front, 90
  over the ear, 180 the nape), symmetric left and right: a recessed temple, a short sideburn in front of the ear, a
  line over and behind the ear, a low nape. The ear itself is kept clear.
- Length by region: a longer, lifted top that thins to the crown, sides and nape tapered to a short fade.
- The comb: forward and up on top (lifted at the front), back and down over the sides, down at the nape.
- Each strand rises off the scalp at its region's lift angle, follows the comb, bends toward the head and carries a
  little frizz. Strands converge on their clump's guide toward the tips (locks), and a few are flyaways.
- Brows: short strands in an arched band above each eye, lying flat, combed outward.

Returns the ribbon mesh's arrays (two vertices per strand point, side -1 and +1) and the scalp's coverage per skin
vertex (for the skin's own darkening under the hair).
"""
import math

import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def unit(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


class Frame:
    """The eyes' frame (mm) of Blender positions (m)."""

    def __init__(self, eye, mid_x, axis_ant):
        self.eye, self.mid_x, self.axis_ant = np.asarray(eye, float), mid_x, axis_ant

    def to(self, p):
        return np.c_[(p[:, 0] - self.mid_x) * 1000, -(p[:, 1] - self.eye[1]) * 1000, (p[:, 2] - self.eye[2]) * 1000]

    def vec(self, v):
        """A Blender-frame direction from an eyes'-frame direction (lat, ant, up)."""
        return np.c_[v[:, 0], -v[:, 1], v[:, 2]]

    def theta(self, q):
        """Angle around the head's vertical axis, degrees: 0 in front, 90 at the side, 180 behind (both sides)."""
        return np.degrees(np.arctan2(np.abs(q[:, 0]), q[:, 1] - self.axis_ant))


def wobble(q):
    """A smooth, fixed irregularity of about -1..1 over a few centimetres (the hairline is never a drawn line)."""
    dirs = np.array([[0.62, 0.31, 0.72], [-0.41, 0.83, 0.38], [0.15, -0.55, 0.82], [0.77, 0.12, -0.63]])
    freq = np.array([1 / 9.0, 1 / 5.3, 1 / 3.1, 1 / 13.0])
    ph = np.array([0.3, 2.1, 4.4, 1.2])
    a = np.array([0.45, 0.3, 0.15, 0.35])
    return (a * np.sin(np.abs(q) @ dirs.T * freq + ph)).sum(1) / a.sum() * 1.6


def fields(q, fr, spec):
    """Scalp density weight, length (mm), lift (rad) and comb direction (eyes' frame) for points q (eyes' frame mm)."""
    hl = spec["hairline"]
    th = fr.theta(q)
    H = np.interp(th, hl["theta"], hl["up"]) + hl.get("wobble_mm", 0) * wobble(q)
    above = q[:, 2] - H
    dens = smooth(-hl["soft_mm"] * 0.5, hl["soft_mm"], above)
    # the ear: no hair over its root (a sphere around it, from hero.py's ear centres)
    for c in spec["_ears"]:
        d = np.linalg.norm(q - np.asarray(c), axis=1)
        dens *= smooth(spec["ear_clear_mm"][0], spec["ear_clear_mm"][1], d)
    dens *= q[:, 2] > -140
    L = spec["length_mm"]
    side_len = L["edge"] + (L["side"] - L["edge"]) * smooth(0, L["side_rise_mm"], above)
    back_len = L["edge"] + (L["back"] - L["edge"]) * smooth(0, L["back_rise_mm"], above)
    low = np.where(th > 125, back_len, np.where(th > 100, side_len + (back_len - side_len) * smooth(100, 125, th), side_len))
    top_len = np.interp(th, L["top_theta"], L["top"])
    wt = smooth(L["top_from_up"], L["top_full_up"], q[:, 2])
    length = low + (top_len - low) * wt
    # the hairline itself: shorter, finer hair over its first millimetres
    length *= 0.45 + 0.55 * smooth(0, L["hairline_mm"], above)
    lift = np.radians(np.interp(th, spec["lift"]["theta"], spec["lift"]["deg"]))
    lift = lift * (0.25 + 0.75 * wt) + np.radians(spec["lift"]["side_deg"]) * (1 - wt)
    # comb: up and back at the front, back over the top, down at the crown and nape, back and down over the sides
    z = np.zeros(len(q))
    front = np.c_[z, -0.25 + z, 1.0 + z]
    back = np.c_[z, -1.0 + z, 0.05 + z]
    side = np.c_[z, -1.0 + z, -0.35 + z]
    down = np.c_[z, -0.15 + z, -1.0 + z]
    w_back = smooth(110, 150, th)[:, None]
    lowdir = side * (1 - w_back) + down * w_back
    fu = smooth(spec["comb"]["front_up_theta"][0], spec["comb"]["front_up_theta"][1], th)[:, None]
    crown = smooth(spec["comb"]["crown_theta"][0], spec["comb"]["crown_theta"][1], th)[:, None]
    topdir = (front * (1 - fu) + back * fu) * (1 - crown) + down * crown
    comb = unit(lowdir * (1 - wt[:, None]) + topdir * wt[:, None])
    return dens, length, lift, comb


def brow_fields(q, spec):
    """Brow density, length, lift and comb (eyes' frame) for points q."""
    b = spec["brows"]
    lat = np.abs(q[:, 0])
    centre = np.interp(lat, b["lat"], b["up"])
    half = np.interp(lat, b["lat"], b["half_mm"])
    inside = smooth(1.0, -0.6, np.abs(q[:, 2] - centre) - half) * (lat > b["lat"][0] - 2) * (lat < b["lat"][-1] + 2) * (q[:, 1] > -5)
    dens = inside * np.interp(lat, b["lat"], b["density"])
    length = np.full(len(q), b["length_mm"]) * (0.7 + 0.3 * smooth(b["lat"][0], b["lat"][1], lat))
    lift = np.full(len(q), np.radians(b["lift_deg"]))
    # medially the hairs rise, laterally they run out and a little down
    out = np.sign(q[:, 0])
    rise = 1 - smooth(b["lat"][0], b["lat"][2], lat)
    comb = unit(np.c_[out * (1 - 0.6 * rise), np.zeros(len(q)), 0.25 + 0.9 * rise - 0.25 * smooth(b["lat"][2], b["lat"][-1], lat)])
    return dens, length, lift, comb


def lash_fields(q, spec):
    """Upper lashes: a narrow band along each upper lid's margin, combed forward and up."""
    lat, ant, up = q[:, 0], q[:, 1], q[:, 2]
    dens = sum(np.exp(-(((lat - s * 29.5) / 10) ** 2 + ((ant - 12.5) / 3.5) ** 2 + ((up - 4.0) / 1.4) ** 2)) for s in (1, -1))
    dens = np.clip(dens * 1.4, 0, 1) * (ant > 5)
    length = np.full(len(q), spec["lashes"]["length_mm"]) * (0.6 + 0.4 * np.exp(-((np.abs(lat) - 31) / 8) ** 2))
    lift = np.full(len(q), np.radians(spec["lashes"]["lift_deg"]))
    comb = unit(np.c_[np.sign(lat) * 0.25, np.ones(len(q)), 0.35 * np.ones(len(q))])
    return dens, length, lift, comb


def sample_roots(P, F, N, weight, count, rng):
    """`count` candidate points on the triangles F, area weighted, kept with probability `weight` (per vertex)."""
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    wf = weight[F].mean(1)
    pdf = area * wf
    tot = pdf.sum()
    if tot <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0), np.zeros((0, 3), int), np.zeros((0, 3))
    tri = rng.choice(len(F), size=count, p=pdf / tot)
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    bc = np.c_[1 - u - v, u, v]
    f = F[tri]
    p = (P[f] * bc[:, :, None]).sum(1)
    n = unit((N[f] * bc[:, :, None]).sum(1))
    w = (weight[f] * bc).sum(1)
    keep = rng.random(count) < w / max(wf[tri].max(), 1e-6)
    return p[keep], n[keep], w[keep], f[keep], bc[keep]


def strands(root, n, length_mm, lift, comb_b, spec, rng, points):
    """Strand polylines (S, points, 3) in Blender metres: off the scalp at `lift`, along the comb, bending toward the
    head, with frizz."""
    S = len(root)
    t = np.linspace(0, 1, points)[None, :, None]
    L = (length_mm * 0.001)[:, None, None]
    f = unit(comb_b - n * (comb_b * n).sum(1, keepdims=True))  # comb in the tangent plane
    lift = lift[:, None, None]
    nn, ff = n[:, None, :], f[:, None, :]
    g = spec["shape"]
    rise = np.sin(lift) * (t - 0.5 * g["settle"] * t * t)
    along = np.cos(lift) * t
    bend = g["bend"] * t * t * (1 - np.sin(lift[:, :, :]) * 0.6)  # lies toward the head as it grows
    P = root[:, None, :] + L * (ff * along + nn * (rise - bend)) + nn * (g["root_lift_mm"] * 0.001)
    # frizz: two random directions across the strand, a slow wave
    a1 = unit(np.cross(f, n) * rng.normal(size=(S, 1)) + n * rng.normal(size=(S, 1)) * 0.6)
    a2 = unit(np.cross(f, a1))
    ph1, ph2 = rng.random((S, 1, 1)) * 6.283, rng.random((S, 1, 1)) * 6.283
    fq = g["frizz_cycles"] * (0.7 + 0.6 * rng.random((S, 1, 1)))
    amp = g["frizz_mm"] * 0.001 * (0.5 + rng.random((S, 1, 1))) * (L / 0.03) ** 0.5
    P = P + amp * t * (np.sin(6.283 * fq * t + ph1) * a1[:, None, :] + 0.6 * np.cos(6.283 * fq * t + ph2) * a2[:, None, :])
    return P


def groups(root, per, rng):
    """Each root's clump guide (an index into root): guides are roots chosen at random, each strand takes the nearest."""
    m = max(1, len(root) // per)
    guides = rng.choice(len(root), size=m, replace=False)
    tree = KDTree(m)
    for i, g in enumerate(guides):
        tree.insert(root[g], i)
    tree.balance()
    return np.array([guides[tree.find(r)[1]] for r in root])


def clump(P, root, spec, rng, kind, guide):
    """Strands converge on their clump's guide toward the tips (locks). Guides are strands themselves."""
    c = spec["clump"]
    out = P.copy()
    for k in np.unique(kind):
        idx = np.nonzero(kind == k)[0]
        if len(idx) < 2:
            continue
        gi = guide[idx]
        t = np.linspace(0, 1, P.shape[1])[None, :, None]
        conv = (c["converge"] if k == 0 else c["converge_brow"]) * (0.6 + 0.4 * rng.random((len(idx), 1, 1)))
        w = conv * t ** c["power"]
        # toward the guide's shape carried to this root, and then toward the guide itself
        shape = P[gi] - P[gi][:, :1] + P[idx][:, :1]
        out[idx] = P[idx] + w * (shape - P[idx]) * 0.6 + w * (P[gi] - P[idx]) * 0.4
    return out


def keep_out(P, bvh, min_mm):
    """Push strand points that sank into the head back above it."""
    flat = P.reshape(-1, 3)
    for i in range(len(flat)):
        loc, nor, _, d = bvh.find_nearest(flat[i])
        if loc is None:
            continue
        s = np.dot(flat[i] - np.array(loc), np.array(nor))
        if s < min_mm * 0.001:
            flat[i] = flat[i] + np.array(nor) * (min_mm * 0.001 - s)
    return flat.reshape(P.shape)


def coverage(P, eye, mid_x, spec, ears):
    """The hair's coverage of the skin (scalp and brows, 0..1) at points P (Blender frame)."""
    fr = Frame(eye, mid_x, spec["axis_ant"])
    Q = fr.to(P)
    return np.clip(fields(Q, fr, {**spec, "_ears": ears})[0] + brow_fields(Q, spec)[0], 0, 1)


def build(P, F, N, eye, mid_x, spec, ears):
    """The groom on the skin (P vertices, F triangles, N vertex normals; Blender frame). Returns the ribbon arrays
    and the scalp coverage per skin vertex."""
    rng = np.random.default_rng(spec["seed"])
    fr = Frame(eye, mid_x, spec["axis_ant"])
    spec = {**spec, "_ears": ears}
    Q = fr.to(P)
    dens, _, _, _ = fields(Q, fr, spec)
    bdens, _, _, _ = brow_fields(Q, spec)
    ldens, _, _, _ = lash_fields(Q, spec)
    out = []
    offset = 0
    lk = spec["locks"]
    for kind, (w, count) in enumerate([(dens, spec["strands"]), (bdens, spec["brows"]["strands"]), (ldens, spec["lashes"]["strands"])]):
        root, n, wr, f, bc = sample_roots(P, F, N, w, count, rng)
        q = fr.to(root)
        d, length, lift, comb = (fields(q, fr, spec) if kind == 0 else brow_fields(q, spec) if kind == 1 else lash_fields(q, spec))
        comb_b = fr.vec(comb)
        g = groups(root, spec["clump"]["per_clump"] if kind == 0 else spec["clump"]["per_clump_brow"], rng) if len(root) > 1 else np.zeros(len(root), int)
        S = len(root)
        # locks: each clump its own length, lift and turn off the comb (the irregular, textured silhouette), each
        # strand a little of its own
        if kind == 0:
            cl = rng.lognormal(0, lk["length_sigma"], S)[g] * (0.92 + 0.16 * rng.random(S))
            cf = np.clip(1 + lk["lift_sigma"] * rng.normal(size=S), 0.3, 2.2)[g] * (0.9 + 0.2 * rng.random(S))
            turn = np.radians(lk["turn_deg"]) * rng.normal(size=S)[g]
            comb_b = comb_b * np.cos(turn)[:, None] + np.cross(n, comb_b) * np.sin(turn)[:, None]
        else:
            cl, cf = 0.85 + 0.3 * rng.random(S), 0.8 + 0.4 * rng.random(S)
        Ps = strands(root, n, length * cl, lift * cf, comb_b, spec, rng, spec["points"])
        out.append((Ps, root, n, wr, np.full(S, kind), length, g + offset))
        offset += S
    guide = np.concatenate([o[6] for o in out])
    Ps = np.concatenate([o[0] for o in out])
    root = np.concatenate([o[1] for o in out])
    n = np.concatenate([o[2] for o in out])
    wr = np.concatenate([o[3] for o in out])
    kind = np.concatenate([o[4] for o in out])
    length = np.concatenate([o[5] for o in out])
    Ps = clump(Ps, root, spec, rng, kind, guide)
    # flyaways: a few scalp strands, longer, lifted, unclumped
    fly = (kind == 0) & (rng.random(len(root)) < spec["flyaway"]["fraction"])
    if fly.any():
        t = np.linspace(0, 1, Ps.shape[1])[None, :, None]
        lift_dir = unit(n[fly] + rng.normal(size=(fly.sum(), 3)) * 0.4)[:, None, :]
        Ps[fly] = Ps[fly] + lift_dir * t ** 2 * (spec["flyaway"]["lift_mm"] * 0.001) + (Ps[fly] - Ps[fly][:, :1]) * (spec["flyaway"]["length"] - 1) * t
    bvh = BVHTree.FromPolygons([tuple(v) for v in P], [tuple(f) for f in F])
    Ps = keep_out(Ps, bvh, spec["shape"]["min_above_mm"])
    # per strand: random, clump-free tone, width; per point: t and an occlusion estimate (low near the scalp, under
    # the outer layer)
    S, K = Ps.shape[:2]
    srnd = rng.random(S)
    height = np.einsum("skj,sj->sk", Ps - root[:, None, :], n) * 1000  # mm above the root's tangent plane
    hmax = np.maximum(np.percentile(height, 95, axis=1, keepdims=True), 1.0)
    tt = np.linspace(0, 1, K)[None, :]
    ao = np.clip(0.25 + 0.75 * (0.55 * tt + 0.45 * np.clip(height / hmax, 0, 1)), 0, 1) * np.where(kind[:, None] == 1, 1.0, 1.0)
    w0 = np.select([kind == 1, kind == 2], [spec["brows"]["width_mm"], spec["lashes"]["width_mm"]], spec["width_mm"][0]) * (0.75 + 0.5 * rng.random(S))
    w0 = w0 * (0.55 + 0.45 * np.clip(wr, 0, 1))  # finer at the hairline
    width = w0[:, None] * (1 - (1 - spec["width_mm"][1] / spec["width_mm"][0]) * tt ** 1.5)
    tang = np.gradient(Ps, axis=1)
    tang = unit(tang)
    cover = np.clip(dens + bdens, 0, 1)
    report = {"strands": int((kind == 0).sum()), "brow_strands": int((kind == 1).sum()), "lash_strands": int((kind == 2).sum()), "flyaways": int(fly.sum()), "points": int(K)}
    return {"P": Ps, "tangent": tang, "t": np.broadcast_to(tt, (S, K)), "width_mm": width, "ao": ao, "rnd": srnd, "kind": kind, "root_n": n, "root": root}, cover, report


def ribbon_mesh(g):
    """Two vertices per strand point (side -1, +1), quads between consecutive points."""
    S, K = g["P"].shape[:2]
    V = np.repeat(g["P"].reshape(-1, 3), 2, axis=0)
    side = np.tile([-1.0, 1.0], S * K)
    base = (np.arange(S)[:, None] * K + np.arange(K - 1)[None, :]).ravel() * 2
    quads = np.c_[base, base + 2, base + 3, base + 1]
    per_vertex = lambda a: np.repeat(a.reshape(S * K, -1), 2, axis=0)
    return V, quads, side, per_vertex
