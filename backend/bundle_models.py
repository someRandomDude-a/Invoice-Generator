"""Materialize the pinned Laya checkpoint into portable, symlink-free release resources."""
import argparse
import json
import shutil
from pathlib import Path

from .server import ModelSpec, PRESETS, spec_key


def materialize(snapshot: Path, destination: Path, spec: ModelSpec):
    checkpoint = destination / "cache" / "snapshots" / spec.revision
    checkpoint.mkdir(parents=True, exist_ok=True)
    for source in snapshot.rglob("*"):
        if source.is_file():
            if source.suffix.lower() in (".py", ".bin", ".pkl", ".pt", ".pth"):
                raise ValueError(f"Unsafe checkpoint artifact: {source.name}")
            target = checkpoint / source.relative_to(snapshot)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)  # Dereference HF cache symlinks for Windows/installers.
    for required in ("model.safetensors", "rl_agent_config.json"):
        if not (checkpoint / required).is_file():
            raise ValueError(f"Default Laya checkpoint is missing {required}")
    entry = {**spec.model_dump(), "path": checkpoint.relative_to(destination).as_posix(), "resolved_revision": spec.revision}
    (destination / "registry.json").write_text(json.dumps({spec_key(spec): entry}, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(".packaging/models"))
    args = parser.parse_args()
    from huggingface_hub import snapshot_download
    spec = ModelSpec()
    if len(spec.revision) != 40 or any(c not in "0123456789abcdef" for c in spec.revision):
        raise ValueError("Release models must use an immutable commit revision.")
    path = snapshot_download(spec.repo_id, revision=spec.revision,
                             allow_patterns=["rl_agent_config.json", "model.safetensors", "encoder/*", "tokenizer/*", "LICENSE*", "NOTICE*", "README.md"],
                             ignore_patterns=["*.py", "*.bin", "*.pkl", "*.pt", "*.pth"])
    materialize(Path(path), args.output.resolve(), spec)
    shutil.copyfile("THIRD_PARTY_MODELS.md", args.output / "ATTRIBUTION.md")
    shutil.copyfile("packaging/LICENSE-LAYA.txt", args.output / "LICENSE-LAYA.txt")
    print(f"Prepared {PRESETS['default']}@{spec.revision} in {args.output}")


if __name__ == "__main__":
    main()
