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

"""Regression tests for continuous CPU sampling and shared API summaries."""

from types import SimpleNamespace
import threading
import time
import unittest
from unittest.mock import Mock, call, patch

from cyclo_host_agent.cpu_usage import CpuUsageSampler
from cyclo_host_agent.main import app, lifespan
from cyclo_host_agent.routers import system_stats
from fastapi import HTTPException


class CpuUsageTests(unittest.TestCase):
    """Check measurement windows, startup behavior, and sampling ownership."""

    def test_rolling_window_discards_prime_and_oldest_sample(self):
        """Average available samples at startup and only the last three afterward."""
        sampler = CpuUsageSampler()
        observed = []

        def next_interval(interval):
            self.assertEqual(interval, 1.0)
            observed.append(sampler.average())
            if len(observed) == 5:
                sampler._stop.set()
                return True
            return False

        with patch('cyclo_host_agent.cpu_usage.psutil.cpu_percent',
                   side_effect=[99.0, 10.0, 20.0, 60.0, 90.0]) as cpu:
            with patch.object(sampler._stop, 'wait', side_effect=next_interval):
                sampler._run()
        self.assertEqual(observed, [None, 10.0, 15.0, 30.0, 56.7])
        self.assertEqual(cpu.call_args_list, [call(interval=None)] * 5)

    def test_background_sampling_is_independent_of_readers(self):
        """Prime and sample on one thread, even without API requests."""
        sampler = CpuUsageSampler(interval=0.01)
        thread_ids = []

        def cpu_percent(interval):
            thread_ids.append(threading.get_ident())
            return 30.0

        with patch('cyclo_host_agent.cpu_usage.psutil.cpu_percent',
                   side_effect=cpu_percent):
            sampler.start()
            worker = sampler._thread
            try:
                sampler.start()
                self.assertIs(sampler._thread, worker)
                deadline = time.monotonic() + 2
                while sampler.average() is None and time.monotonic() < deadline:
                    time.sleep(0.005)
                self.assertEqual(sampler.average(), 30.0)
            finally:
                sampler.stop()
            self.assertFalse(worker.is_alive())
            count = len(thread_ids)
            for _ in range(50):
                self.assertEqual(sampler.average(), 30.0)
            self.assertEqual(len(thread_ids), count)
            self.assertGreaterEqual(count, 2)
            self.assertEqual(len(set(thread_ids)), 1)
            self.assertNotEqual(thread_ids[0], threading.get_ident())
            sampler._interval = 1.0
            sampler.start()
            try:
                self.assertIsNone(sampler.average())
            finally:
                sampler.stop()

    def test_warmup_does_not_report_a_fake_zero(self):
        """Return a retryable response before a complete sample exists."""
        with patch.object(system_stats, 'cpu_sampler', CpuUsageSampler()):
            with self.assertRaises(HTTPException) as result:
                system_stats.get_system_stats()
        self.assertEqual(result.exception.status_code, 503)

    def test_sampling_failure_clears_history_and_primes_again(self):
        """Do not keep old CPU values when a measurement fails."""
        sampler = CpuUsageSampler()
        observed = []

        def next_interval(interval):
            observed.append(sampler.average())
            if len(observed) == 5:
                sampler._stop.set()
                return True
            return False

        with patch('cyclo_host_agent.cpu_usage.psutil.cpu_percent',
                   side_effect=[99.0, 10.0, OSError('CPU read failed'), 99.0, 60.0]), \
                patch('cyclo_host_agent.cpu_usage.logger.exception') as log, \
                patch.object(sampler._stop, 'wait', side_effect=next_interval):
            sampler._run()
        self.assertEqual(observed, [None, 10.0, None, None, 60.0])
        log.assert_called_once()

    def test_status_and_process_summary_read_the_same_average(self):
        """Total CPU is shared while process rows retain their own measurements."""
        process = Mock()
        process.as_dict.return_value = {
            'pid': 42, 'username': 'robot', 'cpu_percent': 80.0,
            'memory_percent': 1.0, 'memory_info': SimpleNamespace(rss=1024),
            'cmdline': ['robot-node'], 'name': 'robot-node',
        }
        with patch.object(system_stats.cpu_sampler, 'average', return_value=12.3), \
                patch.object(system_stats.psutil, 'cpu_percent',
                             side_effect=AssertionError('API must not resample total CPU')), \
                patch.object(system_stats.psutil, 'virtual_memory',
                             return_value=SimpleNamespace(used=1024**3, total=8*1024**3)), \
                patch.object(system_stats.psutil, 'disk_usage',
                             return_value=SimpleNamespace(used=10*1024**3, total=100*1024**3)), \
                patch.object(system_stats, '_extra_storage_disk_usage', return_value=(None, None)), \
                patch.object(system_stats, '_temperature', return_value=None), \
                patch.object(system_stats.psutil, 'process_iter', return_value=[process]), \
                patch.object(system_stats.psutil, 'cpu_count', return_value=4), \
                patch.object(system_stats.time, 'sleep') as sleep:
            status = system_stats.get_system_stats()
            processes = system_stats._sample_processes()
        self.assertEqual(status.cpu_percent, 12.3)
        self.assertEqual(processes.cpu_percent, status.cpu_percent)
        self.assertEqual(processes.processes[0].cpu_percent, 20.0)
        process.cpu_percent.assert_called_once_with(None)
        sleep.assert_called_once_with(0.2)


class CpuLifespanTests(unittest.IsolatedAsyncioTestCase):
    """Check sampler cleanup when the API exits."""

    async def test_lifespan_stops_sampler_even_on_failure(self):
        """Stop the background worker on both normal and exceptional shutdown."""
        sampler = Mock()
        with patch.object(system_stats, 'cpu_sampler', sampler):
            async with lifespan(app):
                sampler.start.assert_called_once_with()
                sampler.stop.assert_not_called()
            sampler.stop.assert_called_once_with()
            sampler.reset_mock()
            with self.assertRaises(RuntimeError):
                async with lifespan(app):
                    raise RuntimeError('shutdown')
            sampler.start.assert_called_once_with()
            sampler.stop.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
