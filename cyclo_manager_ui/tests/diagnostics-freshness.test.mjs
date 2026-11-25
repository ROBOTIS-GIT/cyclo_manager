import test from 'node:test';
import assert from 'node:assert/strict';
import { entriesFor, handGroupsFor, handStatus, handJointLabel, communicationIssue, deviceStatus, handEntriesFor, inspectionCounts, inspectionDevices, issueText, modelAssessment, measurementText, sampleIsStale, validMeasurement } from '../components/diagnostics/diagnosticView.ts';

const reading = { value: 24.1, raw: 241, unit: 'V', last_success: 100, status: 'ok', message: '', failures: 0 };
const device = { state: 'online', health: 'ok', last_seen: 100 };
const live = { live: true };

test('port failure marks every affected device, including devices not yet inspected', () => {
  const bus = { port: '/dev/follower', state: 'error', error: 'Permission denied' };
  for (const state of ['pending', 'online', 'offline']) {
    assert.equal(deviceStatus({ ...device, state }, 101, live, bus), 'communication');
  }
  assert.equal(deviceStatus(device, 101, live, { state: 'open' }), 'ok');
  assert.match(issueText({ device, bus }, 101, live), /Permission denied/);
  assert.match(issueText({ device, bus }, 101, live), /Device health could not be checked/);
});

test('port failures take precedence over stale readings and clear after recovery', () => {
  assert.equal(deviceStatus(device, 130, live, { state: 'error' }), 'communication');
  assert.equal(deviceStatus(device, 130, live, { state: 'open', error: null }), 'stale');
  assert.equal(deviceStatus({ ...device, last_seen: 130 }, 130, live, { state: 'open', error: null }), 'ok');
});

test('missing serial dependency is distinguished from a port-open failure', () => {
  const bus = { port: '/dev/follower', state: 'error', error: "No module named 'serial'" };
  const issue = communicationIssue({ device, bus });
  assert.equal(issue.title, 'Diagnostic dependency missing');
  assert.match(issue.message, /Python serial package/);
  assert.equal(deviceStatus(device, 101, live, bus), 'communication');
});

test('pending devices stay uninspected while the first response is immediately usable', () => {
  assert.equal(deviceStatus({ state: 'pending', health: 'unknown', last_seen: null }, 101, live), 'pending');
  assert.equal(deviceStatus(device, 101, live), 'ok');
  assert.equal(measurementText(reading, 101, live), '24.1 V');
  assert.equal(validMeasurement(reading, 101, live), true);
});

test('an unresponsive device does not invalidate a recently refreshed device', () => {
  assert.equal(deviceStatus({ ...device, state: 'offline', health: 'unknown' }, 130, live), 'communication');
  assert.equal(deviceStatus({ ...device, last_seen: 129 }, 130, live), 'ok');
  assert.equal(measurementText({ ...reading, last_success: 129 }, 130, live), '24.1 V');
});

test('PING failure identifies only the affected device, not the open port', () => {
  const bus = { state: 'open', port: '/dev/follower' };
  const offline = { ...device, state: 'offline', health: 'unknown', fields: {}, message: 'No status packet' };
  assert.equal(deviceStatus(offline, 101, live, bus), 'communication');
  assert.equal(communicationIssue({ device: offline, bus }).title, 'No PING response');
  assert.equal(deviceStatus(device, 101, live, bus), 'ok');
});

test('failed register reads override stale data and name the original failed transaction', () => {
  const fields = {
    'Error Code': { ...reading, status: 'read_error', message: 'Device read interrupted' },
    'Present Input Voltage': { ...reading, status: 'read_error', message: 'No status packet' },
  };
  const failed = { ...device, fields, state: 'offline', health: 'unknown', message: 'No status packet' };
  const bus = { state: 'open' };
  assert.equal(deviceStatus(failed, 130, live, bus), 'communication');
  assert.equal(deviceStatus({ ...failed, state: 'online' }, 130, live, bus), 'communication');
  assert.equal(communicationIssue({ device: failed, bus }).title, 'Read failed · Present Input Voltage');
  assert.equal(deviceStatus({ ...device, fields: { 'Present Input Voltage': reading } }, 101, live, bus), 'ok');
});

test('unverified board readings remain distinct from communication failures', () => {
  const bus = { state: 'open' };
  const board = { ...device, health: 'unknown', fields: { Error_Code: { ...reading, status: 'raw' } } };
  assert.equal(deviceStatus(board, 101, live, bus), 'unknown');
  const failed = { ...board, fields: {
    Error_Code: { ...reading, status: 'read_error', message: 'No status packet' },
    Millis: { ...reading, status: 'read_error', message: 'No status packet' },
  } };
  assert.equal(communicationIssue({ device: failed, bus }).title, 'Register read failed');
});

test('fresh supported board error codes use zero/nonzero health policy, including older worker snapshots', () => {
  const board = { ...device, kind: 'controller', expected: true, board_telemetry: 'supported', health: 'unknown', packet_error: 0,
    fields: { Error_Code: { ...reading, raw: 0, value: 0, unit: 'raw', status: 'raw' } } };
  assert.equal(deviceStatus(board, 101, live), 'ok');
  const error = { ...board, fields: { Error_Code: { ...board.fields.Error_Code, raw: 9, value: 9 } } };
  assert.equal(deviceStatus(error, 101, live), 'error');
  assert.match(issueText({ device: error, bus: { state: 'open' } }, 101, live), /Board error code · 0x9/);
  assert.equal(deviceStatus({ ...board, packet_error: 128 }, 101, live), 'error');
  assert.equal(deviceStatus({ ...board, health: 'error', message: 'Model number differs from configuration' }, 101, live), 'error');
});

test('zero board codes cannot hide missing, failed, stale or unsupported readings', () => {
  const board = { ...device, kind: 'sensor', expected: true, board_telemetry: 'supported', health: 'unknown', packet_error: 0,
    fields: { Error_Code: { ...reading, raw: 0, value: 0, unit: 'raw', status: 'raw' } } };
  assert.equal(deviceStatus({ ...board, fields: {} }, 101, live), 'unknown');
  assert.equal(deviceStatus({ ...board, board_telemetry: 'unsupported' }, 101, live), 'unknown');
  assert.equal(deviceStatus({ ...board, last_seen: 110 }, 110, live), 'stale');
  assert.equal(deviceStatus({ ...board, fields: { Error_Code: { ...board.fields.Error_Code, status: 'read_error' } } }, 101, live), 'communication');
  assert.equal(deviceStatus({ ...board, fields: { ...board.fields, Millis: { ...reading, status: 'read_error' } } }, 101, live), 'communication');
});

test('each live measurement expires after three seconds without a startup exemption', () => {
  assert.equal(deviceStatus(device, 103, live), 'ok');
  assert.equal(deviceStatus(device, 103.1, live), 'stale');
  assert.equal(measurementText(reading, 103.1, live), 'Stale data');
  assert.equal(validMeasurement(reading, 103.1, live), false);
  assert.equal(deviceStatus({ ...device, last_seen: 104 }, 104, live), 'ok');
  assert.equal(measurementText(reading, 104, live), 'Stale data');
});

test('failures and missing readings cannot appear healthy while monitoring', () => {
  assert.equal(deviceStatus({ ...device, health: 'error' }, 101, live), 'error');
  assert.equal(measurementText({ ...reading, status: 'read_error' }, 101, live), 'Read failed');
  assert.equal(validMeasurement({ ...reading, status: 'read_error' }, 101, live), false);
  assert.equal(measurementText({ ...reading, value: null }, 101, live), 'Not measured');
  assert.equal(validMeasurement({ ...reading, value: null }, 101, live), false);
  assert.equal(sampleIsStale(null, 101, live), true);
});

test('a successful refresh restores values without resetting other device states', () => {
  assert.equal(deviceStatus(device, 130, live), 'stale');
  assert.equal(deviceStatus({ ...device, last_seen: 130 }, 130, live), 'ok');
  assert.equal(measurementText({ ...reading, last_success: 130 }, 130, live), '24.1 V');
});

test('hand controller cache stays unknown and preserves the access explanation', () => {
  const hand = { ...device, kind: 'controller', expected: true, health: 'unknown', fields: {},
    hand: { mode: 'sync_table', devices: [] }, message: 'Controller cache only; motor freshness unverified' };
  assert.equal(deviceStatus(hand, 101, live), 'unknown');
  assert.equal(issueText({ device: hand, bus: { state: 'open' } }, 101, live), hand.message);
  assert.equal(deviceStatus({ ...device, kind: 'dxl', state: 'cached', health: 'unknown', last_seen: null }, 101, live), 'unknown');
});


test('hand motor counts use configured IDs and current direct results', () => {
  const parent = { ...device, id: 140, name: 'hand_l_controller', system: 'hand', kind: 'controller', expected: true,
    sync_mapping: { 'SyncTable 1 ID 1': 141 }, fields: {}, hand: undefined };
  const bus = { real_port: '/dev/test', state: 'open', devices: [parent],
    virtual_devices: [{ id: 141, name: 'dxl141', system: 'hand', kind: 'virtual_dxl', comm_id: 140 }] };
  const pending = handEntriesFor([{ ...bus, devices: [{ ...parent, state: 'pending' }] }]);
  assert.equal(pending.length, 1);
  assert.equal(deviceStatus(pending[0].device, 101, live, pending[0].bus), 'pending');
  const failed = handEntriesFor([{ ...bus, state: 'error', error: 'Permission denied' }]);
  assert.equal(deviceStatus(failed[0].device, 101, live, failed[0].bus), 'communication');
  const online = { ...device, id: 141, name: 'dxl141', system: 'hand', kind: 'dxl', expected: true, fields: {}, access: 'direct' };
  const read = handEntriesFor([{ ...bus, devices: [{ ...parent, hand: { devices: [online] } }] }]);
  assert.equal(deviceStatus(read[0].device, 101, live, read[0].bus), 'ok');
  assert.equal(read[0].device.comm_id, 140);
  assert.match(read[0].key, /hand:140:hand:141/);
});

test('configured hand tactile sensors are shown and tracked independently', () => {
  const parent = { ...device, id: 140, name: 'hand_l_controller', system: 'hand', kind: 'controller', expected: true,
    sync_mapping: { 'SyncTable 1 ID 1': 141 }, fields: {}, hand: undefined };
  const bus = { real_port: '/dev/test', state: 'open', devices: [parent],
    virtual_devices: [{ id: 145, name: 'tip145', system: 'hand', kind: 'virtual_sensor', comm_id: 140 }] };
  const entries = handEntriesFor([bus]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].device.kind, 'tactile');
  assert.equal(deviceStatus(entries[0].device, 101, live, bus), 'pending');
  const reading = { ...device, id: 145, name: 'tip145', system: 'hand', kind: 'tactile', expected: true, fields: {} };
  const liveEntries = handEntriesFor([{ ...bus, devices: [{ ...parent, hand: { devices: [reading] } }] }]);
  assert.equal(deviceStatus(liveEntries[0].device, 101, live, bus), 'ok');
});

test('hand children blocked by controller failure are not checked, while attempted pings are communication errors', () => {
  const parent = { ...device, id: 140, name: 'hand_l_controller', system: 'hand', kind: 'controller', expected: true,
    state: 'offline', sync_mapping: {}, fields: {}, hand: undefined };
  const bus = { real_port: '/dev/test', state: 'open', devices: [parent],
    virtual_devices: [{ id: 141, name: 'dxl141', system: 'hand', kind: 'virtual_dxl', comm_id: 140 }] };
  let child = handEntriesFor([bus])[0];
  assert.equal(deviceStatus(parent, 101, live, bus), 'communication');
  assert.equal(child.device.state, 'not_checked');
  assert.equal(deviceStatus(child.device, 101, live, bus), 'pending');
  assert.match(child.device.message, /controller.*device was not checked/i);
  const blocked = { ...child.device, message: 'Bypass switch could not be verified', state: 'not_checked' };
  child = handEntriesFor([{ ...bus, devices: [{ ...parent, hand: { devices: [blocked] } }] }])[0];
  assert.equal(deviceStatus(child.device, 101, live, bus), 'pending');
  assert.equal(child.device.message, 'Bypass switch could not be verified');
  const probed = { ...blocked, state: 'offline', access: 'direct_probe' };
  assert.equal(deviceStatus(probed, 101, live, bus), 'communication');
  const hand = handGroupsFor([{ key: 'controller', device: parent, bus }], [child])[0];
  assert.equal(handStatus(hand, 101, live), 'communication');
});


test('model mismatch and missing model definition are independent and require a fresh response', () => {
  const model = { ...device, fields: {}, model_number: 456, expected_model: 123, model_definition: 'unavailable' };
  assert.deepEqual(modelAssessment(model, 101, live), { match: 'Mismatch', definition: 'Unavailable', detected: 456 });
  assert.deepEqual(modelAssessment({ ...model, expected_model: 456, model_definition: 'available' }, 101, live), { match: 'Match', definition: 'Available', detected: 456 });
  assert.deepEqual(modelAssessment({ ...model, expected_model: undefined, model_definition: 'available' }, 101, live), { match: 'Not configured', definition: 'Available', detected: 456 });
  assert.deepEqual(modelAssessment({ ...model, expected_model: 456 }, 101, live), { match: 'Match', definition: 'Unavailable', detected: 456 });
  assert.deepEqual(modelAssessment({ ...model, state: 'offline' }, 101, live), { match: 'Not checked', definition: 'Not checked', detected: null });
  assert.deepEqual(modelAssessment(model, 110, live), { match: 'Not checked', definition: 'Not checked', detected: null });
  assert.equal(modelAssessment({ ...model, model_definition: undefined, model_name: undefined }, 101, live).definition, 'Not reported');
});


test('hand overview includes child failures and never turns incomplete checks green', () => {
  const bus = { real_port: '/dev/ttyUSB0', virtual_devices: [] };
  const controller = { key: 'controller', bus, device: { ...device, kind: 'controller', expected: true,
    id: 110, name: 'hand_r_controller', sync_mapping: {}, fields: {}, health: 'unknown' } };
  const motor = { key: 'motor', bus, device: { ...device, id: 111, comm_id: 110 } };
  const hand = handGroupsFor([controller], [motor])[0];
  assert.equal(hand.side, 'right');
  assert.equal(handStatus(hand, 101, live), 'unknown');
  assert.equal(handStatus({ ...hand, motors: [{ ...motor, device: { ...motor.device, health: 'error' } }] }, 101, live), 'error');
  assert.equal(handStatus({ ...hand, motors: [{ ...motor, device: { ...motor.device, state: 'offline' } }] }, 101, live), 'communication');
  assert.equal(handStatus({ ...hand, controller: { ...controller, device: { ...controller.device, state: 'pending' } },
    motors: [{ ...motor, device: { ...motor.device, state: 'pending' } }] }, 101, live), 'pending');
  assert.equal(handStatus(hand, 110, live), 'stale');
  assert.equal(handGroupsFor([controller], [{ ...motor, bus: { real_port: '/dev/other' } }])[0].motors.length, 0);
});

test('physical device entries use the normalized backend configuration', () => {
  const parent = { id: 110, name: 'hand_r_controller', kind: 'controller', expected: true, sync_mapping: {} };
  const init = { id: 111, name: 'dxl111_init', expected: true };
  const bus = { real_port: '/dev/ttyUSB0', devices: [parent, init, { id: 99, name: 'other', expected: true }],
    virtual_devices: [{ id: 111, comm_id: 110, kind: 'virtual_dxl' }] };
  assert.deepEqual(entriesFor([bus]).map(entry => entry.device.id), [110, 111, 99]);
  assert.equal(entriesFor([{ ...bus, virtual_devices: [] }]).length, 3);
  assert.equal(handJointLabel(111, 110), 'Thumb · CMC');
  assert.equal(handJointLabel(149, 140), 'Index · DIP');
});

test('other controllers with virtual motors do not create hand motor entries', () => {
  const rcu = { id: 200, name: 'ffw_g10_rcu', kind: 'controller', expected: true, sync_mapping: {} };
  const bus = { real_port: '/dev/ttyUSB0', devices: [rcu],
    virtual_devices: [{ id: 102, comm_id: 200, kind: 'virtual_dxl', system: 'base', name: 'wheel' }] };
  assert.deepEqual(handEntriesFor([bus]), []);
});

test('checklist includes configured hand DXL and tactile sensors but excludes other virtual devices', () => {
  const controller = { id: 110, name: 'hand_r_controller', kind: 'controller', system: 'follower', expected: true, sync_mapping: {} };
  const motor = { id: 1, name: 'dxl1', kind: 'dxl', system: 'follower', expected: true };
  const rcu = { id: 200, name: 'ffw_g10_rcu', kind: 'controller', system: 'base', expected: true };
  const bus = { real_port: '/dev/test', devices: [controller, motor, rcu], virtual_devices: [
    { id: 111, name: 'dxl111', system: 'follower', kind: 'virtual_dxl', comm_id: 110 },
    { id: 115, name: 'tip115', system: 'follower', kind: 'virtual_sensor', comm_id: 110 },
    { id: 102, name: 'wheel', system: 'base', kind: 'virtual_dxl', comm_id: 200 },
  ] };
  assert.equal(inspectionCounts(bus, 'follower'), '2 DXL · 1 tactile sensor · 1 controller');
  assert.deepEqual(inspectionDevices(bus, 'follower').map(item => item.id), [110, 1, 111, 115]);
  assert.equal(inspectionCounts(bus, 'base'), '1 controller');
  const offline = { ...controller, state: 'offline' };
  assert.equal(inspectionCounts({ ...bus, devices: [offline, motor, rcu] }, 'follower'), '2 DXL · 1 tactile sensor · 1 controller');
});

test('hand controller health requires fresh verified status and voltage readings', () => {
  const field = { ...reading, status: 'ok', last_success: 100 };
  const board = { ...device, expected: true, kind: 'controller', model_name: 'hx5_d20_rr', board_telemetry: 'supported', packet_error: 0,
    fields: Object.fromEntries(['Hardware Error Status', 'Status', 'Present Input Voltage', 'Min Voltage Limit', 'Max Voltage Limit'].map(name => [name, field])) };
  assert.equal(deviceStatus(board, 101, live), 'ok');
  const missing = { ...board.fields }; delete missing.Status;
  assert.equal(deviceStatus({ ...board, fields: missing }, 101, live), 'unknown');
  assert.equal(deviceStatus({ ...board, last_seen: 110 }, 110, live), 'stale');
  assert.equal(deviceStatus({ ...board, health: 'error' }, 101, live), 'error');
});
