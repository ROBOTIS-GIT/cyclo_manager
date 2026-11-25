"""SH5/BH5 routing tests with simulated buses; no robot connection required."""
import copy
import tempfile
import threading
import unittest
from pathlib import Path

from cyclo_manager.diagnostics.profiles import parse_description
from cyclo_manager.diagnostics.registers import Catalog
from cyclo_manager.diagnostics.runner import Runner
from test_diagnostics import FakeBus, TABLE


CONTROLLER = '''[unit info]
Present Input Voltage\t0.01\tV\tunsigned\t0.0
[control table]
6 1 Firmware Version
60 2 Max Voltage Limit
62 2 Min Voltage Limit
71 1 Hardware Error Status
100 2 Realtime Tick
102 2 Present Input Voltage
106 1 Status
70 1 Table Sync Enable
1024 1 SyncTable 1 ID 1
1030 2 SyncTable 1 Read Address 1
1042 2 SyncTable 1 Read Size 1
''' + ''.join(f'{1078 + n} 1 SyncTable 1 Read Data {n + 1}\n' for n in range(6))
VIRTUAL = '''[unit info]
Present Current\t1.0\traw\tsigned\t0.0
Present Velocity\t0.02\trad/s\tsigned\t0.0
Present Position\t0.0015\trad\tsigned\t-3.14
[control table]
1078 2 Present Current
1080 2 Present Velocity
1082 2 Present Position
'''
XML = '''<robot><ros2_control name="hand"><hardware>
<plugin>dynamixel_hardware_interface/DynamixelHardware</plugin>
<param name="port_name">/dev/test</param><param name="baud_rate">4000000</param>
</hardware><gpio name="hand_l_controller"><param name="type">controller</param>
<param name="ID">140</param><param name="Table Sync Enable">0</param>
<param name="SyncTable 1 ID 1">141</param><param name="SyncTable 1 Read Address 1">224</param>
<param name="SyncTable 1 Read Size 1">6</param></gpio>
<gpio name="dummy"><param name="type">controller</param><param name="ID">140</param>
<param name="Table Sync Enable">1</param></gpio>
<gpio name="dxl141"><param name="type">virtual_dxl</param><param name="ID">141</param>
<param name="comm_id">140</param><param name="model_num">6001</param></gpio>
</ros2_control></robot>'''


class HandTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        (self.root / 'dynamixel.model').write_text('261 hx5_d20_rl.model\n6001 hx5_d20_r_synctable_1_device_1.model\n1020 xm430.model\n')
        (self.root / 'hx5_d20_rl.model').write_text(CONTROLLER)
        (self.root / 'hx5_d20_r_synctable_1_device_1.model').write_text(VIRTUAL)
        (self.root / 'xm430.model').write_text(TABLE)
        self.catalog = Catalog(self.root)
        self.bus = FakeBus()
        self.bus.models = {140: 261, 141: 1020}
        def bypass(device_id, register):
            self.bus.calls.append(('bypass', device_id, register.name))
            self.bus.values['Table Sync Enable'] = 0
            return 0
        self.bus.enable_hand_bypass = bypass
        self.bus.values.update({'Table Sync Enable': 1, 'SyncTable 1 ID 1': 141,
            'Firmware Version': 3, 'Realtime Tick': 10, 'Present Input Voltage': 120, 'Status': 0,
            'SyncTable 1 Read Address 1': 224, 'SyncTable 1 Read Size 1': 6,
            'Present Current': 65535, 'Present Velocity': 2, 'Present Position': 100})
        self.runner = Runner(parse_description(XML), self.catalog, threading.Event(), lambda _: None,
                             lambda *_: self.bus)
        self.runner.handles[0] = self.bus
        self.device = self.runner.snapshot['buses'][0]['devices'][0]

    def read(self):
        if self.runner.identify(0, self.device):
            self.runner.read_device(0, self.device)
        return self.device.get('hand')

    def test_parser_retains_mapping_and_virtual_model_without_dummy_mode_override(self):
        self.assertEqual(len(self.runner.snapshot['buses'][0]['devices']), 1)
        self.assertEqual(self.device['sync_mapping']['SyncTable 1 ID 1'], 141)
        self.assertNotIn('Table Sync Enable', self.device['sync_mapping'])
        self.assertEqual(self.runner.snapshot['buses'][0]['virtual_devices'][0]['virtual_model'], 6001)

    def test_same_id_initialization_and_virtual_mapping_become_one_motor(self):
        xml = XML.replace('<gpio name="dxl141">', '''<gpio name="arbitrary_initialization_name">
<param name="type">controller</param><param name="ID">141</param>
<param name="Operating Mode">5</param></gpio><gpio name="dxl141">''')
        config = parse_description(xml)
        bus = config['buses'][0]
        self.assertEqual([device['id'] for device in bus['devices']], [140])
        child = bus['virtual_devices'][0]
        self.assertEqual([(d['name'], d['kind']) for d in child['declarations']],
                         [('dxl141', 'virtual_dxl'), ('arbitrary_initialization_name', 'controller')])
        runner = Runner(config, self.catalog, threading.Event(), lambda _: None, lambda *_: self.bus)
        self.assertEqual(runner.run(), 0)
        motor = runner.snapshot['buses'][0]['devices'][0]['hand']['devices'][0]
        self.assertEqual(motor['state'], 'online')
        self.assertEqual(motor['health'], 'ok')
        self.assertEqual(runner.snapshot['summary']['expected'], 2)
        self.assertEqual(self.bus.calls.count(('ping', 141)), 1)

    def test_two_hand_controllers_cannot_own_same_virtual_id(self):
        xml = XML.replace('</ros2_control>', '''<gpio name="hand_r_controller">
<param name="type">controller</param><param name="ID">110</param></gpio>
<gpio name="other"><param name="type">virtual_dxl</param><param name="ID">141</param>
<param name="comm_id">110</param><param name="model_num">6001</param></gpio></ros2_control>''')
        with self.assertRaisesRegex(ValueError, 'Conflicting controller ownership'):
            parse_description(xml)

    def test_sync_switches_to_bypass_and_verifies_before_probing(self):
        hand = self.read()
        self.assertEqual(hand['mode'], 'sync_disabled')
        self.assertEqual(hand['devices'][0]['access'], 'direct')
        self.assertEqual(hand['devices'][0]['fields']['Present Temperature']['value'], 35)
        write = self.bus.calls.index(('bypass', 140, 'Table Sync Enable'))
        probe = self.bus.calls.index(('ping', 141))
        self.assertIn(('read', 140, 'Table Sync Enable'), self.bus.calls[write + 1:probe])
        self.assertEqual(self.bus.values['Table Sync Enable'], 0)
        self.assertEqual(self.device['board_telemetry'], 'supported')
        self.assertEqual(self.device['fields']['Firmware Version']['raw'], 3)
        self.assertEqual(self.device['fields']['Present Input Voltage']['raw'], 120)
        self.assertEqual(self.device['fields']['Status']['raw'], 0)
        self.assertEqual(self.device['health'], 'ok')
        self.assertLess(self.bus.calls.index(('read', 140, 'Status')), write)

    def test_controller_board_read_failure_does_not_switch_or_probe(self):
        self.bus.read_failure = 'Status'
        self.read()
        self.assertEqual(self.device['state'], 'offline')
        self.assertNotIn(('ping', 141), self.bus.calls)
        self.assertFalse(any(call[0] == 'bypass' for call in self.bus.calls))

    def test_bypass_write_failure_does_not_probe_internal_motors(self):
        def fail(*_):
            raise RuntimeError('write timeout')
        self.bus.enable_hand_bypass = fail
        hand = self.read()
        self.assertEqual(self.device['state'], 'offline')
        self.assertIn('Bypass switch failed', hand['message'])
        self.assertNotIn(('ping', 141), self.bus.calls)

    def test_unverified_switch_does_not_probe_internal_motors(self):
        self.bus.enable_hand_bypass = lambda *_: 0
        hand = self.read()
        self.assertEqual(hand['mode'], 'unknown')
        self.assertIn('could not be verified', hand['message'])
        self.assertEqual(hand['devices'][0]['state'], 'not_checked')
        self.assertIn('could not be verified', hand['devices'][0]['message'])
        self.assertEqual(self.device['health'], 'unknown')
        self.assertNotIn(('ping', 141), self.bus.calls)

    def test_already_in_bypass_does_not_write(self):
        self.bus.values['Table Sync Enable'] = 0
        self.read()
        self.assertFalse(any(call[0] == 'bypass' for call in self.bus.calls))

    def test_unsafe_register_layout_does_not_write(self):
        (self.root / 'hx5_d20_rl.model').write_text(CONTROLLER.replace('70 1 Table Sync Enable', '71 1 Table Sync Enable'))
        from cyclo_manager.diagnostics.dynamixel_bus import DynamixelBus
        transport = DynamixelBus.__new__(DynamixelBus)
        self.bus.enable_hand_bypass = transport.enable_hand_bypass
        hand = self.read()
        self.assertIn('Unsupported hand mode register', hand['message'])
        self.assertNotIn(('ping', 141), self.bus.calls)

    def test_transport_only_writes_the_verified_mode_register_to_zero(self):
        from cyclo_manager.diagnostics.registers import Register
        from cyclo_manager.diagnostics.dynamixel_bus import DynamixelBus
        class Packet:
            def __init__(self): self.calls = []
            def write1ByteTxRx(self, port, device_id, address, value):
                self.calls.append((device_id, address, value))
                return 0, 0
        transport = DynamixelBus.__new__(DynamixelBus)
        transport.port = object()
        transport.packet = Packet()
        self.assertEqual(transport.enable_hand_bypass(140, Register(70, 1, 'Table Sync Enable')), 0)
        self.assertEqual(transport.packet.calls, [(140, 70, 0)])
        for register in (Register(71, 1, 'Table Sync Enable'), Register(70, 2, 'Table Sync Enable'),
                         Register(70, 1, 'Other')):
            with self.assertRaises(ValueError):
                transport.enable_hand_bypass(140, register)
        self.assertEqual(transport.packet.calls, [(140, 70, 0)])

    def test_disabled_sync_uses_ping_model_for_direct_diagnostics(self):
        self.bus.values['Table Sync Enable'] = 0
        child = self.read()['devices'][0]
        self.assertEqual(child['access'], 'direct')
        self.assertEqual(child['model_number'], 1020)
        self.assertEqual(child['health'], 'ok')
        self.assertEqual(child['fields']['Present Temperature']['value'], 35)
        self.assertNotIn(('read', 140, 'Present Position'), self.bus.calls)

    def test_disabled_sync_without_internal_response_does_not_claim_bypass(self):
        self.bus.values['Table Sync Enable'] = 0
        del self.bus.models[141]
        hand = self.read()
        self.assertEqual(hand['mode'], 'sync_disabled')
        self.assertEqual(hand['devices'][0]['state'], 'offline')
        self.assertEqual(hand['devices'][0]['access'], 'direct_probe')

    def test_shared_physical_id_blocks_direct_probe(self):
        self.bus.values['Table Sync Enable'] = 0
        self.runner.snapshot['buses'][0]['devices'].append(dict(id=141, expected=True, state='pending', health='unknown'))
        child = self.read()['devices'][0]
        self.assertIn('Ambiguous ID', child['message'])
        self.assertNotIn(('ping', 141), self.bus.calls)

    def test_unknown_mode_does_not_guess_access(self):
        self.bus.values['Table Sync Enable'] = 7
        child = self.read()['devices'][0]
        self.assertEqual(child['fields'], {})
        self.assertNotIn(('ping', 141), self.bus.calls)
        self.assertNotIn(('read', 140, 'Present Position'), self.bus.calls)

    def test_unknown_controller_model_skips_mode_and_internal_probes(self):
        self.bus.models[140] = 65500
        hand = self.read()
        self.assertEqual(hand['mode'], 'unknown')
        self.assertEqual(self.bus.calls, [('ping', 140)])
        self.assertEqual(hand['devices'][0]['fields'], {})

    def test_bus_failure_invalidates_nested_cache(self):
        self.read()
        self.runner.fail_bus(0, self.runner.snapshot['buses'][0], OSError('USB disconnected'))
        child = self.device['hand']['devices'][0]
        self.assertEqual(child['fields'], {})
        self.assertEqual(child['state'], 'not_checked')
        self.assertEqual(self.device['hand']['mode'], 'unknown')

    def test_mode_change_discards_acquired_values(self):
        original = self.bus.read
        count = 0
        def read(i, register):
            nonlocal count
            value, error = original(i, register)
            if register.name == 'Table Sync Enable':
                count += 1
                if count == 3:
                    return 1, error
            return value, error
        self.bus.read = read
        hand = self.read()
        self.assertEqual(hand['mode'], 'unknown')
        self.assertEqual(hand['devices'][0]['fields'], {})

    def test_children_publish_individually_and_retain_other_recent_results(self):
        runner = self.tactile_runner()
        snapshots = []
        runner.emit = lambda snapshot: snapshots.append((copy.deepcopy(snapshot), list(self.bus.calls)))
        parent = runner.snapshot['buses'][0]['devices'][0]
        runner.identify(0, parent)
        runner.read_device(0, parent)
        first, calls = snapshots[0]
        children = first['buses'][0]['devices'][0]['hand']['devices']
        self.assertEqual([(d['id'], d['state']) for d in children], [(141, 'online'), (145, 'pending')])
        self.assertNotIn(('ping', 145), calls)
        self.assertEqual(snapshots[-1][0]['buses'][0]['devices'][0]['hand']['devices'][1]['state'], 'online')
        snapshots.clear()
        runner.identify(0, parent)
        runner.read_device(0, parent)
        first_children = snapshots[0][0]['buses'][0]['devices'][0]['hand']['devices']
        self.assertEqual(first_children[1]['state'], 'online')
        self.assertEqual(first_children[1]['fields']['Present Pressure 1']['raw'], 201)

    def test_later_mode_change_invalidates_already_published_children(self):
        runner = self.tactile_runner()
        snapshots = []
        runner.emit = lambda snapshot: snapshots.append(copy.deepcopy(snapshot))
        parent = runner.snapshot['buses'][0]['devices'][0]
        original = self.bus.read
        def change_mode_after_sensor(device_id, register):
            result = original(device_id, register)
            if device_id == 145 and register.name == 'Present Pressure 9':
                self.bus.values['Table Sync Enable'] = 1
            return result
        self.bus.read = change_mode_after_sensor
        runner.open_bus(0, runner.snapshot['buses'][0])
        observed = [s['buses'][0]['devices'][0].get('hand', {}).get('devices', []) for s in snapshots]
        self.assertTrue(any(children and children[0]['state'] == 'online' and children[1]['state'] == 'pending' for children in observed))
        final = observed[-1]
        self.assertEqual([child['state'] for child in final], ['not_checked', 'not_checked'])
        self.assertTrue(all(not child['fields'] for child in final))
        self.assertFalse(any(children and children[1]['state'] == 'online' for children in observed))

    def test_read_failure_and_controller_loss_clear_old_hand_values(self):
        self.read()
        self.bus.read_failure = 'Present Temperature'
        child = self.read()['devices'][0]
        self.assertEqual(child['state'], 'offline')
        self.assertTrue(all(v['status'] == 'read_error' for v in child['fields'].values()))
        self.bus.read_failure = None
        self.read()
        del self.bus.models[140]
        hand = self.read()
        self.assertEqual(hand['mode'], 'unknown')
        self.assertEqual(hand['devices'][0]['fields'], {})
        self.assertEqual(hand['devices'][0]['state'], 'not_checked')
        self.assertIn('controller did not respond', hand['devices'][0]['message'])

    def test_first_controller_failure_never_probes_children(self):
        del self.bus.models[140]
        self.read()
        self.runner.publish()
        self.assertNotIn(('ping', 141), self.bus.calls)
        self.assertEqual(self.runner.snapshot['summary']['expected'], 2)
        self.assertEqual(self.runner.snapshot['summary']['responding'], 0)

    def test_controller_board_failure_invalidates_previous_child_readings(self):
        self.read()
        self.bus.read_failure = 'Status'
        self.read()
        child = self.device['hand']['devices'][0]
        self.assertEqual(child['state'], 'not_checked')
        self.assertEqual(child['fields'], {})
        self.assertIn('register read failed', child['message'])

    def test_mode_read_failure_is_a_communication_failure(self):
        self.read()
        self.bus.read_failure = 'Table Sync Enable'
        hand = self.read()
        self.assertEqual(self.device['state'], 'offline')
        self.assertEqual(hand['mode'], 'unknown')
        self.assertEqual(hand['devices'][0]['fields'], {})

    def test_once_routes_hand_children_without_promoting_them_to_bus_devices(self):
        self.runner.run()
        self.assertTrue(self.bus.closed)
        self.assertEqual(len(self.runner.snapshot['buses'][0]['devices']), 1)
        self.assertEqual(self.runner.snapshot['buses'][0]['devices'][0]['hand']['mode'], 'sync_disabled')
        self.assertIn(('ping', 141), self.bus.calls)
        self.assertEqual(self.bus.calls.count(('bypass', 140, 'Table Sync Enable')), 1)
        self.assertEqual(self.runner.snapshot['summary']['expected'], 2)
        self.assertEqual(self.runner.snapshot['summary']['responding'], 2)
        self.assertEqual(self.runner.snapshot['summary']['excluded'], 0)

    def test_configured_hand_counts_before_ping_and_on_port_failure(self):
        self.runner.publish()
        self.assertEqual(self.runner.snapshot['summary']['expected'], 2)
        self.assertEqual(self.runner.snapshot['summary']['responding'], 0)
        self.assertEqual(self.runner.snapshot['summary']['excluded'], 0)
        del self.bus.models[140]
        self.read()
        self.runner.publish()
        self.assertEqual(self.runner.snapshot['summary']['expected'], 2)
        self.assertEqual(self.runner.snapshot['summary']['responding'], 0)

    def test_nonresponding_and_faulted_hand_motors_are_counted(self):
        del self.bus.models[141]
        self.read()
        self.runner.publish()
        self.assertEqual(self.runner.snapshot['summary']['responding'], 1)
        self.assertGreaterEqual(self.runner.snapshot['summary']['unknown'], 1)
        self.bus.models[141] = 1020
        original_read = self.bus.read
        def read_with_motor_error(device_id, register):
            value, error = original_read(device_id, register)
            return (4 if device_id == 141 and register.name == 'Hardware Error Status' else value), error
        self.bus.read = read_with_motor_error
        self.read()
        self.runner.publish()
        self.assertEqual(self.runner.snapshot['summary']['responding'], 2)
        self.assertGreaterEqual(self.runner.snapshot['summary']['errors'], 1)
        self.assertEqual(self.device['health'], 'ok')
        self.assertEqual(self.device['hand']['devices'][0]['health'], 'error')

    def test_hand_controller_error_bits_are_reported_independently(self):
        for register, raw, label in [('Hardware Error Status', 1, 'Input voltage error'),
                                     ('Status', 64, 'Bus watchdog error'),
                                     ('Status', 2, 'Unknown bits')]:
            with self.subTest(register=register, raw=raw):
                self.bus.values['Hardware Error Status'] = 0
                self.bus.values['Status'] = 0
                self.bus.values[register] = raw
                self.read()
                self.assertEqual(self.device['health'], 'error')
                self.assertIn(label, self.device['fields'][register]['message'])

    def test_original_hand_model_uses_supplemental_fields_and_units(self):
        original = CONTROLLER.replace('[unit info]\nPresent Input Voltage\t0.01\tV\tunsigned\t0.0\n', '')
        for line in ('60 2 Max Voltage Limit\n', '62 2 Min Voltage Limit\n', '71 1 Hardware Error Status\n'):
            original = original.replace(line, '')
        (self.root / 'hx5_d20_rl.model').write_text(original)
        self.read()
        self.assertEqual(self.device['health'], 'ok')
        self.assertEqual(self.device['fields']['Present Input Voltage']['value'], 1.2)
        self.assertEqual(self.device['fields']['Max Voltage Limit']['value'], 1.6)
        self.assertEqual(self.device['fields']['Hardware Error Status']['raw'], 0)

    def test_hand_supplement_never_overlaps_installed_registers(self):
        original = CONTROLLER.replace('71 1 Hardware Error Status\n', '71 1 Different Register\n')
        (self.root / 'hx5_d20_rl.model').write_text(original)
        self.read()
        self.assertNotIn('Hardware Error Status', self.device['fields'])
        self.assertEqual(self.device['health'], 'unknown')

    def test_installed_voltage_unit_takes_precedence(self):
        (self.root / 'hx5_d20_rl.model').write_text(CONTROLLER.replace('0.01\tV', '0.1\tV'))
        self.read()
        self.assertEqual(self.device['fields']['Present Input Voltage']['value'], 12.0)

    def tactile_runner(self):
        xml = XML.replace('</ros2_control>', '''<gpio name="tip145">
<param name="type">virtual_sensor</param><param name="ID">145</param>
<param name="comm_id">140</param><param name="model_num">6005</param></gpio></ros2_control>''')
        self.bus.models[145] = 250
        self.bus.values.update({f'Present Pressure {i}': 200 + i for i in range(1, 10)})
        runner = Runner(parse_description(xml), self.catalog, threading.Event(), lambda _: None, lambda *_: self.bus)
        runner.handles[0] = self.bus
        return runner

    def test_tactile_direct_probe_reads_physical_table_and_counts_sensor(self):
        runner = self.tactile_runner()
        runner.publish()
        self.assertEqual(runner.snapshot['summary']['expected'], 3)
        self.assertEqual(runner.snapshot['summary']['excluded'], 0)
        parent = runner.snapshot['buses'][0]['devices'][0]
        runner.identify(0, parent)
        runner.read_device(0, parent)
        sensor = parent['hand']['devices'][1]
        self.assertEqual((sensor['kind'], sensor['model_number'], sensor['health']), ('tactile', 250, 'ok'))
        self.assertEqual(sensor['fields']['Present Input Voltage']['value'], 12.0)
        self.assertEqual([sensor['fields'][f'Present Pressure {i}']['raw'] for i in range(1, 10)], list(range(201, 210)))
        self.assertLess(self.bus.calls.index(('bypass', 140, 'Table Sync Enable')), self.bus.calls.index(('ping', 145)))
        runner.publish()
        self.assertEqual(runner.snapshot['summary']['responding'], 3)

    def test_tactile_barometer_error_and_failed_reads(self):
        runner = self.tactile_runner()
        parent = runner.snapshot['buses'][0]['devices'][0]
        original = self.bus.read
        def read(device_id, register):
            value, error = original(device_id, register)
            return (2 if device_id == 145 and register.name == 'Hardware Error Status' else value), error
        self.bus.read = read
        runner.identify(0, parent)
        runner.read_device(0, parent)
        sensor = parent['hand']['devices'][1]
        self.assertEqual(sensor['health'], 'error')
        self.assertIn('Barometer', sensor['fields']['Hardware Error Status']['message'])
        self.bus.read_failure = 'Present Pressure 3'
        runner.read_device(0, parent)
        sensor = parent['hand']['devices'][1]
        self.assertEqual(sensor['state'], 'offline')
        self.assertEqual(sensor['fields']['Present Pressure 3']['status'], 'read_error')

    def test_tactile_model_253_uses_same_pressure_and_error_table(self):
        runner = self.tactile_runner()
        self.bus.models[145] = 253
        original = self.bus.read
        def read(device_id, register):
            value, error = original(device_id, register)
            return (2 if device_id == 145 and register.name == 'Hardware Error Status' else value), error
        self.bus.read = read
        parent = runner.snapshot['buses'][0]['devices'][0]
        runner.identify(0, parent)
        runner.read_device(0, parent)
        sensor = parent['hand']['devices'][1]
        self.assertEqual(sensor['model_number'], 253)
        self.assertEqual(sensor['health'], 'error')
        self.assertEqual(sensor['fields']['Present Pressure 9']['raw'], 209)
        self.assertEqual(sensor['fields']['Present Input Voltage']['value'], 12.0)
        self.assertIn('Barometer', sensor['fields']['Hardware Error Status']['message'])

    def test_unsupported_tactile_model_retains_ping_hardware_alert(self):
        runner = self.tactile_runner()
        self.bus.models[145] = 1020
        ping = self.bus.ping
        def with_alert(device_id):
            model, error = ping(device_id)
            return model, 0x80 if device_id == 145 else error
        self.bus.ping = with_alert
        parent = runner.snapshot['buses'][0]['devices'][0]
        runner.identify(0, parent)
        runner.read_device(0, parent)
        sensor = parent['hand']['devices'][1]
        self.assertEqual(sensor['health'], 'error')
        self.assertIn('hardware alert', sensor['message'])
        self.assertFalse(any(call[:2] == ('read', 145) for call in self.bus.calls))

    def test_unrecognized_tactile_model_is_identified_but_not_read(self):
        runner = self.tactile_runner()
        self.bus.models[145] = 1020
        parent = runner.snapshot['buses'][0]['devices'][0]
        runner.identify(0, parent)
        runner.read_device(0, parent)
        sensor = parent['hand']['devices'][1]
        self.assertEqual(sensor['health'], 'unknown')
        self.assertIn('Unsupported tactile sensor model', sensor['message'])
        self.assertFalse(any(call[:2] == ('read', 145) for call in self.bus.calls))



if __name__ == '__main__':
    unittest.main()
