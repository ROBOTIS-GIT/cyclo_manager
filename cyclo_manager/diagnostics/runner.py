"""One serial owner per bus, with interleaved discovery and scheduled reads."""

from collections import deque
import copy
import math
from queue import Empty, Full, Queue
import threading
import time

from cyclo_manager.diagnostics.registers import TEMPERATURES, classify_fields, report_packet_alert, worst_status
from cyclo_manager.diagnostics.dynamixel_bus import DynamixelBus
from cyclo_manager.diagnostics.boards import board_registers
from cyclo_manager.diagnostics.hands import invalidate_hand, is_hand_controller, read_hand
from cyclo_manager.diagnostics.calibration import CalibrationPortError, calibrate
from cyclo_manager.diagnostics.multi_turn import clear_multi_turn


def field_names(table):
    names = ['Hardware Error Status', 'Error Code', 'Present Input Voltage',
             'Min Voltage Limit', 'Max Voltage Limit', *TEMPERATURES, *TEMPERATURES.values()]
    return [name for name in dict.fromkeys(names) if name in table.registers]


class Runner:
    def __init__(self, config, catalog, stop, emit, bus_factory=DynamixelBus, temperature_margin=5.0, command_queues=None):
        self.catalog, self.stop, self.emit = catalog, stop, emit
        self.bus_factory, self.temperature_margin = bus_factory, temperature_margin
        self.config = copy.deepcopy(config)
        self.handles = {}
        self.tables = {}
        self.retry_at = {}
        self.sequence = 0
        self.command_queues = command_queues if command_queues is not None else [Queue(maxsize=16) for _ in config['buses']]
        self.snapshot = dict(state='starting', health='unknown', started_at=time.time(), **copy.deepcopy(config))
        for bus in self.snapshot['buses']:
            bus.update(state='pending', error=None, discovery_error=None)
            for device in bus['devices']:
                device.update(state='pending', health='unknown', fields={},
                              last_seen=None, failures=0, message=None, packet_error=0)

    def submit_calibration(self, command):
        if not isinstance(command, dict) or set(command) != {'action', 'request_id', 'system', 'controller_id', 'device_id', 'expires_at'}:
            raise ValueError('Invalid calibration command')
        if (command['action'] not in {'calibrate_tactile', 'clear_multi_turn'}
                or not isinstance(command['request_id'], str) or not 1 <= len(command['request_id']) <= 64
                or not isinstance(command['system'], str)
                or any(type(command[key]) is not int or not 0 <= command[key] <= 252 for key in ('controller_id', 'device_id'))
                or type(command['expires_at']) not in (int, float)
                or not math.isfinite(command['expires_at'])):
            raise ValueError('Invalid calibration target')
        indices = [index for index, bus in enumerate(self.config['buses']) if command['system'] in bus['systems']]
        if len(indices) != 1:
            raise ValueError('Calibration system not found')
        try:
            self.command_queues[indices[0]].put_nowait(dict(command))
        except Full as exc:
            raise ValueError('Calibration queue is full') from exc

    def process_calibrations(self, index):
        bus = self.snapshot['buses'][index]
        while not self.stop.is_set():
            try:
                command = self.command_queues[index].get_nowait()
            except Empty:
                return
            port_error = None
            try:
                bus['calibration_result'] = (calibrate if command['action'] == 'calibrate_tactile'
                                             else clear_multi_turn)(self, index, command)
            except CalibrationPortError as exc:
                port_error = exc
                self.fail_bus(index, bus, exc)
                bus['calibration_result'] = exc.result
            try:
                self.publish()
            finally:
                del bus['calibration_result']
            if port_error:
                raise port_error

    def publish(self):
        self.sequence += 1
        self.snapshot['sequence'] = self.sequence
        self.snapshot['updated_at'] = time.time()
        devices = [d for b in self.snapshot['buses'] for d in b['devices']]
        hand_devices = []
        for bus in self.snapshot['buses']:
            for parent in bus['devices']:
                if not is_hand_controller(parent) or not parent.get('sync_mapping'):
                    continue
                children = parent.get('hand', {}).get('devices')
                if children is None:
                    children = [dict(expected=True, state='pending', health='unknown')
                        for child in bus['virtual_devices']
                        if child['kind'] in {'virtual_dxl', 'virtual_sensor'} and child['comm_id'] == parent['id']]
                hand_devices.extend(children)
        devices += hand_devices
        expected = [d for d in devices if d['expected']]
        self.snapshot['health'] = worst_status([d['health'] for d in expected]
            + ['unknown' for b in self.snapshot['buses'] if b['state'] != 'open'])
        self.snapshot['summary'] = dict(
            expected=len(expected), responding=sum(d['state'] == 'online' for d in expected),
            additional=sum(not d['expected'] for d in devices),
            errors=sum(d['health'] == 'error' for d in devices),
            unknown=sum(d['health'] == 'unknown' and d['state'] not in {'pending', 'not_checked'} for d in devices),
            excluded=sum(len(b['virtual_devices']) for b in self.snapshot['buses']) - len(hand_devices)
                     + len(self.snapshot['excluded']))
        self.emit(self.snapshot)

    def identify(self, bus_index, device, attempts=1):
        key = (bus_index, device['id'])
        for _ in range(attempts):
            if self.stop.is_set():
                return False
            try:
                model, error = self.handles[bus_index].ping(device['id'])
                if device.get('model_number') != model:
                    device['fields'] = {}
                    device.pop('sample_activity', None)
                    device.pop('board_telemetry', None)
                    device.pop('board_skipped_fields', None)
                table = self.catalog.get(model)
                device.update(model_number=model, model_name=table.name if table else None,
                              model_definition='available' if table else 'unavailable',
                              state='online', last_seen=time.time(), packet_error=error,
                              message=None, health='unknown' if device['kind'] == 'dxl' else 'ok')
                self.tables[key] = table
                if error & 0x80 and device['kind'] != 'dxl':
                    device.update(health='error', message='Hardware alert in identification response')
                if device.get('expected_model', model) != model:
                    device.update(health='error', message='Model number differs from configuration')
                return True
            except OSError:
                raise
            except Exception as exc:
                device['failures'] += 1
                device.update(state='offline', health='unknown', message=str(exc))
                invalidate_hand(device, 'Hand controller did not respond; device was not checked')
                if device['kind'] in {'sensor', 'controller'}:
                    for field in device['fields'].values():
                        field.update(status='read_error', message=str(exc))
                    device.pop('sample_activity', None)
                if self.stop.wait(0.05):
                    break
        self.retry_at[key] = time.monotonic() + 5
        return False

    def read_board(self, index, device):
        if device.get('expected_model', device['model_number']) != device['model_number']:
            return
        registers, support, skipped = board_registers(device['model_number'], self.tables.get((index, device['id'])))
        device['board_telemetry'] = support
        device['board_skipped_fields'] = skipped
        if support != 'supported':
            device['health'] = 'error' if device['packet_error'] & 0x80 else 'unknown'
            device['message'] = 'Board register layout unavailable; identification only'
            return
        fields = device['fields']
        for register in registers:
            if self.stop.is_set():
                return
            field = fields.setdefault(register.name, dict(value=None, raw=None, unit=register.unit,
                last_success=None, status='unknown', message='', failures=0, address=register.address))
            try:
                raw, error = self.handles[index].read(device['id'], register)
                now = time.time()
                field.update(raw=raw, value=register.decode(raw), unit=register.unit, last_success=now, status='raw',
                             message='Raw board register; semantics not verified')
                device.update(state='online', last_seen=now, packet_error=device['packet_error'] | error)
                if register.name == 'IMU TIMESTAMP':
                    previous = device.get('sample_activity')
                    changed = previous is not None and previous['raw'] != raw
                    last_change = now if previous is None or changed else previous['last_change']
                    device['sample_activity'] = dict(raw=raw, observed_at=now, last_change=last_change,
                        state='changed' if changed else 'unchanged' if now - last_change >= 5 else 'observing')
            except OSError:
                raise
            except Exception as exc:
                field['failures'] += 1
                for other in fields.values():
                    other.update(status='read_error', message=str(exc))
                device.update(state='offline', health='unknown', message=str(exc))
                invalidate_hand(device, 'Hand controller register read failed; device was not checked')
                device.pop('sample_activity', None)
                self.retry_at[(index, device['id'])] = time.monotonic() + 5
                return
        # Board policy: a successfully collected zero error code is healthy.
        # Nonzero codes are errors without applying a motor-specific decoder.
        error_field = fields.get('Error_Code')
        if device.get('model_name') in {'hx5_d20_rl', 'hx5_d20_rr'}:
            errors = [fields.get(name) for name in ('Hardware Error Status', 'Status')]
            messages = []
            for name, field in zip(('Hardware Error Status', 'Status'), errors):
                if field is None or field['raw'] is None:
                    continue
                raw = field['raw']
                parts = (["Input voltage error"] if raw & 0x01 else []) + (["Bus watchdog error"] if raw & 0x40 else [])
                if raw & ~0x41:
                    parts.append(f'Unknown bits 0x{raw & ~0x41:02X}')
                field['status'] = 'error' if raw else 'ok'
                field['message'] = ', '.join(parts) if parts else 'No reported error'
                if raw:
                    messages.append(f"{field['message']} · 0x{raw:02X}")
            voltage = [fields.get(name) for name in ('Present Input Voltage', 'Min Voltage Limit', 'Max Voltage Limit')]
            voltage_available = all(field and field['value'] is not None and field['unit'] == 'V' for field in voltage)
            if voltage_available and not voltage[1]['value'] <= voltage[0]['value'] <= voltage[2]['value']:
                messages.append('Input voltage outside configured limits')
            if messages:
                device.update(health='error', message='; '.join(messages))
            elif any(field is None or field['raw'] is None for field in errors):
                device.update(health='unknown', message='Controller error status unavailable')
            elif not voltage_available:
                device.update(health='unknown', message='Controller voltage or limits unavailable')
            else:
                device.update(health='ok', message=None)
        elif error_field and error_field['raw'] is not None:
            error_field['status'] = 'ok' if error_field['raw'] == 0 else 'error'
            error_field['message'] = ('No reported board error' if error_field['raw'] == 0
                                      else f"Board error 0x{error_field['raw']:X}")
            device['health'] = error_field['status']
            device['message'] = None if device['health'] == 'ok' else error_field['message']
        else:
            device.update(health='unknown', message='Board error code unavailable')
        report_packet_alert(device)

    def read_device(self, index, device):
        if device['kind'] == 'dxl':
            self.read_motor(index, device)
        elif device.get('expected') and device['kind'] in {'sensor', 'controller'}:
            self.read_board(index, device)
            if device['state'] == 'online' and is_hand_controller(device):
                read_hand(self, index, device)

    def read_motor(self, index, device, extra_fields=()):
        table = self.tables.get((index, device['id']))
        if device.get('expected_model', device['model_number']) != device['model_number']:
            return
        if table is None:
            if device['packet_error'] & 0x80:
                device.update(health='error', message='Device reported hardware alert; model registers unavailable')
            else:
                device.update(health='unknown', message='Unknown model: register reads skipped')
            return
        fields = device['fields']
        for name in dict.fromkeys([*field_names(table), *(name for name in extra_fields if name in table.registers)]):
            if self.stop.is_set():
                return
            register = table.registers[name]
            field = fields.setdefault(name, dict(value=None, raw=None, unit=register.unit,
                last_success=None, status='unknown', message='', failures=0))
            try:
                raw, error = self.handles[index].read(device['id'], register)
                now = time.time()
                field.update(raw=raw, value=register.decode(raw), last_success=now, status='ok', message='')
                device.update(state='online', last_seen=now, packet_error=device['packet_error'] | error, message=None)
            except OSError:
                raise
            except Exception as exc:
                field['failures'] += 1
                device['failures'] += 1
                field.update(status='read_error', message=str(exc))
                # Abort the device's remaining reads on a failed transaction.
                # Its old measurements remain explicitly invalid, not fresh zeros.
                for other in fields.values():
                    if other is not field:
                        other.update(status='read_error', message='Device read interrupted')
                device.update(state='offline', health='unknown', message=str(exc))
                self.retry_at[(index, device['id'])] = time.monotonic() + 5
                return
        device['health'] = classify_fields(fields, table, self.temperature_margin)
        if device['packet_error'] & 0x80:
            device.update(health='error', message='Device reported hardware alert')

    def connect_bus(self, index, bus):
        handle = self.bus_factory(bus['port'], bus['baud_rate'])
        self.handles[index] = handle
        bus['state'] = 'open'
        self.publish()
        found, error = handle.discover()
        bus['discovery_error'] = error
        expected_ids = {d['id'] for d in bus['devices']}
        virtual_ids = {d['id'] for d in bus['virtual_devices']}
        for device_id in sorted(set(found) - expected_ids - virtual_ids):
            bus['devices'].append(dict(id=device_id, name=f'Additional ID {device_id}',
                system=bus['systems'][0], kind='discovered', expected=False, aliases=[],
                state='pending', health='unknown', fields={}, last_seen=None,
                failures=0, message=None, packet_error=0))
        self.publish()

    def open_bus(self, index, bus):
        """One-shot CLI checks retain three bounded initial PING attempts."""
        self.connect_bus(index, bus)
        for device in bus['devices']:
            if self.stop.is_set():
                break
            if self.identify(index, device, attempts=3):
                self.read_device(index, device)
            self.publish()

    def monitor_bus(self, index, bus, interval):
        self.connect_bus(index, bus)
        pending = deque(bus['devices'])
        next_read = {}
        reads_since_probe = 0
        while not self.stop.is_set():
            self.process_calibrations(index)
            now = time.monotonic()
            due = [d for d in bus['devices'] if d['state'] == 'online'
                   and next_read.get(d['id'], 0) <= now]
            retry = [d for d in bus['devices'] if d['state'] == 'offline'
                     and self.retry_at.get((index, d['id']), 0) <= now]
            probe = pending[0] if pending else min(retry,
                key=lambda d: self.retry_at.get((index, d['id']), 0), default=None)
            # Prefer overdue reads, but reserve a probe after four reads so a
            # busy bus cannot indefinitely starve undiscovered/offline devices.
            if due and (probe is None or reads_since_probe < 4):
                device = min(due, key=lambda d: next_read.get(d['id'], 0))
                table = self.tables.get((index, device['id']))
                can_read_motor = (device['kind'] == 'dxl' and table is not None
                    and device.get('expected_model', device['model_number']) == device['model_number']
                    and bool(field_names(table)))
                if can_read_motor:
                    # Collect alert bits for this acquisition, not earlier cycles.
                    device['packet_error'] = 0
                    self.read_motor(index, device)
                elif self.identify(index, device):
                    self.read_device(index, device)
                reads_since_probe += 1
            elif probe is not None:
                device = pending.popleft() if pending else probe
                if self.identify(index, device):
                    self.read_device(index, device)
                reads_since_probe = 0
            else:
                deadlines = [next_read.get(d['id'], now) if d['state'] == 'online'
                    else self.retry_at.get((index, d['id']), now + interval)
                    for d in bus['devices']]
                self.stop.wait(max(0.001, min(deadlines, default=now + interval) - now))
                continue
            next_read[device['id']] = time.monotonic() + interval
            self.publish()

    def fail_bus(self, index, bus, exc):
        bus.update(state='error', error=str(exc))
        handle = self.handles.pop(index, None)
        if handle:
            try:
                handle.close()
            except Exception as close_error:
                bus['error'] += f'; closing port: {close_error}'
        for device in bus['devices']:
            device.update(state='offline', health='unknown', message=str(exc))
            invalidate_hand(device, 'Port connection failed; device was not checked')
            device.pop('sample_activity', None)
            for field in device['fields'].values():
                field.update(status='read_error', message='Bus disconnected')

    def run(self, watch=False, interval=1.0):
        if interval <= 0:
            raise ValueError('Read interval must be positive')
        updates = Queue(maxsize=max(4, len(self.snapshot['buses']) * 4))
        workers, threads = [], []

        def enqueue(index, snapshot):
            # Each worker owns its mutable bus data. Only detached snapshots
            # cross threads; the coordinator alone emits ordered NDJSON.
            bus = copy.deepcopy(snapshot['buses'][0])
            while not self.stop.is_set():
                try:
                    updates.put((index, bus), timeout=0.1)
                    return
                except Full:
                    pass

        def operate(worker):
            bus = worker.snapshot['buses'][0]
            try:
                if not self.stop.is_set():
                    if watch:
                        worker.monitor_bus(0, bus, interval)
                    else:
                        worker.open_bus(0, bus)
            except Exception as exc:
                if bus['state'] != 'error':
                    worker.fail_bus(0, bus, exc)
                worker.publish()
            finally:
                handle = worker.handles.pop(0, None)
                if handle:
                    try:
                        handle.close()
                    except Exception as exc:
                        worker.fail_bus(0, bus, exc)
                        worker.publish()

        try:
            self.snapshot['state'] = 'running'
            self.publish()
            for index, bus in enumerate(self.config['buses']):
                config = {**self.config, 'buses': [bus], 'excluded': []}
                worker = Runner(config, self.catalog, self.stop,
                    lambda snapshot, i=index: enqueue(i, snapshot),
                    self.bus_factory, self.temperature_margin, [self.command_queues[index]])
                workers.append(worker)
                thread = threading.Thread(target=operate, args=(worker,), name=f'diagnostics-bus-{index}')
                thread.start()
                threads.append(thread)
            while True:
                try:
                    index, bus = updates.get(timeout=0.1)
                    self.snapshot['buses'][index] = bus
                    self.publish()
                    bus.pop('calibration_result', None)
                except Empty:
                    if not any(thread.is_alive() for thread in threads):
                        if not watch or self.stop.is_set():
                            break
                        # Keep port failures visible until the user stops.
                        # Device timestamps are not refreshed by this heartbeat.
                        self.stop.wait(interval)
                        self.publish()
            for thread in threads:
                thread.join()
            for index, worker in enumerate(workers):
                self.snapshot['buses'][index] = copy.deepcopy(worker.snapshot['buses'][0])
            # Workers have closed their own ports before a terminal result.
            self.snapshot['state'] = 'stopped' if self.stop.is_set() else 'completed'
            self.snapshot['finished_at'] = time.time()
            self.publish()
            return 0 if self.snapshot['health'] in {'ok', 'warning'} else 1
        finally:
            if any(thread.is_alive() for thread in threads):
                self.stop.set()
            for thread in threads:
                thread.join()
