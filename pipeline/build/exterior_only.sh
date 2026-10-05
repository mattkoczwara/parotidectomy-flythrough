#!/usr/bin/env bash
# Rebuild only the presentation layer (exterior.py) and re-export, after a full build has run once.
# The anatomy checks still gate the export.
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=pipeline/segment/.venv/Scripts/python.exe
[ -x "$PY" ] || PY=pipeline/segment/.venv/bin/python
export PYTHONIOENCODING=utf-8
$PY pipeline/anatomy/exterior.py
$PY pipeline/build/check_all.py
$PY pipeline/build/export_gltf.py
npx gltf-transform meshopt pipeline/build/out/slice.raw.glb apps/site/public/assets/anatomy/slice.glb --level medium
cp pipeline/build/out/frame.json apps/site/public/assets/anatomy/frame.json
sha256sum apps/site/public/assets/anatomy/slice.glb
node tools/evidence/checksums.mjs
