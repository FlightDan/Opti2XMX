"""Dependency discovery is explicit and independent of development checkouts."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from manager import Manager


class DependencySelection(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.manager = Manager(self.home)

    def runtime_tree(self, package, sr):
        for name in ('igdext64.dll', 'lib/libvulkan_intel.so', 'tools/cm-compile.sh',
                     'tools/cmk_pack.py', 'igc/neo/bin/ocloc',
                     'igc/igc/local/lib/libigc.so', 'igc/igc/local/lib/libigdfcl.so'):
            target = package / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'fixture')
        sr.parent.mkdir(parents=True, exist_ok=True)
        sr.write_bytes(b'MZ fixture')

    def test_development_tree_is_not_an_implicit_dependency(self):
        legacy = self.home / 'oxp3-research/xess/xess-xmx-linux-20261005'
        sr = self.home / 'oxp3-research/xess-sr/payload/libxess.dll'
        self.runtime_tree(legacy, sr)
        with patch('manager.pe_version', return_value=(2, 0, 2, 68)):
            package, selected_sr, ready = self.manager.dependencies()
        self.assertEqual(package, self.manager.root / 'runtime')
        self.assertEqual(selected_sr, self.manager.root / 'sdk/libxess.dll')
        self.assertFalse(ready)

    def test_canonical_runtime_and_explicit_paths_remain_supported(self):
        canonical = self.manager.root / 'runtime'
        canonical_sr = self.manager.root / 'sdk/libxess.dll'
        self.runtime_tree(canonical, canonical_sr)
        with patch('manager.pe_version', return_value=(2, 0, 2, 68)):
            self.assertEqual(self.manager.dependencies(), (canonical, canonical_sr, True))
        explicit = self.home / 'chosen-runtime'
        explicit_sr = self.home / 'chosen-sdk/libxess.dll'
        self.runtime_tree(explicit, explicit_sr)
        (self.manager.root / 'runtime.json').write_text(json.dumps({
            'package': str(explicit), 'sr': str(explicit_sr)}))
        with patch('manager.pe_version', return_value=(2, 0, 2, 68)):
            self.assertEqual(self.manager.dependencies(), (explicit, explicit_sr, True))


if __name__ == '__main__':
    unittest.main()
