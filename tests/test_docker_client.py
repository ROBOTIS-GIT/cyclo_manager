#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Author: Hyungyu Kim

"""Container listings tolerate missing image metadata without hiding daemon errors."""

from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock

from docker.errors import APIError, ImageNotFound
from docker.models.containers import Container

from cyclo_manager.docker_client import DockerClient


class ContainerListingTests(unittest.TestCase):
    def setUp(self):
        self.sdk = MagicMock()
        self.client = DockerClient.__new__(DockerClient)
        self.client.client = self.sdk

    def container(self, name, image_id, configured_image=None):
        return Container(attrs={
            'Id': name + '-id', 'Name': '/' + name, 'State': {'Status': 'running'},
            'Created': '2026-09-22T00:00:00Z', 'Image': 'sha256:' + image_id,
            'Config': {'Image': configured_image} if configured_image else {},
        }, client=self.sdk)

    def test_missing_image_does_not_break_other_containers_or_agent_listing(self):
        self.sdk.containers.list.return_value = [
            self.container('missing', 'old-image', 'robot:old'),
            self.container('healthy', 'new-image', 'robot:new'),
        ]
        self.sdk.images.get.side_effect = [
            ImageNotFound('No such image'), SimpleNamespace(tags=['robot:current']),
        ]
        rows = self.client.list_containers(all=True)
        self.assertEqual([r['name'] for r in rows], ['missing', 'healthy'])
        self.assertEqual([r['image'] for r in rows], ['robot:old', 'robot:current'])
        self.assertTrue(all(r['status'] == 'running' for r in rows))
        self.sdk.containers.list.assert_called_once_with(all=True)
        self.assertEqual(self.sdk.images.get.call_count, 2)

    def test_missing_configured_name_falls_back_to_container_image_id(self):
        self.sdk.containers.list.return_value = [self.container('robot', 'orphaned')]
        self.sdk.images.get.side_effect = ImageNotFound('No such image')
        self.assertEqual(self.client.list_containers()[0]['image'], 'sha256:orphaned')

    def test_untagged_image_uses_original_configured_name(self):
        self.sdk.containers.list.return_value = [self.container('robot', 'id', 'robot:old')]
        self.sdk.images.get.return_value = SimpleNamespace(tags=[])
        self.assertEqual(self.client.list_containers()[0]['image'], 'robot:old')
        self.sdk.images.get.assert_called_once()

    def test_image_inspection_api_error_also_uses_saved_name(self):
        self.sdk.containers.list.return_value = [self.container('robot', 'id', 'robot:old')]
        self.sdk.images.get.side_effect = APIError('Image inspection failed')
        self.assertEqual(self.client.list_containers()[0]['image'], 'robot:old')

    def test_container_listing_error_is_still_reported(self):
        self.sdk.containers.list.side_effect = APIError('Daemon unavailable')
        with self.assertLogs('cyclo_manager.docker_client', level='ERROR'):
            with self.assertRaises(APIError):
                self.client.list_containers()
        self.sdk.images.get.assert_not_called()

    def test_running_robot_lookup_uses_one_list_without_inspection(self):
        self.sdk.api.containers.return_value = [
            {'Id': 'one', 'Names': ['/custom-robot'], 'State': 'running'},
            {'Id': 'two', 'Names': ['/custom-robot-extra'], 'State': 'running'},
            {'Id': 'three', 'Names': ['/stopped'], 'State': 'exited'},
        ]
        self.assertEqual(self.client.running_robot_containers(('custom-robot', 'stopped')),
                         [{'id': 'one', 'name': 'custom-robot'}])
        self.sdk.api.containers.assert_called_once_with(
            all=False, filters={'name': ['custom-robot', 'stopped']})
        self.sdk.containers.list.assert_not_called()
        self.sdk.api.inspect_container.assert_not_called()
        self.sdk.images.get.assert_not_called()

    def test_no_configured_robots_skips_docker(self):
        self.assertEqual(self.client.running_robot_containers(()), [])
        self.sdk.api.containers.assert_not_called()


class RobotTypeTests(unittest.TestCase):
    def setUp(self):
        self.client = DockerClient.__new__(DockerClient)
        self.container = MagicMock()
        self.client.get_container = MagicMock(return_value=self.container)

    def test_reads_only_existing_type_file_and_normalizes_it(self):
        self.container.exec_run.return_value = SimpleNamespace(exit_code=0, output=b' OMY\n')
        self.assertEqual(self.client.get_robot_type('container-id'), 'omy')
        self.client.get_container.assert_called_once_with('container-id')
        self.container.exec_run.assert_called_once_with(['cat', '/run/robot_type'])

    def test_missing_type_file_is_not_guessed(self):
        self.container.exec_run.return_value = SimpleNamespace(exit_code=1, output=b'No such file')
        with self.assertRaisesRegex(ValueError, '/run/robot_type'):
            self.client.get_robot_type('container-id')
