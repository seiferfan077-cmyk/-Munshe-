import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = pathlib.Path(__file__).parents[1] / "src" / "safe_extract.py"

class SafeExtractTests(unittest.TestCase):
    def run_extract(self, archive, destination):
        return subprocess.run([sys.executable, str(SCRIPT), str(archive), str(destination)], capture_output=True, text=True)

    def test_extracts_normal_project(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            archive = root / "ok.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("project/package.json", '{"dependencies":{"expo":"~52.0.0"}}')
            result = self.run_extract(archive, root / "out")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / "out/project/package.json").is_file())

    def test_rejects_parent_directory_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            archive = root / "bad.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("../../escaped.txt", "no")
            result = self.run_extract(archive, root / "out")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root.parent / "escaped.txt").exists())

    def test_rejects_symbolic_links(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            archive = root / "link.zip"
            link = zipfile.ZipInfo("project/link")
            link.create_system = 3
            link.external_attr = (0o120777 << 16)
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr(link, "../../outside")
            result = self.run_extract(archive, root / "out")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("روابط رمزية", result.stderr)

if __name__ == "__main__":
    unittest.main()
