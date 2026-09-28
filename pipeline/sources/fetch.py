"""Download the raw files listed in pipeline/sources/*.json into pipeline/sources/raw/.

Each manifest records source, licence and attribution. Downloads are resumable (existing files
are skipped) and every file's sha256 is written back into the manifest, so a later fetch can
verify it received identical data.

    python pipeline/sources/fetch.py <manifest-id> [<manifest-id> ...]
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(manifest_id: str) -> None:
    manifest_path = HERE / f"{manifest_id}.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        target = RAW / entry["path"]
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(target.suffix + ".part")
            req = urllib.request.Request(entry["url"], headers={"User-Agent": "parotid-atlas-pipeline/0.1 (research fetch)"})
            with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            tmp.replace(target)
        digest = sha256(target)
        if entry.get("sha256") and entry["sha256"] != digest:
            raise SystemExit(f"{entry['path']}: sha256 mismatch (manifest {entry['sha256']}, got {digest})")
        entry["sha256"] = digest
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{manifest_id}: {len(manifest['files'])} file(s) ok")


if __name__ == "__main__":
    for mid in sys.argv[1:]:
        fetch(mid)
