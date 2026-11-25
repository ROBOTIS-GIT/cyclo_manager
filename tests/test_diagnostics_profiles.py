"""Profile discovery must check explicit dependencies without opening hardware."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cyclo_manager.diagnostics.profiles import PROFILES, list_profiles, resolve_profile


class ProfileTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for profile in PROFILES.values():
            path = self.root / 'urdf' / profile.folder / f'{profile.stem}.urdf.xacro'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()

    def test_missing_hand_package_only_disables_hand_profiles(self):
        calls = []
        def share(name):
            calls.append(name)
            if name == 'robotis_hand_description':
                raise LookupError('not found')
            return self.root
        with patch('cyclo_manager.diagnostics.profiles.package_share', side_effect=share):
            profiles = {p['id']: p for p in list_profiles()}
        for name in ('sh5', 'bh5'):
            self.assertFalse(profiles[name]['available'])
            self.assertIn('robotis_hand_description', profiles[name]['reason'])
            self.assertEqual(profiles[name]['label'], name.upper())
        self.assertTrue(profiles['w2']['available'])
        self.assertEqual(calls.count('robotis_hand_description'), 2)
        self.assertTrue(all('partial' not in p for p in profiles.values()))

    def test_hand_profiles_are_available_when_packages_exist(self):
        with patch('cyclo_manager.diagnostics.profiles.package_share', return_value=self.root):
            profiles = {p['id']: p for p in list_profiles()}
        self.assertTrue(profiles['sh5']['available'])
        self.assertTrue(profiles['bh5']['available'])
        self.assertIsNone(profiles['sh5']['reason'])

    def test_missing_xacro_is_reported(self):
        profile = PROFILES['w2']
        (self.root / 'urdf' / profile.folder / f'{profile.stem}.urdf.xacro').unlink()
        with patch('cyclo_manager.diagnostics.profiles.package_share', return_value=self.root):
            profiles = {p['id']: p for p in list_profiles()}
        self.assertFalse(profiles['w2']['available'])
        self.assertIn('w2_follower.urdf.xacro', profiles['w2']['reason'])
        self.assertTrue(profiles['w1']['available'])

    def test_resolved_profile_has_no_partial_and_keeps_label(self):
        class Document:
            def toxml(self):
                return '<robot/>'
        class Xacro:
            @staticmethod
            def process_file(path, mappings):
                self.assertTrue(path.endswith('ffw_sh5_follower.urdf.xacro'))
                self.assertEqual(mappings['model'], 'ffw_sh5_rev1_follower')
                return Document()
        with patch('cyclo_manager.diagnostics.profiles.package_share', return_value=self.root), \
             patch('cyclo_manager.diagnostics.profiles.parse_description', return_value={'buses': []}), \
             patch.dict('sys.modules', {'xacro': Xacro}):
            result = resolve_profile('sh5')
        self.assertEqual(result['label'], 'SH5')
        self.assertNotIn('partial', result)


if __name__ == '__main__':
    unittest.main()
