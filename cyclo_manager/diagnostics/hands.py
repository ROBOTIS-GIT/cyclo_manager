"""HX5 preflight switches to bypass before directly reading internal motors."""

import time
from cyclo_manager.diagnostics.registers import report_packet_alert

HAND_MODELS = {'hx5_d20_rl', 'hx5_d20_rr'}
HAND_CONTROLLERS = {'hand_l_controller', 'hand_r_controller'}
TACTILE_MODELS = {250, 253}
TACTILE_FIELDS = tuple(f'Present Pressure {i}' for i in range(1, 10))


def is_hand_controller(device):
    names = {device.get('name'), *(alias.rsplit('/', 1)[-1] for alias in device.get('aliases', []))}
    return device.get('kind') == 'controller' and bool(names & HAND_CONTROLLERS)


class UnsupportedLayout(ValueError):
    pass


def unique_register(table, name):
    matches = table.registers_by_name.get(name, []) if table else []
    if len(matches) != 1:
        raise UnsupportedLayout(f'{name}: missing or ambiguous register definition')
    register = table.registers[name]
    if register.size not in (1, 2, 4) or not 0 <= register.address <= 65536 - register.size:
        raise UnsupportedLayout(f'{name}: invalid register layout')
    return register


def invalidate_hand(device, message):
    hand = device.get('hand')
    if hand:
        hand.update(mode='unknown', message=message)
        for child in hand['devices']:
            child.update(state='not_checked', health='unknown', message=message, fields={}, access='unavailable', last_seen=None)


def read_hand(runner, index, device):
    if not is_hand_controller(device):
        return False
    bus = runner.snapshot['buses'][index]
    children = [v for v in bus['virtual_devices']
                if v['comm_id'] == device['id'] and v['kind'] in {'virtual_dxl', 'virtual_sensor'}]
    if not children:
        return False
    # Preserve each previous observation until that child is refreshed. Invalid
    # controller access clears the entire hand through invalidate_hand.
    previous_hand = device.get('hand', {})
    previous = {(child['system'], child['id']): child
                for child in previous_hand.get('devices', [])} if previous_hand.get('mode') == 'sync_disabled' else {}
    hand = dict(mode='unknown', message=None, devices=[])
    device['hand'] = hand
    for child in children:
        hand['devices'].append(previous.get((child['system'], child['id'])) or dict(
            id=child['id'], name=child['name'], system=child['system'],
            kind='tactile' if child['kind'] == 'virtual_sensor' else 'dxl', expected=True, state='pending', health='unknown', fields={},
            last_seen=None, failures=0, packet_error=0, message='Waiting for hand device check',
            access='unavailable', virtual_model=child.get('virtual_model'),
            declarations=child.get('declarations', [])))
    board_health = device['health']
    board_message = device['message']
    table = runner.tables.get((index, device['id']))
    if device.get('expected_model', device['model_number']) != device['model_number']:
        device.update(health='error', message='Model number differs from configuration')
        invalidate_hand(device, 'Hand controller model differs from configuration; device was not checked')
        return True
    if table is None or table.name not in HAND_MODELS:
        hand['message'] = 'Hand controller model is unsupported; identification only'
        device['message'] = board_message if board_health == 'error' else hand['message']
        invalidate_hand(device, 'Hand controller model is unsupported; device was not checked')
        return True

    def read(register):
        if runner.stop.is_set():
            raise InterruptedError('Check stopped')
        raw, error = runner.handles[index].read(device['id'], register)
        device['packet_error'] |= error
        device['last_seen'] = time.time()
        report_packet_alert(device)
        return raw

    try:
        mode_register = unique_register(table, 'Table Sync Enable')
        mode = read(mode_register)
        device['fields']['Table Sync Enable'] = dict(raw=mode, value=mode, unit='raw',
            status='raw', message='', last_success=time.time(), failures=0)
        hand['mode'] = {0: 'sync_disabled', 1: 'sync_table'}.get(mode, 'unknown')
        if mode not in (0, 1):
            invalidate_hand(device, f'Unrecognized Table Sync Enable value: {mode}; device was not checked')
        else:
            if mode == 1:
                if runner.stop.is_set():
                    raise InterruptedError('Check stopped')
                try:
                    device['packet_error'] |= runner.handles[index].enable_hand_bypass(device['id'], mode_register)
                except Exception as exc:
                    raise RuntimeError(f'Bypass switch failed: {exc}') from exc
                if read(mode_register) != 0:
                    raise UnsupportedLayout('Bypass switch could not be verified')
                mode = 0
                device['fields']['Table Sync Enable'].update(raw=0, value=0, last_success=time.time())
            hand['mode'] = 'sync_disabled'
            hand['message'] = 'Bypass enabled. Direct access is confirmed separately for each ID.'
            def verify_mode():
                if read(mode_register) != 0:
                    raise UnsupportedLayout('Hand mode changed during inspection; retrying next cycle')
            read_direct(runner, index, bus, hand, verify_mode)
        # Reject a mode change during acquisition; do not mix access modes.
        if read(mode_register) != mode:
            invalidate_hand(device, 'Hand mode changed during inspection; retrying next cycle')
            device['fields'].pop('Table Sync Enable', None)
        # The controller verdict describes the controller itself. The UI's
        # hand overview aggregates individual child states separately.
        device['health'] = 'unknown' if hand['mode'] == 'unknown' and board_health != 'error' else board_health
        device['message'] = board_message if board_health == 'error' else hand['message']
    except UnsupportedLayout as exc:
        invalidate_hand(device, str(exc))
        device['health'] = 'error' if board_health == 'error' else 'unknown'
        device['message'] = board_message if board_health == 'error' else str(exc)
    except InterruptedError:
        invalidate_hand(device, 'Check stopped')
    except OSError:
        raise
    except Exception as exc:
        invalidate_hand(device, f'Hand controller access failed; device was not checked: {exc}')
        device.update(state='offline', health='unknown', message=str(exc))
        for field in device['fields'].values():
            field.update(status='read_error', message=str(exc))
        runner.retry_at[(index, device['id'])] = time.monotonic() + 5
    report_packet_alert(device)
    return True


def read_direct(runner, index, bus, hand, verify_mode):
    physical_ids = {d['id'] for d in bus['devices']}
    for child in hand['devices']:
        if runner.stop.is_set():
            return
        # A reply on a shared bus cannot disambiguate two configured owners.
        duplicates = sum(v['id'] == child['id'] for v in bus['virtual_devices'])
        if child['id'] in physical_ids or duplicates != 1:
            child.update(state='not_checked', health='unknown', fields={}, last_seen=None,
                         access='unavailable', message='Ambiguous ID on this bus; direct probe skipped')
        else:
            child['access'] = 'direct_probe'
            if runner.identify(index, child):
                child['access'] = 'direct'
                # The virtual model describes controller memory, NOT the physical motor.
                if child['kind'] == 'tactile' and child['model_number'] not in TACTILE_MODELS:
                    if child['packet_error'] & 0x80:
                        child.update(health='error', message='Device reported hardware alert; unsupported tactile sensor model')
                    else:
                        child.update(health='unknown', message='Unsupported tactile sensor model; register reads skipped')
                else:
                    runner.read_motor(index, child, TACTILE_FIELDS if child['kind'] == 'tactile' else ())
        if runner.stop.is_set():
            return
        # Confirm that the controller is still reachable and in bypass before
        # exposing each result; a later failure invalidates earlier results.
        verify_mode()
        runner.publish()
