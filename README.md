# Invoice Studio

A local invoice workspace with a minimal liquid-glass interface, dark/light mode, templates, CSV tools and local model extraction.

## Run

Requires **Node.js 22.18+** and npm. Use a current Chrome or Edge browser for folder selection and PDF extraction.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Production build: `npm run build`; serve it with `npm run preview`. Always serve the app over HTTP, not `file://`.

## Desktop packages

Build/release automation produces **Windows installer + ZIP**, **macOS DMG + ZIP (Apple Silicon)**, and **Linux AppImage + DEB**, including the CPU runtime and Laya weights for offline extraction. Run **Desktop packages** in GitHub Actions or push a version tag matching `package.json`; successful tagged builds create a draft release with SHA-256 checksums. See [desktop build and signing instructions](docs/releases.md).

## Included

- **Invoice workspace:** create, edit, duplicate, search, filter, record payments, delete and print selected invoices.
- **Invoice entry:** customer details, dates, custom fields, multiple line items, HSN/SAC, quantity, rates, discounts, tax, notes and payment status. Calculates in minor currency units, applying discounts before tax.
- **Template creator:** modern, classic and minimal layouts; accent colors; logos; signatures; tax presentation; optional sections; terms; footer; custom input fields. Templates can be duplicated and removed.
- **Asset library:** upload, categorize, rename and remove PNG/JPG/WebP images. Raster images are normalized and resized to reduce storage usage.
- **Print / PDF:** A4 portrait output, one invoice per print section, with repeatable table headers for longer invoices. Choose **Save as PDF** in the browser print dialog. Use 100% scale, disable browser headers/footers and enable background graphics.
- **Input-data CSV export:** exports the current invoice form, including unsaved values, or all filtered/selected invoices. One row per item; invoice-level fields repeat. Includes custom values, status and payments. Summary CSV is also available.
- **CSV batch import:** upload/paste a CSV, select a template, map arbitrary column names to invoice fields, configure numbering, validate, review and save/print the entire batch.
- **Recursive directory import:** select an entire source folder, filter extensions and scan subfolders. Extract data locally, consolidate rows with source provenance, correct values, and export a custom CSV schema to a flat file or a ZIP organized by year/month. Optionally generate invoices from the reviewed rows.
- **Business settings:** business identity, GSTIN/tax ID, bank details, INR/USD/EUR/GBP, numbering and tax/payment defaults.
- **Workspace backups:** JSON export/restore includes invoices, assets, templates, settings and import configuration. Saved invoices retain snapshots of their original business details, template and image assets.

## Local models: Laya by default

The default is [`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya), with its reviewed revision pinned in `backend/models.json`. The app ships its adapter, configuration and dependency manifest; the large model weights are **not checked into Git**. Download them explicitly from the GUI, or prepare them for an offline deployment using the command below.

### Install the local runner

Use **Python 3.11 or 3.12** in a virtual environment. Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-models.txt
.\.venv\Scripts\python.exe -m backend.server
```

On macOS/Linux, use `python3 -m venv .venv`, then `.venv/bin/python` for the same commands. The runner binds **127.0.0.1:8000**. Keep it running alongside `npm run dev`.

For a CPU-only PyTorch install, install `torch` from the [official CPU wheel index](https://download.pytorch.org/whl/cpu) before installing the model requirements. For GPU execution, install the appropriate [PyTorch build](https://pytorch.org/get-started/locally/) and drivers. Device choices are **CPU**, available **CUDA/ROCm devices**, or **Apple Metal (MPS)**. Unavailable devices or runtime fallbacks are reported rather than silently accepted.

Open **Data import studio → Sources & model**:

1. Connect to the local runner.
2. Choose Laya, its multilingual/typed-decisions variants, an extractive QA preset, or a compatible custom Hugging Face repository.
3. Review the model license and click **Download weights**. Downloads can be hundreds of MB or larger. Only model identifiers go to Hugging Face, never source documents.
4. Select CPU or GPU, threads, timeout and confidence threshold, then scan your files.
5. Review extracted values and per-field confidence before creating invoices.

**Laya is non-generative.** The adapter finds candidate values in the source, then uses Laya’s typed `choice` decisions to select among them or abstain. It cannot invent arbitrary text or recover values that candidate generation misses. Its default checkpoint is not a guaranteed zero-shot invoice extractor: validate it on your documents, tune the threshold, use a fine-tuned checkpoint, or correct rows manually. The extractive-QA adapter returns literal spans from the source. Custom models must match the selected adapter; arbitrary HF architectures are not interchangeable.

Inference uses only explicitly downloaded local checkpoints. Downloads accept safetensors rather than pickle weights, and custom Hugging Face code is not enabled. Cache and registry: `.models/` (ignored by Git). A gated repository can use `HF_TOKEN` set in the runner’s environment, never stored in the GUI or backups.

To **ship the default Laya weights with an offline installation**:

```sh
python -m backend.prepare_models
```

Package `.models/` alongside the app and preserve the downloaded model’s license. No weights are downloaded just by starting the app or server. `INVOICE_MODEL_DIR` can change the cache directory; `INVOICE_APP_ORIGINS` can specify exact allowed browser origins. Wildcard origins are rejected. The standard dev/preview ports and test port 5174 are allowed by default.

Ollama is an optional alternative engine for already-installed generative models. CPU mode sets `num_gpu: 0`; GPU mode requests offload and verifies GPU memory placement through `/api/ps`. Keyword rules require no model. CSV/JSON use deterministic field mapping. Cancelling a scan stops further files and aborts the browser request; an in-flight Python model forward pass may finish on the runner before it becomes available again.

## CSV field mapping and numbering

`examples/mapped-batch.csv` demonstrates nonstandard source headers. Map **Reference → Invoice number**, **Client name → Customer name**, **Product → Item description**, **Unit price → Unit rate**, and **Registration → Vehicle / registration**. Auto-matched columns can be adjusted. Required destinations: customer name, description and rate. Blank rates are rejected; enter `0` explicitly for a free item.

Rows with the same invoice number form one invoice. Customer details, dates, notes, status, payments and custom fields must match across that group. Blank invoice numbers create a separate invoice for each row. Invoice numbers must be unique within the workspace. All batches are validated before saving—invalid batches do not partially create invoices.

Numbering tokens: `{prefix}`, `{year}`, `{month}`, `{day}`, `{seq}` or `{seq:4}` (padding widths 1–9). Example: `{prefix}{year}{month}-{seq:4}` → `INV-202610-0001`. A sequence token is required. You can keep source numbers or regenerate them while retaining multi-item grouping. Existing numbers are skipped automatically.

Input exports include business, currency and template reference columns, but CSV imports intentionally use the **selected template and current business profile**. These reference columns do not override your settings. For an exact archival restore, use a JSON workspace backup instead. Choose a matching currency/template when reimporting CSV. Formula-like spreadsheet cells are escaped with a leading apostrophe for safety.

## Directory consolidation

**Sources & model:** choose a folder/files, recursion, included extensions, model and device. The browser only reads explicitly selected files; it cannot crawl arbitrary disk paths.

**Fields & format:** configure each output column’s name, search aliases, invoice destination, data type, fallback and required flag. Add CSV-only fields or your selected template’s custom fields. Configure export filenames, delimiter, numbering and folder hierarchy. Group by mapped invoice date, a `YYYY/MM` or `YYYY-MM` source path, or file modification date. Unknown dates are preserved in `undated/` rather than guessed. Save the configuration to reuse it and include it in backups.

**Review & export:** inspect rows by source folder, edit any value, remove unwanted rows and inspect failed-file reports. Download a single CSV or organized ZIP, or generate invoices. The source files are never modified. ZIP structure, for example:

```text
2026/
  09/invoices.csv
  10/invoices.csv
undated/invoices.csv
```

`examples/source-folder` is a small recursive scan example. Use keyword rules to try it without installing a model.

### Supported formats and limits

- UTF-8 CSV, JSON objects/arrays, TXT, Markdown, HTML, text-based PDF and DOCX document bodies.
- CSV/JSON can produce multiple rows; each unstructured document produces **one invoice-item row**. Multiple items in complex documents require manual splitting or a structured CSV/JSON source.
- PDF extraction reads at most 30 pages and does not render or execute embedded content. Image-only scans need external OCR first. DOCX headers, footers and embedded objects are not imported.
- Maximum 500 selected files / 100 MB total; 10 MB per file; 1,000 consolidated rows. Text is capped at 100,000 characters; Ollama input at 24,000 characters. Laya uses bounded, per-field source evidence and at most 12 candidates to respect its short context budget. Large/complex documents may need to be split.
- Assets: 2 MB source file limit, resized to at most 1,200 pixels and compressed to a maximum 500 KB data URL.
- Workspace: up to 100 templates, 100 assets, 10,000 invoices, 200 items per invoice and 20 custom fields per template. Browser storage capacity will usually be reached much earlier.

## Data and privacy

Invoices and configuration are saved in this browser’s **localStorage**, not a server or cloud database. Fonts and PDF workers are bundled locally; no analytics or external font requests are made. Original directory contents and review rows remain in memory and are not saved automatically: export them before leaving the import studio. The model server receives only text extracted from your selected documents.

Export backups regularly. Clearing browser data, private browsing or exceeding storage limits can lose unsaved data. Storage failures show a persistent warning; export before closing the tab. Corrupt saved data is preserved for recovery rather than overwritten. This is a single-tab workspace and does not synchronize across devices or simultaneous tabs.

This is not a statutory GST/e-invoicing integration, accounting ledger, or automated compliance checker. Confirm required fields, rates and tax treatment with your accountant before issuing invoices. A template editor configures predefined invoice layouts; it is not an arbitrary drag-and-drop page designer.

## Development

React + TypeScript + Vite; Python + FastAPI for local models. Zod validates records/backups, Papa Parse handles CSV, PDF.js extracts PDF text, and fflate reads DOCX bodies and produces organized ZIP exports. The model API can be tested with only `backend/requirements.txt`; actual inference requires `backend/requirements-models.txt`.

```sh
npm test
npm run build
npm run test:e2e
python -m unittest backend.test_extraction backend.test_server
```

Unit and backend tests cover calculations, validation, snapshots, backups, CSV roundtrips, mapping, numbering, candidates, organized exports, origin restrictions, local-only inference and device selection. End-to-end tests use installed Google Chrome and a dev server on port 5174; they cover the main workflows, dark/light mode, downloads, document extraction and mobile layouts. Model calls are mocked; real CPU/GPU inference requires a separate hardware/checkpoint smoke test.
