"""Offline synthetic-file checks; never touches real Claude config or clipboard."""
import importlib.util
import json
import pathlib
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('setup', pathlib.Path(__file__).with_name('setup_claude.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = pathlib.Path(self.tmp.name) / 'Claude/config.json'
        self.fake_token = 'flw_pat_' + '0' * 64

    def run_setup(self, token=None):
        setup.install(self.config, '/synthetic/Flowboard with spaces/dist/index.js', '/synthetic/node',
                      self.fake_token if token is None else token)

    def test_create_private_config_without_backup(self):
        self.run_setup()
        data = json.loads(self.config.read_text())
        self.assertEqual(data['mcpServers']['flowboard-uat']['env']['FLOWBOARD_API_URL'], 'https://flowboard-app-uat.pages.dev')
        self.assertEqual(data['mcpServers']['flowboard-uat']['args'], ['/synthetic/Flowboard with spaces/dist/index.js'])
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o600)

    def test_preserve_other_settings_and_private_original_backup(self):
        self.config.parent.mkdir()
        old = b'{"preferences":{"theme":"dark"},"mcpServers":{"other":{"command":"retain"}}}\n'
        self.config.write_bytes(old)
        self.run_setup()
        data = json.loads(self.config.read_text())
        self.assertEqual(data['mcpServers']['other'], {'command': 'retain'})
        self.assertEqual(data['preferences'], {'theme': 'dark'})
        backup, = self.config.parent.glob('*.flowboard-backup-*')
        self.assertEqual(backup.read_bytes(), old)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)

    def test_bad_clipboard_does_not_create_configuration(self):
        for value in ['not a credential', '', self.fake_token + '\nunsafe']:
            with self.assertRaises(ValueError): self.run_setup(value)
        self.assertFalse(self.config.exists())

    def test_malformed_and_wrong_shape_config_never_overwritten(self):
        self.config.parent.mkdir()
        for content in ['{broken', '[]', '{"mcpServers":[]}']:
            self.config.write_text(content)
            with self.assertRaises(ValueError): self.run_setup()
            self.assertEqual(self.config.read_text(), content)

    def test_symlink_not_followed_or_overwritten(self):
        self.config.parent.mkdir()
        target = self.config.with_name('original.json')
        target.write_text('{"preserve":true}')
        self.config.symlink_to(target)
        with self.assertRaises(ValueError): self.run_setup()
        self.assertTrue(self.config.is_symlink())
        self.assertEqual(target.read_text(), '{"preserve":true}')


if __name__ == '__main__':
    unittest.main()
