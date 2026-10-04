"""Instruments, imaging planes and the drain (M2/M4 plates).

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/props.py      (after face.py and extras.py)

* needle      a syringe with a fine needle, its tip in the tumour (the fine-needle sample)
* us_probe    an ultrasound transducer on the skin over the tumour, with its cable
* us_plane    the plane the transducer images, drawn as an outline (line grammar: not an ultrasound image)
* ct_tumour_outline  the tumour's section at the CT slice, a dashed outline and hatch fill (never an image of a tumour)
* imaging/ct-axial.png  the registered axial CT slice of the donor at the tumour level (normal anatomy) with alpha
* drain_tube  a closed-suction drain from the resection bed out through a stab wound in the neck
Writes work/meshes/<id>.npz, apps/site/public/assets/imaging/ct-axial.png, work/imaging.json (read by export_gltf.py).
"""
import json

import nibabel as nib
import numpy as np
import trimesh
import yaml
from PIL import Image
from scipy import ndimage

from author import catmull_rom, tube
from common import ROOT, WORK, load_ct
from surfaces import OUT

PUBLIC = ROOT / "apps/site/public/assets/imaging"


def merge(parts):
    """Concatenate (positions, normals, indices) triples into one mesh."""
    pos, nor, idx, base = [], [], [], 0
    for p, n, i in parts:
        pos.append(p)
        nor.append(n)
        idx.append(i.astype(np.uint32) + base)
        base += len(p)
    return np.concatenate(pos).astype(np.float32), np.concatenate(nor).astype(np.float32), np.concatenate(idx).astype(np.uint32)


def rod(p0, p1, r0, r1=None, sides=14):
    c = np.linspace(np.asarray(p0, float), np.asarray(p1, float), 10)
    pos, nor, idx, _ = tube(c, r0, r0 if r1 is None else r1, sides)
    return pos, nor, idx


def save_mesh(mid, parts, **extra):
    pos, nor, idx = merge(parts)
    np.savez_compressed(OUT / f"{mid}.npz", positions=pos, normals=nor, indices=idx, kind="surface", **extra)
    print(f"{mid}: {len(idx) // 3} triangles")


def flat(corners):
    """A quad (two triangles) from four corner points in order; normals from the winding."""
    c = np.asarray(corners, float)
    n = np.cross(c[1] - c[0], c[3] - c[0])
    n /= np.linalg.norm(n)
    return c.astype(np.float32), np.tile(n, (4, 1)).astype(np.float32), np.array([0, 1, 2, 0, 2, 3], np.uint32)


class Head:
    """The solid head (skin_mask) for finding where a ray leaves the skin."""

    def __init__(self):
        img = nib.load(str(WORK / "skin_mask.nii.gz"))
        self.mask = np.asarray(img.dataobj) > 0
        self.inv = np.linalg.inv(img.affine)

    def inside(self, p):
        ijk = np.round(nib.affines.apply_affine(self.inv, np.atleast_2d(p))).astype(int)
        ok = np.all((ijk >= 0) & (ijk < np.array(self.mask.shape)), axis=1)
        out = np.zeros(len(ijk), bool)
        out[ok] = self.mask[tuple(ijk[ok].T)]
        return out

    def exit(self, origin, direction, step=0.25, limit=140):
        d = np.asarray(direction, float) / np.linalg.norm(direction)
        for t in np.arange(0, limit, step):
            if not self.inside(origin + d * t)[0]:
                return origin + d * (t - step * 0.5)
        raise RuntimeError("ray never leaves the head")


def main() -> None:
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))["props"]
    head = Head()
    tc = np.array(json.loads((ROOT / "pipeline/specs/tumour.resolved.json").read_text())["center"], float)

    # ── needle and syringe ──────────────────────────────────────────────────────────────
    N = spec["needle"]
    d = np.array(N["direction"], float)
    d /= np.linalg.norm(d)
    skin = head.exit(tc, d)
    tip = tc - d * N["tip_inside_mm"]
    outer = skin + d * N["shaft_outside_mm"]
    hub = outer + d * N["hub_mm"]
    barrel = hub + d * N["barrel_mm"]
    plunger = barrel + d * N["plunger_mm"]
    parts = [
        rod(tip, outer, N["radius_mm"], N["radius_mm"], 8),
        rod(outer, hub, 1.4, 2.4, 14),
        rod(hub, barrel, 4.4, 4.4, 20),
        rod(barrel, plunger, 1.3, 1.3, 12),
        rod(plunger, plunger + d * 1.6, 5.2, 5.2, 20),
    ]
    save_mesh("needle", parts)

    # ── ultrasound probe, cable and imaged plane ───────────────────────────────────────
    U = spec["ultrasound"]
    y_t, z_t = tc[1] + U["offset_y_mm"], tc[2] + U["offset_z_mm"]
    x_s = head.exit(np.array([tc[0], y_t, z_t]), [1, 0, 0])[0]
    from shapely.geometry import box as sbox

    foot = sbox(-U["thickness_mm"] / 2, -U["width_mm"] / 2, U["thickness_mm"] / 2, U["width_mm"] / 2).buffer(U["round_mm"])
    body = trimesh.creation.extrude_polygon(foot, U["height_mm"])
    v = body.vertices
    body.vertices = np.c_[x_s + v[:, 2], y_t + v[:, 0], z_t + v[:, 1]]  # (u, v, w) -> (y, z, x): a cyclic permutation
    body.fix_normals()
    top = np.array([x_s + U["height_mm"], y_t, z_t])
    cable = catmull_rom(np.array([top, top + [8, -4, 4], top + [16, -18, 14], top + [20, -38, 26]]), step=1.0)
    cpos, cnor, cidx, _ = tube(cable, 1.9, 1.9, 10)
    save_mesh("us_probe", [(body.vertices.astype(np.float32), body.vertex_normals.astype(np.float32), body.faces.astype(np.uint32).ravel()), (cpos, cnor, cidx)])
    zlo, zhi = z_t - U["plane_width_mm"] / 2, z_t + U["plane_width_mm"] / 2
    xin, xout = x_s - U["plane_depth_mm"], x_s
    quad = flat([[xin, y_t, zlo], [xout, y_t, zlo], [xout, y_t, zhi], [xin, y_t, zhi]])
    ring = np.array([[xin, y_t, zlo], [xout, y_t, zlo], [xout, y_t, zhi], [xin, y_t, zhi], [xin, y_t, zlo]], float)
    edges = []
    for a, b in zip(ring[:-1], ring[1:]):
        edges.append(rod(a, b, 0.3, 0.3, 6))
    save_mesh("us_plane", [quad, *edges])

    # ── registered CT slice at the tumour level, and the tumour's section ───────────────────
    ct, aff, zooms = load_ct()
    inv = np.linalg.inv(aff)
    I = spec["imaging"]
    k = int(round(nib.affines.apply_affine(inv, [0, 0, tc[2]])[2]))
    z_plane = float(nib.affines.apply_affine(aff, [0, 0, k])[2])
    x0, x1, ya, yb = I["x_mm"][0], I["x_mm"][1], I["y_mm"][0], I["y_mm"][1]
    i0 = int(round(nib.affines.apply_affine(inv, [x1, 0, 0])[0]))
    i1 = int(round(nib.affines.apply_affine(inv, [x0, 0, 0])[0]))
    j0 = int(round(nib.affines.apply_affine(inv, [0, yb, 0])[1]))
    j1 = int(round(nib.affines.apply_affine(inv, [0, ya, 0])[1]))
    # rows: lateral (x max) at the top; columns: anterior (y) increasing to the right
    sl = ct[i0:i1, j0:j1, k].astype(np.float32)[:, ::-1]
    body_mask = ndimage.binary_fill_holes(sl > -300)
    body_mask = ndimage.binary_opening(body_mask, iterations=1)
    lo, hi = I["level"] - I["window"] / 2, I["level"] + I["window"] / 2
    grey = np.clip((sl - lo) / (hi - lo), 0, 1)
    scale = I["upsample"]
    big = ndimage.zoom(grey, scale, order=3)
    mask_big = ndimage.zoom(ndimage.gaussian_filter(body_mask.astype(np.float32), 0.8), scale, order=1)
    h, w = big.shape
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum.reduce([yy, h - 1 - yy, xx, w - 1 - xx]).astype(np.float32)
    fade = np.clip(edge / (I["fade_px"]), 0, 1)  # the slice fades out toward its border
    alpha = np.clip(mask_big * 1.4 - 0.2, 0, 1) * fade
    rgba = np.dstack([np.repeat((np.clip(big, 0, 1) * 255).astype(np.uint8)[..., None], 3, axis=2), (alpha * 255).astype(np.uint8)])
    PUBLIC.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(PUBLIC / "ct-axial.png", optimize=True)
    xa = nib.affines.apply_affine(aff, [i0, 0, 0])[0]
    xb = nib.affines.apply_affine(aff, [i1, 0, 0])[0]
    ya_ = nib.affines.apply_affine(aff, [0, j0, 0])[1]
    yb_ = nib.affines.apply_affine(aff, [0, j1, 0])[1]
    imaging = {"z_mm": z_plane, "x_mm": [float(min(xa, xb)), float(max(xa, xb))], "y_mm": [float(min(ya_, yb_)), float(max(ya_, yb_))], "image": "/assets/imaging/ct-axial.png", "pixels": [int(w), int(h)], "level": I["level"], "window": I["window"]}
    (WORK / "imaging.json").write_text(json.dumps(imaging, indent=2), encoding="utf-8")
    print("ct slice", imaging["z_mm"], imaging["x_mm"], imaging["y_mm"], (w, h))

    t_data = np.load(OUT / "pleomorphic_adenoma.npz")
    tmesh = trimesh.Trimesh(t_data["positions"], t_data["indices"].reshape(-1, 3), process=False)
    sec = tmesh.section(plane_origin=[0, 0, z_plane], plane_normal=[0, 0, 1])
    dashes, fill = [], []
    for poly in sec.discrete:
        poly = np.asarray(poly, float)
        poly[:, 2] = z_plane + 0.25
        seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
        arc = np.r_[0, np.cumsum(seg)]
        on, off = I["dash_mm"]
        s = 0.0
        while s < arc[-1]:
            e = min(s + on, arc[-1])
            ss = np.linspace(s, e, max(3, int((e - s) / 0.6)))
            pts = np.c_[np.interp(ss, arc, poly[:, 0]), np.interp(ss, arc, poly[:, 1]), np.full_like(ss, z_plane + 0.25)]
            if len(pts) >= 3:
                dashes.append(tube(pts, 0.32, 0.32, 6)[:3])
            s = e + off
        c = poly[:-1].mean(0)
        n = len(poly) - 1
        pos = np.vstack([c, poly[:-1]]).astype(np.float32)
        tri = np.array([[0, 1 + i, 1 + (i + 1) % n] for i in range(n)], np.uint32)
        nrm = np.tile(np.array([0, 0, 1], np.float32), (len(pos), 1))
        fill.append((pos, nrm, tri.ravel()))
    save_mesh("ct_tumour_outline", [*dashes, *fill])

    # ── closed-suction drain ───────────────────────────────────────────────────────────────
    D = spec["drain"]
    skin_p = np.load(OUT / "skin.npz")["positions"]
    near = skin_p[(np.abs(skin_p[:, 1] - D["exit_yz_mm"][0]) < 3) & (np.abs(skin_p[:, 2] - D["exit_yz_mm"][1]) < 3) & (skin_p[:, 0] > 30)]
    x_exit = float(near[:, 0].max())
    nodes = [np.array(p, float) for p in D["bed_nodes_mm"]]
    nodes += [np.array([x_exit - 2.5, *D["exit_yz_mm"]]), np.array([x_exit + 2.0, *D["exit_yz_mm"]]), np.array([x_exit + 3.0, D["exit_yz_mm"][0] - 3, D["exit_yz_mm"][1] - 18]), np.array([x_exit + 1.5, D["exit_yz_mm"][0] - 5, D["exit_yz_mm"][1] - 40])]
    centre = catmull_rom(np.array(nodes), step=0.9)
    pos, nor, idx, _ = tube(centre, D["radius_mm"], D["radius_mm"], 12)
    save_mesh("drain_tube", [(pos, nor, idx)])
    (WORK / "drain.json").write_text(json.dumps({"exit_x_mm": x_exit, "nodes_mm": [n.tolist() for n in nodes]}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
