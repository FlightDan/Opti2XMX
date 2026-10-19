"""Frozen Decky runtime trust-store regression and fail-closed checks."""
import ssl
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from manager import Manager
from runtime_setup import download_ssl_context


class DownloadTLS(unittest.TestCase):
    def test_linux_uses_system_bundle_with_verification(self):
        real_create = ssl.create_default_context
        calls = []
        def create(**kwargs):
            calls.append(kwargs)
            return real_create()
        with patch('runtime_setup.platform.system', return_value='Linux'), \
                patch.object(Path, 'is_file', lambda p: str(p).replace('\\', '/') == '/etc/ssl/cert.pem'), \
                patch('runtime_setup.ssl.create_default_context', side_effect=create):
            context = download_ssl_context()
        self.assertEqual(calls, [{'cafile': '/etc/ssl/cert.pem'}])
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_missing_primary_bundle_uses_other_system_bundle(self):
        with patch('runtime_setup.platform.system', return_value='Linux'), \
                patch.object(Path, 'is_file', lambda p: str(p).replace('\\', '/') == '/etc/ssl/certs/ca-certificates.crt'), \
                patch('runtime_setup.ssl.create_default_context') as create:
            download_ssl_context()
        create.assert_called_once_with(cafile='/etc/ssl/certs/ca-certificates.crt')

    def test_missing_bundles_retains_verified_default(self):
        with patch('runtime_setup.platform.system', return_value='Linux'), \
                patch.object(Path, 'is_file', return_value=False):
            context = download_ssl_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_invalid_bundle_fails_without_unverified_retry(self):
        with patch('runtime_setup.platform.system', return_value='Linux'), \
                patch.object(Path, 'is_file', return_value=True), \
                patch('runtime_setup.ssl.create_default_context', side_effect=ssl.SSLError('invalid CA')) as create:
            with self.assertRaises(ssl.SSLError):
                download_ssl_context()
        create.assert_called_once_with(cafile='/etc/ssl/cert.pem')

    def test_invalid_server_certificate_does_not_cache_or_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            manager = Manager(folder, types.SimpleNamespace(no_symlink_parents=lambda p: None))
            with patch('opti.urllib.request.urlopen', side_effect=ssl.SSLCertVerificationError('untrusted')) as request:
                with self.assertRaises(ssl.SSLCertVerificationError):
                    manager.opti_package('0.9.4', 'github')
            self.assertEqual(request.call_count, 1)
            context = request.call_args.kwargs['context']
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
            self.assertFalse(list(Path(folder).rglob('*.7z')))
            self.assertFalse(list(Path(folder).rglob('*.part')))
            self.assertEqual(manager.progress.snapshot()['phase'], 'failed')


if __name__ == '__main__':
    unittest.main()
