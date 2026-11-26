"""Control-table metadata and small, explicit diagnostic conversion rules."""

from dataclasses import dataclass
from pathlib import Path
import re


@dataclass(frozen=True)
class Register:
    address: int
    size: int
    name: str
    scale: float = 1.0
    unit: str = 'raw'
    signed: bool = False
    offset: float = 0.0

    def decode(self, value):
        if self.signed and value & (1 << (self.size * 8 - 1)):
            value -= 1 << (self.size * 8)
        return value * self.scale + self.offset


TEMPERATURES = {
    'Present Temperature': 'Temperature Limit',
    'Present Inverter Temperature': 'Inverter Temperature Limit',
    'Present Motor Temperature': 'Motor Temperature Limit',
}
Y_ERRORS = {
    1: 'Over voltage', 2: 'Low voltage', 3: 'Inverter overheating',
    4: 'Motor overheating', 5: 'Overload', 7: 'Inverter error',
    9: 'Multi-turn battery warning', 10: 'Battery error',
    11: 'Magnet error (position lost)', 12: 'Multi-turn IC error',
    13: 'Encoder error', 14: 'Hall sensor error', 15: 'Calibration error',
    17: 'Following error', 18: 'Bus watchdog', 19: 'Overspeed', 20: 'Position limit',
}
X_BITS = {0: 'Input voltage', 2: 'Overheating', 3: 'Motor encoder',
          4: 'Electrical shock', 5: 'Overload'}
TACTILE_BITS = {0: 'Input voltage', 1: 'Barometer', 2: 'Overheating', 4: 'Electrical shock'}

# Supplemental information for installed tables that omit documented fields
# or units. Never replace an existing definition or overlap another register.
HAND_EXTRA_REGISTERS = {'Max Voltage Limit': (60, 2), 'Min Voltage Limit': (62, 2),
                        'Hardware Error Status': (71, 1)}
VOLTAGE_UNITS = {'hx5_d20_rl': (102, 2, 0.01), 'hx5_d20_rr': (102, 2, 0.01),
                 'xm335_t323': (144, 2, 0.1)}


class ModelTable:
    def __init__(self, path):
        self.name = Path(path).stem
        units, registers, section = {}, {}, ''
        # Some board tables repeat field names at different addresses.
        self.registers_by_address = {}
        self.registers_by_name = {}
        for line in Path(path).read_text().splitlines():
            line = line.strip()
            if line.startswith('['):
                section = line
            elif section == '[unit info]':
                parts = [p.strip() for p in line.split('\t') if p.strip()]
                if len(parts) == 5 and parts[0] != 'Data Name':
                    units[parts[0]] = (float(parts[1]), parts[2], parts[3] == 'signed', float(parts[4]))
            elif section == '[control table]' and re.match(r'^\d+\s', line):
                address, size, name = re.split(r'\s+', line, maxsplit=2)
                registers[name] = (int(address), int(size))
                register = Register(int(address), int(size), name)
                self.registers_by_address[int(address)] = register
                self.registers_by_name.setdefault(name, []).append(register)
        voltage = VOLTAGE_UNITS.get(self.name)
        if voltage and registers.get('Present Input Voltage') == voltage[:2]:
            units.setdefault('Present Input Voltage', (voltage[2], 'V', False, 0.0))
        if (self.name in {'hx5_d20_rl', 'hx5_d20_rr'}
                and registers.get('Present Input Voltage') == (102, 2)
                and registers.get('Table Sync Enable') == (70, 1)):
            for name, (address, size) in HAND_EXTRA_REGISTERS.items():
                if name in self.registers_by_name:
                    continue
                if any(address < other.address + other.size and other.address < address + size
                       for entries in self.registers_by_name.values() for other in entries):
                    continue
                register = Register(address, size, name)
                registers[name] = (address, size)
                self.registers_by_address[address] = register
                self.registers_by_name[name] = [register]
        self.registers = {}
        for name, (address, size) in registers.items():
            conversion = units.get(name)
            # Temperature units for the supported X/Y control tables are degrees C.
            if conversion is None and (name in TEMPERATURES or name in TEMPERATURES.values()):
                conversion = (1.0, '°C', False, 0.0)
            if conversion is None and name in {'Min Voltage Limit', 'Max Voltage Limit'}:
                conversion = units.get('Present Input Voltage')
            self.registers[name] = Register(address, size, name, *(conversion or (1.0, 'raw', False, 0.0)))

    def error(self, name, value):
        if not value:
            return 'ok', 'No reported error'
        if name == 'Error Code' and self.name.startswith('ym'):
            return ('warning' if value == 9 else 'error'), Y_ERRORS.get(value, f'Unknown error 0x{value:X}')
        if name == 'Hardware Error Status' and (self.name.startswith('x') or self.name == 'hx_sensor_tip'):
            bits = TACTILE_BITS if self.name == 'hx_sensor_tip' else X_BITS
            return 'error', ', '.join(bits.get(bit, f'Unknown bit {bit}')
                                     for bit in range(8) if value & (1 << bit))
        return 'error', f'Raw error 0x{value:X} (model-specific decoding unavailable)'


class Catalog:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.files = {}
        self.cache = {}
        for line in (self.directory / 'dynamixel.model').read_text().splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0].isdigit():
                self.files[int(parts[0])] = parts[1]

    def get(self, model):
        # The tactile sensor is directly addressed in bypass; its xacro model
        # describes a SyncTable proxy, not this physical control table.
        if model in {250, 253}:
            if model not in self.cache:
                self.cache[model] = ModelTable(Path(__file__).parent / 'hx_sensor_tip.model')
            return self.cache[model]
        if model not in self.files:
            return None
        if model not in self.cache:
            try:
                self.cache[model] = ModelTable(self.directory / self.files[model])
            except FileNotFoundError:
                return None
        return self.cache[model]


def classify_fields(fields, table, temperature_margin=5.0):
    """Never turn failed/missing measurements or unknown units into an OK result."""
    statuses = []
    for name, field in fields.items():
        if field['status'] == 'read_error':
            statuses.append('unknown')
            continue
        if field['value'] is None:
            continue
        field['status'], field['message'] = 'ok', ''
        if name in {'Hardware Error Status', 'Error Code'}:
            field['status'], field['message'] = table.error(name, field['raw'])
        elif name == 'Present Input Voltage':
            low, high = fields.get('Min Voltage Limit', {}), fields.get('Max Voltage Limit', {})
            if field['unit'] != 'V' or any(v.get('status') == 'read_error' or v.get('value') is None
                                          or v.get('unit') != 'V' for v in (low, high)):
                field['status'], field['message'] = 'unknown', 'Voltage limits or units unavailable'
            elif not low['value'] <= field['value'] <= high['value']:
                field['status'], field['message'] = 'error', 'Outside configured voltage limits'
        elif name in TEMPERATURES:
            limit = fields.get(TEMPERATURES[name], {})
            if limit.get('value') is None or limit.get('status') == 'read_error':
                field['status'], field['message'] = 'unknown', 'Configured temperature limit unavailable'
            elif field['value'] >= limit['value']:
                field['status'], field['message'] = 'error', 'At or above configured temperature limit'
            elif field['value'] >= limit['value'] - temperature_margin:
                field['status'], field['message'] = 'warning', 'Diagnostic temperature warning margin'
        statuses.append(field['status'])
    # Error status, voltage and at least one temperature are required for a motor verdict.
    for names in ({'Hardware Error Status', 'Error Code'}, {'Present Input Voltage'}, set(TEMPERATURES)):
        if not any(fields.get(n, {}).get('value') is not None for n in names):
            statuses.append('unknown')
    return worst_status(statuses)


def worst_status(statuses):
    return next((s for s in ('error', 'unknown', 'warning') if s in statuses), 'ok')


def report_packet_alert(device):
    """Keep a decoded board error when a response also carries an alert."""
    if device.get('state') != 'online' or not device.get('packet_error', 0) & 0x80:
        return
    if device.get('health') != 'error' or not device.get('message'):
        device['message'] = 'Hardware alert reported'
    device['health'] = 'error'
