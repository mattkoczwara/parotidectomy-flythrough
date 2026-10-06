"""The opening's portrait: a leaner, athletic version of the same generic exterior, stored as a morph of it.

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/portrait.py      (after exterior.py)

Presentation only: nothing here is anatomy, and no claim rests on it. The fitted exterior (face.py) is the donor's
shape where anatomy lies beneath; the opening shows an idealised adult instead and settles into the fitted shape
before any anatomy appears (owner's goal reference, docs/benchmarks/README.md).

1. The same MPFB base mesh with MakeHuman's macro modifiers for a leaner, more muscular adult male (anatomy.yaml
   `portrait`), placed by the head fit's own per-axis scale and translation (recovered exactly from the eyes, which
   face.py moves by that transform alone). No envelope, conform or coverage step: the portrait is not the donor.
2. One Loop subdivision of both the fitted and the portrait base meshes (the same step face.py takes) gives
   vertex-for-vertex corresponding surfaces. The displacement between them is carried to every vertex of the skin,
   the exterior body and the eyes by its location on the subdivided fitted surface (exact for
   the vertices face.py kept; barycentric for those added by the neck cut, flap.py's refinement and the hair).
3. Each mesh gets `pdisp` (portrait minus fitted, mm) and `pnrm` (the portrait's normal), and the skin and body a
   portrait field `port` (x stubble region, y cavity, z T-zone, w scalp under the portrait hair) for the material.
4. The portrait hair (groom.py): a shell under-layer (`portrait_scalp.npz`) and an offline, deterministic groom of
   baked ribbon cards (`portrait_hair.npz`) over the portrait scalp.

The positions, normals and indices of the fitted meshes are not changed. Appends a `portrait` check to
docs/qc/m1-anatomy/checks.json and renders docs/qc/m1-anatomy/portrait.png.
"""
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
import yaml
from scipy.spatial import cKDTree

from common import ROOT, WORK
from exterior import outer_vertices, smoothstep, target_weight, transfer
from face import read_base, read_target, submesh

OUT = WORK / "meshes"
QC = ROOT / "docs/qc/m1-anatomy"


def tri_weights(v):
    """MakeHuman's min/average/max weights for a 0..1 macro value (0.5 = average)."""
    return {"min": max(0.0, 1 - v / 0.5), "average": 1 - abs(v - 0.5) / 0.5, "max": max(0.0, (v - 0.5) / 0.5)}


def macro(v, spec):
    """MakeHuman's macro modifiers with muscle and weight as blend values (face.py's macro() is the 0.5/0.5 case),
    ideal proportions, and optional named targets with weights."""
    old = spec["age_old_weight"]
    g = spec["gender"]
    anc = spec.get("ancestry", {"caucasian": 1 / 3, "african": 1 / 3, "asian": 1 / 3})
    out = v.copy()
    for eth, a in anc.items():
        out += (1 - old) * a * read_target(f"macrodetails/{eth}-{g}-young") + old * a * read_target(f"macrodetails/{eth}-{g}-old")
    mw, ww = tri_weights(spec["muscle"]), tri_weights(spec["weight"])
    prop = spec.get("proportions", 0.5)
    for m, a in mw.items():
        for w, b in ww.items():
            if a * b <= 0:
                continue
            for age, c in (("young", 1 - old), ("old", old)):
                out += a * b * c * read_target(f"macrodetails/universal-{g}-{age}-{m}muscle-{w}weight")
                if prop != 0.5:
                    kind, k = ("ideal", (prop - 0.5) * 2) if prop > 0.5 else ("uncommon", (0.5 - prop) * 2)
                    out += a * b * c * k * read_target(f"macrodetails/proportions/{g}-{age}-{m}muscle-{w}weight-{kind}proportions")
    for name, k in (spec.get("targets") or {}).items():
        out += k * read_target(name)
    return out


def locate(surface, points, exact_mm=1e-3):
    """Each point's triangle and barycentric weights on `surface` (exact vertices first, the rest by closest point)."""
    d, j = cKDTree(surface.vertices).query(points)
    tri = np.zeros(len(points), int)
    bary = np.zeros((len(points), 3))
    exact = d < exact_mm
    # an exact vertex: any face that uses it, with weight 1 on that corner
    vf = surface.vertex_faces[j[exact]][:, 0]
    tri[exact] = vf
    corner = np.argmax(surface.faces[vf] == j[exact][:, None], axis=1)
    bary[np.nonzero(exact)[0], corner] = 1.0
    rest = np.nonzero(~exact)[0]
    if len(rest):
        # candidate triangles: those around the nearest few vertices (the points lie on or within millimetres of the
        # surface), the closest point on each, the nearest kept
        _, jj = cKDTree(surface.vertices).query(points[rest], k=6)
        vf = surface.vertex_faces
        cand = vf[jj].reshape(len(rest), -1)
        best = np.full(len(rest), np.inf)
        for c in range(cand.shape[1]):
            fi = cand[:, c]
            ok = fi >= 0
            if not ok.any():
                continue
            b = closest_bary(surface.triangles[np.where(ok, fi, 0)], points[rest])
            q = np.einsum("ij,ijk->ik", b, surface.triangles[np.where(ok, fi, 0)])
            dd = np.where(ok, np.linalg.norm(q - points[rest], axis=1), np.inf)
            better = dd < best
            best[better] = dd[better]
            tri[rest[better]] = fi[better]
            bary[rest[better]] = b[better]
    return tri, bary


def closest_bary(T, p):
    """Barycentric weights of the closest point on each triangle T[i] to p[i] (Ericson, Real-Time Collision Detection 5.1.5)."""
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp, cp = p - b, p - c
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    den = np.maximum(va + vb + vc, 1e-18)
    v, w = vb / den, vc / den
    out = np.c_[1 - v - w, v, w]
    # regions outside the face: clamp to the nearest edge or vertex
    def edge(x, y, ex, i, j, k):
        tt = np.clip((((p - x) * ex).sum(1)) / np.maximum((ex * ex).sum(1), 1e-18), 0, 1)
        r = np.zeros((len(p), 3))
        r[:, i], r[:, j] = 1 - tt, tt
        return r
    outside = (out < 0).any(1)
    if outside.any():
        cands = [edge(a, b, ab, 0, 1, 2), edge(a, c, ac, 0, 2, 1), edge(b, c, c - b, 1, 2, 0)]
        dist = [np.linalg.norm(np.einsum("ij,ijk->ik", r, T) - p, axis=1) for r in cands]
        k = np.argmin(np.stack(dist), axis=0)
        pick = np.stack(cands)[k, np.arange(len(p))]
        out[outside] = pick[outside]
    return out


def carry(values, surface, tri, bary):
    return np.einsum("ij,ijk->ik", bary, values[surface.faces[tri]])


def unit(a):
    return a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-12)


def portrait_normals(pos, faces, normals, disp):
    """The portrait's normals as the authored normals turned by the shape change: the change of the plain area-weighted
    normal under the displacement, added to the exported normal (so seam welding and flap smoothing carry over)."""
    a = trimesh.Trimesh(pos, faces, process=False).vertex_normals
    b = trimesh.Trimesh(pos + disp, faces, process=False).vertex_normals
    return unit(normals + (b - a)).astype(np.float32)


def neck_centre(p, spec):
    lev = (p[:, 2] > spec["neck_z"] - 8) & (p[:, 2] < spec["neck_z"] + 8)
    return p[lev].mean(0)


def pose(p, spec, c):
    """A portrait pose: the torso turned about a vertical axis through the neck (positive turns the chest toward the
    patient's right, the opening camera's side), ramping in from the neck down, so the head stays in profile while the
    shoulders and chest open toward the viewer; the shoulders lowered from MakeHuman's raised rest pose by a drop that
    grows with distance from the neck; and the head carried a little forward and down (pitched chin-down about a
    point above the neck centre and lowered onto a shorter neck), as in the goal reference. `c` is the neck centre
    of the unposed portrait, so the eyes take the same transform as the skin."""
    k = 1 - smoothstep(spec["twist_full_z"], spec["twist_zero_z"], p[:, 2])
    a = np.radians(spec["twist_deg"]) * k
    q = p.copy()
    dx, dy = p[:, 0] - c[0], p[:, 1] - c[1]
    q[:, 0] = c[0] + dx * np.cos(a) + dy * np.sin(a)
    q[:, 1] = c[1] - dx * np.sin(a) + dy * np.cos(a)
    lateral = smoothstep(spec["drop_from_mm"][0], spec["drop_from_mm"][1], np.abs(dx))
    q[:, 2] -= spec["shoulder_drop_mm"] * lateral * (1 - smoothstep(spec["neck_z"] - 10, spec["neck_z"] + 30, p[:, 2]))
    # the torso set back under the head (a relaxed, slightly forward head carriage)
    q[:, 1] -= spec["torso_back_mm"] * (1 - smoothstep(spec["twist_full_z"], spec["neck_z"] + 20, p[:, 2]))
    # head carriage: pitch (chin down) ramping in up the neck, then a drop that shortens the neck
    h = smoothstep(spec["neck_z"] - 20, spec["neck_z"] + spec["head_pitch_ramp_mm"], p[:, 2])
    a = np.radians(spec["head_pitch_deg"]) * h
    py, pz = c[1], spec["neck_z"] + spec["head_pitch_pivot_dz"]
    dy, dz = q[:, 1] - py, q[:, 2] - pz
    q[:, 1] = py + dy * np.cos(a) + dz * np.sin(a)
    q[:, 2] = pz - dy * np.sin(a) + dz * np.cos(a)
    q[:, 2] -= spec["head_drop_mm"] * smoothstep(spec["twist_full_z"] + 20, spec["neck_z"] + spec["head_pitch_ramp_mm"], p[:, 2])
    return q


def relief(surface, eac, spec):
    """Muscle and bone relief of the portrait's neck and shoulder as capsules (RAS mm): the stage evaluates
    h(p) = sum amp exp(-d^2 / sigma^2) over them in the portrait's object space, shading the normals by its gradient
    and lifting the surface a little (presentation only; the mesh there is too coarse to carry the forms).

    Landmarks are found on the portrait surface: the mastoid from the ear canal; the acromion as the right shoulder's
    most lateral top; the sternal notch on the midline front at the level of the clavicles; the laryngeal prominence
    on the midline front between the notch and the chin; a nape point on the midline back. Each muscle is a polyline
    between offsets of these (anatomy.yaml `portrait.relief`), each node projected onto the surface."""
    v = np.asarray(surface.vertices)
    nrm = np.asarray(surface.vertex_normals)
    tree = cKDTree(v)
    mid = np.abs(v[:, 0]) < 6
    right = v[v[:, 0] > 0]
    # acromion: the most lateral point among the shoulder's upper surface (above the deltoid's widest level)
    # acromion: the top of the shoulder at the authored distance from the midline (MakeHuman's rest pose carries the
    # arms out, so the most lateral point would be on the arm)
    top = right[np.abs(right[:, 0] - spec["acromion_x_mm"]) < 8]
    A = top[np.argmax(top[:, 2])]
    front = v[mid]
    def front_at(z):
        s = front[np.abs(front[:, 2] - z) < 4]
        return s[np.argmax(s[:, 1])]
    def back_at(z):
        s = front[np.abs(front[:, 2] - z) < 4]
        return s[np.argmin(s[:, 1])]
    S = front_at(A[2] + spec["notch_above_acromion_mm"])
    chin = front_at(eac[2] - 75)
    L = front_at(S[2] + spec["larynx_at"] * (chin[2] - S[2]))
    N = back_at(eac[2] - spec["nape_below_ear_mm"])
    M = eac + np.array(spec["mastoid_offset_mm"], float)
    marks = {"M": M, "S": S, "A": A, "L": L, "N": N, "E": eac}
    caps, polys = [], []
    for m in spec["muscles"]:
        pts = [marks[k[0]] + np.array(k[1], float) for k in m["path"]]
        # nodes along the path, each projected onto the surface (then set into it by `depth_mm`)
        nodes = []
        for a, b in zip(pts, pts[1:]):
            for t in np.linspace(0, 1, m.get("steps", 2), endpoint=False):
                nodes.append(a + (b - a) * t)
        nodes.append(pts[-1])
        q = []
        for x in nodes:
            j = tree.query(x)[1]
            q.append(v[j] - nrm[j] * m.get("depth_mm", 0.0))
        polys.append(np.array(q))
        segs = [[*a, *b, m["amp_mm"], m["sigma_mm"]] for a, b in zip(q, q[1:])]
        assert len(segs) <= spec["segments_per_muscle"], m["name"]
        segs += [segs[-1]] * (spec["segments_per_muscle"] - len(segs))
        caps += segs
    return np.array(caps), marks, polys


def main() -> None:
    spec_all = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    face, spec, ext = spec_all["face"], spec_all["portrait"], spec_all["exterior"]
    basis = np.load(WORK / "face_basis.npz")
    fitted, index, eyes_fit = basis["fitted"].astype(float), basis["index"], basis["eyes"].astype(float)

    v0, groups = read_base()
    from face import macro as face_macro

    v_fit = face_macro(v0, face["mpfb_macro"])
    head_keep = v_fit[:, 2] > face["mpfb_body_cut_dm"] * 100
    head = submesh(v_fit, groups["body"], head_keep)
    kept = np.unique(groups["body"][head_keep[groups["body"]].all(1)])
    assert np.array_equal(kept, index), "MPFB head selection differs from face.py's"
    eye_idx = np.concatenate([np.unique(groups[g][head_keep[groups[g]].all(1)]) for g in ("helper-l-eye", "helper-r-eye")])

    # The head fit's per-axis scale and translation, exactly: face.py moves the eyes by that transform alone.
    s, t = np.ones(3), np.zeros(3)
    for k in range(3):
        s[k], t[k] = np.linalg.lstsq(np.c_[v_fit[eye_idx, k], np.ones(len(eye_idx))], eyes_fit[:, k], rcond=None)[0]
    eye_resid = float(np.abs(v_fit[eye_idx] * s + t - eyes_fit).max())
    assert eye_resid < 1e-2, f"eyes are not an axis-scaled copy of MPFB's ({eye_resid} mm)"

    v_por = macro(v0, spec["mpfb_macro"])
    por = v_por[index] * s + t
    eyes_por = v_por[eye_idx] * s + t
    # The ears: the fit moved them rigidly with the skin ring around their root; the portrait keeps MPFB's ears where
    # the transform puts them, so nothing more is done here.
    c = neck_centre(por, spec["pose"])
    por = pose(por, spec["pose"], c)
    eyes_por = pose(eyes_por, spec["pose"], c)

    F = trimesh.Trimesh(fitted, head.faces, process=False).subdivide_loop(iterations=1)
    P = trimesh.Trimesh(por, head.faces, process=False).subdivide_loop(iterations=1)
    assert len(F.vertices) == len(P.vertices)
    D = np.asarray(P.vertices) - np.asarray(F.vertices)

    report = {"axis_scales_xyz": [round(float(x), 4) for x in s], "eye_transform_residual_mm": round(eye_resid, 5)}
    out = {}
    for sid in ("skin", "exterior_body"):
        d = dict(np.load(OUT / f"{sid}.npz"))
        ref = d.get("positions_base", d["positions"]).astype(float)  # on the subdivided surface (before the lump)
        tri, bary = locate(F, ref)
        disp = carry(D, F, tri, bary)
        if sid == "skin":
            # The shell's inner surface and its boundary walls move with the outer skin above them (located on their own
            # they would part from it where the shape changes most, and show along the shell's edge at the neck cut).
            f0 = d["indices"].reshape(-1, 3)
            outer = outer_vertices(f0, len(ref), int(d["n_outer"]))
            n0 = int(d["n_outer"])
            disp[n0:2 * n0] = disp[:n0]  # face.py's inner offset: vertex i + n0 lies under outer vertex i
            rest = ~outer
            rest[n0:2 * n0] = False
            if rest.any():  # flap.py's refinement of the inner shell: the nearest outer vertex
                O = np.nonzero(outer)[0]
                _, j = cKDTree(ref[O]).query(ref[rest])
                disp[rest] = disp[O[j]]
        pos = d["positions"].astype(float)
        f = d["indices"].reshape(-1, 3)
        d["pdisp"] = disp.astype(np.float32)
        d["pnrm"] = portrait_normals(pos, f, d["normals"].astype(float), disp)
        out[sid] = d
        report[f"{sid}_max_displacement_mm"] = round(float(np.linalg.norm(disp, axis=1).max()), 1)
    # eyes: the same transform, vertex for vertex
    e = dict(np.load(OUT / "eyes.npz"))
    assert len(e["positions"]) == len(eyes_por)
    e["pdisp"] = (eyes_por - eyes_fit).astype(np.float32)
    e["pnrm"] = portrait_normals(e["positions"].astype(float), e["indices"].reshape(-1, 3), e["normals"].astype(float), eyes_por - eyes_fit)
    out["eyes"] = e

    # The seam at the neck cut: the skin's bottom loop and the body's top loop are the same points, so they must move
    # together (they read the same subdivided vertices).
    sk, bd = out["skin"], out["exterior_body"]
    keys = lambda p: {tuple(np.round(x * 1000).astype(np.int64)): i for i, x in enumerate(p)}
    kb = keys(bd["positions"].astype(float))
    pairs = [(i, kb[k]) for k, i in keys(sk["positions"].astype(float)).items() if k in kb]
    gap = max((float(np.linalg.norm(sk["pdisp"][i] - bd["pdisp"][j])) for i, j in pairs), default=0.0)
    report["seam_pairs"], report["seam_gap_mm"] = len(pairs), round(gap, 4)
    # The outer skin and the body are one surface for the normals (exterior.py welds the fitted normals across the
    # seam the same way): the change of normal under the morph is taken on the welded surface, without the shell's
    # inner face and boundary walls.
    sf = sk["indices"].reshape(-1, 3)
    outer = outer_vertices(sf, len(sk["positions"]), int(sk["n_outer"]))
    O = np.nonzero(outer)[0]
    loc = -np.ones(len(outer), int)
    loc[O] = np.arange(len(O))
    of = loc[sf[outer[sf].all(1)]]
    allp = np.vstack([sk["positions"][O], bd["positions"]]).astype(float)
    alld = np.vstack([sk["pdisp"][O], bd["pdisp"]]).astype(float)
    _, first, inv = np.unique(np.round(allp * 1000).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    wf = inv[np.vstack([of, bd["indices"].reshape(-1, 3) + len(O)])]
    # The portrait's own normals on the welded surface, smoothed over it: flap.py's refinement is irregular and the
    # donor-fitted jaw carries small terraces, and neither belongs to the portrait.
    wp = trimesh.Trimesh(allp[first] + alld[first], wf, process=False)
    n = np.asarray(wp.vertex_normals).copy()
    nbrs = wp.vertex_neighbors
    for _ in range(spec["normal_smoothing_iters"]):
        n = unit(0.5 * n + 0.5 * np.array([n[nb].mean(0) if len(nb) else n[i] for i, nb in enumerate(nbrs)]))
    pn = n[inv].astype(np.float32)
    sk["pnrm"][O] = pn[: len(O)]
    bd["pnrm"] = pn[len(O):]
    # Cavity: how far the portrait surface lies below its Gaussian-weighted local mean (mm), so creases (nasolabial
    # fold, lip corners, concha, jaw-neck crease, eye socket) can be darkened at the scale they are seen. The mean is
    # taken over seeded, area-uniform surface samples within a fixed radius, so it does not depend on how densely each
    # region is triangulated (the skin's flap refinement against the coarse body).
    cv = spec["cavity"]
    pts = np.asarray(trimesh.sample.sample_surface(wp, cv["samples"], seed=17)[0])
    dd, jj = cKDTree(pts).query(np.asarray(wp.vertices), k=cv["neighbours"])
    wt = np.exp(-(dd / cv["radius_mm"]) ** 2)
    local = (pts[jj] * wt[..., None]).sum(1) / wt.sum(1, keepdims=True)
    depth = ((local - np.asarray(wp.vertices)) * n).sum(1)
    cavity = smoothstep(cv["from_mm"], cv["to_mm"], depth)
    # The hero key's shadow (the stage has no shadow maps): the jaw's shadow on the neck and the ear's on the scalp
    # give the portrait its depth. A shadow map along the key direction from dense surface samples; a vertex is in
    # shadow where the surface toward the light lies above it by more than the bias, softened and smoothed over the
    # surface for a penumbra. Stored with the cavity in one channel (the skin's fragment inputs are at the limit):
    # half the cavity, or the shadow, whichever is darker.
    sh = spec["key_shadow"]
    L = unit(np.array([sh["dir_ras"]], float))[0]
    u = unit(np.cross(L, [0.0, 0.0, 1.0])[None])[0]
    w2 = np.cross(L, u)
    sp = np.vstack([pts, np.asarray(wp.vertices)])
    cell = sh["cell_mm"]
    gu, gv = np.floor(sp @ u / cell).astype(int), np.floor(sp @ w2 / cell).astype(int)
    gu0, gv0 = gu.min(), gv.min()
    top = np.full((gu.max() - gu0 + 1, gv.max() - gv0 + 1), -np.inf)
    np.maximum.at(top, (gu - gu0, gv - gv0), sp @ L)
    wv = np.asarray(wp.vertices)
    iu, iv = np.floor(wv @ u / cell).astype(int) - gu0, np.floor(wv @ w2 / cell).astype(int) - gv0
    shadow = smoothstep(sh["bias_mm"], sh["bias_mm"] + sh["soft_mm"], top[iu, iv] - wv @ L)
    # the auricle is thinner than the bias: it shadowed itself and went dark, so it is kept lit
    ear_w = smoothstep(0.02, 0.1, transfer(target_weight(["ears/r-ear-flap-incr", "ears/l-ear-flap-incr"])[index], fitted, allp[first]))
    shadow *= 1 - ear_w
    for _ in range(sh["smooth_iters"]):
        shadow = 0.5 * shadow + 0.5 * np.array([shadow[nb].mean() if len(nb) else shadow[i] for i, nb in enumerate(nbrs)])
    cavity = np.maximum(0.5 * cavity, sh["strength"] * shadow)[inv].astype(np.float32)

    # Portrait field on the skin and body: regions from MakeHuman's own target vertex sets and the eye centres.
    surf_skin, surf_body = sk["positions"].astype(float), bd["positions"].astype(float)
    ears_r = smoothstep(0.02, 0.1, target_weight(["ears/r-ear-flap-incr", "ears/l-ear-flap-incr"])[index])
    nose_r = smoothstep(0.15, 0.7, target_weight(["nose/nose-scale-horiz-incr", "nose/nose-scale-depth-incr"])[index])
    eye_c = [eyes_fit[eyes_fit[:, 0] > 0].mean(0), eyes_fit[eyes_fit[:, 0] < 0].mean(0)]
    ze = float(np.mean([c[2] for c in eye_c]))
    eac = np.array(json.loads((ROOT / "pipeline/specs/landmarks.vhp-male.json").read_text(encoding="utf-8"))["landmarks"]["eac_lateral"]["xyz"], float)
    st = spec["stubble"]

    def field(p):
        y_front = p[:, 1] - eac[1]  # mm in front of the ear canal
        z = p[:, 2]
        # Beard area: below a line from the sideburn's foot (in front of the ear) down to the mouth corner and up over
        # the upper lip; above the neck line; the front of the neck under the jaw.
        line = np.interp(y_front, st["line_y"], np.array(st["line_dz"]) + ze)
        under = smoothstep(0, st["soft_mm"], line - z)
        front = smoothstep(st["front_from_mm"], st["front_from_mm"] + 12, y_front)
        lower = smoothstep(st["neck_dz"] + ze, st["neck_dz"] + ze + 20, z)
        lips = np.zeros(len(p))
        stub = np.clip(under * front * lower, 0, 1)
        tz = np.clip(transfer(nose_r, fitted, p) + smoothstep(ze + 18, ze + 40, z) * smoothstep(60, 90, p[:, 1] - eac[1]) * (1 - smoothstep(25, 55, np.abs(p[:, 0]))), 0, 1)
        return np.c_[stub, np.zeros(len(p)), tz, np.zeros(len(p))].astype(np.float32), lips

    sk["port"], _ = field(surf_skin)
    bd["port"], _ = field(surf_body)
    sk["port"][~outer] = 0  # the shell's inner face never shows while the portrait does
    sk["port"][O, 1] = cavity[: len(O)]
    bd["port"][:, 1] = cavity[len(O):]
    tint_lip = sk["tint"][:, 1]
    sk["port"][:, 0] *= 1 - np.clip(tint_lip * 1.6, 0, 1)  # no stubble on the lips themselves

    for sid, d in out.items():
        np.savez_compressed(OUT / f"{sid}.npz", **d)

    # Portrait groom on the portrait scalp.
    # The portrait's hair: a shell under-layer and a groom of baked cards on the portrait scalp (groom.py); the scalp
    # weight darkens the skin under it (`port.w`).
    from groom import build

    so = np.nonzero(outer)[0]
    loc_o = -np.ones(len(outer), int)
    loc_o[so] = np.arange(len(so))
    Pp = (sk["positions"][so] + sk["pdisp"][so]).astype(float)
    Np = sk["pnrm"][so].astype(float)
    Fp = loc_o[sf[outer[sf].all(1)]]
    Dp = sk["pdisp"][so].astype(float)
    ears_skin = transfer(ears_r, fitted, sk["positions"][so].astype(float))
    eyes_c_por = [eyes_por[eyes_por[:, 0] > 0].mean(0), eyes_por[eyes_por[:, 0] < 0].mean(0)]
    eac_por = eac + Dp[cKDTree(sk["positions"][so]).query(eac)[1]]
    scalp_mesh, groom, scalp_w, groom_report = build(Pp, Np, Fp, Dp, Pp[ears_skin > 0.5], eyes_c_por, eac_por, spec["hair"])
    sk["port"][so, 3] = scalp_w.astype(np.float32)
    # the portrait's hair keeps the parotid region clear too (exterior.py's rule, on the portrait surface)
    zone = (np.linalg.norm(Pp - np.array(face["conform_center"], float), axis=1) < ext["parotid_clear_mm"]) & (Pp[:, 0] > 0)
    report["portrait_hair_max_in_parotid_zone"] = round(float(scalp_w[zone].max()), 3) if zone.any() else 0.0
    np.savez_compressed(OUT / "portrait_scalp.npz", **scalp_mesh)
    np.savez_compressed(OUT / "portrait_hair.npz", **groom)
    report.update(groom_report)
    caps, marks, _ = relief(wp, eac_por, spec["relief"])
    (WORK / "portrait.relief.json").write_text(json.dumps({"segments_per_muscle": spec["relief"]["segments_per_muscle"], "capsules_ras_mm": np.round(caps, 3).tolist(), "landmarks_ras_mm": {k: np.round(x, 2).tolist() for k, x in marks.items()}}, indent=1), encoding="utf-8")
    report["relief_capsules"] = int(len(caps))
    for sid in ("skin", "exterior_body"):
        np.savez_compressed(OUT / f"{sid}.npz", **out[sid])

    ok = report["seam_gap_mm"] < 0.2 and report["eye_transform_residual_mm"] < 1e-2 and report["portrait_hair_max_in_parotid_zone"] < 0.01 and report["portrait_hair_min_ear_clearance_mm"] >= spec["hair"]["ear_clear_mm"][0]
    checks_path = QC / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8"))
    checks["portrait"] = {"pass": bool(ok), **report, "summary": f"presentation only: portrait morph of the exterior (seam gap {report['seam_gap_mm']} mm over {report['seam_pairs']} vertices; largest displacement {report['skin_max_displacement_mm']} mm on the skin, {report['exterior_body_max_displacement_mm']} mm on the body)"}
    checks_path.write_text(json.dumps(checks, indent=2), encoding="utf-8")
    print(("PASS" if ok else "FAIL"), "portrait:", checks["portrait"]["summary"])
    render(out)


def render(out):
    """Lateral silhouettes, fitted and portrait, for the QC log."""
    from matplotlib.collections import PolyCollection

    fig, axes = plt.subplots(1, 2, figsize=(14, 8), dpi=90)
    for ax, (title, w) in zip(axes, [("fitted (donor) exterior", 0.0), ("portrait exterior (opening only)", 1.0)]):
        for sid in ("exterior_body", "skin"):
            d = out[sid]
            f = d["indices"].reshape(-1, 3)
            if sid == "skin":
                f = f[outer_vertices(f, len(d["positions"]), int(d["n_outer"]))[f].all(1)]
            p = d["positions"].astype(float) + w * d["pdisp"]
            tri = p[f]
            n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
            order = np.argsort(tri[:, :, 0].mean(1))
            shade = 0.3 + 0.7 * np.clip(n @ np.array([0.8, 0.2, 0.5]), 0, 1)
            ax.add_collection(PolyCollection(np.stack([tri[order][:, :, 1], tri[order][:, :, 2]], -1), facecolors=(np.array([0.86, 0.68, 0.58]) * shade[order, None]).clip(0, 1), edgecolors="none"))
        ax.autoscale()
        ax.set_aspect("equal")
        ax.set_facecolor("#15181c")
        ax.set_title(title, fontsize=9)
    fig.suptitle("Portrait morph (presentation only): the opening's idealised exterior settles into the fitted exterior before anatomy shows", fontsize=9)
    fig.tight_layout()
    fig.savefig(QC / "portrait.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
