"""Loopback-only HF download and model inference service for Invoice Studio.

Run: python -m backend.server
Install model dependencies separately; starting the server never downloads weights.
"""
import gc
import json
import os
import secrets
import threading
import uuid
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from .extraction import select_laya_values

ROOT = Path(__file__).resolve().parent.parent
MODEL_ROOT = Path(os.environ.get("INVOICE_MODEL_DIR", str(ROOT / ".models"))).resolve()
BUNDLED_MODEL_ROOT = Path(os.environ["INVOICE_BUNDLED_MODEL_DIR"]).resolve() if os.environ.get("INVOICE_BUNDLED_MODEL_DIR") else None
SERVER_TOKEN = os.environ.get("INVOICE_SERVER_TOKEN", "")
PRESETS = json.loads((Path(__file__).parent / "models.json").read_text(encoding="utf-8"))
DEFAULT_ORIGINS = [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 4173, 5174)]
ORIGINS = [value.strip() for value in os.environ.get("INVOICE_APP_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",") if value.strip()]
if "*" in ORIGINS:
    raise RuntimeError("Wildcard origins are not permitted for the local model server.")

app = FastAPI(title="Invoice Studio · Local Model Runner", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"])
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="model-download")
jobs: dict[str, dict] = {}
registry_lock = threading.RLock()
inference_lock = threading.Lock()
loaded_key = None
loaded_model = None


@app.middleware("http")
async def protect_local_requests(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and origin not in ORIGINS:
        return JSONResponse({"detail": "This origin is not permitted."}, status_code=403)
    if SERVER_TOKEN and request.method != "OPTIONS" and not secrets.compare_digest(request.headers.get("x-invoice-token", ""), SERVER_TOKEN):
        return JSONResponse({"detail": "Desktop session authentication required."}, status_code=401)
    if int(request.headers.get("content-length", "0") or "0") > 512_000:
        return JSONResponse({"detail": "Request exceeds the 512 KB limit."}, status_code=413)
    response = await call_next(request)
    if SERVER_TOKEN:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self'; "
            "connect-src 'self' http://127.0.0.1:* http://localhost:* http://[::1]:*; "
            "worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


class ModelSpec(BaseModel):
    repo_id: str = Field(default=PRESETS["default"], min_length=3, max_length=96)
    revision: str = Field(default=PRESETS["presets"][0]["revision"], min_length=1, max_length=100)
    adapter: Literal["laya", "qa"] = "laya"

    @field_validator("repo_id")
    @classmethod
    def valid_repo(cls, value):
        from huggingface_hub.utils import validate_repo_id
        if value.count("/") != 1:
            raise ValueError("Use a Hugging Face owner/model repository ID, not a URL or local path.")
        validate_repo_id(value)
        return value


class ExtractionField(BaseModel):
    column: str = Field(min_length=1, max_length=100)
    target: str = Field(default="", max_length=200)
    terms: str = Field(default="", max_length=1000)
    type: Literal["text", "number", "date"] = "text"


class ExtractRequest(ModelSpec):
    text: str = Field(min_length=1, max_length=100_000)
    fields: list[ExtractionField] = Field(min_length=1, max_length=50)
    device: str = Field(default="cpu", pattern=r"^(cpu|cuda:[0-9]+|mps)$")
    cpu_threads: int = Field(default=4, ge=1, le=64)
    confidence_threshold: float = Field(default=0.65, ge=0, le=1)
    max_candidates: int = Field(default=8, ge=2, le=12)
    instructions: str = Field(default="", max_length=10000)


def registry(root: Path | None = None) -> dict:
    with registry_lock:
        path = (root or MODEL_ROOT) / "registry.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def checkpoint_path(spec: ModelSpec) -> Path:
    for root in (MODEL_ROOT, BUNDLED_MODEL_ROOT):
        if root is None:
            continue
        entry = registry(root).get(spec_key(spec))
        if entry:
            path = (root / entry["path"]).resolve()
            if not path.is_relative_to((root / "cache").resolve()) or not path.is_dir():
                raise ValueError("The registered model cache is missing or outside the configured cache directory.")
            return path
    raise ValueError("Download the selected model in the GUI before extracting. Inference never downloads weights.")


def spec_key(spec: ModelSpec) -> str:
    return f"{spec.adapter}:{spec.repo_id}@{spec.revision}"


def devices() -> list[str]:
    result = ["cpu"]
    try:
        import torch
        if torch.cuda.is_available():
            result.extend(f"cuda:{index}" for index in range(torch.cuda.device_count()))
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            result.append("mps")
    except ImportError:
        pass
    return result


@app.get("/health")
def health():
    import importlib.util
    return {"status": "ok", "devices": devices(), "default_model": PRESETS["default"],
            "laya_installed": importlib.util.find_spec("laya") is not None}


@app.get("/models")
def models():
    data = registry(BUNDLED_MODEL_ROOT) if BUNDLED_MODEL_ROOT else {}
    data.update(registry())
    return {"presets": PRESETS["presets"], "downloaded": list(data.values())}


def download_job(job_id: str, spec: ModelSpec):
    try:
        from huggingface_hub import snapshot_download
        jobs[job_id].update(status="downloading", message="Downloading weights and tokenizer from Hugging Face…")
        patterns = ["rl_agent_config.json", "model.safetensors", "tokenizer/*", "encoder/*", "LICENSE*", "README.md"] if spec.adapter == "laya" else ["*.json", "*.safetensors", "*.txt", "*.model", "LICENSE*", "README.md"]
        path = snapshot_download(repo_id=spec.repo_id, revision=spec.revision, cache_dir=str(MODEL_ROOT / "cache"),
                                 allow_patterns=patterns, ignore_patterns=["*.py", "*.bin", "*.pkl", "*.pt", "*.pth"])
        model_path = Path(path)
        if spec.adapter == "laya" and not (model_path / "rl_agent_config.json").exists():
            raise ValueError("This repository is not a compatible Laya checkpoint. Choose the correct adapter.")
        if not (model_path / "model.safetensors").exists() and not list(model_path.glob("*.safetensors")):
            raise ValueError("No safetensors weights found. Pick a compatible checkpoint; pickle weights are not loaded.")
        entry = {**spec.model_dump(), "path": model_path.resolve().relative_to(MODEL_ROOT).as_posix(), "resolved_revision": model_path.name}
        with registry_lock:
            data = registry(); data[spec_key(spec)] = entry
            MODEL_ROOT.mkdir(parents=True, exist_ok=True)
            temp = MODEL_ROOT / "registry.tmp"
            temp.write_text(json.dumps(data, indent=2), encoding="utf-8"); temp.replace(MODEL_ROOT / "registry.json")
        jobs[job_id].update(status="complete", message="Model downloaded. Ready for local inference.")
    except Exception as error:
        jobs[job_id].update(status="failed", message=str(error)[:600])


@app.post("/models/download", status_code=202)
def download_model(spec: ModelSpec):
    # Explicit download endpoint: extraction is always offline and never downloads.
    with registry_lock:
        if any(job["status"] in ("queued", "downloading") for job in jobs.values()):
            raise HTTPException(409, "A model download is already running.")
        job_id = uuid.uuid4().hex
        jobs[job_id] = {"id": job_id, "status": "queued", "message": "Preparing download…", "repo_id": spec.repo_id}
        executor.submit(download_job, job_id, spec)
        return dict(jobs[job_id])


@app.get("/models/jobs/{job_id}")
def job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Unknown download job.")
    return jobs[job_id]


def load_model(request: ExtractRequest):
    global loaded_key, loaded_model
    if request.device not in devices():
        raise ValueError(f"Device {request.device} is not available. Select CPU or install a compatible GPU runtime.")
    path = checkpoint_path(request)
    import torch
    torch.set_num_threads(request.cpu_threads)
    key = (spec_key(request), request.device)
    if key == loaded_key and loaded_model is not None:
        return loaded_model
    loaded_model = None; loaded_key = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    # Only downloaded local safetensors/configs are used; no remote custom code.
    if request.adapter == "laya":
        import laya
        model = laya.load(str(path), device=request.device, backend="eager")
        if str(model.device) != request.device:
            raise ValueError(f"Laya fell back to {model.device}; requested {request.device}. Choose CPU explicitly or fix the GPU runtime.")
    else:
        from transformers import AutoModelForQuestionAnswering, AutoTokenizer, pipeline
        tokenizer = AutoTokenizer.from_pretrained(str(path), local_files_only=True, trust_remote_code=False)
        weights = AutoModelForQuestionAnswering.from_pretrained(str(path), local_files_only=True, trust_remote_code=False, use_safetensors=True)
        model = pipeline("question-answering", model=weights, tokenizer=tokenizer, device=torch.device(request.device))
    loaded_model, loaded_key = model, key
    return model


@app.post("/extract")
def extract(request: ExtractRequest):
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(409, "The model is busy. Only one inference request runs at a time.")
    try:
        model = load_model(request)
        fields = [field.model_dump() for field in request.fields]
        with warnings.catch_warnings(record=True) as runtime_warnings:
            if request.adapter == "laya":
                result = select_laya_values(model, request.text, fields, request.confidence_threshold, request.max_candidates, request.instructions)
            else:
                result = {"values": {}, "confidence": {}, "warnings": []}
                for field in fields:
                    answer = model(question=f"What is the {field['column']}? Labels: {field['terms']}", context=request.text,
                                   handle_impossible_answer=True, max_seq_len=384, doc_stride=128)
                    score = float(answer["score"])
                    value = str(answer["answer"])
                    # QA answers must be literal spans from the input.
                    result["values"][field["column"]] = value if score >= request.confidence_threshold and value in request.text else ""
                    result["confidence"][field["column"]] = score
                    if not result["values"][field["column"]]:
                        result["warnings"].append(f"{field['column']}: abstained (confidence {score:.2f})")
        if request.device != "cpu" and any("fall" in str(w.message).lower() and "cpu" in str(w.message).lower() for w in runtime_warnings):
            raise ValueError("The runtime used a CPU fallback. Choose CPU explicitly or fix the GPU memory/runtime.")
        return {**result, "device": request.device, "model": request.repo_id}
    except Exception as error:
        raise HTTPException(422, str(error)[:600]) from error
    finally:
        inference_lock.release()


if os.environ.get("INVOICE_UI_DIR"):
    # Registered last so API routes win. The desktop launcher authenticates static requests too.
    app.mount("/", StaticFiles(directory=os.environ["INVOICE_UI_DIR"], html=True), name="desktop-ui")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.server:app", host="127.0.0.1", port=8000, log_level="info")
