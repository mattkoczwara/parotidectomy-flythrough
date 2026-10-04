#!/usr/bin/env bash
# Rebuild the anatomy asset from the segmentations and specs (see pipeline/*/README.md).
# Prerequisites: pipeline/sources/fetch.py downloads, pipeline/segment/{build_ct_volume,segment}.py outputs.
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=pipeline/segment/.venv/Scripts/python.exe
[ -x "$PY" ] || PY=pipeline/segment/.venv/bin/python
export PYTHONIOENCODING=utf-8
$PY pipeline/anatomy/landmarks.py > /dev/null
$PY pipeline/anatomy/author.py
$PY pipeline/anatomy/surfaces.py
$PY pipeline/anatomy/pieces.py
$PY pipeline/anatomy/face.py
$PY pipeline/anatomy/extras.py
$PY pipeline/anatomy/props.py
(cd pipeline/anatomy && "../../$PY" layers.py && "../../$PY" flap.py)
$PY pipeline/anatomy/barriers.py
$PY pipeline/build/export_gltf.py
npx gltf-transform meshopt pipeline/build/out/slice.raw.glb apps/site/public/assets/anatomy/slice.glb --level medium
cp pipeline/build/out/frame.json apps/site/public/assets/anatomy/frame.json
sha256sum apps/site/public/assets/anatomy/slice.glb
node tools/evidence/checksums.mjs
