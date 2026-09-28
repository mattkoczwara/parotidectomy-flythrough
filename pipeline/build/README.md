# Asset build

`bash pipeline/build/build.sh` rebuilds the M1 anatomy asset end to end:

1. `pipeline/anatomy/landmarks.py`: CT-frame landmarks (automatic, plus visual picks in `pipeline/specs/landmarks.picked.json`).
2. `pipeline/anatomy/author.py`: spec-authored nerves, vessels, digastric and styloid, with topology and relationship checks.
3. `pipeline/anatomy/surfaces.py`: segmented surfaces, the authored deep-lobe completion, the nerve-plane split, the tumour and the peel field.
4. `pipeline/anatomy/face.py`: generic MPFB (CC0) head fitted over the dissection field; voxelised head for the layers.
5. `pipeline/anatomy/layers.py`: fat and SMAS shells under the final skin.
6. `pipeline/build/export_gltf.py` writes `out/slice.raw.glb` and `frame.json`. The glTF frame is CT RAS mm mapped to Y-up metres, centred on the right parotid.
7. `gltf-transform meshopt` writes `apps/site/public/assets/anatomy/slice.glb`, using meshopt compression and quantisation. The stage converts quantised attributes to float at load, because WebGPU has no 16-bit vec3 or scalar vertex formats.

Checks and QC images go to `docs/qc/m1-anatomy/`. The asset's provenance record is `apps/site/src/content/assets/anatomy-slice-glb.json`; update its sha256 after every rebuild.

Not part of the build: `pipeline/anatomy/cryo.py fit` redraws the cryosection registration QC (`docs/qc/m1-cryo/`) from `pipeline/specs/cryo_landmarks.json`. It needs the raw photographs, and it should be rerun after any change to the authored nerves, vessels or gland. `cryo.py view`/`cryo` write gridded crops for picking landmarks.
