#!/usr/bin/env bash
# Rebuild only the opening's hero portrait (hero_prep.py, pipeline/blender/hero.py) and publish it, after a full build
# has run once: hero.glb, and the opening's framing box in frame.json (export_gltf.py writes the same box in a full build).
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=pipeline/segment/.venv/Scripts/python.exe
[ -x "$PY" ] || PY=pipeline/segment/.venv/bin/python
BLENDER=${BLENDER:-"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"}
export PYTHONIOENCODING=utf-8
(cd pipeline/anatomy && "../../$PY" hero_prep.py)
"$BLENDER" -b --python pipeline/blender/hero.py 2>&1 | grep -E "^hero|Error|Traceback|  File|Exception" || true
[ -s pipeline/segment/work/hero/report.json ] || { echo "hero.py failed"; exit 1; }
npx gltf-transform meshopt pipeline/build/out/hero.raw.glb apps/site/public/assets/anatomy/hero.glb --level medium
# the skin maps (skin.py): colour lossy, the normal and ORM maps near-lossless
magick pipeline/build/out/hero_albedo.png -quality 92 apps/site/public/assets/anatomy/hero_albedo.webp
magick pipeline/build/out/hero_albedo_fit.png -quality 92 apps/site/public/assets/anatomy/hero_albedo_fit.webp
magick pipeline/build/out/hero_normal.png -define webp:near-lossless=80 -quality 100 apps/site/public/assets/anatomy/hero_normal.webp
magick pipeline/build/out/hero_orm.png -define webp:near-lossless=80 -quality 100 apps/site/public/assets/anatomy/hero_orm.webp
$PY - <<'EOF'
import json
from pathlib import Path
box = json.loads(Path("pipeline/segment/work/hero/report.json").read_text(encoding="utf-8"))["portrait_bust"]
for f in (Path("pipeline/build/out/frame.json"), Path("apps/site/public/assets/anatomy/frame.json")):
    if not f.exists():  # (a full build writes it next, with the same box)
        continue
    fr = json.loads(f.read_text(encoding="utf-8"))
    fr["bounds"]["portrait_bust"] = box
    f.write_text(json.dumps(fr, indent=2), encoding="utf-8")
print("framing", box)
EOF
sha256sum apps/site/public/assets/anatomy/hero.glb apps/site/public/assets/anatomy/hero_*.webp
