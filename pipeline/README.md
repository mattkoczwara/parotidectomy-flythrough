# Anatomy pipeline

**Contents:** `specs/` · `sources/` · `segment/` · `blender/` · `build/`

"Anatomy as code": every shipped mesh is rebuilt from source data plus cited specs by scripts in this directory. See docs/plan.md §7.

- `specs/` authored anatomy (nerves, vessels, layers, landmarks) as data; every dimension carries claim ids.
- `sources/` manifests for third-party data (URL, sha256, licence); raw files go in `sources/raw/` (gitignored).
- `segment/` TotalSegmentator on Visible Human CT (uv venv, Python 3.11/3.12).
- `blender/` headless Blender 5.2 scripts: register, remesh, author from specs, split lobes, bake fields, export glTF.
- `build/` gltf-transform optimisation (meshopt, KTX2, LODs, per-chapter chunks) into the site's public assets.
