"""Resolve installed robot descriptions without starting ROS."""

from pathlib import Path
from dataclasses import dataclass
import os
import re
import xml.etree.ElementTree as ET

from .hands import is_hand_controller


@dataclass(frozen=True)
class Profile:
    label: str
    folder: str
    stem: str
    required_packages: tuple[str, ...] = ()


PROFILES = {
    'w1': Profile('W1', 'w1_follower', 'w1_follower'),
    'w2': Profile('W2', 'w2_follower', 'w2_follower'),
    'sg2': Profile('SG2', 'ffw_sg2_rev1_follower', 'ffw_sg2_follower'),
    'bg2': Profile('BG2 rev4', 'ffw_bg2_rev4_follower', 'ffw_bg2_follower'),
    'sh5': Profile('SH5', 'ffw_sh5_rev1_follower', 'ffw_sh5_follower', ('robotis_hand_description',)),
    'bh5': Profile('BH5', 'ffw_bh5_rev1_follower', 'ffw_bh5_follower', ('robotis_hand_description',)),
    'a1': Profile('A1 leader', 'ffw_a1_leader', 'ffw_a1_leader'),
    'a2': Profile('A2 leader', 'ffw_a2_leader', 'ffw_a2_leader'),
    'lg2': Profile('LG2 leader', 'ffw_lg2_leader', 'ffw_lg2_leader'),
}


def package_share(name):
    from ament_index_python.packages import get_package_share_directory
    return Path(get_package_share_directory(name))


def list_profiles():
    result = []
    for key, profile in PROFILES.items():
        reason = None
        try:
            path = package_share('ffw_description') / 'urdf' / profile.folder / f'{profile.stem}.urdf.xacro'
            if not path.is_file():
                raise FileNotFoundError(str(path))
            for package in profile.required_packages:
                try:
                    package_share(package)
                except Exception as exc:
                    raise RuntimeError(f'Required package {package} is unavailable: {exc}') from exc
        except Exception as exc:
            reason = str(exc)
        result.append(dict(id=key, label=profile.label,
                           available=reason is None, reason=reason))
    return result


def params(element):
    return {p.get('name'): (p.text or '').strip() for p in element.findall('param')}


def parse_description(xml, overrides=None, baud_rates=None):
    """Group by physical port; virtual IDs are routed through hand inspection."""
    overrides = overrides or {}
    baud_rates = baud_rates or {}
    if any(type(rate) is not int or rate <= 0 for rate in baud_rates.values()):
        raise ValueError("Baud rate overrides must be positive integers")
    root = ET.fromstring(xml)
    buses = {}
    excluded = []
    systems = set()
    for system in root.findall('ros2_control'):
        name = system.attrib['name']
        systems.add(name)
        hw = system.find('hardware')
        if hw is None or hw.findtext('plugin') != 'dynamixel_hardware_interface/DynamixelHardware':
            excluded.append(dict(system=name, reason='Unsupported hardware plugin'))
            continue
        config = params(hw)
        port = overrides.get(name, config.get('port_name', ''))
        if not port.startswith('/dev/') or '\x00' in port:
            raise ValueError(f'{name}: invalid device path {port!r}')
        baud = baud_rates.get(name, int(config['baud_rate']))
        if baud <= 0:
            raise ValueError(f'{name}: invalid baud rate')
        real_port = os.path.realpath(port)
        bus = buses.setdefault(real_port, dict(port=port, real_port=real_port,
            baud_rate=baud, systems=[], devices=[], virtual_devices=[]))
        if bus['baud_rate'] != baud:
            raise ValueError(f'Conflicting baud rates on {real_port}')
        bus['systems'].append(name)
        for gpio in system.findall('gpio'):
            cfg = params(gpio)
            kind = cfg.get('type', '')
            device_id = int(cfg['ID'])
            if not 0 <= device_id <= 252:
                raise ValueError(f'{name}/{gpio.get("name")}: invalid ID')
            device = dict(id=device_id, name=gpio.attrib['name'], system=name,
                          kind=kind, expected=True)
            if kind in {'virtual_dxl', 'virtual_sensor'}:
                device.update(comm_id=int(cfg['comm_id']),
                              reason='Virtual device accessed through its configured controller')
                if not 0 <= device['comm_id'] <= 252:
                    raise ValueError(f'{name}: invalid communication ID')
                if 'model_num' in cfg:
                    device['virtual_model'] = int(cfg['model_num'])
                bus['virtual_devices'].append(device)
            elif kind in {'dxl', 'controller', 'sensor'}:
                # Keep only read-mapping expectations, never initialization writes.
                mapping = {key: int(value) for key, value in cfg.items()
                           if re.fullmatch(r'SyncTable \d+ (ID|Read Address|Read Size) \d+', key)}
                if mapping:
                    device['sync_mapping'] = mapping
                if 'model_num' in cfg:
                    device['expected_model'] = int(cfg['model_num'])
                existing = next((d for d in bus['devices'] if d['id'] == device_id), None)
                if existing and (existing['kind'], existing.get('expected_model')) != (
                    kind, device.get('expected_model')
                ):
                    raise ValueError(f'Conflicting definitions for {real_port} ID {device_id}')
                if existing:
                    for key, value in mapping.items():
                        previous = existing.setdefault('sync_mapping', {}).setdefault(key, value)
                        if previous != value:
                            raise ValueError(f'Conflicting SyncTable setting: {key}')
                    existing['aliases'].append(f'{name}/{device["name"]}')
                else:
                    device['aliases'] = [f'{name}/{device["name"]}']
                    bus['devices'].append(device)
            else:
                excluded.append(dict(system=name, name=device['name'], reason=f'Unsupported type: {kind}'))
    unknown = (set(overrides) | set(baud_rates)) - systems
    if unknown:
        raise ValueError(f'Unknown system override: {sorted(unknown)}')
    if not buses:
        raise ValueError('No DYNAMIXEL systems found in the description')
    for bus in buses.values():
        parents = {device['id']: device for device in bus['devices'] if is_hand_controller(device)}
        virtual = {}
        for child in bus['virtual_devices']:
            if child['kind'] != 'virtual_dxl' or child['comm_id'] not in parents:
                continue
            previous = virtual.get(child['id'])
            if previous and previous['comm_id'] != child['comm_id']:
                raise ValueError(f"Conflicting controller ownership for {bus['real_port']} ID {child['id']}")
            if previous:
                if previous.get('virtual_model') != child.get('virtual_model'):
                    raise ValueError(f"Conflicting virtual model for {bus['real_port']} ID {child['id']}")
                previous.setdefault('declarations', []).append(dict(child))
            else:
                child['declarations'] = [{key: value for key, value in child.items() if key != 'declarations'}]
                virtual[child['id']] = child
        bus['virtual_devices'] = [v for v in bus['virtual_devices']
                                  if v['kind'] != 'virtual_dxl' or v['comm_id'] not in parents
                                  or v is virtual[v['id']]]
        retained = []
        for device in bus['devices']:
            child = virtual.get(device['id'])
            if child is None:
                retained.append(device)
            elif device['kind'] not in {'dxl', 'controller'} or is_hand_controller(device):
                raise ValueError(f"Conflicting definitions for {bus['real_port']} ID {device['id']}")
            else:
                child['declarations'].append(dict(device))
        bus['devices'] = retained
    return dict(buses=list(buses.values()), excluded=excluded)


def resolve_profile(profile, overrides=None, baud_rates=None):
    if profile not in PROFILES:
        raise ValueError(f'Unknown profile: {profile}')
    import xacro
    selected = PROFILES[profile]
    path = package_share('ffw_description') / 'urdf' / selected.folder / f'{selected.stem}.urdf.xacro'
    document = xacro.process_file(str(path), mappings={
        'use_sim': 'false', 'use_mock_hardware': 'false', 'model': selected.folder,
    })
    result = parse_description(document.toxml(), overrides, baud_rates)
    result.update(profile=profile, label=selected.label, description=str(path))
    return result
