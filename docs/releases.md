# Desktop builds and releases

The desktop packages include Electron, the compiled frontend, a frozen Python/PyTorch CPU runner, and the pinned default Laya checkpoint. End users do not need Node, Python, Ollama, or an initial model download. Alternative models can still be downloaded explicitly; GPU extraction can use a separately configured local runner.

## Deliverables

| Platform | Architecture | Installer | Standalone package |
| --- | --- | --- | --- |
| Windows | x64 | `*-Setup.exe` (NSIS) | ZIP: extract and run `Invoice Studio.exe` |
| macOS | Apple Silicon / arm64 | DMG: drag the app into Applications | ZIP containing `Invoice Studio.app` |
| Linux | x64 | DEB | AppImage |

The ZIPs include supporting resource directories; do not move just the executable out of the extracted folder. The app deliberately avoids a one-file Python executable that would unpack large model dependencies on every launch. Packages are large because weights and the complete runtime are included. Each release asset must stay below GitHub's 2 GiB upload limit.

macOS Intel and Linux/Windows arm64 are not built by the current matrix. Linux builds use Ubuntu 22.04; run on a compatible glibc-based distribution with desktop libraries installed. AppImage may require FUSE (`libfuse2` on Ubuntu) or AppImage's extraction mode.

## GitHub Actions

- `.github/workflows/ci.yml`: unit, backend, desktop helper, browser tests and production build on pushes/PRs.
- `.github/workflows/desktop-release.yml`: run manually from **Actions → Desktop packages → Run workflow**, or push a version tag such as `v1.0.0`.
- Tags must exactly match `package.json`'s version. Update the version and npm lockfile together before tagging.
- After tests pass, the pipeline downloads the pinned weights once, freezes the native runner on each OS, assembles the desktop app, and tests **real offline CPU inference inside the packaged app**.
- Installers and standalone packages are uploaded as Actions artifacts with SHA-256 checksums. Tagged builds additionally create a **draft GitHub release**, with all platforms attached only after every platform succeeds. Review it and publish manually.
- Rerunning a tag can update an existing draft, never overwrite a published release. Manual builds only produce artifacts.

No repository secrets are needed for unsigned builds. The workflow uses the built-in `GITHUB_TOKEN` with release-write permissions only in the release job. Do not put Hugging Face credentials or other secrets into model resources.

## Optional signing

Unsigned packages may trigger Windows SmartScreen and macOS Gatekeeper warnings. For trusted distribution, configure signing certificates in GitHub repository secrets:

| Secret | Purpose |
| --- | --- |
| `WINDOWS_CSC_LINK` | Base64-encoded Windows signing certificate or private certificate URL |
| `WINDOWS_CSC_KEY_PASSWORD` | Certificate password |
| `MACOS_CSC_LINK` | Base64-encoded Developer ID Application certificate or private certificate URL |
| `MACOS_CSC_KEY_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple account for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific Apple password |
| `APPLE_TEAM_ID` | Developer team identifier |

The final packaging step signs when certificates are supplied and notarizes macOS builds when Apple credentials are supplied. Certificate auto-discovery is disabled in CI. Signing/notarization failures block release; without secrets the build remains unsigned. Signing credentials are not used by pull-request tests.

## Native local build

Build on the same OS/architecture as the desired package, with Node **22.18+** and Python **3.11**. PyInstaller cannot cross-compile the Python runner.

```sh
npm ci
npm run desktop:install
python -m venv .venv
```

Activate the virtual environment (`.venv\Scripts\Activate.ps1` in PowerShell or `source .venv/bin/activate` on macOS/Linux), then:

```sh
# Windows/Linux: ensure this wheel is installed before the build requirements.
python -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
# macOS: omit the command above; its native torch wheel is installed below.
python -m pip install -r backend/requirements-build.txt
python -m backend.bundle_models
python -m PyInstaller --noconfirm --clean --distpath .packaging/runtime --workpath .packaging/build packaging/runner.spec
pip-licenses --format=json --with-license-file --no-license-path --output-file=.packaging/python-licenses.json
python -m pip freeze > .packaging/python-versions.txt
npm run desktop:release
```

On headless Linux, use `xvfb-run -a npm run desktop:release`. To verify an unpacked app without creating installers, use `npm run desktop:verify`. For live frontend development, build/stage the native resources once, run `npm run dev` in one terminal and `npm run desktop:dev` in another. Local smoke tests use temporary user data and `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1`.

Generated resources are under `.packaging/`; deliverables are under `release/`. Both are ignored by Git. Weights are materialized as regular files so installations do not depend on cache symlinks or the build machine's paths. Frontend/font and Python dependency licenses/versions, Laya's license/attribution, and a build manifest are included in the app resources.

## Runtime and user data

The desktop host starts its own authenticated runner on `127.0.0.1:17865` and shuts it down when the app exits. It refuses to attach to an unrelated process on that port. The Electron renderer is sandboxed, has no Node access, and cannot navigate away from the app. Model weights in the installation are read-only; extra downloads go into user data.

The runner also monitors its parent process and exits if the desktop host crashes or is forcibly terminated.

For external GPU/Ollama runners, allow the exact desktop origin `http://127.0.0.1:17865` in that server's origin configuration; do not use a wildcard.

Workspace data and logs persist outside the installation:

- Windows: `%APPDATA%\Invoice Studio`
- macOS: `~/Library/Application Support/Invoice Studio`
- Linux: `~/.config/Invoice Studio` (or the configured XDG location)

`desktop.log` contains model-runner startup diagnostics. Removing or upgrading the app does not deliberately delete workspace data. Browser and desktop workspaces are separate: use **Export workspace / Restore backup** to transfer data. Standalone packages use the same user-data location as installed packages; “standalone” does not mean data is stored next to the executable.
