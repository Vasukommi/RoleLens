"""Copy a reproducible PDF sample locally. Dataset files and mappings stay out of Git."""

import argparse
import hashlib
import json
import random
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--count", type=int, default=200)
    parser.add_argument("--seed", type=int, default=20261002)
    args = parser.parse_args()
    files = sorted(args.source.expanduser().resolve().rglob("*.pdf"))
    if not 1 <= args.count <= len(files):
        parser.error("Count must be positive and no larger than the available PDF count.")
    selected = random.Random(args.seed).sample(files, args.count)
    directory = ROOT / "data/demo/resumes"
    directory.mkdir(parents=True, exist_ok=True)
    if list(directory.glob("*.pdf")):
        parser.error("Sample directory already contains PDFs. Use the existing sample or move it.")
    manifest = []
    for index, source in enumerate(selected, 1):
        target = directory / f"Applicant-{index:03}.pdf"
        shutil.copyfile(source, target)
        manifest.append(
            {
                "alias": target.name,
                "original": str(source),
                "category": source.parent.name,
                "bytes": target.stat().st_size,
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            }
        )
    (directory.parent / "selection.private.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"selected": len(manifest), "seed": args.seed, "directory": str(directory)}))


if __name__ == "__main__":
    main()
