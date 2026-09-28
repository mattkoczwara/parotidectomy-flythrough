"""Shared helpers for the anatomy pipeline (canonical CT frame, ADR-0002)."""
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work"


def load_ct():
    img = nib.load(str(WORK / "vhp_male_ct_head.nii.gz"))
    return np.asarray(img.dataobj).astype(np.float32), img.affine, img.header.get_zooms()[:3]


def body_mask(ct: np.ndarray) -> np.ndarray:
    """Solid body from the CT: tissue threshold, largest component, cavities filled per axial slice.

    TotalSegmentator's `head` class has internal boundaries, so it cannot serve as "inside the skin"."""
    body = ct > -400
    lab, n = ndimage.label(body)
    body = lab == (np.argmax(ndimage.sum(body, lab, range(1, n + 1))) + 1)
    for k in range(body.shape[2]):
        body[:, :, k] = ndimage.binary_fill_holes(body[:, :, k])
    return ndimage.binary_closing(body, iterations=2)
