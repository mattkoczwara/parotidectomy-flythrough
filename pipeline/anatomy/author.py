"""Build authored anatomy (nerves, vessels, thin muscles and bones) from pipeline/specs/anatomy.yaml and
assert its anatomical relationships.

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/author.py

Outputs:
  pipeline/segment/work/meshes/<segment>.npz   positions (mm), normals, indices, centreline, radii
  docs/qc/m1-anatomy/checks.json               topology and relationship results (non-zero exit on failure)
  docs/qc/m1-anatomy/*.png                     orthographic views and CT overlays for visual QC
"""
import json
import sys
import zlib
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
import yaml
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work"
SEG = WORK / "seg"
SPECS = ROOT / "pipeline/specs"
OUT = WORK / "meshes"
QC = ROOT / "docs/qc/m1-anatomy"
RING = {"nerve": 16, "vein": 24, "artery": 24, "muscle": 20, "bone": 12, "duct": 14, "instrument": 10}


# ── Signed distance fields ────────────────────────────────────────────────────────────────
class Field:
    """Signed distance (mm, positive outside) to a segmentation mask, with surface normals."""

    def __init__(self, rel: str):
        img = nib.load(str(SEG / f"{rel}.nii.gz"))
        m = np.asarray(img.dataobj) > 0
        zooms = img.header.get_zooms()[:3]
        self.sdf = ndimage.distance_transform_edt(~m, sampling=zooms) - ndimage.distance_transform_edt(m, sampling=zooms)
        self.aff = img.affine
        self.inv = np.linalg.inv(img.affine)
        surf = m & ~ndimage.binary_erosion(m)
        self.surface = nib.affines.apply_affine(self.aff, np.argwhere(surf))
        self.tree = cKDTree(self.surface)
        self.grad = np.gradient(self.sdf)  # per index axis

    def at(self, pts: np.ndarray) -> np.ndarray:
        ijk = nib.affines.apply_affine(self.inv, np.atleast_2d(pts)).T
        return ndimage.map_coordinates(self.sdf, ijk, order=1, mode="nearest")

    def normal(self, pts: np.ndarray) -> np.ndarray:
        ijk = nib.affines.apply_affine(self.inv, np.atleast_2d(pts)).T
        g = np.stack([ndimage.map_coordinates(gi, ijk, order=1, mode="nearest") for gi in self.grad], -1)
        w = g @ self.inv[:3, :3]  # chain rule: index-space gradient to world space
        return w / np.linalg.norm(w, axis=-1, keepdims=True)

    def snap(self, p: np.ndarray, offset: float) -> np.ndarray:
        _, i = self.tree.query(p)
        s = self.surface[i]
        n = self.normal(s)[0]
        return s + n * offset


_fields: dict[str, Field] = {}


def field(rel: str) -> Field:
    if rel not in _fields:
        _fields[rel] = Field(rel)
    return _fields[rel]


# ── Geometry ──────────────────────────────────────────────────────────────────────────────
def catmull_rom(points: np.ndarray, step: float = 0.8) -> np.ndarray:
    """Centripetal Catmull-Rom through all points, sampled about every `step` mm."""
    p = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5
        n = max(2, int(np.ceil(np.linalg.norm(p2 - p1) / step)))
        for t in np.linspace(t1, t2, n, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(points[-1])
    return np.array(out)


def tube(centre: np.ndarray, r0: float, r1: float, sides: int, radii: np.ndarray | None = None):
    """Tapered tube with rounded caps, parallel-transport frames. Returns positions, normals, indices, radii.
    `radii` (one per centre sample) overrides the linear taper from r0 to r1."""
    seg = np.diff(centre, axis=0)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(seg, axis=1))])
    if radii is None:
        radii = r0 + (r1 - r0) * arc / arc[-1]
    tang = np.gradient(centre, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    ref = np.array([0, 0, 1.0]) if abs(tang[0] @ [0, 0, 1]) < 0.9 else np.array([1.0, 0, 0])
    n = np.cross(tang[0], ref)
    n /= np.linalg.norm(n)
    normals_f = [n]
    for i in range(1, len(tang)):
        v = np.cross(tang[i - 1], tang[i])
        if np.linalg.norm(v) > 1e-8:
            ang = np.arccos(np.clip(tang[i - 1] @ tang[i], -1, 1))
            k = v / np.linalg.norm(v)
            n = n * np.cos(ang) + np.cross(k, n) * np.sin(ang) + k * (k @ n) * (1 - np.cos(ang))
        normals_f.append(n)
    theta = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    rings, rnorm = [], []
    for c, t, nn, r in zip(centre, tang, normals_f, radii):
        b = np.cross(t, nn)
        dirs = np.cos(theta)[:, None] * nn + np.sin(theta)[:, None] * b
        rings.append(c + r * dirs)
        rnorm.append(dirs)
    # hemispherical caps
    caps = []
    for end, sign in ((0, -1), (len(centre) - 1, 1)):
        c, t, nn, r = centre[end], tang[end] * sign, normals_f[end], radii[end]
        b = np.cross(tang[end], nn)
        cap_rings, cap_norm = [], []
        for phi in np.linspace(0, np.pi / 2, 4)[1:]:
            dirs = (np.cos(theta)[:, None] * nn + np.sin(theta)[:, None] * b) * np.cos(phi) + t * np.sin(phi)
            cap_rings.append(c + r * dirs)
            cap_norm.append(dirs)
        caps.append((cap_rings, cap_norm))
    start_rings = list(reversed(caps[0][0])) + rings + caps[1][0]
    start_norm = list(reversed(caps[0][1])) + rnorm + caps[1][1]
    pos = np.concatenate(start_rings)
    nor = np.concatenate(start_norm)
    tip0 = centre[0] - tang[0] * radii[0]
    tip1 = centre[-1] + tang[-1] * radii[-1]
    pos = np.vstack([pos, tip0, tip1])
    nor = np.vstack([nor, -tang[0], tang[-1]])
    nr = len(start_rings)
    # counter-clockwise seen from outside, so each face's geometric normal agrees with the outward vertex normals
    idx = []
    for i in range(nr - 1):
        for j in range(sides):
            a, b_ = i * sides + j, i * sides + (j + 1) % sides
            c, d = a + sides, b_ + sides
            idx += [a, b_, c, b_, d, c]
    i0, i1 = nr * sides, nr * sides + 1
    for j in range(sides):
        idx += [i0, (j + 1) % sides, j]
        last = (nr - 1) * sides
        idx += [i1, last + j, last + (j + 1) % sides]
    return pos.astype(np.float32), nor.astype(np.float32), np.array(idx, dtype=np.uint32), radii


def cumarc(c: np.ndarray) -> np.ndarray:
    return np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))])


def arc_on(c: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Arc length (mm) along polyline `c` at the projection of `p` onto it (closest point on the closest polyline
    segment, interpolated), and the distance from `p` to that point."""
    a, b = c[:-1], c[1:]
    ab = b - a
    t = np.clip(((p - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0, 1)
    q = a + ab * t[:, None]
    d = np.linalg.norm(q - p, axis=1)
    i = int(np.argmin(d))
    return float(cumarc(c)[i] + t[i] * np.linalg.norm(ab[i])), float(d[i])


# Presentation-only shaping of the authored tubes (final pass): the authored radius stays the authority.
ROOT_SWELL = 0.08      # a child's root swells by at most 8 % of its own radius, over about one radius (junction)
TIP_TAPER = {"nerve": (0.55, 2.5)}   # free nerve ends thin to this share over this many mm (branches enter muscle)
WAVE = {"nerve": 0.03, "vein": 0.04, "artery": 0.02}   # slow radius undulation (share of the radius)
# Kept round: the measured trunk (claim fn-trunk-diameter) and the divisions where they cross the vein (relation check).
NO_WAVE = {"facial_nerve_trunk", "facial_nerve_temporofacial", "facial_nerve_cervicofacial"}
# Vessels undulate inward only, so no vessel surface comes closer to the nerve or another vessel than authored.
INWARD = {"vein", "artery"}


def shaped_radii(s, centre: np.ndarray, rooted: bool, free_end: bool, funnel: float | None = None) -> np.ndarray:
    """Authored linear taper with a bounded root swell, a terminal taper on free nerve ends and a slow undulation
    (mean-preserving on nerve branches, inward-only on vessels; seeded by the id, so the build is reproducible).
    `funnel`: a parent that ends where thinner branches leave narrows over its last 1.5 radii to this radius, so the
    branches leave a funnel instead of a collar at its end cap (the branches keep their authored calibre)."""
    arc = cumarc(centre)
    r0, r1 = s["radius"]
    base = r0 + (r1 - r0) * arc / arc[-1]
    shape = np.ones_like(arc)
    amp = 0.0 if s["id"] in NO_WAVE else WAVE.get(s["kind"], 0.0)
    if amp:
        rng = np.random.default_rng(zlib.crc32(s["id"].encode()))
        w = sum(np.sin(2 * np.pi * arc / lam + rng.uniform(0, 2 * np.pi)) for lam in (11.0, 17.0)) / 2
        w = w - w.mean()
        w = w / max(np.abs(w).max(), 1e-9)
        shape = shape + (amp * (w - 1) / 2 if s["kind"] in INWARD else amp * w)
    if rooted:
        shape = shape + ROOT_SWELL * np.exp(-((arc / max(r0, 0.3)) ** 2))
    if free_end and s["kind"] in TIP_TAPER:
        share, span = TIP_TAPER[s["kind"]]
        u = np.clip((arc[-1] - arc) / span, 0, 1)
        shape = shape * (share + (1 - share) * (u * u * (3 - 2 * u)))
    r = base * shape
    if funnel is not None and funnel < 0.95 * r1:
        u = np.clip(1 - (arc[-1] - arc) / (1.5 * r1), 0, 1)
        u = u * u * (3 - 2 * u)
        r = r * (1 - u) + funnel * u
    return r


def vertex_arc(arc: np.ndarray, sides: int) -> np.ndarray:
    """Per-vertex arc for tube(): 3 start-cap rings, the rings, 3 end-cap rings, then the two tips."""
    return np.concatenate([np.full(3 * sides, arc[0]), np.repeat(arc, sides), np.full(3 * sides, arc[-1]), [arc[0], arc[-1]]]).astype(np.float32)


# ── Build ─────────────────────────────────────────────────────────────────────────────────
def resolve_nodes(spec, landmarks):
    nodes = {}
    for name, n in spec["nodes"].items():
        if "landmark" in n:
            p = np.array(landmarks[n["landmark"]]["xyz"], float)
        else:
            p = np.array(n["xyz"], float)
        if "snap" in n:
            s = n["snap"]
            p = field(spec["snap_surfaces"][s["surface"]]).snap(p, s["offset_mm"])
        nodes[name] = p
    return nodes


def main() -> int:
    spec = yaml.safe_load((SPECS / "anatomy.yaml").read_text(encoding="utf-8"))
    landmarks = json.loads((SPECS / "landmarks.vhp-male.json").read_text(encoding="utf-8"))["landmarks"]
    nodes = resolve_nodes(spec, landmarks)
    OUT.mkdir(parents=True, exist_ok=True)
    built = {}
    tubular = {"nerve", "vein", "artery"}
    flows = spec.get("flows", {})
    directed = set(flows.get("forward", [])) | set(flows.get("reverse", []))
    def joined(sid, node):
        """True when another segment's path also contains `node` (a branch point, not a free end)."""
        return any(node in o["path"] for o in spec["segments"] if o["id"] != sid)
    arc_root, junctions = {}, {}
    for s in spec["segments"]:
        centre = catmull_rom(np.array([nodes[n] for n in s["path"]]))
        # the segment this one branches from: an earlier tube whose path contains its first node
        parent = next((b for b in built if s["path"][0] in built[b]["path"] and built[b]["kind"] in tubular), None) if s["kind"] in tubular else None
        sides = RING[s["kind"]]
        if s["kind"] in tubular:
            # only a thinner child swells at its root (a continuation of the same calibre, the EJV, does not)
            rooted = parent is not None and s["radius"][0] < 0.95 * float(built[parent]["radii"][cKDTree(built[parent]["centre"]).query(centre[0])[1]])
            kids = [o["radius"][0] for o in spec["segments"] if o["path"][0] == s["path"][-1] and o["kind"] in tubular and o["id"] != s["id"]]
            funnel = max(kids) * (1 + ROOT_SWELL) if kids else None
            radii = shaped_radii(s, centre, rooted=rooted, free_end=not joined(s["id"], s["path"][-1]), funnel=funnel)
            pos, nor, idx, radii = tube(centre, 0, 0, sides, radii=radii)
        else:
            pos, nor, idx, radii = tube(centre, s["radius"][0], s["radius"][1], sides)
        extra = {}
        if s["id"] in directed:
            # Unsigned tree distance (mm) from the root of the directed tree: a child starts at its parent's arc at the
            # projection of the shared node, so a travelling cue crosses every branch point without a step.
            off = 0.0
            if parent in arc_root:
                off, gap = arc_on(built[parent]["centre"], centre[0])
                off += arc_root[parent]
                junctions[s["id"]] = {"parent": parent, "node_offset_mm": round(gap, 4)}
            arc_root[s["id"]] = off
            extra["arc"] = vertex_arc(off + cumarc(centre), sides)
        if s["id"].startswith("facial_nerve") and s["id"] not in ("facial_nerve_trunk", "facial_nerve_posterior_auricular", "facial_nerve_digastric_branch"):
            # Nerve mobilisation (total parotidectomy): the branches are lifted off the deep lobe and retracted while it is
            # delivered from beneath. The weight is 0 at the first division and 1 from `mob_full_mm` out along the branches,
            # so the trunk stays fixed and each branch swings from its root.
            d = np.linalg.norm(pos.astype(np.float64) - nodes["pes"], axis=1)
            t = np.clip((d - spec["mobilisation"]["start_mm"]) / (spec["mobilisation"]["full_mm"] - spec["mobilisation"]["start_mm"]), 0, 1)
            extra["mob"] = (t * t * (3 - 2 * t)).astype(np.float32)
        np.savez_compressed(OUT / f"{s['id']}.npz", positions=pos, normals=nor, indices=idx, centre=centre, radii=radii, kind=s["kind"], **extra)
        built[s["id"]] = {"centre": centre, "radii": radii, "kind": s["kind"], "path": s["path"]}

    results = run_checks(spec, nodes, built, landmarks)
    worst = max((j["node_offset_mm"] for j in junctions.values()), default=0.0)
    results["flow_arc_continuity"] = {"pass": worst < 0.05, "junctions": junctions, "summary": f"{len(junctions)} branch roots; largest distance from the parent centreline {worst:.3f} mm (presentation field)"}
    QC.mkdir(parents=True, exist_ok=True)
    (QC / "checks.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    (SPECS / "nodes.resolved.json").write_text(json.dumps({k: [round(float(v), 2) for v in p] for k, p in nodes.items()}, indent=1) + "\n", encoding="utf-8")
    render(built, nodes)
    failed = [k for k, v in results.items() if isinstance(v, dict) and v.get("pass") is False]
    for k, v in results.items():
        print(f"{'PASS' if v.get('pass') else 'FAIL' if v.get('pass') is False else 'INFO'}  {k}: {v.get('summary', '')}")
    return 1 if failed else 0


# ── Checks ────────────────────────────────────────────────────────────────────────────────
def arclength(c):
    return float(np.linalg.norm(np.diff(c, axis=0), axis=1).sum())


def relation(deep, superficial, zspan=3.0, keep=None):
    """Where two structures overlap front-to-back at about the same level (|dz| < zspan and |dy| smaller
    than their summed radii + 2 mm), the `deep` one must lie medial (smaller x) without the tubes touching.
    `keep` optionally masks which superficial samples count. Returns (pairs, violations, min clearance mm)."""
    pairs, bad, margin = 0, 0, np.inf
    for i, p in enumerate(superficial["centre"]):
        if keep is not None and not keep[i]:
            continue
        dz = np.abs(deep["centre"][:, 2] - p[2])
        dy = np.abs(deep["centre"][:, 1] - p[1])
        near = np.nonzero((dz < zspan) & (dy < deep["radii"] + superficial["radii"][i] + 2))[0]
        for j in near:
            pairs += 1
            gap = p[0] - deep["centre"][j, 0] - superficial["radii"][i] - deep["radii"][j]
            margin = min(margin, gap)
            if gap <= 0:
                bad += 1
    return pairs, bad, float(margin)


def contacts(built, allow_pairs):
    """Tube-to-tube contacts between segments that are not meant to join (parent/child share a node)."""
    ids = list(built)
    trees = {k: cKDTree(v["centre"]) for k, v in built.items()}
    hits = {}
    for a_i, a in enumerate(ids):
        for b in ids[a_i + 1 :]:
            if set(built[a]["path"]) & set(built[b]["path"]) or frozenset((a, b)) in allow_pairs:
                continue
            ra, rb = built[a]["radii"].max(), built[b]["radii"].max()
            d, j = trees[b].query(built[a]["centre"])
            gap = d - built[a]["radii"] - built[b]["radii"][j]
            if (gap < 0).any():
                hits[f"{a}/{b}"] = round(float(gap.min()), 2)
    return hits


def run_checks(spec, nodes, built, landmarks):
    c = spec["checks"]
    R = {}
    tl = arclength(built[c["trunk_length_mm"]["segment"]]["centre"])
    lo, hi = c["trunk_length_mm"]["range"]
    R["trunk_length_mm"] = {"pass": lo <= tl <= hi, "value": round(tl, 1), "range": [lo, hi], "summary": f"{tl:.1f} mm (Pather range {lo}–{hi}; means 14.0 and 16.4)"}

    pc = c["pes_inside_parotid"]
    d = float(field(pc["mask"]).at(nodes[pc["node"]])[0])
    R["pes_inside_parotid"] = {"pass": d <= pc["max_outside_mm"], "sdf_mm": round(d, 2), "summary": f"signed distance {d:.1f} mm (negative = inside)"}

    nv = c["nerve_lateral_to_rmv"]
    inside = lambda b: field(nv["within_mask"]).at(b["centre"]) < 0 if "within_mask" in nv else None
    tot = [relation(built[nv["vessel"]], built[n], keep=inside(built[n])) for n in nv["nerve"]]
    pairs, bad, margin = sum(t[0] for t in tot), sum(t[1] for t in tot), min(t[2] for t in tot)
    R["nerve_lateral_to_rmv"] = {"pass": pairs > 0 and bad == 0, "pairs": pairs, "violations": bad, "min_gap_mm": round(margin, 2), "summary": f"{pairs} level-matched pairs, {bad} violations, min clearance {margin:.1f} mm"}

    for key in ("eca_deep_to_rmv", "eca_deep_to_digastric"):
        e = c[key]
        pairs, bad, margin = relation(built[e["deep"]], built[e["superficial"]])
        R[key] = {"pass": pairs > 0 and bad == 0, "pairs": pairs, "violations": bad, "min_gap_mm": round(margin, 2), "summary": f"{pairs} pairs, {bad} violations, min clearance {margin:.1f} mm"}

    bo = c["branch_order_superior_to_inferior"]
    zs = {}
    for sid in bo["order"]:
        ce = built[sid]["centre"]
        idx = np.nonzero(np.diff(np.sign(ce[:, 1] - bo["at_y"])))[0]
        zs[sid] = float(ce[idx[0], 2]) if len(idx) else None
    ordered = all(zs[a] is not None and zs[b] is not None and zs[a] > zs[b] for a, b in zip(bo["order"], bo["order"][1:]))
    R["branch_order_superior_to_inferior"] = {"pass": ordered, "z_at_plane": zs, "summary": " > ".join(f"{k.replace('facial_nerve_', '')}={v:.0f}" if v is not None else f"{k}=n/a" for k, v in zs.items())}

    mm = c["mm_near_mandible_border"]
    ce = built[mm["segment"]]["centre"]
    dist = field(mm["mask"]).at(ce[len(ce) // 2 :])
    R["mm_near_mandible_border"] = {"pass": bool(np.all(np.abs(dist) <= mm["max_mm"])), "max_mm": round(float(np.abs(dist).max()), 1), "summary": f"distal half within {np.abs(dist).max():.1f} mm of the mandible surface"}

    ts = c["temporal_superficial_to_arch"]
    ce, rr = built[ts["segment"]]["centre"], built[ts["segment"]]["radii"]
    sd = field(ts["mask"]).at(ce)
    R["temporal_superficial_to_arch"] = {"pass": bool(np.all(sd > rr)), "min_clearance_mm": round(float((sd - rr).min()), 2), "summary": f"min clearance from skull {float((sd - rr).min()):.1f} mm"}

    nb = c["no_bone_intersection"]
    allow = np.array([nodes[n] for n in nb["allow_near"]])
    hits = {}
    for sid, b in built.items():
        if b["kind"] not in nb["kinds"]:
            continue
        near_allowed = cKDTree(allow).query(b["centre"])[0] < 5
        for m in nb["masks"]:
            sd = field(m).at(b["centre"])
            bad = (sd < b["radii"] * 0.5) & ~near_allowed
            if bad.any():
                hits[f"{sid}/{m.split('/')[-1]}"] = int(bad.sum())
    R["no_bone_intersection"] = {"pass": not hits, "hits": hits, "summary": "none" if not hits else json.dumps(hits)}

    trunk = built["facial_nerve_trunk"]["centre"]
    ld = {}
    for lm, rec in c["landmark_distances"].items():
        p = np.array(landmarks[lm]["xyz"])
        dmin = float(np.linalg.norm(trunk - p, axis=1).min())
        per = {s: (lo <= dmin <= hi) for s, (lo, hi) in rec["ranges"].items()}
        ld[lm] = {"distance_mm": round(dmin, 1), "within": per, "claim": rec["claim"], "asserted": rec.get("assert", True)}
    any_ok = all(any(v["within"].values()) for v in ld.values() if v["asserted"])
    R["landmark_distances"] = {"pass": any_ok, "detail": ld, "summary": "; ".join(f"{k} {v['distance_mm']} mm in {[s for s, ok in v['within'].items() if ok] or 'no study range'}{'' if v['asserted'] else ' (reported only)'}" for k, v in ld.items())}

    if "duct_course" in c:
        dc = c["duct_course"]
        ce, rr = built[dc["segment"]]["centre"], built[dc["segment"]]["radii"]
        outside_m = field(dc["masseter"]).at(ce) - rr  # clearance from the masseter surface (positive = outside the muscle)
        arch = field(dc["skull_mask"]).at(ce) - rr
        ok = bool((outside_m > 0).all() and arch.min() >= dc["min_below_arch_mm"])
        R["duct_course"] = {"pass": ok, "min_clearance_from_masseter_mm": round(float(outside_m.min()), 2), "min_clearance_from_skull_mm": round(float(arch.min()), 1), "summary": f"duct outside the masseter throughout (min {outside_m.min():.1f} mm), {arch.min():.0f} mm from the skull at closest"}

    allow = {frozenset(pair) for pair in c.get("no_tube_contacts", {}).get("allow", [])}
    touching = contacts(built, allow)
    R["no_tube_contacts"] = {"pass": not touching, "contacts": touching, "summary": "no unintended contacts between authored structures" if not touching else json.dumps(touching)}

    # graph: every segment path starts at a node that is the root or lies on an earlier segment's path
    seen = {c["graph_connected_single_root"]["root"]}
    nerve_ids = [s["id"] for s in spec["segments"] if s["id"].startswith("facial_nerve")]
    orphans = []
    for sid in nerve_ids:
        path = built[sid]["path"]
        if path[0] not in seen:
            orphans.append(sid)
        seen.update(path)
    R["graph_connected_single_root"] = {"pass": not orphans, "orphans": orphans, "summary": f"{len(nerve_ids)} facial-nerve segments, all descend from the foramen" if not orphans else f"orphans: {orphans}"}
    return R


# ── QC renders ────────────────────────────────────────────────────────────────────────────
COL = {"nerve": "#f3e7a8", "vein": "#6c86c4", "artery": "#e0484d", "muscle": "#c77dff", "bone": "#ffffff", "duct": "#7fd1c4", "instrument": "#9aa5b4"}


def render(built, nodes):
    ct_img = nib.load(str(WORK / "vhp_male_ct_head.nii.gz"))
    ct = np.asarray(ct_img.dataobj)
    inv = np.linalg.inv(ct_img.affine)
    ctx = {k: field(v) for k, v in {"parotid": "head_glands_cavities/parotid_gland_right", "masseter": "head_muscles/masseter_right", "mandible": "craniofacial_structures/mandible"}.items()}
    views = {"lateral": (1, 2, 1, 0), "anterior": (0, 2, -1, 1), "inferior": (0, 1, -1, 2)}
    fig, axes = plt.subplots(1, 3, figsize=(21, 8), dpi=110)
    for ax, (title, (a, b, flip, depth)) in zip(axes, views.items()):
        for name, f, col in (("parotid", ctx["parotid"], "#ff9a3c"), ("masseter", ctx["masseter"], "#ef476f"), ("mandible", ctx["mandible"], "#bbbbbb")):
            s = f.surface[:: max(1, len(f.surface) // 6000)]
            ax.scatter(s[:, a] * flip, s[:, b], s=1, c=col, alpha=0.15, linewidths=0)
        for sid, bl in built.items():
            ce = bl["centre"]
            ax.plot(ce[:, a] * flip, ce[:, b], color=COL[bl["kind"]], lw=max(0.8, float(bl["radii"].mean()) * 1.6), solid_capstyle="round")
        for n in ("smf", "pes", "tf_end", "cf_end"):
            p = nodes[n]
            ax.plot(p[a] * flip, p[b], "o", ms=3, color="k")
            ax.annotate(n, (p[a] * flip, p[b]), fontsize=6, xytext=(3, 3), textcoords="offset points")
        ax.set_aspect("equal")
        ax.set_title(title + (" (from patient's right; anterior to the right)" if title == "lateral" else ""), fontsize=9)
        ax.set_facecolor("#20262a")
        ax.tick_params(labelsize=6)
    fig.suptitle("Authored nerves (ivory), veins (blue), arteries (red), digastric (violet), styloid (white) over segmented parotid, masseter, mandible (points)", fontsize=9)
    fig.tight_layout()
    fig.savefig(QC / "authored_views.png")
    plt.close(fig)

    # Axial CT overlays: tube cross-sections at parotid levels
    fig, axes = plt.subplots(2, 3, figsize=(18, 12), dpi=100)
    for ax, z in zip(axes.ravel(), [258, 250, 243, 236, 226, 212]):
        k = int(round(nib.affines.apply_affine(inv, [0, 0, z])[2]))
        x0, x1, y0, y1 = 25, 95, 45, 125
        i0 = int(nib.affines.apply_affine(inv, [x1, 0, 0])[0])
        i1 = int(nib.affines.apply_affine(inv, [x0, 0, 0])[0])
        j0 = int(nib.affines.apply_affine(inv, [0, y1, 0])[1])
        j1 = int(nib.affines.apply_affine(inv, [0, y0, 0])[1])
        ax.imshow(ct[i0:i1, j0:j1, k].T, cmap="gray", vmin=-150, vmax=250, extent=[x1, x0, y0, y1], origin="upper")
        for sid, bl in built.items():
            ce, rr = bl["centre"], bl["radii"]
            sel = np.abs(ce[:, 2] - z) < 0.6
            for p, r in zip(ce[sel], rr[sel]):
                ax.add_patch(plt.Circle((p[0], p[1]), r, color=COL[bl["kind"]], fill=False, lw=1.2))
        par = ctx["parotid"].surface
        sl = par[np.abs(par[:, 2] - z) < 0.6]
        ax.scatter(sl[:, 0], sl[:, 1], s=2, c="#ff9a3c")
        ax.set_title(f"axial z = {z} mm (anterior up, lateral to the left)", fontsize=9)
        ax.tick_params(labelsize=6)
    fig.tight_layout()
    fig.savefig(QC / "authored_on_ct.png")
    plt.close(fig)


if __name__ == "__main__":
    sys.exit(main())
