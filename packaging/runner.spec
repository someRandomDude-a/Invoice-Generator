"""Native onedir runner; large weights are separate resources, never a onefile temp extraction."""
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, copy_metadata

root = Path(SPECPATH).parent
datas = [(str(root / "backend" / "models.json"), "backend")]
binaries, hiddenimports = [], ["backend.server", "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.h11_impl", "uvicorn.lifespan.on"]
for package in ("laya", "transformers", "safetensors", "tokenizers", "huggingface_hub"):
    data, binary, imports = collect_all(package)
    datas += data
    binaries += binary
    hiddenimports += imports
# transformers checks dependency versions through distribution metadata.
for package in ("torch", "numpy", "regex", "packaging", "filelock", "requests", "tqdm", "pyyaml"):
    datas += copy_metadata(package)

a = Analysis([str(root / "backend" / "desktop.py")], pathex=[str(root)], binaries=binaries,
             datas=datas, hiddenimports=hiddenimports,
             excludes=["tensorflow", "keras", "jax", "flax", "pytest", "IPython", "matplotlib", "torchvision", "torchaudio"],
             noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="invoice-runner", debug=False,
          strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="invoice-runner")
