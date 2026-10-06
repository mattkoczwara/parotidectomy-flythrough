"""Inputs for the opening's hero portrait (pipeline/blender/hero.py), which Blender's own Python cannot read.

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/hero_prep.py      (after portrait.py)

Presentation only: nothing here is anatomy, and no claim rests on it. Writes to pipeline/segment/work/hero/:
- `spec.json`: anatomy.yaml `hero`, plus the frame's origin;
- `fitted.npz`: the fitted exterior the hero hands off to (the skin's outer surface with its localisation field `foot`,
  the exterior body, the eyes and the fitted hair's roots), and the ear-canal landmark, all in Blender's frame (metres).

Blender's frame for the hero: b = (X, -Z, Y) of glTF (ADR-0002: glTF = [-(x - ox), z - oz, y - oy] * 0.001 from CT RAS
mm), so b = (-(x - ox), -(y - oy), z - oz) * 0.001: +x the patient's left, -y anterior, +z up. Blender's glTF export
turns it back into glTF (Y up), and the Human Base Meshes figure already faces -y with its left at +x.
"""
import json

import numpy as np
import yaml

from common import ROOT, WORK
from exterior import outer_vertices

MESHES = WORK / "meshes"
OUT = WORK / "hero"


def to_blender(p, origin):
    q = (np.asarray(p, float) - origin) * 0.001
    return np.c_[-q[:, 0], -q[:, 1], q[:, 2]]


def main() -> None:
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))["hero"]
    marks = json.loads((ROOT / "pipeline/specs/landmarks.vhp-male.json").read_text(encoding="utf-8"))["landmarks"]
    origin = np.array(marks["parotid_centroid"]["xyz"], float)
    OUT.mkdir(parents=True, exist_ok=True)

    sk = np.load(MESHES / "skin.npz")
    f = sk["indices"].reshape(-1, 3)
    outer = outer_vertices(f, len(sk["positions"]), int(sk["n_outer"]))
    keep = np.nonzero(outer)[0]
    remap = -np.ones(len(outer), int)
    remap[keep] = np.arange(len(keep))
    sf = remap[f[outer[f].all(1)]]
    bd = np.load(MESHES / "exterior_body.npz")
    ey = np.load(MESHES / "eyes.npz")
    hr = np.load(MESHES / "hair.npz")
    out = {
        "skin_p": to_blender(sk["positions"][keep], origin), "skin_f": sf.astype(np.int32), "skin_foot": sk["foot"][keep].astype(np.float32),
        "body_p": to_blender(bd["positions"], origin), "body_f": bd["indices"].reshape(-1, 3).astype(np.int32),
        "eyes_p": to_blender(ey["positions"], origin), "eyes_f": ey["indices"].reshape(-1, 3).astype(np.int32),
        "hair_p": to_blender(hr["positions"], origin), "hair_h": hr["hair_h"].astype(np.float32),
        "eac": to_blender([marks["eac_lateral"]["xyz"]], origin)[0], "tragus": to_blender([marks["tragus_skin"]["xyz"]], origin)[0],
    }
    np.savez_compressed(OUT / "fitted.npz", **out)
    (OUT / "spec.json").write_text(json.dumps({**spec, "origin_ras_mm": origin.tolist()}, indent=1), encoding="utf-8")
    print(f"hero_prep: fitted skin {len(keep)} vertices, body {len(bd['positions'])}, eyes {len(ey['positions'])} -> {OUT}")


if __name__ == "__main__":
    main()
