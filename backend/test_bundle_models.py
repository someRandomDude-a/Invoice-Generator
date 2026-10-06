import json
import tempfile
import unittest
from pathlib import Path
from .bundle_models import materialize
from .server import ModelSpec, spec_key


class BundleTests(unittest.TestCase):
    def test_release_registry_is_relative_and_weights_are_regular_files(self):
        with tempfile.TemporaryDirectory() as temp:
            snapshot = Path(temp) / "snapshot"
            snapshot.mkdir()
            (snapshot / "model.safetensors").write_bytes(b"weights")
            (snapshot / "rl_agent_config.json").write_text("{}")
            output = Path(temp) / "bundle"
            spec = ModelSpec()
            materialize(snapshot, output, spec)
            entry = json.loads((output / "registry.json").read_text())[spec_key(spec)]
            self.assertFalse(Path(entry["path"]).is_absolute())
            self.assertEqual((output / entry["path"] / "model.safetensors").read_bytes(), b"weights")
            self.assertFalse((output / entry["path"] / "model.safetensors").is_symlink())

    def test_executable_checkpoint_artifacts_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            snapshot = Path(temp) / "snapshot"
            snapshot.mkdir()
            (snapshot / "malicious.py").touch()
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                materialize(snapshot, Path(temp) / "bundle", ModelSpec())


if __name__ == "__main__":
    unittest.main()
