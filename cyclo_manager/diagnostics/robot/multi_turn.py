"""User-requested multi-turn clear for identified Y-series DYNAMIXELs."""

import time

from cyclo_manager.diagnostics.robot.calibration import CalibrationPortError


def y_motor_target(bus, system, device_id):
    if bus.get('state') != 'open':
        raise ValueError('Port is not open')
    matches = [d for d in bus['devices'] if d['id'] == device_id and d['system'] == system
               and d.get('expected') and d.get('kind') == 'dxl']
    if len(matches) != 1:
        raise ValueError('Configured DXL not found on this port')
    device = matches[0]
    if (device.get('state') != 'online' or not (device.get('model_name') or '').lower().startswith('ym')
            or device.get('model_definition') != 'available'
            or device.get('expected_model', device.get('model_number')) != device.get('model_number')):
        raise ValueError('A responding Y-series DXL with a matching model definition is required')
    if any(d['id'] == device_id for d in bus.get('virtual_devices', [])):
        raise ValueError('Ambiguous device ID on this port')
    return device


def clear_multi_turn(runner, index, command):
    result = {**command, 'state': 'failed', 'updated_at': time.time()}
    writing = False
    try:
        if runner.stop.is_set() or time.time() > command['expires_at']:
            raise ValueError('Check stopped or request expired; no command was sent')
        device = y_motor_target(runner.snapshot['buses'][index], command['system'], command['device_id'])
        handle = runner.handles[index]
        model, _ = handle.ping(device['id'])
        table = runner.tables.get((index, device['id']))
        if model != device.get('model_number') or not table or not table.name.lower().startswith('ym'):
            raise ValueError('DXL model changed; no command was sent')
        if runner.stop.is_set() or time.time() > command['expires_at']:
            raise ValueError('Check stopped or request expired; no command was sent')
        writing = True
        comm_result, packet_error = handle.clear_multi_turn(device['id'])
        if comm_result != 0:
            raise RuntimeError(handle.packet.getTxRxResult(comm_result))
        device['packet_error'] |= packet_error
        if packet_error & 0x7f:
            result.update(state='failed', message=handle.packet.getRxPacketError(packet_error & 0x7f))
            return result
        result.update(state='sent', message='Multi-turn clear acknowledged')
    except OSError as exc:
        result.update(state='unconfirmed' if writing else 'failed', message=str(exc))
        result['updated_at'] = time.time()
        raise CalibrationPortError(exc, result) from exc
    except Exception as exc:
        result.update(state='unconfirmed' if writing else 'failed', message=str(exc))
    finally:
        if writing:
            # A successful clear can reboot a Y-series motor; never retain old readings.
            device.update(state='offline', health='unknown', fields={}, last_seen=None,
                          message='Waiting for DXL after multi-turn clear')
            runner.retry_at[(index, device['id'])] = time.monotonic() + 3
    result['updated_at'] = time.time()
    return result
