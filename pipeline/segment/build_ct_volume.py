"""Assemble the Visible Human male normal-CT head/neck slices into one NIfTI volume.

Input:  pipeline/sources/raw/vhp/normalCT/c_vm####.fre.Z (Unix-compressed GE Genesis, 3416-byte header,
        512x512 big-endian int16). Slice number = millimetres below the VHP vertex reference; cryosection
        a_vm#### at the same number is the same level.
Output: pipeline/segment/work/vhp_male_ct_head.nii.gz, resampled onto one grid (0.75 mm in-plane, 1 mm in z).

The scans were acquired in several series with different fields of view (250-460 mm), so every slice is
placed by the corner coordinates in its own GE image header (patient R/A/S, mm; R and A positive toward the
patient's right and anterior, matching NIfTI RAS+), then resampled. The 3 mm region below slice 1162 is
linearly interpolated in z (recorded in the NIfTI description).
"""
import struct
import subprocess
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "pipeline/sources/raw/vhp/normalCT"
OUT = ROOT / "pipeline/segment/work"
HEADER = 3416
SIZE = 512
STEP = 0.75
BOX_R = (-130.0, 130.0)  # mm, patient left..right
BOX_A = (-120.0, 200.0)  # mm, posterior..anterior
AIR_STORED = 0.0  # stored value of air before the -1024 offset
# GE Genesis image-header offsets (found by inspection; FOV/512 equals pixel size, corners span the FOV).
OFF_PIXEL, OFF_THICK = 2444, 2420
OFF_TLHC, OFF_TRHC, OFF_BRHC = 2548, 2560, 2572


def read_slice(path: Path):
    raw = subprocess.run(["gzip", "-dc", str(path)], check=True, capture_output=True).stdout
    h = raw[:HEADER]
    f = lambda o: struct.unpack(">f", h[o : o + 4])[0]
    corner = lambda o: np.array([f(o), f(o + 4), f(o + 8)])
    meta = {"pixel": f(OFF_PIXEL), "thickness": f(OFF_THICK), "tlhc": corner(OFF_TLHC), "trhc": corner(OFF_TRHC), "brhc": corner(OFF_BRHC)}
    img = np.frombuffer(raw[HEADER : HEADER + SIZE * SIZE * 2], dtype=">i2").reshape(SIZE, SIZE).astype(np.float32)
    return img, meta


def main() -> None:
    files = sorted(SRC.glob("c_vm*.fre.Z"), key=lambda p: int(p.name[4:8]))
    slices = {}
    for path in files:
        img, meta = read_slice(path)
        col = (meta["trhc"] - meta["tlhc"]) / SIZE  # world step per column
        row = (meta["brhc"] - meta["trhc"]) / SIZE  # world step per row
        origin = meta["tlhc"] + 0.5 * (col + row)   # centre of pixel (0, 0)
        slices[int(path.name[4:8])] = (img, origin, col, row)

    numbers = sorted(slices)
    s_values = {n: slices[n][1][2] for n in numbers}
    # Table position must advance 1 mm per slice number, or the slice numbering is not millimetres.
    drift = max(abs((s_values[numbers[0]] - s_values[n]) - (n - numbers[0])) for n in numbers)
    if drift > 0.51:
        raise SystemExit(f"table position disagrees with slice numbers by {drift} mm")

    # In-plane grid: the union of the series' fields of view, clipped to a head-and-neck box. (An earlier build
    # used their intersection, which the 250 mm top-of-head series limited so that the face anterior to the
    # lower incisors was cut off; see QC log.) Pixels a slice does not cover are filled with air.
    r_min = max(min(min(o[0], o[0] + c[0] * SIZE) for _, o, c, _ in slices.values()), BOX_R[0])
    r_max = min(max(max(o[0], o[0] + c[0] * SIZE) for _, o, c, _ in slices.values()), BOX_R[1])
    a_min = max(min(min(o[1], o[1] + r[1] * SIZE) for _, o, _, r in slices.values()), BOX_A[0])
    a_max = min(max(max(o[1], o[1] + r[1] * SIZE) for _, o, _, r in slices.values()), BOX_A[1])
    grid_r = np.arange(r_max, r_min, -STEP)  # array axis 0: from patient right to left (x decreasing)
    grid_a = np.arange(a_max, a_min, -STEP)  # array axis 1: anterior to posterior
    gr, ga = np.meshgrid(grid_r, grid_a, indexing="ij")

    def resample(n: int) -> np.ndarray:
        img, origin, col, row = slices[n]
        # Solve world (R, A) -> (row i, column j); corners give an axis-aligned mapping per slice.
        j = (gr - origin[0]) / col[0]
        i = (ga - origin[1]) / row[1]
        return ndimage.map_coordinates(img, [i, j], order=1, mode="constant", cval=AIR_STORED)

    z_numbers = np.arange(numbers[0], numbers[-1] + 1)
    vol = np.empty((len(grid_r), len(grid_a), len(z_numbers)), dtype=np.float32)
    cache = {n: resample(n) for n in numbers}
    for k, n in enumerate(z_numbers):
        if n in cache:
            vol[:, :, k] = cache[n]
            continue
        lo = max(m for m in numbers if m < n)
        hi = min(m for m in numbers if m > n)
        w = (n - lo) / (hi - lo)
        vol[:, :, k] = (1 - w) * cache[lo] + w * cache[hi]

    air = float(np.percentile(vol, 2))
    offset = -1024 if air > -200 else 0  # GE stores CT numbers either signed or +1024
    vol += offset

    s0 = s_values[numbers[0]]
    affine = np.array(
        [
            [-STEP, 0, 0, grid_r[0]],
            [0, -STEP, 0, grid_a[0]],
            [0, 0, -1.0, s0],
            [0, 0, 0, 1],
        ]
    )
    OUT.mkdir(parents=True, exist_ok=True)
    nii = nib.Nifti1Image(np.round(vol).astype(np.int16), affine)
    nii.header["descrip"] = b"VHP male normalCT 1012-1399; GE RAS corners; 3mm below 1162 interp to 1mm"
    nii.header.set_xyzt_units("mm")
    nib.save(nii, OUT / "vhp_male_ct_head.nii.gz")
    # Slice number n sits at world z = s0 - (n - first); consumers use this to find cryosection levels.
    (OUT / "vhp_male_ct_head.levels.txt").write_text(f"first_slice={numbers[0]}\nz_first_mm={s0}\n", encoding="utf-8")
    print(f"slices={len(numbers)} grid={vol.shape} R[{r_min:.1f},{r_max:.1f}] A[{a_min:.1f},{a_max:.1f}] S0={s0} air2%={air:.0f} offset={offset}")


if __name__ == "__main__":
    main()
