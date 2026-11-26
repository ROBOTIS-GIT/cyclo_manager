"""User-requested tactile calibration on the existing diagnostic bus owner."""

import time

from cyclo_manager.diagnostics.robot.hands import TACTILE_FIELDS, TACTILE_MODELS, invalidate_hand, is_hand_controller, unique_register
from cyclo_manager.diagnostics.robot.registers import report_packet_alert


class CalibrationPortError(OSError):
    def __init__(self, error, result):
        super().__init__(str(error))
        self.result = result


def tactile_target(bus, system, controller_id, device_id):
    if bus.get('state') != 'open':
        raise ValueError('Start a check and wait for the port to open')
    parents = [device for device in bus['devices'] if device['id'] == controller_id
               and device.get('expected') and is_hand_controller(device)]
    if len(parents) != 1:
        raise ValueError('Hand controller not found on this port')
    parent = parents[0]
    hand = parent.get('hand', {})
    if parent.get('state') != 'online' or hand.get('mode') != 'sync_disabled':
        raise ValueError('Hand controller bypass is not available')
    matches = [child for child in hand.get('devices', [])
               if child['id'] == device_id and child['system'] == system and child.get('expected')]
    if len(matches) != 1:
        raise ValueError('Tactile sensor not found in the current check')
    sensor = matches[0]
    if (sensor.get('kind') != 'tactile' or sensor.get('model_number') not in TACTILE_MODELS
            or sensor.get('state') != 'online' or sensor.get('access') != 'direct'):
        raise ValueError('A responding supported tactile sensor is required')
    # Reuse the same ownership rules as normal hand reads.
    if (any(device['id'] == device_id for device in bus['devices'])
            or sum(child['id'] == device_id for child in bus['virtual_devices']) != 1):
        raise ValueError('Ambiguous sensor ID on this port')
    return parent, sensor


def calibrate(runner, index, command):
    result = {**command, 'state': 'failed', 'updated_at': time.time()}
    writing = False
    try:
        if runner.stop.is_set():
            raise ValueError('Check stopped before calibration')
        if time.time() > command['expires_at']:
            raise ValueError('Calibration request expired; no command was sent')
        bus = runner.snapshot['buses'][index]
        parent, sensor = tactile_target(bus, command['system'], command['controller_id'], command['device_id'])
        handle = runner.handles[index]
        table = runner.tables.get((index, parent['id']))
        mode = unique_register(table, 'Table Sync Enable')
        if (mode.address, mode.size) != (70, 1):
            raise ValueError('Unsupported hand mode register layout')
        raw, error = handle.read(parent['id'], mode)
        parent['packet_error'] |= error
        report_packet_alert(parent)
        if raw != 0:
            invalidate_hand(parent, 'Hand controller is no longer in bypass; readings invalidated')
            raise ValueError('Hand controller is no longer in bypass; no command was sent')
        # A fresh PING prevents using a stale identity after a device is replaced.
        model_number, error = handle.ping(sensor['id'])
        sensor['packet_error'] |= error
        report_packet_alert(sensor)
        if model_number != sensor['model_number'] or model_number not in TACTILE_MODELS:
            sensor.update(state='not_checked', health='unknown', fields={}, last_seen=None,
                          access='unavailable', message='Sensor model changed; waiting for a new check')
            raise ValueError('Tactile sensor model changed; no command was sent')
        if runner.stop.is_set():
            raise ValueError('Check stopped before calibration')
        if time.time() > command['expires_at']:
            raise ValueError('Calibration request expired; no command was sent')
        sensor['fields'] = {}
        sensor['health'] = 'unknown'
        writing = True
        error = handle.calibrate_tactile(sensor['id'], model_number)
        sensor['packet_error'] |= error
        report_packet_alert(sensor)
        result.update(state='sent', message='Calibration command acknowledged by the sensor')
        raw, error = handle.read(parent['id'], mode)
        parent['packet_error'] |= error
        report_packet_alert(parent)
        if raw != 0:
            invalidate_hand(parent, 'Hand mode changed after calibration; readings invalidated')
            raise ValueError('Hand mode changed after calibration')
        # Calibration changes the measurements; old readings must not look current.
        runner.read_motor(index, sensor, TACTILE_FIELDS)
    except OSError as exc:
        if result['state'] == 'sent':
            result['message'] += f'; reading refresh failed: {exc}'
        else:
            result.update(state='unconfirmed' if writing else 'failed', message=str(exc))
        result['updated_at'] = time.time()
        raise CalibrationPortError(exc, result) from exc
    except Exception as exc:
        # A timed-out write may have reached the device. Never retry it automatically.
        if result['state'] == 'sent':
            result['message'] += f'; reading refresh failed: {exc}'
        else:
            result.update(state='unconfirmed' if writing else 'failed', message=str(exc))
    result['updated_at'] = time.time()
    return result
