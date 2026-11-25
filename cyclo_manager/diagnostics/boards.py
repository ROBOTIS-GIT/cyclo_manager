"""Explicit board READ allowlists; addresses come from installed model tables."""

from pathlib import Path

import yaml


class UniqueKeyLoader(yaml.SafeLoader):
    """Reject duplicated configuration keys rather than silently overriding them."""


def _mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if not isinstance(key, (str, int)) or key in result:
            raise ValueError(f'Duplicate or invalid YAML key: {key!r}')
        result[key] = loader.construct_object(value_node)
    return result


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


def load_board_config(path):
    """Validate a complete allowlist before any board register can be read."""
    try:
        with Path(path).open(encoding='utf-8') as stream:
            config = yaml.load(stream, Loader=UniqueKeyLoader)
        if not isinstance(config, dict) or set(config) != {'common_fields', 'models'}:
            raise ValueError('expected common_fields and models')

        def fields(value, context):
            if not isinstance(value, list) or any(not isinstance(v, str) or not v.strip() or v != v.strip() for v in value):
                raise ValueError(f'{context}: fields must be a list of nonempty names')
            if len(set(value)) != len(value):
                raise ValueError(f'{context}: duplicate field')
            return tuple(value)

        common = fields(config['common_fields'], 'common_fields')
        models = config['models']
        if not isinstance(models, dict) or not models:
            raise ValueError('models must be a nonempty mapping')
        by_number, extras, common_usage = {}, {}, {}
        for name, data in models.items():
            if not isinstance(name, str) or not name or name != name.strip():
                raise ValueError('invalid board model name')
            if not isinstance(data, dict) or not {'model_numbers', 'fields'} <= set(data) or set(data) - {'model_numbers', 'fields', 'use_common_fields'}:
                raise ValueError(f'{name}: expected model_numbers, fields and optional use_common_fields')
            use_common = data.get('use_common_fields', True)
            if type(use_common) is not bool:
                raise ValueError(f'{name}: use_common_fields must be boolean')
            common_usage[name] = use_common
            numbers = data['model_numbers']
            if not isinstance(numbers, list) or not numbers:
                raise ValueError(f'{name}: model_numbers must be a nonempty list')
            extras[name] = fields(data['fields'], name)
            if use_common and set(common) & set(extras[name]):
                raise ValueError(f'{name}: field duplicated in common_fields')
            for number in numbers:
                if type(number) is not int or not 0 <= number <= 65535 or number in by_number:
                    raise ValueError(f'{name}: invalid or duplicate model number {number!r}')
                by_number[number] = name
        return common, by_number, extras, common_usage
    except (OSError, yaml.YAMLError, ValueError, TypeError) as exc:
        raise ValueError(f'Invalid board diagnostic configuration {path}: {exc}') from exc


COMMON, BOARD_MODELS, EXTRA, COMMON_USAGE = load_board_config(Path(__file__).with_name('boards.yaml'))


def board_registers(model, table):
    """Resolve permitted names without guessing missing or ambiguous registers."""
    name = BOARD_MODELS.get(model)
    if table is None or name != table.name:
        return [], 'unsupported', []
    result, skipped = [], []
    for field in (COMMON if COMMON_USAGE[name] else ()) + EXTRA[name]:
        matches = table.registers_by_name.get(field, [])
        if len(matches) != 1:
            skipped.append(dict(name=field, reason='missing' if not matches else 'duplicate'))
            continue
        # The name index detects duplicates; the canonical table carries units
        # and conversion metadata from [unit info].
        register = table.registers[field]
        # SDK Protocol 2 uses 16-bit addresses. Board values in this diagnostic
        # are scalar readings; do not issue arbitrarily large reads from a table.
        if register.size not in (1, 2, 4) or not 0 <= register.address <= 0x10000 - register.size:
            skipped.append(dict(name=field, reason='invalid_layout'))
            continue
        result.append(register)
    return result, 'supported', skipped
