"""Tissue-layer shells under the final (fitted MPFB) skin: subcutaneous fat and SMAS as closed depth bands.

    pipeline/segment/.venv/Scripts/python pipeline/anatomy/layers.py      (after face.py)

Depth is measured below the final skin (work/skin_mask.nii.gz, from face.py), so the bands are consistent
with the visible skin by construction. They are restricted to the right face and upper neck (the dissection
field) and kept off the parotid, whose fascia is built in surfaces.py. The skin shell itself comes from face.py.
"""
import json

import nibabel as nib
import numpy as np
import yaml
from scipy import ndimage

from common import ROOT, WORK
from surfaces import OUT, SEG, mesh_from_mask, save


def main() -> None:
    spec = yaml.safe_load((ROOT / "pipeline/specs/anatomy.yaml").read_text(encoding="utf-8"))
    L = spec["layers"]
    img = nib.load(str(WORK / "skin_mask.nii.gz"))
    head = np.asarray(img.dataobj) > 0
    aff, zooms = img.affine, img.header.get_zooms()[:3]
    depth = ndimage.distance_transform_edt(head, sampling=zooms)
    parotid = np.asarray(nib.load(str(SEG / "head_glands_cavities/parotid_gland_right.nii.gz")).dataobj) > 0
    gland = ndimage.binary_dilation(parotid, iterations=2)
    idx = np.indices(head.shape).reshape(3, -1).T
    w = nib.affines.apply_affine(aff, idx).reshape(*head.shape, 3)
    b = L["field_box"]
    roi = (w[..., 0] > b["x_min"]) & (w[..., 1] > b["y"][0]) & (w[..., 1] < b["y"][1]) & (w[..., 2] > b["z"][0]) & (w[..., 2] < b["z"][1])
    # The auricle is thin and voxelises poorly: the bands are kept only where the head is thick. An opening removes the
    # ear (and nothing of the face), so the preauricular fat is kept and the raised flap has no hole in its fat.
    roi &= ndimage.binary_opening(head, iterations=L["thick_open_iter"])
    del w, idx
    fat = roi & head & (depth >= L["skin_mm"]) & (depth < L["smas_depth_mm"]) & ~gland
    smas = roi & head & (depth >= L["smas_depth_mm"]) & (depth < L["smas_depth_mm"] + L["smas_thickness_mm"]) & ~gland
    save("subcutaneous_fat", mesh_from_mask(fat, aff, 40000, sigma=0.8, smooth_iter=6))
    save("smas", mesh_from_mask(smas, aff, 30000, sigma=0.7, smooth_iter=6))
    print(f"layers: fat {fat.sum() * np.prod(zooms) / 1000:.1f} mL, SMAS {smas.sum() * np.prod(zooms) / 1000:.1f} mL")


if __name__ == "__main__":
    main()
