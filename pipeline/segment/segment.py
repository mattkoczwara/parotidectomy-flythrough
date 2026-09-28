"""Run the open (Apache-2.0) TotalSegmentator head/neck tasks on the Visible Human CT volume.

    pipeline/segment/.venv/Scripts/python pipeline/segment/segment.py

Outputs one mask per structure under pipeline/segment/work/seg/<task>/.
Tasks and citations: https://github.com/wasserth/TotalSegmentator (see pipeline/sources for provenance).
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "pipeline/segment/work"
TASKS = ["craniofacial_structures", "head_glands_cavities", "head_muscles", "headneck_bones_vessels", "headneck_muscles"]
EXE = Path(sys.executable).with_name("TotalSegmentator.exe")


def main() -> None:
    ct = WORK / "vhp_male_ct_head.nii.gz"
    for task in TASKS:
        out = WORK / "seg" / task
        if out.exists() and any(out.iterdir()):
            print(f"{task}: exists, skipping")
            continue
        subprocess.run([str(EXE), "-i", str(ct), "-o", str(out), "--task", task], check=True)
        print(f"{task}: done")


if __name__ == "__main__":
    main()
