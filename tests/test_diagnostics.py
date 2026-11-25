"""Run with: python -m unittest discover -s tests -p 'test_diagnostics*.py'."""

import asyncio
import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from cyclo_manager.diagnostics.profiles import parse_description
from cyclo_manager.diagnostics.registers import Catalog
from cyclo_manager.diagnostics.runner import Runner
from cyclo_manager.diagnostics.dynamixel_bus import DeviceLock, DynamixelBus


TABLE = '''[unit info]
Present Input Voltage\t0.1\tV\tunsigned\t0.0
[control table]
Address Size Data Name
31 1 Temperature Limit
32 2 Max Voltage Limit
34 2 Min Voltage Limit
70 1 Hardware Error Status
144 2 Present Input Voltage
146 1 Present Temperature
'''
Y_TABLE = '''[unit info]
Present Input Voltage\t0.1\tV\tunsigned\t0.0
[control table]
56 1 Inverter Temperature Limit
57 1 Motor Temperature Limit
60 2 Max Voltage Limit
62 2 Min Voltage Limit
153 1 Error Code
568 2 Present Input Voltage
570 1 Present Inverter Temperature
571 1 Present Motor Temperature
'''


def system(name='arm', port='/dev/ttyTest', devices=None, baud=4000000):
    devices = devices or [('dxl', 1), ('controller', 200), ('virtual_dxl', 102)]
    gpios = ''.join(f'<gpio name="device{i}"><param name="type">{kind}</param>'
                   f'<param name="ID">{i}</param>'
                   + ('<param name="comm_id">200</param>' if kind.startswith('virtual') else '')
                   + '</gpio>' for kind, i in devices)
    return f'''<ros2_control name="{name}"><hardware>
      <plugin>dynamixel_hardware_interface/DynamixelHardware</plugin>
      <param name="port_name">{port}</param><param name="baud_rate">{baud}</param>
      </hardware>{gpios}</ros2_control>'''


class FakeBus:
    def __init__(self, *_):
        self.calls = []
        self.closed = False
        self.models = {1: 1020, 200: 602, 91: 601}
        self.values = {'Hardware Error Status': 0, 'Present Input Voltage': 120,
                       'Min Voltage Limit': 95, 'Max Voltage Limit': 160,
                       'Present Temperature': 35, 'Temperature Limit': 80}
        self.read_failure = None
        self.discovery_error = None

    def discover(self):
        self.calls.append(('discover',))
        return {i: [m, 1] for i, m in self.models.items()}, self.discovery_error

    def ping(self, i):
        self.calls.append(('ping', i))
        if i not in self.models:
            raise RuntimeError('No response')
        return self.models[i], 0

    def read(self, i, register):
        self.calls.append(('read', i, register.name))
        if self.read_failure == register.name:
            raise RuntimeError('Receive timeout')
        return self.values[register.name], 0

    def close(self):
        self.closed = True


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        directory = Path(self.temp.name)
        (directory / 'dynamixel.model').write_text('1020 xm430_w350.model\n4000 ym070_210_m001.model\n')
        (directory / 'xm430_w350.model').write_text(TABLE)
        (directory / 'ym070_210_m001.model').write_text(Y_TABLE)
        self.catalog = Catalog(directory)
        self.bus = FakeBus()

    def run_once(self, config=None):
        config = config or parse_description('<robot>' + system() + '</robot>')
        runner = Runner(config, self.catalog, threading.Event(), lambda s: None,
                        bus_factory=lambda *args: self.bus)
        code = runner.run()
        self.assertTrue(self.bus.closed)
        return code, runner.snapshot

    def test_multiple_buses_keep_same_id_separate_and_virtual_ids_are_not_pinged(self):
        self.bus.models[102] = 1020
        config = parse_description('<robot>' + system() + system('sensor', '/dev/ttyOther') + '</robot>')
        self.assertEqual(len(config['buses']), 2)
        _, snapshot = self.run_once(config)
        self.assertNotIn(('ping', 102), self.bus.calls)
        self.assertEqual(snapshot['summary']['expected'], 4)
        self.assertEqual(snapshot['summary']['excluded'], 2)

    def test_discovery_retains_extra_devices_and_partial_results(self):
        self.bus.discovery_error = 'Corrupt packet after valid responses'
        code, snapshot = self.run_once()
        # The unrecognized expected controller is no longer certified healthy
        # merely because it answered PING. Additional discoveries stay ID-only.
        self.assertEqual(code, 1)
        self.assertEqual(snapshot['summary']['additional'], 1)
        extra = snapshot['buses'][0]['devices'][-1]
        self.assertEqual(extra['id'], 91)
        self.assertFalse(extra['expected'])
        self.assertFalse(any(c[0] == 'read' and c[1] in {91, 200} for c in self.bus.calls))

    def test_missing_motor_is_unknown_not_zero_or_healthy(self):
        del self.bus.models[1]
        code, snapshot = self.run_once()
        motor = snapshot['buses'][0]['devices'][0]
        self.assertEqual(code, 1)
        self.assertEqual(motor['state'], 'offline')
        self.assertEqual(motor['fields'], {})
        self.assertEqual(self.bus.calls.count(('ping', 1)), 3)

    def test_unknown_model_is_identified_without_guessing_registers(self):
        self.bus.models[1] = 65500
        code, snapshot = self.run_once()
        self.assertEqual(code, 1)
        self.assertEqual(snapshot['buses'][0]['devices'][0]['model_number'], 65500)
        self.assertFalse(any(c[0] == 'read' for c in self.bus.calls))

    def test_expected_model_mismatch_stays_error_for_known_or_unknown_models(self):
        for actual in (1020, 65500):
            with self.subTest(actual=actual):
                self.bus = FakeBus()
                self.bus.models = {1: actual}
                config = parse_description('<robot>' + system(devices=[('dxl', 1)]) + '</robot>')
                config['buses'][0]['devices'][0]['expected_model'] = 4000
                _, snapshot = self.run_once(config)
                motor = snapshot['buses'][0]['devices'][0]
                self.assertEqual(motor['health'], 'error')
                self.assertEqual(motor['message'], 'Model number differs from configuration')
                self.assertEqual((motor['expected_model'], motor['model_number']), (4000, actual))
                self.assertFalse(any(c[0] == 'read' for c in self.bus.calls))

    def test_missing_model_file_keeps_ping_and_reports_unknown_or_mismatch(self):
        model_file = Path(self.temp.name) / 'xm430_w350.model'
        model_file.unlink()
        for expected, health in ((None, 'unknown'), (4000, 'error')):
            with self.subTest(expected=expected):
                self.bus = FakeBus()
                self.bus.models = {1: 1020}
                config = parse_description('<robot>' + system(devices=[('dxl', 1)]) + '</robot>')
                if expected is not None:
                    config['buses'][0]['devices'][0]['expected_model'] = expected
                _, snapshot = self.run_once(config)
                motor = snapshot['buses'][0]['devices'][0]
                self.assertEqual(motor['state'], 'online')
                self.assertEqual(motor['health'], health)
                self.assertIsNone(motor['model_name'])
                self.assertFalse(any(c[0] == 'read' for c in self.bus.calls))

    def test_voltage_unit_conversion_and_configured_limits(self):
        self.bus.values['Present Input Voltage'] = 170
        code, snapshot = self.run_once()
        field = snapshot['buses'][0]['devices'][0]['fields']['Present Input Voltage']
        self.assertEqual(code, 1)
        self.assertEqual(field['value'], 17)
        self.assertEqual(field['status'], 'error')

    def test_y_temperatures_and_warning_code_are_independent(self):
        self.bus.models[1] = 4000
        self.bus.values.update({'Error Code': 9, 'Present Inverter Temperature': 75,
                               'Inverter Temperature Limit': 80, 'Present Motor Temperature': 60,
                               'Motor Temperature Limit': 100})
        _, snapshot = self.run_once()
        fields = snapshot['buses'][0]['devices'][0]['fields']
        self.assertEqual(fields['Error Code']['status'], 'warning')
        self.assertEqual(fields['Present Inverter Temperature']['status'], 'warning')
        self.assertEqual(fields['Present Motor Temperature']['status'], 'ok')

    def test_hardware_error_bits_are_decoded(self):
        self.bus.values['Hardware Error Status'] = 0x24
        _, snapshot = self.run_once()
        field = snapshot['buses'][0]['devices'][0]['fields']['Hardware Error Status']
        self.assertIn('Overheating', field['message'])
        self.assertIn('Overload', field['message'])

    def test_failed_read_invalidates_cached_measurements(self):
        stop = threading.Event()
        timeout = threading.Timer(3, stop.set)
        timeout.start()
        self.addCleanup(timeout.cancel)
        snapshots = []
        def emit(snapshot):
            snapshots.append(copy.deepcopy(snapshot))
            if snapshot['state'] == 'running':
                device = snapshot['buses'][0]['devices'][0]
                if device['fields'].get('Present Temperature', {}).get('value') == 35:
                    self.bus.read_failure = 'Present Temperature'
                if device['state'] == 'offline':
                    stop.set()
        runner = Runner(parse_description('<robot>' + system() + '</robot>'), self.catalog, stop,
                        emit, bus_factory=lambda *args: self.bus)
        runner.run(watch=True, interval=0.001)
        fields = runner.snapshot['buses'][0]['devices'][0]['fields']
        self.assertEqual(fields['Present Temperature']['value'], 35)
        self.assertEqual(fields['Present Temperature']['status'], 'read_error')
        self.assertEqual(runner.snapshot['health'], 'unknown')

    def test_port_open_failure_is_reported_and_other_bus_continues(self):
        config = parse_description('<robot>' + system() + system('other', '/dev/ttyGood') + '</robot>')
        def factory(port, baud):
            if port == '/dev/ttyTest':
                raise PermissionError('Permission denied')
            return self.bus
        runner = Runner(config, self.catalog, threading.Event(), lambda _: None, factory)
        runner.run()
        self.assertEqual(runner.snapshot['buses'][0]['state'], 'error')
        self.assertEqual(runner.snapshot['buses'][1]['devices'][0]['state'], 'online')

    def test_same_bus_deduplicates_and_conflicting_configuration_fails(self):
        config = parse_description('<robot>' + system() + system('other') + '</robot>')
        self.assertEqual(len(config['buses']), 1)
        self.assertEqual(len(config['buses'][0]['devices']), 2)
        with self.assertRaisesRegex(ValueError, 'Conflicting baud'):
            parse_description('<robot>' + system() + system('other', baud=1000000) + '</robot>')
        with self.assertRaisesRegex(ValueError, 'Unknown system'):
            parse_description('<robot>' + system() + '</robot>', {'wrong': '/dev/null'})

    def test_baud_override_reaches_transport_and_preserves_default(self):
        xml = '<robot>' + system() + '</robot>'
        config = parse_description(xml, {'arm': '/dev/ttyOverride'}, {'arm': 1000000})
        calls = []
        def factory(port, baud):
            calls.append((port, baud))
            return self.bus
        Runner(config, self.catalog, threading.Event(), lambda _: None, factory).run()
        self.assertEqual(calls, [('/dev/ttyOverride', 1000000)])
        self.assertEqual(parse_description(xml)['buses'][0]['baud_rate'], 4000000)

    def test_baud_override_rejects_invalid_unknown_and_shared_port_conflicts(self):
        xml = '<robot>' + system() + '</robot>'
        for invalid in [0, -1, 1.5, True, '1000000']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                parse_description(xml, baud_rates={'arm': invalid})
        with self.assertRaisesRegex(ValueError, 'Unknown system'):
            parse_description(xml, baud_rates={'typo': 1000000})
        shared = '<robot>' + system() + system('other') + '</robot>'
        with self.assertRaisesRegex(ValueError, 'Conflicting baud'):
            parse_description(shared, baud_rates={'arm': 1000000})
        result = parse_description(shared, baud_rates={'arm': 1000000, 'other': 1000000})
        self.assertEqual(len(result['buses']), 1)
        self.assertEqual(result['buses'][0]['baud_rate'], 1000000)

    def test_cli_baud_override_is_forwarded_and_validated_before_resolving(self):
        from cyclo_manager.diagnostics.__main__ import main
        from contextlib import redirect_stdout, redirect_stderr
        from io import StringIO
        with patch('sys.argv', ['diagnostics', '--profile', 'w1', '--inspect', '--baud-rate', 'arm=1000000']), patch('cyclo_manager.diagnostics.__main__.resolve_profile', return_value={}) as resolve, redirect_stdout(StringIO()):
            self.assertEqual(main(), 0)
            resolve.assert_called_once_with('w1', {}, {'arm': 1000000})
        for args in [['arm=0'], ['arm=1.5'], ['arm=1', 'arm=2']]:
            argv = ['diagnostics', '--profile', 'w1', '--inspect']
            for arg in args:
                argv.extend(['--baud-rate', arg])
            with patch('sys.argv', argv), patch('cyclo_manager.diagnostics.__main__.resolve_profile') as resolve, redirect_stderr(StringIO()), self.assertRaises(SystemExit):
                main()
            resolve.assert_not_called()

    def test_cooperative_lock_rejects_duplicate_and_releases(self):
        first = DeviceLock('/dev/null')
        try:
            with self.assertRaises(RuntimeError):
                DeviceLock('/dev/null')
        finally:
            first.close()
        DeviceLock('/dev/null').close()

    def test_packet_alert_does_not_hide_telemetry_but_instruction_errors_fail(self):
        transport = DynamixelBus.__new__(DynamixelBus)
        class Packet:
            def getRxPacketError(self, error): return 'Instruction error'
        transport.packet = Packet()
        transport._check(0, 0x80)
        with self.assertRaisesRegex(RuntimeError, 'Instruction error'):
            transport._check(0, 0x84)


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_disconnect_does_not_stop_worker_and_duplicate_start_is_rejected(self):
        from cyclo_manager.agent.diagnostics_process import DiagnosticSessions
        store = DiagnosticSessions()
        script = ('import json,sys; print(json.dumps({"state":"running",'
                  '"health":"ok"}),flush=True); sys.stdin.read()')
        with patch('cyclo_manager.agent.diagnostics_process.worker_command', return_value=[sys.executable, '-u', '-c', script]) as command:
            session = await store.start('w1', {'arm': '/dev/ttyOverride'}, {'arm': 1000000})
            command.assert_called_once_with('--profile', 'w1', '--watch', '--format', 'ndjson', '--managed', '--port', 'arm=/dev/ttyOverride', '--baud-rate', 'arm=1000000')
            try:
                stream = store.stream(session['id'])
                await anext(stream)
                await stream.aclose()
                self.assertIsNone(store.process.returncode)
                with self.assertRaises(ValueError):
                    await store.start('w1', {})
            finally:
                result = await store.stop(session['id'])
            self.assertEqual(result['state'], 'stopped')
            self.assertIsNotNone(store.process.returncode)

    async def test_malformed_worker_output_becomes_failed_and_releases_process(self):
        from cyclo_manager.agent.diagnostics_process import DiagnosticSessions
        store = DiagnosticSessions()
        with patch('cyclo_manager.agent.diagnostics_process.worker_command', return_value=[sys.executable, '-u', '-c', 'print("bad json")']):
            await store.start('a1', {})
            await store.task
        self.assertEqual(store.current['state'], 'failed')
        self.assertIsNotNone(store.process.returncode)

    async def test_configuration_failure_preserves_error_without_invalid_snapshot(self):
        from cyclo_manager.agent.diagnostics_process import DiagnosticSessions
        store = DiagnosticSessions()
        failure = dict(state='failed', error='Robot description missing')
        script = f'import json,sys; print(json.dumps({failure!r})); sys.exit(2)'
        with patch('cyclo_manager.agent.diagnostics_process.worker_command', return_value=[sys.executable, '-u', '-c', script]):
            await store.start('a1', {})
            await store.task
        self.assertEqual(store.current['state'], 'failed')
        self.assertEqual(store.current['error'], 'Robot description missing')
        self.assertIsNone(store.current['snapshot'])
        self.assertEqual(store.process.returncode, 2)


if __name__ == '__main__':
    unittest.main()
