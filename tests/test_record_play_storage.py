#!/usr/bin/env python3
# Copyright 2026 ROBOTIS CO., LTD.
# Licensed under the Apache License, Version 2.0.
# Author: Hyungyu Kim

"""Exercise recording deletion only inside temporary filesystem fixtures."""

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cyclo_manager.record_play.bags import BagStore, RecordingNotFoundError


class RecordingDeletionStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = BagStore(self.root / 'recordings')
        self.recording_id, self.path = self.store.create()
        self.store.save(self.recording_id, {'id': self.recording_id, 'created_at': '2026-09-23'})
        (self.path / 'bag').mkdir()
        (self.path / 'bag' / 'recording.mcap').write_bytes(b'fixture bag')

    def test_delete_removes_bag_metadata_and_directory_but_keeps_other_recordings(self):
        other_id, other_path = self.store.create()
        self.store.save(other_id, {'id': other_id, 'created_at': '2026-09-23'})
        self.store.delete(self.recording_id)
        self.assertFalse(self.path.exists())
        self.assertTrue((other_path / 'recording.json').exists())
        self.assertEqual([item['id'] for item in self.store.list()], [other_id])

    def test_missing_or_unfinished_recording_is_not_deleted(self):
        with self.assertRaises(RecordingNotFoundError):
            self.store.delete('0' * 32)
        metadata = self.path / 'recording.json'
        metadata.unlink()
        for content in (None, '{invalid json'):
            with self.subTest(content=content):
                if content is not None:
                    metadata.write_text(content)
                with self.assertRaises(RecordingNotFoundError):
                    self.store.delete(self.recording_id)
                self.assertTrue((self.path / 'bag' / 'recording.mcap').exists())

    def test_invalid_ids_and_symlinked_recording_cannot_delete_outside_storage(self):
        outside = self.root / 'outside'
        outside.mkdir()
        marker = outside / 'recording.json'
        marker.write_text('{}')
        for recording_id in ('../outside', 'not-an-id', 'A' * 32):
            with self.subTest(recording_id=recording_id), self.assertRaises(ValueError):
                self.store.delete(recording_id)
        alias = 'a' * 32
        (self.store.root / alias).symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.store.delete(alias)
        self.assertTrue(marker.exists())

    def test_nested_symlink_is_removed_without_following_its_target(self):
        outside = self.root / 'outside'
        outside.mkdir()
        marker = outside / 'keep.mcap'
        marker.write_bytes(b'keep')
        (self.path / 'linked-bag').symlink_to(outside, target_is_directory=True)
        self.store.delete(self.recording_id)
        self.assertFalse(self.path.exists())
        self.assertEqual(marker.read_bytes(), b'keep')

    def test_storage_errors_are_not_reclassified_as_missing_recordings(self):
        with patch('cyclo_manager.record_play.bags.shutil.rmtree',
                   side_effect=PermissionError('permission denied')):
            with self.assertRaises(PermissionError):
                self.store.delete(self.recording_id)
        with patch.object(Path, 'read_text', side_effect=PermissionError('permission denied')):
            with self.assertRaises(PermissionError):
                self.store.delete(self.recording_id)
        self.assertTrue((self.path / 'recording.json').exists())


if __name__ == '__main__':
    unittest.main()
