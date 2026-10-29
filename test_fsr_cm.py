"""Portable compiler correction recovery tests; no compiler or GPU execution."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from fsr_cm import PRE_HASH, correct_pre


class CompilerCorrection(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / (PRE_HASH + '_fixture.cmk')
        self.original = bytearray(500)
        self.original[:4] = b'CMK2'
        struct.pack_into('<4I', self.original, 168, 0xffffffff, 0, 0, 11)
        struct.pack_into('<11I', self.original, 280, *range(11))
        self.path.write_bytes(self.original)

    def test_legacy_partial_does_not_block_correction_or_get_removed(self):
        legacy = self.path.with_name(self.path.name + '.fsr-fixed')
        legacy.write_bytes(b'previous incomplete output; retain')
        self.assertTrue(correct_pre(self.path))
        self.assertEqual(legacy.read_bytes(), b'previous incomplete output; retain')
        after = self.path.read_bytes()
        self.assertEqual(struct.unpack_from('<3I', after, 168), (1, 2, 4))
        self.assertEqual(after[:168], self.original[:168])
        self.assertEqual(after[180:], self.original[180:])
        profile = json.loads(self.path.with_suffix('.cmk.fsr-profile.json').read_text())
        self.assertEqual(profile['profile'], 1)

    def test_failed_replacement_preserves_output_and_cleans_only_own_temporary(self):
        before = set(self.path.parent.iterdir())
        with patch.object(Path, 'replace', side_effect=OSError('injected replace failure')):
            with self.assertRaisesRegex(OSError, 'injected replace failure'):
                correct_pre(self.path)
        self.assertEqual(self.path.read_bytes(), self.original)
        self.assertEqual(set(self.path.parent.iterdir()), before)
        self.assertTrue(correct_pre(self.path), 'A failed correction must be retryable')

    def test_non_pre_output_is_unchanged(self):
        other = self.path.with_name('native-xess.cmk')
        other.write_bytes(b'other kernel')
        self.assertFalse(correct_pre(other))
        self.assertEqual(other.read_bytes(), b'other kernel')


if __name__ == '__main__':
    unittest.main()
