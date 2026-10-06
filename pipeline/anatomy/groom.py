"""The opening portrait's hair (presentation only, no claims): an offline, deterministic groom over the portrait scalp.

Called by portrait.py. Everything is in the CT RAS frame (mm) on the portrait's outer skin (fitted + `pdisp`).

- The hairline, lengths and comb direction are authored in anatomy.yaml `portrait.hair` (a short, textured adult cut:
  longer and lifted on top, tapered to a fade over the ears and at the nape, the ear and the parotid region kept
  clear as for the fitted haircut in exterior.py).
- `portrait_scalp`: the scalp and brow patches as a root surface for a dense, short shell under-layer (the same shell
  renderer as the fitted hair), with the portrait's lengths.
- `portrait_hair`: locks as baked ribbon cards. Clump guide curves walk over the scalp along the comb direction and
  rise to an authored height above it; each card follows its clump's curve from its own root, converging toward the
  clump's tip, with a little seeded wave. Card widths face the opening camera (fixed), so nothing is billboarded at
  run time. Per vertex: `groom` = (t root→tip, across 0..1, card random, layer 0 inner..1 outer) and `flow` (the
  strand tangent).
- Both carry `pdisp`: the scalp displacement at each root, so the hair rides the scalp through the morph.
Rest positions are portrait positions minus `pdisp`, like every other morphed mesh.
"""
import numpy as np
import trimesh
from scipy.spatial import cKDTree

from exterior import smoothstep


def unit(a):
    return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-12)


def hair_fields(P, N, spec, eye_c, eac, ear_tree):
    """Scalp and brow weights, length (mm), kind (0 scalp, 1 brow) and comb direction for the portrait cut."""
    ze, za, yc = float(np.mean([c[2] for c in eye_c])), float(eac[2]), float(eac[1])
    hl = spec["hairline"]
    ref = np.array([ze if r == "eye" else za for r in hl["ref"]])
    z_side = np.interp(P[:, 1] - yc, hl["y"], ref + np.array(hl["dz"]))
    w_side = 1 - (1 - smoothstep(hl["side_from_mm"][0], hl["side_from_mm"][1], np.abs(P[:, 0]))) * smoothstep(20, 50, P[:, 1] - yc)
    z_line = ze + hl["front_dz"] + (z_side - ze - hl["front_dz"]) * w_side
    scalp = smoothstep(z_line, z_line + spec["hairline_soft_mm"], P[:, 2])
    d_ear = ear_tree.query(P)[0]
    scalp = scalp * smoothstep(spec["ear_clear_mm"][0], spec["ear_clear_mm"][1], d_ear)
    # eyebrows (the fitted rule of exterior.py with the portrait's eye centres)
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
    # Length: tapered sides and nape, longer on top and longest at the front.
    up = smoothstep(za + spec["top_from_dz"][0], za + spec["top_from_dz"][1], P[:, 2])
    front = smoothstep(yc + 20, yc + 90, P[:, 1])
    side = spec["side_mm"][0] + (spec["side_mm"][1] - spec["side_mm"][0]) * smoothstep(za - 40, za + 30, P[:, 2])
    top = spec["crown_mm"] + (spec["top_mm"] - spec["crown_mm"]) * front
    length = np.maximum(scalp * (side + (top - side) * up), brows * spec["brow_mm"])
    kind = (brows * spec["brow_mm"] > scalp * spec["side_mm"][0]).astype(np.float32)
    # Comb: back and a little away from the midline on top; back and down on the sides.
    sidew = 1 - up
    d = np.c_[np.sign(P[:, 0]) * spec["part_spread"], -np.ones(len(P)), -spec["comb_down"] - spec["side_down"] * sidew]
    # the front lifts up and back (a short quiff), not down over the forehead
    d[:, 2] += spec["front_lift"] * front * up
    lateral = smoothstep(eye_c[0][0] - 25, eye_c[0][0] + 12, np.abs(P[:, 0]))
    d_brow = np.c_[np.sign(P[:, 0]), 0.15 * np.ones(len(P)), 0.35 * (1 - lateral) - 0.3 * lateral]
    # the crown whorl: around a point at the back of the top the hair turns about the scalp normal
    wh = spec["whorl"]
    back_top = (P[:, 1] < yc + wh["behind_ear_mm"][1]) & (P[:, 1] > yc + wh["behind_ear_mm"][0]) & (np.abs(P[:, 0]) < 8)
    if back_top.any():
        c = P[back_top][np.argmax(P[back_top][:, 2])]
        r = np.linalg.norm(P - c, axis=1)
        swirl = unit(np.cross(N, P - c))
        k = ((1 - np.clip(r / wh["radius_mm"], 0, 1)) ** 2 * wh["strength"])[:, None] * (kind[:, None] < 0.5)
        d = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9) * (1 - k) + swirl * k
    d = np.where(kind[:, None] > 0.5, d_brow, d)
    flow = unit(d - N * (d * N).sum(1, keepdims=True))
    return scalp, brows, length, kind, flow, d_ear, up


def build(P, N, F, D, ear_pts, eye_c, eac, spec):
    """P, N, F: the portrait's outer skin (positions, normals, faces); D: its `pdisp` per vertex; ear_pts: auricle points
    (for the clearance); eye_c: the portrait's eye centres. Returns (portrait_scalp, portrait_hair, scalp per vertex, report)."""
    ear_tree = cKDTree(ear_pts)
    scalp, brows, length, kind, flow, d_ear, up = hair_fields(P, N, spec, eye_c, eac, ear_tree)
    tree = cKDTree(P)
    g = spec["groom"]
    # The opening camera's envelope: the plate-1 view and the transition to plate 2 while the portrait hair shows (RAS
    # directions toward the camera). A root is kept if it faces any of them within a margin; the far side never shows.
    env = g["envelope"]
    views = np.array([[np.cos(np.radians(a)) * np.cos(np.radians(e)), np.sin(np.radians(a)) * np.cos(np.radians(e)), np.sin(np.radians(e))] for a in env["azimuth_deg"] for e in env["elevation_deg"]])
    facing = lambda nv: (nv @ views.T).max(-1) > env["min_facing"]

    # 1) shell root surface: the scalp and brow patches, subdivided once, fields at the new vertices
    w = np.maximum(scalp, brows)
    keep = (w[F] > 0.01).any(1) & facing(N[F].mean(1))
    hf = F[keep]
    used = np.unique(hf)
    remap = -np.ones(len(P), int)
    remap[used] = np.arange(len(used))
    # finer only along the hairline and the brows, where the edge must not show the triangles
    edge = (w[hf].min(1) < 0.95) | (brows[hf].max(1) > 0.01)
    hv, hfaces, attr = trimesh.remesh.subdivide(P[used], remap[hf], face_index=np.nonzero(edge)[0], vertex_attributes={"n": N[used], "d": D[used]})
    hn = unit(attr["n"])
    s_scalp, s_brows, s_len, s_kind, s_flow, _, _ = hair_fields(hv, hn, spec, eye_c, eac, ear_tree)
    # the under-layer: a share of the length on top, the whole (short) length in the fade
    shell_len = np.where(s_kind > 0.5, s_len, np.maximum(np.minimum(s_len * spec["shell_fraction"], spec["shell_max_mm"]), np.minimum(s_len, spec["shell_min_mm"])))
    scalp_mesh = {
        "positions": (hv - attr["d"]).astype(np.float32), "normals": hn.astype(np.float32), "indices": hfaces.astype(np.uint32).ravel(),
        "hair_h": (shell_len / 64.0).astype(np.float32), "flow": s_flow.astype(np.float32),  # mm / 64, so it quantises "hair_kind": s_kind.astype(np.float32),
        "pdisp": attr["d"].astype(np.float32), "kind": "surface",
    }

    # 2) groom: clump guides, then cards
    rng = np.random.default_rng(g["seed"])
    V = views[0]  # card widths face the plate-1 camera
    tri = P[F]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    # sparser toward the hairline (density follows the square of the scalp weight)
    fw = scalp[F].mean(1) ** 2 * (length[F].mean(1) > g["min_len_mm"]) * (kind[F].max(1) < 0.5)
    fw *= facing(N[F].mean(1))

    def sample(n):
        f = rng.choice(len(F), size=n, p=(area * fw) / (area * fw).sum())
        r = rng.random((n, 2))
        flip = r.sum(1) > 1
        r[flip] = 1 - r[flip]
        b = np.c_[1 - r.sum(1), r]
        return np.einsum("ij,ijk->ik", b, tri[f]), f, b

    def field_at(x):
        j = tree.query(x)[1]
        return j

    K = g["points"]

    def walk(root, L, H, n, turn):
        """A guide curve: walk over the scalp along the comb field (turned by `turn` radians about the normal, so locks
        part and cross a little), rising to height H(t) above it."""
        pts = np.zeros((len(root), K, 3))
        x = root.copy()
        j = field_at(x)
        d = flow[j]

        def turned(f, nn):
            b = np.cross(nn, f)
            return unit(f * np.cos(turn)[:, None] + b * np.sin(turn)[:, None])
        step = (L / (K - 1))[:, None]
        for k in range(K):
            t = k / (K - 1)
            j = field_at(x)
            nn = N[j]
            # back onto the surface (nearest vertex's tangent plane), then up to the authored height
            xs = x - nn * ((x - P[j]) * nn).sum(1, keepdims=True)
            h = H * (smoothstep(0, g["rise_t"], t) * (1 - g["settle"] * t)) + g["root_lift_mm"]
            pts[:, k] = xs + nn * h[:, None]
            d = unit(g["inertia"] * d + (1 - g["inertia"]) * turned(flow[j], nn))
            d = unit(d - nn * (d * nn).sum(1, keepdims=True))
            x = xs + d * step
        return pts

    nc = g["clumps"]
    croot, cf, cb = sample(nc)
    cj = field_at(croot)
    # lock lengths vary (0.75-1.25), shorten toward the hairline, and a few locks on top stand up as tufts
    cL = length[cj] * (0.75 + 0.5 * rng.random(nc)) * (0.45 + 0.55 * smoothstep(0.25, 0.9, scalp[cj]))
    cH = cL * (g["lift_side"] + (g["lift_top"] - g["lift_side"]) * up[cj]) * (0.55 + 0.6 * rng.random(nc))
    tuft = (rng.random(nc) < g["tuft_fraction"]) & (up[cj] > 0.6)
    cL = np.where(tuft, cL * g["tuft_length"], cL)
    cH = np.where(tuft, cH * g["tuft_lift"], cH)
    turn = (rng.random(nc) - 0.5) * 2 * np.radians(g["turn_deg"]) * (0.4 + 0.6 * up[cj])
    guides = walk(croot, cL, cH, nc, turn)

    n = g["cards"]
    root, f_, b_ = sample(n)
    ctree = cKDTree(croot)
    dc, ci = ctree.query(root)
    # a card belongs to a clump only near it (a lone card far from every clump would draw a straight stray)
    near = dc < g["clump_radius_mm"]
    root, f_, b_, ci = root[near], f_[near], b_[near], ci[near]
    n = len(root)
    rj = field_at(root)
    rnd = rng.random(n)
    fly = rnd < g["flyaway_fraction"]  # the shader draws these as single strands
    off = root - croot[ci]
    t = np.linspace(0, 1, K)
    conv = g["clump_converge"] * (0.6 + 0.4 * rng.random(n))
    curve = guides[ci] + off[:, None, :] * (1 - conv[:, None] * t[None, :])[..., None]
    # own layer: each card sits a little above or below its clump (volume), and waves a little
    layer = rng.random(n)
    lift = (layer - 0.5) * g["layer_mm"]
    nr = N[rj]
    curve += nr[:, None, :] * (lift[:, None] * smoothstep(0, 0.4, t)[None, :])[..., None]
    T = np.gradient(curve, axis=1)
    T = unit(T)
    B = unit(np.cross(T, nr[:, None, :]))
    phase = rng.random(n) * 6.283
    wave = np.where(fly, g["wave_mm"] * 2.5, g["wave_mm"])
    curve += B * (wave[:, None] * t[None, :] * np.sin(phase[:, None] + t[None, :] * g["wave_cycles"] * 6.283))[..., None]
    # flyaways: longer, lifted away from the lock toward the silhouette
    curve = np.where(fly[:, None, None], curve[:, :1] + (curve - curve[:, :1]) * g["flyaway_length"] + nr[:, None, :] * (g["flyaway_lift_mm"] * t[None, :] ** 1.5)[..., None], curve)
    # never inside the scalp: at least the root lift above the nearest vertex's tangent plane
    flat = curve.reshape(-1, 3)
    jj = tree.query(flat)[1]
    hgt = ((flat - P[jj]) * N[jj]).sum(1)
    flat += N[jj] * np.clip(g["root_lift_mm"] - hgt, 0, None)[:, None]
    curve = flat.reshape(n, K, 3)
    T = unit(np.gradient(curve, axis=1))
    # card geometry: two vertices per point, the width facing the opening camera
    W = unit(np.cross(T, V[None, None, :]))
    width = g["width_mm"] * (1 - g["taper"] * t)[None, :, None] * np.where(fly, 0.35, 1.0)[:, None, None]
    left = curve - W * width / 2
    right = curve + W * width / 2
    pos = np.stack([left, right], axis=2).reshape(-1, 3)
    tan = np.repeat(T, 2, axis=1).reshape(-1, 3)
    nrm = np.repeat(np.repeat(nr[:, None, :], K, axis=1), 2, axis=1).reshape(-1, 3)
    gattr = np.zeros((n, K, 2, 4), np.float32)
    gattr[..., 0] = t[None, :, None]
    gattr[..., 1] = np.array([0.0, 1.0])[None, None, :]
    gattr[..., 2] = rnd[:, None, None]
    gattr[..., 3] = layer[:, None, None]
    # each card rides its root's scalp displacement
    droot = np.einsum("ij,ijk->ik", b_, D[F[f_]])
    disp = np.repeat(np.repeat(droot[:, None, :], K, axis=1), 2, axis=1).reshape(-1, 3)
    base = (np.arange(n) * K * 2)[:, None]
    seg = np.arange(K - 1)
    quads = []
    for s in seg:
        a, b2, c, d2 = 2 * s, 2 * s + 1, 2 * s + 2, 2 * s + 3
        quads.append(np.c_[base + a, base + c, base + b2])
        quads.append(np.c_[base + b2, base + c, base + d2])
    idx = np.stack(quads, axis=1).reshape(-1, 3)
    groom = {
        "positions": (pos - disp).astype(np.float32), "normals": nrm.astype(np.float32), "indices": idx.astype(np.uint32).ravel(),
        "flow": tan.astype(np.float32), "groom": gattr.reshape(-1, 4), "pdisp": disp.astype(np.float32), "kind": "surface",
    }
    report = {"groom_cards": int(n), "groom_clumps": int(nc), "portrait_scalp_vertices": int(len(hv)), "portrait_hair_min_ear_clearance_mm": round(float(d_ear[scalp > 0.05].min()), 1)}
    return scalp_mesh, groom, scalp, report
