"""Scheduler regressions using simulated buses; no serial devices are opened."""

import copy
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from cyclo_manager.diagnostics.profiles import parse_description
from cyclo_manager.diagnostics.registers import Catalog
from cyclo_manager.diagnostics.runner import Runner
from test_diagnostics import FakeBus, TABLE, system


class MonitoringTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / 'dynamixel.model').write_text('1020 xm430_w350.model\n')
        (root / 'xm430_w350.model').write_text(TABLE)
        self.catalog = Catalog(root)
        self.stop = threading.Event()
        self.expired = threading.Event()
        def expire():
            self.expired.set()
            self.stop.set()
        timer = threading.Timer(4, expire)
        timer.start()
        self.addCleanup(timer.cancel)

    def test_refreshes_start_before_all_devices_are_identified_without_starving_probes(self):
        clock = [0.0]
        bus = FakeBus()
        bus.models = {i: 1020 for i in range(1, 13)}
        original_read = bus.read
        def read(device_id, register):
            result = original_read(device_id, register)
            clock[0] += 0.02
            if device_id == 12 and register.name == 'Temperature Limit':
                self.stop.set()
            return result
        bus.read = read
        config = parse_description('<robot>' + system(devices=[('dxl', i) for i in bus.models]) + '</robot>')
        runner = Runner(config, self.catalog, self.stop, lambda _: None, lambda *_: bus)
        with patch('cyclo_manager.diagnostics.runner.time.monotonic', side_effect=lambda: clock[0]):
            runner.monitor_bus(0, runner.snapshot['buses'][0], 0.05)
        self.assertFalse(self.expired.is_set())
        self.assertEqual([call[1] for call in bus.calls if call[0] == 'ping'], list(range(1, 13)))
        before_last_probe = bus.calls[:bus.calls.index(('ping', 12))]
        self.assertGreater(before_last_probe.count(('read', 1, 'Present Temperature')), 1)
        # One probe's own measurement plus at most four refreshes before the next probe.
        reads_between_probes = 0
        for call in bus.calls:
            if call[0] == 'ping':
                self.assertLessEqual(reads_between_probes, 5)
                reads_between_probes = 0
            elif call[0] == 'read' and call[2] == 'Present Temperature':
                reads_between_probes += 1

    def test_missing_device_retries_later_while_other_devices_refresh_and_can_recover(self):
        clock = [0.0]
        bus = FakeBus()
        bus.models = {1: 1020}
        missing_probes = []
        original_ping, original_read = bus.ping, bus.read
        def ping(device_id):
            if device_id == 2:
                missing_probes.append((clock[0], bus.calls.count(('read', 1, 'Present Temperature'))))
                if len(missing_probes) == 2:
                    bus.models[2] = 1020
            return original_ping(device_id)
        def read(device_id, register):
            result = original_read(device_id, register)
            clock[0] += 0.25
            if device_id == 2 and register.name == 'Temperature Limit':
                self.stop.set()
            return result
        bus.ping, bus.read = ping, read
        config = parse_description('<robot>' + system(devices=[('dxl', 1), ('dxl', 2)]) + '</robot>')
        runner = Runner(config, self.catalog, self.stop, lambda _: None, lambda *_: bus)
        def advance_clock():
            clock[0] += 0.01
            return clock[0]
        with patch('cyclo_manager.diagnostics.runner.time.monotonic', side_effect=advance_clock):
            runner.monitor_bus(0, runner.snapshot['buses'][0], 0.01)
        self.assertFalse(self.expired.is_set())
        self.assertEqual(len(missing_probes), 2)
        self.assertGreaterEqual(missing_probes[1][0] - missing_probes[0][0], 5)
        self.assertGreater(missing_probes[1][1], missing_probes[0][1])
        recovered = runner.snapshot['buses'][0]['devices'][1]
        self.assertEqual(recovered['state'], 'online')
        self.assertEqual(recovered['fields']['Present Temperature']['value'], 35)

    def test_blocked_port_does_not_block_other_port_and_each_port_has_one_owner(self):
        slow_entered, release_slow = threading.Event(), threading.Event()
        ownership, calls, snapshots = {}, [], []
        buses = {}
        def factory(port, _baud):
            ownership[port] = threading.get_ident()
            bus = FakeBus()
            bus.models = {1: 1020}
            for name in ('discover', 'ping', 'read', 'close'):
                original = getattr(bus, name)
                def tracked(*args, name=name, original=original):
                    calls.append((port, name, threading.get_ident()))
                    if port == '/dev/slow' and name == 'discover':
                        slow_entered.set()
                        release_slow.wait(2)
                    return original(*args)
                setattr(bus, name, tracked)
            buses[port] = bus
            return bus
        completed_while_other_blocked = []
        emitting_threads = set()
        coordinator = threading.get_ident()
        def emit(snapshot):
            emitting_threads.add(threading.get_ident())
            snapshots.append(copy.deepcopy(snapshot))
            if snapshot['state'] == 'stopped':
                self.assertTrue(all(bus.closed for bus in buses.values()))
            fast = buses.get('/dev/fast')
            if fast and slow_entered.is_set() and fast.calls.count(('read', 1, 'Present Temperature')) >= 3:
                completed_while_other_blocked.append(not release_slow.is_set())
                self.stop.set()
                release_slow.set()
        config = parse_description('<robot>' + system('slow', '/dev/slow', [('dxl', 1)])
            + system('fast', '/dev/fast', [('dxl', 1)]) + '</robot>')
        original_config = copy.deepcopy(config)
        runner = Runner(config, self.catalog, self.stop, emit, factory)
        try:
            runner.run(watch=True, interval=0.01)
        finally:
            release_slow.set()
        self.assertFalse(self.expired.is_set())
        self.assertTrue(completed_while_other_blocked[0])
        self.assertEqual(emitting_threads, {coordinator})
        self.assertEqual(len(set(ownership.values())), 2)
        self.assertTrue(all(owner == ownership[port] for port, _method, owner in calls))
        self.assertNotIn(coordinator, ownership.values())
        self.assertEqual(config, original_config)
        self.assertEqual([s['sequence'] for s in snapshots], list(range(1, len(snapshots) + 1)))
        self.assertEqual(snapshots[0]['buses'][0]['state'], 'pending')
        self.assertEqual(runner.snapshot['state'], 'stopped')

    def test_stop_interrupts_long_idle_interval_and_closes_before_final_snapshot(self):
        bus = FakeBus()
        bus.models = {1: 1020}
        def emit(snapshot):
            if snapshot['buses'][0]['devices'][0]['fields'].get('Present Temperature'):
                self.stop.set()
            if snapshot['state'] == 'stopped':
                self.assertTrue(bus.closed)
        config = parse_description('<robot>' + system(devices=[('dxl', 1)]) + '</robot>')
        runner = Runner(config, self.catalog, self.stop, emit, lambda *_: bus)
        started = time.monotonic()
        runner.run(watch=True, interval=60)
        self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(bus.closed)

    def test_output_failure_stops_workers_and_releases_ports(self):
        bus = FakeBus()
        bus.models = {1: 1020}
        def emit(snapshot):
            if snapshot['buses'][0]['devices'][0]['fields'].get('Present Temperature'):
                raise BrokenPipeError('consumer closed')
        config = parse_description('<robot>' + system(devices=[('dxl', 1)]) + '</robot>')
        with self.assertRaises(BrokenPipeError):
            Runner(config, self.catalog, self.stop, emit, lambda *_: bus).run(watch=True, interval=60)
        self.assertTrue(self.stop.is_set())
        self.assertTrue(bus.closed)

    def test_close_failure_cannot_leave_port_and_measurements_healthy(self):
        bus = FakeBus()
        bus.models = {1: 1020}
        def close():
            bus.closed = True
            raise OSError('adapter disconnected on close')
        bus.close = close
        config = parse_description('<robot>' + system(devices=[('dxl', 1)]) + '</robot>')
        runner = Runner(config, self.catalog, self.stop, lambda _: None, lambda *_: bus)
        runner.run()
        failed_bus = runner.snapshot['buses'][0]
        self.assertEqual(failed_bus['state'], 'error')
        self.assertIn('adapter disconnected', failed_bus['error'])
        self.assertEqual(failed_bus['devices'][0]['state'], 'offline')
        self.assertEqual(failed_bus['devices'][0]['fields']['Present Temperature']['status'], 'read_error')


if __name__ == '__main__':
    unittest.main()
