"""Reject substituted archives before publishing a cache or invoking the extractor."""
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from manager import Manager
from opti import ARCHIVE_PINS, RELEASES, ASSETS, archive_files, archive_pin


class ArchiveIntegrity(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.manager = Manager(self.directory.name, types.SimpleNamespace(no_symlink_parents=lambda p: None))
        self.trusted = b'7z\xbc\xaf\x27\x1c trusted release'
        self.pin = dict(size_bytes=len(self.trusted), sha256=hashlib.sha256(self.trusted).hexdigest())

    def cache(self, version):
        tag, filename, _ = RELEASES[version]
        folder = self.manager.root / 'downloads' / tag
        folder.mkdir(parents=True)
        return folder / filename

    def response(self, data):
        value = io.BytesIO(data); value.headers = {}
        return value

    def test_all_stable_releases_have_independent_original_archive_pins(self):
        self.assertEqual(set(ARCHIVE_PINS), {'0.9.4', '0.7.9'})
        self.assertEqual(ARCHIVE_PINS['0.9.4']['size_bytes'], 55016448)
        self.assertEqual(ARCHIVE_PINS['0.7.9']['size_bytes'], 32581791)
        self.assertEqual(ARCHIVE_PINS['0.9.4']['sha256'], '575cb4df866116093df75af607e37fd70e10f5163e0f23fd5c804142e80ef0ad')
        self.assertEqual(ARCHIVE_PINS['0.7.9']['sha256'], '70103bf3746140d368179773edeafb02ec9718efa130276b8da833c3156fbfe3')

    def test_substituted_download_never_becomes_cache_or_extractor_input(self):
        substituted = self.trusted[:-1] + b'X'
        for version in ('0.9.4', '0.7.9'):
            with self.subTest(version=version), patch('opti.archive_pin', return_value=self.pin), \
                    patch('opti.urllib.request.urlopen', return_value=self.response(substituted)), \
                    patch('opti.subprocess.run', side_effect=AssertionError('Untrusted archive extracted')):
                with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
                    self.manager.opti_package(version, 'ghproxy')
            self.assertFalse(list(self.manager.root.rglob('*.7z')))
            self.assertFalse(list(self.manager.root.rglob('*.part')))

    def test_corrupt_prepared_local_cache_cannot_bypass_integrity(self):
        for version in ('0.9.4', '0.7.9'):
            archive = self.cache(version)
            archive.write_bytes(self.trusted[:-1] + b'X')
            payload = archive.parent / 'payload'; payload.mkdir()
            (payload / 'ready.json').write_text('{}')
            for name in ('OptiScaler.dll', 'OptiScaler.ini', 'libxess.dll'):
                (payload / name).write_bytes(b'MZ fake')
            with self.subTest(version=version), patch('opti.archive_pin', return_value=self.pin), \
                    patch('opti.urllib.request.urlopen', side_effect=AssertionError('Local cache used network')), \
                    patch('opti.subprocess.run', side_effect=AssertionError('Corrupt cache extracted')):
                with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
                    self.manager.opti_package(version, 'local')

    def test_invalid_download_cannot_replace_an_existing_legacy_partial(self):
        archive = self.cache('0.9.4')
        legacy = archive.with_suffix('.part'); legacy.write_bytes(b'existing unrelated file')
        with patch('opti.archive_pin', return_value=self.pin), \
                patch('opti.urllib.request.urlopen', return_value=self.response(self.trusted[:-1] + b'X')):
            with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
                self.manager.opti_package('0.9.4', 'github')
        self.assertEqual(legacy.read_bytes(), b'existing unrelated file')
        self.assertEqual(list(archive.parent.glob('*.part')), [legacy])

    def test_all_bundled_payload_pins_match_the_archive_trust_roots(self):
        for version in RELEASES:
            with self.subTest(version=version):
                files = archive_files(version, archive_pin(version))
                self.assertIn('OptiScaler.dll', files)
                self.assertIn('OptiScaler.ini', files)

    def prepared_payload(self):
        archive = self.cache('0.9.4'); archive.write_bytes(self.trusted)
        payload = archive.parent / 'payload'; payload.mkdir()
        data = {name: b'[Upscalers]\nDx12Upscaler=xess\n' if name.endswith('.ini') else b'MZ verified ' + name.encode()
                for name in ('OptiScaler.dll', 'OptiScaler.ini', 'libxess.dll', 'libxell.dll')}
        for name, value in data.items(): (payload / name).write_bytes(value)
        (payload / 'ready.json').write_text('{}')
        files = {name: dict(size_bytes=len(value), sha256=hashlib.sha256(value).hexdigest())
                 for name, value in data.items()}
        return payload, data, files

    def test_modified_required_or_optional_payload_is_repaired_without_network(self):
        payload, data, files = self.prepared_payload()
        def unpack(arguments, **kwargs):
            return types.SimpleNamespace(returncode=0, stdout=data[arguments[-1]])
        with patch('opti.archive_pin', return_value=self.pin), patch('opti.archive_files', return_value=files), \
                patch('opti.urllib.request.urlopen', side_effect=AssertionError('Local source used network')):
            for name in ('OptiScaler.dll', 'OptiScaler.ini', 'libxell.dll'):
                with self.subTest(name=name):
                    (payload / name).write_bytes(b'corrupt payload')
                    with patch('opti.subprocess.run', side_effect=unpack) as extraction:
                        self.assertEqual(self.manager.opti_package('0.9.4', 'local'), payload)
                        self.assertEqual(extraction.call_count, len(files))
                    for path, value in data.items(): self.assertEqual((payload / path).read_bytes(), value)
            with patch('opti.subprocess.run', side_effect=AssertionError('Verified warm payload re-extracted')):
                self.assertEqual(self.manager.opti_package('0.9.4', 'local'), payload)

    def test_stale_known_optional_payload_is_removed_and_unrelated_file_retained(self):
        payload, data, files = self.prepared_payload()
        stale = next(name for name in ASSETS if name not in files)
        stale_path = payload / stale
        stale_path.parent.mkdir(parents=True, exist_ok=True); stale_path.write_bytes(b'MZ stale')
        unrelated = payload / 'user-notes.txt'; unrelated.write_bytes(b'keep me')
        with patch('opti.archive_pin', return_value=self.pin), patch('opti.archive_files', return_value=files), \
                patch('opti.urllib.request.urlopen', side_effect=AssertionError('Cache used network')), \
                patch('opti.subprocess.run', side_effect=lambda args, **kw: types.SimpleNamespace(returncode=0, stdout=data[args[-1]])):
            self.manager.opti_package('0.9.4', 'local')
        self.assertFalse(stale_path.exists())
        self.assertEqual(unrelated.read_bytes(), b'keep me')

    def test_invalid_extractor_output_cannot_replace_a_payload_file(self):
        payload, data, files = self.prepared_payload()
        target = payload / 'OptiScaler.dll'; target.write_bytes(b'MZ original cached data')
        with patch('opti.archive_pin', return_value=self.pin), patch('opti.archive_files', return_value=files), \
                patch('opti.subprocess.run', return_value=types.SimpleNamespace(returncode=0, stdout=b'MZ substituted')):
            with self.assertRaisesRegex(RuntimeError, '校验失败'):
                self.manager.opti_package('0.9.4', 'local')
        self.assertEqual(target.read_bytes(), b'MZ original cached data')
        self.assertFalse(list(payload.glob('.opti-*')))

    def test_failed_atomic_cache_replacement_preserves_old_bytes_and_cleans_temporary(self):
        payload, data, files = self.prepared_payload()
        target = payload / 'OptiScaler.dll'; target.write_bytes(b'MZ old bytes')
        with patch('opti.archive_pin', return_value=self.pin), patch('opti.archive_files', return_value=files), \
                patch('opti.subprocess.run', side_effect=lambda args, **kw: types.SimpleNamespace(returncode=0, stdout=data[args[-1]])), \
                patch.object(Path, 'replace', side_effect=OSError('injected replace failure')):
            with self.assertRaisesRegex(OSError, 'injected replace failure'):
                self.manager.opti_package('0.9.4', 'local')
        self.assertEqual(target.read_bytes(), b'MZ old bytes')
        self.assertFalse(list(payload.glob('.opti-*')))

    @unittest.skipIf(sys.platform == 'win32', 'Linux symlink safety')
    def test_required_and_absent_optional_symlinks_are_never_followed_or_removed(self):
        payload, data, files = self.prepared_payload()
        outside = payload.parent / 'user-file'; outside.write_bytes(b'preserve')
        optional = next(name for name in ASSETS if name not in files)
        with patch('opti.archive_pin', return_value=self.pin), patch('opti.archive_files', return_value=files), \
                patch('opti.subprocess.run', side_effect=AssertionError('Symlink payload extracted')):
            for name in ('OptiScaler.dll', optional):
                with self.subTest(name=name):
                    target = payload / name
                    if target.exists(): target.unlink()
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.symlink_to(outside)
                    with self.assertRaisesRegex(RuntimeError, '普通文件'):
                        self.manager.opti_package('0.9.4', 'local')
                    self.assertTrue(target.is_symlink())
                    self.assertEqual(outside.read_bytes(), b'preserve')
                    target.unlink()


if __name__ == '__main__':
    unittest.main()
