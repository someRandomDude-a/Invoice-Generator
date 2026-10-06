import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from . import server
from .test_extraction import FakeAgent


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root_patch = patch.object(server, "MODEL_ROOT", Path(self.temp.name))
        self.root_patch.start()
        self.client = TestClient(server.app)

    def tearDown(self):
        self.client.close(); self.root_patch.stop(); self.temp.cleanup()

    def test_health_is_local_and_never_downloads_weights(self):
        with patch("huggingface_hub.snapshot_download") as download:
            result = self.client.get("/health")
            self.assertEqual(result.status_code, 200)
            self.assertIn("cpu", result.json()["devices"])
            self.assertEqual(result.json()["default_model"], "convaiinnovations/laya")
            download.assert_not_called()

    def test_rejects_remote_origins_before_side_effects(self):
        result = self.client.post("/models/download", json={}, headers={"origin": "https://evil.example"})
        self.assertEqual(result.status_code, 403)

    def test_desktop_session_requires_its_secret(self):
        with patch.object(server, "SERVER_TOKEN", "session-secret"):
            self.assertEqual(self.client.get("/health").status_code, 401)
            self.assertEqual(self.client.get("/health", headers={"x-invoice-token": "wrong"}).status_code, 401)
            response = self.client.get("/health", headers={"x-invoice-token": "session-secret"})
            self.assertEqual(response.status_code, 200)
            self.assertIn("script-src 'self'", response.headers["content-security-policy"])

    def test_bundled_checkpoint_is_read_only_and_downloads_use_user_storage(self):
        with tempfile.TemporaryDirectory() as bundle:
            root = Path(bundle)
            checkpoint = root / "cache" / "snapshots" / "revision"
            checkpoint.mkdir(parents=True)
            spec = server.ModelSpec()
            (root / "registry.json").write_text(json.dumps({server.spec_key(spec): {**spec.model_dump(), "path": "cache/snapshots/revision"}}))
            with patch.object(server, "BUNDLED_MODEL_ROOT", root):
                self.assertEqual(server.checkpoint_path(spec), checkpoint.resolve())
                self.assertEqual(len(self.client.get("/models").json()["downloaded"]), 1)
                self.assertEqual(server.registry(), {})

    def test_rejects_urls_paths_and_invalid_device_settings(self):
        for repo in ("https://huggingface.co/x/model", "../model", "C:/model"):
            self.assertEqual(self.client.post("/models/download", json={"repo_id": repo}).status_code, 422)
        body = {"text": "Source", "fields": [{"column": "customer"}], "device": "remote"}
        self.assertEqual(self.client.post("/extract", json=body).status_code, 422)

    def test_offline_inference_requires_a_downloaded_model(self):
        body = {"text": "Customer: Alice", "fields": [{"column": "customer_name", "terms": "customer"}]}
        result = self.client.post("/extract", json=body)
        self.assertEqual(result.status_code, 422)
        self.assertIn("Download", result.json()["detail"])

    def test_unavailable_gpu_is_not_silently_changed_to_cpu(self):
        request = server.ExtractRequest(text="Source", fields=[server.ExtractionField(column="name")], device="cuda:0")
        with patch.object(server, "devices", return_value=["cpu"]):
            with self.assertRaisesRegex(ValueError, "not available"):
                server.load_model(request)

    def test_typed_extraction_returns_values_confidence_and_device(self):
        body = {"text": "Customer: Alice", "fields": [{"column": "customer_name", "terms": "customer"}], "device": "cpu"}
        with patch.object(server, "load_model", return_value=FakeAgent()):
            result = self.client.post("/extract", json=body)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["values"]["customer_name"], "Alice")
        self.assertEqual(result.json()["confidence"]["customer_name"], 0.9)
        self.assertEqual(result.json()["device"], "cpu")

    def test_request_size_limit(self):
        result = self.client.post("/extract", content="X" * 513000, headers={"content-type": "application/json"})
        self.assertEqual(result.status_code, 413)

    def test_explicit_download_registers_a_portable_cache_without_executable_weights(self):
        checkpoint = Path(self.temp.name) / "cache" / "snapshots" / "revision"
        checkpoint.mkdir(parents=True)
        (checkpoint / "model.safetensors").touch()
        (checkpoint / "rl_agent_config.json").write_text("{}")
        spec = server.ModelSpec()
        job_id = "mock-download"
        server.jobs[job_id] = {"status": "queued"}
        try:
            with patch("huggingface_hub.snapshot_download", return_value=str(checkpoint)) as download:
                server.download_job(job_id, spec)
            self.assertEqual(server.jobs[job_id]["status"], "complete")
            entry = server.registry()[server.spec_key(spec)]
            self.assertFalse(Path(entry["path"]).is_absolute())
            self.assertEqual((server.MODEL_ROOT / entry["path"]).resolve(), checkpoint.resolve())
            self.assertIn("*.bin", download.call_args.kwargs["ignore_patterns"])
            self.assertIn("*.py", download.call_args.kwargs["ignore_patterns"])
        finally:
            del server.jobs[job_id]


if __name__ == "__main__":
    unittest.main()
