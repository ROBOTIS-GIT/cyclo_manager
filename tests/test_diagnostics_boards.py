"""Board acquisition contract: known layouts, raw states, freshness, no writes."""
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from cyclo_manager.diagnostics.boards import board_registers, load_board_config
from cyclo_manager.diagnostics.profiles import parse_description
from cyclo_manager.diagnostics.registers import Catalog
from cyclo_manager.diagnostics.runner import Runner
from test_diagnostics import FakeBus, system

COMMON = '5 1 Firmware_Version_Major\n6 1 Firmware_Version_Minor\n12 4 Error_Code\n24 4 Millis\n'
RCU = '''28 4 Sec_Since_Power_On
32 4 Sec_Since_Reset
40 1 Estop_Input
41 1 Remote_Connected
42 1 System_State
43 1 Board_Temperature
50 1 Host_Connection
100 1 Motor1_Connection_Status
101 1 Motor1_Connection_Status
102 1 Motor1_Connection_Status
104 1 Swerve_DXL1_Connection_Status
105 1 Swerve_DXL2_Connection_Status
106 1 Swerve_DXL3_Connection_Status
17 1 Operation_Command
61 1 Orin_Power_Control
'''
IMU = '''32 2 IMU ACC SCALE
34 2 IMU GYRO SCALE
36 4 IMU TIMESTAMP
40 2 IMU ACC X
42 2 IMU ACC Y
44 2 IMU ACC Z
46 2 IMU GYRO X
48 2 IMU GYRO Y
50 2 IMU GYRO Z
'''


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        (self.directory / 'dynamixel.model').write_text('602 ffw_g10_rcu.model\n537 ffw_g40_imu.model\n')
        for name, extra in [('ffw_g10_rcu', RCU), ('ffw_g40_imu', IMU)]:
            (self.directory / f'{name}.model').write_text('[control table]\n' + COMMON + extra)
        self.catalog = Catalog(self.directory)
        self.bus = FakeBus()
        self.bus.models = {200: 602, 91: 602}
        self.bus.values = {name: 0 for name in ['Firmware_Version_Major', 'Firmware_Version_Minor', 'Error_Code', 'Millis',
            'Sec_Since_Power_On', 'Sec_Since_Reset', 'Estop_Input', 'Remote_Connected', 'System_State', 'Board_Temperature',
            'Host_Connection', 'Motor_Connection_Status@100', 'Motor_Connection_Status@101', 'Motor_Connection_Status@102',
            'Swerve_DXL1_Connection_Status', 'Swerve_DXL2_Connection_Status', 'Swerve_DXL3_Connection_Status',
            'IMU ACC SCALE', 'IMU GYRO SCALE', 'IMU TIMESTAMP', 'IMU ACC X', 'IMU ACC Y', 'IMU ACC Z', 'IMU GYRO X', 'IMU GYRO Y', 'IMU GYRO Z']}
        self.bus.values.update(Firmware_Version_Major=1, Firmware_Version_Minor=2, Board_Temperature=40)

    def runner(self, model=602):
        self.bus.models[200] = model
        config = parse_description('<robot>' + system(devices=[('controller', 200)]) + '</robot>')
        return Runner(config, self.catalog, threading.Event(), lambda _: None, bus_factory=lambda *_: self.bus)

    def test_board_configuration_is_valid_and_preserves_model_associations(self):
        path = Path(__file__).resolve().parents[1] / 'cyclo_manager/diagnostics/boards.yaml'
        common, models, extras, common_usage = load_board_config(path)
        self.assertEqual(models, {536: 'sensorxel_joy', 600: 'sensorxel_joy',
                                  537: 'ffw_g40_imu', 601: 'ffw_g10_led', 602: 'ffw_g10_rcu',
                                  260: 'hx5_d20_rr', 261: 'hx5_d20_rl'})
        self.assertFalse(common_usage['hx5_d20_rl'])
        self.assertIn('Error_Code', common)
        self.assertIn('IMU TIMESTAMP', extras['ffw_g40_imu'])

    def test_xm335_voltage_fallback_only_when_installed_table_lacks_units(self):
        path = self.directory / 'xm335_t323.model'
        (self.directory / 'dynamixel.model').write_text('1020 xm335_t323.model\n')
        path.write_text('[control table]\n144 2 Present Input Voltage\n')
        self.assertEqual(Catalog(self.directory).get(1020).registers['Present Input Voltage'].decode(120), 12.0)
        path.write_text('[unit info]\nPresent Input Voltage\t0.2\tV\tunsigned\t0.0\n[control table]\n144 2 Present Input Voltage\n')
        self.assertEqual(Catalog(self.directory).get(1020).registers['Present Input Voltage'].decode(120), 24.0)
        path.write_text('[control table]\n145 2 Present Input Voltage\n')
        self.assertEqual(Catalog(self.directory).get(1020).registers['Present Input Voltage'].unit, 'raw')

    def test_rcu_with_virtual_wheel_motors_reads_board_without_hand_operations(self):
        runner = self.runner()
        bus = runner.snapshot['buses'][0]
        device = bus['devices'][0]
        device['name'] = 'ffw_g10_rcu'
        bus['virtual_devices'] = [dict(kind='virtual_dxl', id=102, comm_id=200)]
        runner.handles[0] = self.bus
        self.assertTrue(runner.identify(0, device))
        runner.read_device(0, device)
        self.assertEqual(device['health'], 'ok')
        self.assertEqual(device['fields']['Error_Code']['raw'], 0)
        self.assertNotIn('hand', device)
        self.assertNotIn(('ping', 102), self.bus.calls)
        self.assertFalse(any(call[0] == 'bypass' for call in self.bus.calls))

    def test_invalid_board_configuration_fails_without_falling_back_to_reads(self):
        path = self.directory / 'boards.yaml'
        configs = [
            'common_fields: []\nmodels: {a: {model_numbers: [1], fields: []}, b: {model_numbers: [1], fields: []}}',
            'common_fields: [Error_Code]\nmodels: {a: {model_numbers: [1], fields: [Error_Code]}}',
            'common_fields: []\nmodels: {a: {model_numbers: [true], fields: []}}',
            'common_fields: []\nmodels: {a: {model_numbers: [1], fields: [x, x]}}',
            'common_fields: []\nmodels: {a: {model_numbers: [1], fields: [], fields: [x]}}',
            'common_fields: []\nmodels: {a: {model_numbers: [1], fields: [x], unexpected: true}}',
            'common_fields: [',
        ]
        for content in configs:
            with self.subTest(content=content):
                path.write_text(content)
                with self.assertRaisesRegex(ValueError, 'Invalid board diagnostic configuration'):
                    load_board_config(path)
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'Invalid board diagnostic configuration'):
            load_board_config(path)

    def test_zero_error_code_is_healthy_and_no_unlisted_reads(self):
        runner = self.runner()
        self.assertEqual(runner.run(), 0)
        device = runner.snapshot['buses'][0]['devices'][0]
        self.assertEqual(device['state'], 'online')
        self.assertEqual(device['health'], 'ok')
        self.assertEqual(device['fields']['Error_Code']['raw'], 0)
        self.assertEqual(device['fields']['Error_Code']['status'], 'ok')
        self.assertEqual(device['fields']['Board_Temperature']['unit'], 'raw')
        self.assertEqual(device['fields']['Firmware_Version_Minor']['value'], 2)
        reads = [c for c in self.bus.calls if c[0] == 'read']
        self.assertTrue(reads)
        self.assertTrue(all(c[1] == 200 for c in reads))  # additional ID 91 is not read
        self.assertFalse(any(c[2] in {'Operation_Command', 'Orin_Power_Control'} for c in reads))

    def test_duplicate_connection_name_is_skipped_and_other_fields_are_read(self):
        runner = self.runner()
        runner.run()
        device = runner.snapshot['buses'][0]['devices'][0]
        self.assertIn('Error_Code', device['fields'])
        self.assertFalse(any(name.startswith('Motor_Connection_Status') for name in device['fields']))
        self.assertIn({'name': 'Motor1_Connection_Status', 'reason': 'duplicate'}, device['board_skipped_fields'])
        self.assertFalse(any(c[0] == 'read' and c[2] == 'Motor1_Connection_Status' for c in self.bus.calls))

    def test_changed_address_and_size_are_read_from_model_table(self):
        path = self.directory / 'ffw_g40_imu.model'
        path.write_text(path.read_text().replace('40 2 IMU ACC X', '140 4 IMU ACC X'))
        table = Catalog(self.directory).get(537)
        registers, support, skipped = board_registers(537, table)
        self.assertEqual(support, 'supported')
        self.assertEqual(skipped, [])
        register = next(r for r in registers if r.name == 'IMU ACC X')
        self.assertEqual((register.address, register.size), (140, 4))

    def test_missing_or_invalid_error_code_does_not_report_healthy(self):
        for entry in ('', '12 8 Error_Code\n'):
            with self.subTest(entry=entry):
                path = self.directory / 'ffw_g40_imu.model'
                path.write_text('[control table]\n' + COMMON.replace('12 4 Error_Code\n', entry) + IMU)
                self.catalog = Catalog(self.directory)
                self.bus.calls.clear()
                runner = self.runner(537)
                runner.run()
                device = runner.snapshot['buses'][0]['devices'][0]
                self.assertEqual(device['health'], 'unknown')
                self.assertNotIn('Error_Code', device['fields'])
                self.assertEqual(device['board_skipped_fields'][0]['name'], 'Error_Code')
                self.assertNotIn('Error_Code', [call[2] for call in self.bus.calls if call[0] == 'read'])
                self.assertIn('IMU ACC X', device['fields'])

    def test_nonzero_board_error_is_preserved_without_motor_decoder(self):
        self.bus.values['Error_Code'] = 0x80000009
        runner = self.runner()
        runner.run()
        device = runner.snapshot['buses'][0]['devices'][0]
        self.assertEqual(device['fields']['Error_Code']['value'], 0x80000009)
        self.assertEqual(device['fields']['Error_Code']['status'], 'error')
        self.assertEqual(device['health'], 'error')

    def test_unknown_model_is_not_read_and_missing_fields_are_reported(self):
        runner = self.runner(65500)
        runner.run()
        self.assertFalse(any(c[0] == 'read' for c in self.bus.calls))
        table = self.catalog.get(602)
        del table.registers_by_name['Estop_Input']
        registers, support, skipped = board_registers(602, table)
        self.assertEqual(support, 'supported')
        self.assertNotIn('Estop_Input', [register.name for register in registers])
        self.assertIn({'name': 'Estop_Input', 'reason': 'missing'}, skipped)
        self.assertEqual(board_registers(537, table), ([], 'unsupported', []))

    def test_failed_read_and_ping_hide_cached_board_data(self):
        runner = self.runner()
        runner.open_bus(0, runner.snapshot['buses'][0])
        device = runner.snapshot['buses'][0]['devices'][0]
        self.bus.read_failure = 'Estop_Input'
        runner.read_board(0, device)
        self.assertEqual(device['state'], 'offline')
        self.assertTrue(all(f['status'] == 'read_error' for f in device['fields'].values()))
        self.bus.read_failure = None
        runner.identify(0, device)
        runner.read_board(0, device)
        del self.bus.models[200]
        runner.identify(0, device)
        self.assertTrue(all(f['status'] == 'read_error' for f in device['fields'].values()))

    def test_imu_timestamp_change_freeze_and_recovery(self):
        runner = self.runner(537)
        with patch('cyclo_manager.diagnostics.runner.time.time', return_value=100):
            runner.open_bus(0, runner.snapshot['buses'][0])
        device = runner.snapshot['buses'][0]['devices'][0]
        self.assertEqual(device['sample_activity']['state'], 'observing')
        with patch('cyclo_manager.diagnostics.runner.time.time', return_value=106):
            runner.read_board(0, device)
        self.assertEqual(device['sample_activity']['state'], 'unchanged')
        self.bus.values['IMU TIMESTAMP'] = 1
        with patch('cyclo_manager.diagnostics.runner.time.time', return_value=107):
            runner.read_board(0, device)
        self.assertEqual(device['sample_activity']['state'], 'changed')
        self.bus.read_failure = 'IMU TIMESTAMP'
        runner.read_board(0, device)
        self.assertNotIn('sample_activity', device)

    def test_packet_alert_is_not_lost_after_a_later_successful_read(self):
        runner = self.runner()
        normal = self.bus.read
        def read(device_id, register):
            value, _ = normal(device_id, register)
            return value, 0x80 if register.name == 'Error_Code' else 0
        self.bus.read = read
        runner.run()
        device = runner.snapshot['buses'][0]['devices'][0]
        self.assertEqual(device['packet_error'], 0x80)
        self.assertEqual(device['health'], 'error')

    def test_model_change_clears_old_board_fields(self):
        runner = self.runner()
        runner.open_bus(0, runner.snapshot['buses'][0])
        device = runner.snapshot['buses'][0]['devices'][0]
        self.bus.models[200] = 537
        runner.identify(0, device)
        self.assertEqual(device['fields'], {})
        runner.read_board(0, device)
        self.assertNotIn('Estop_Input', device['fields'])
        self.assertIn('IMU TIMESTAMP', device['fields'])


if __name__ == '__main__':
    unittest.main()
