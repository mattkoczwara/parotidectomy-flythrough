"""Fail the build when any anatomy check recorded in docs/qc/m1-anatomy/checks.json did not pass (run last by build.sh)."""
import json
import sys
from pathlib import Path

checks = json.loads((Path(__file__).resolve().parents[2] / "docs/qc/m1-anatomy/checks.json").read_text(encoding="utf-8"))
failed = [k for k, v in checks.items() if isinstance(v, dict) and v.get("pass") is False]
if failed:
    print("FAILED anatomy checks: " + ", ".join(failed))
    sys.exit(1)
print(f"all {sum(1 for v in checks.values() if isinstance(v, dict) and 'pass' in v)} anatomy checks pass")
