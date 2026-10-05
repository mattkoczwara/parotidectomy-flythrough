# Segmentation and registration

**Contents:** venv setup · Steps › `build_ct_volume.py`; `segment.py`; `register.py`

Everything here runs in an isolated Python 3.12 venv. The system Python is 3.14, and PyTorch wheels lag behind it.

```bash
"/c/Program Files/Python312/python.exe" -m venv pipeline/segment/.venv
pipeline/segment/.venv/Scripts/python -m pip install -r pipeline/segment/requirements.lock.txt
# CUDA build of torch (TotalSegmentator's dependency resolution pulls the CPU wheel):
pipeline/segment/.venv/Scripts/python -m pip install --force-reinstall --no-deps "torch==2.14.0" --index-url https://download.pytorch.org/whl/cu130
```

**Steps** (the raw inputs come from `python pipeline/sources/fetch.py <manifest-id>`):

1. `build_ct_volume.py` turns the Visible Human male normal-CT slices into `work/vhp_male_ct_head.nii.gz`. This is the canonical frame (ADR-0002): RAS, mm, 0.75 × 0.75 × 1 mm.
2. `segment.py` runs the five Apache-2.0 TotalSegmentator head/neck tasks, writing to `work/seg/<task>/`.
3. `register.py` produces the meshes, the HRA↔CT registration report and the visual-QC images, all in `docs/qc/m0-registration/`.

`work/` and `.venv/` are gitignored.
