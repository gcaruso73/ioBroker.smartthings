# Clean TV Object Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add, for TV-category SmartThings devices only, a writable consolidated `control` channel and a read-only clean `state` mirror, without touching the existing raw `capabilities`/`general`/`status` tree.

**Architecture:** Pure, testable logic (TV detection, control command mapping, clean-state derivation) lives in a new `lib/tvtree.js` (upstream already uses `lib/`). `main.js` wires it in: object creation in `getDeviceList()`, command dispatch in `onStateChange()`, and clean-state population in `updateDevices()` and `_handleSseEvent()`.

**Tech Stack:** Node.js, `@iobroker/adapter-core`, `json2iob`, `axios`, `mocha` (existing dev dep) + node `assert` for unit tests.

---

## File Structure

- Create: `lib/tvtree.js` — pure helpers: `isTvDevice`, `getCapabilitySet`, `buildControlObjects`, `mapControlCommand`, `deriveCleanStates`, plus `CONTROL_DEFS`/`STATE_CONVENIENCE` tables.
- Create: `test/unit/tvtree.test.js` — mocha unit tests for the pure helpers.
- Modify: `main.js` — require tvtree; constructor cache; getDeviceList object creation; onStateChange control dispatch; sendDeviceCommand helper; updateDevices clean-state call; _handleSseEvent clean-state call; new `updateCleanState` method.

---

## Task 1: Pure helpers — TV detection & capability set

**Files:**
- Create: `lib/tvtree.js`
- Test: `test/unit/tvtree.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/tvtree.test.js`:

```js
'use strict';
const assert = require('assert');
const tvtree = require('../../lib/tvtree');

describe('tvtree.isTvDevice', () => {
  it('returns true when a component category is Television', () => {
    const device = { components: [{ id: 'main', categories: [{ name: 'Television', categoryType: 'manufacturer' }], capabilities: [] }] };
    assert.strictEqual(tvtree.isTvDevice(device), true);
  });
  it('returns false for a non-TV device', () => {
    const device = { components: [{ id: 'main', categories: [{ name: 'Switch' }], capabilities: [] }] };
    assert.strictEqual(tvtree.isTvDevice(device), false);
  });
  it('returns false for malformed input', () => {
    assert.strictEqual(tvtree.isTvDevice(null), false);
    assert.strictEqual(tvtree.isTvDevice({}), false);
  });
});

describe('tvtree.getCapabilitySet', () => {
  it('collects capability ids across components', () => {
    const device = { components: [{ capabilities: [{ id: 'switch' }, { id: 'audioVolume' }] }] };
    const set = tvtree.getCapabilitySet(device);
    assert.ok(set.has('switch') && set.has('audioVolume'));
    assert.strictEqual(set.size, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/tvtree.test.js`
Expected: FAIL with "Cannot find module '../../lib/tvtree'".

- [ ] **Step 3: Write minimal implementation**

Create `lib/tvtree.js`:

```js
'use strict';

const TV_CATEGORY = 'Television';

/**
 * @param {any} device device object from GET /v1/devices
 * @returns {boolean} true if any component is categorized as a Television
 */
function isTvDevice(device) {
  if (!device || !Array.isArray(device.components)) {
    return false;
  }
  for (const component of device.components) {
    for (const cat of component.categories || []) {
      if (cat && (cat.name === TV_CATEGORY || cat.categoryType === TV_CATEGORY)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {any} device device object from GET /v1/devices
 * @returns {Set<string>} capability ids exposed by the device
 */
function getCapabilitySet(device) {
  const set = new Set();
  if (!device || !Array.isArray(device.components)) {
    return set;
  }
  for (const component of device.components) {
    for (const cap of component.capabilities || []) {
      if (cap && cap.id) {
        set.add(cap.id);
      }
    }
  }
  return set;
}

module.exports = { isTvDevice, getCapabilitySet, TV_CATEGORY };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/tvtree.test.js`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add lib/tvtree.js test/unit/tvtree.test.js
git commit -m "feat(tvtree): TV detection and capability set helpers"
```

---

## Task 2: Control definitions & command mapping

**Files:**
- Modify: `lib/tvtree.js`
- Test: `test/unit/tvtree.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/unit/tvtree.test.js`:

```js
describe('tvtree.buildControlObjects', () => {
  it('includes controls only for present capabilities', () => {
    const caps = new Set(['switch', 'audioVolume', 'audioMute']);
    const ids = tvtree.buildControlObjects(caps).map((c) => c.id);
    assert.ok(ids.includes('power'));
    assert.ok(ids.includes('volume'));
    assert.ok(ids.includes('volumeUp'));
    assert.ok(ids.includes('mute'));
    assert.ok(!ids.includes('channelUp')); // no tvChannel capability
    assert.ok(!ids.includes('app'));       // no custom.launchapp capability
  });
  it('includes input when only the vendor capability exists', () => {
    const ids = tvtree.buildControlObjects(new Set(['samsungvd.mediaInputSource'])).map((c) => c.id);
    assert.ok(ids.includes('input'));
  });
});

describe('tvtree.mapControlCommand', () => {
  const caps = new Set(['switch', 'audioVolume', 'audioMute', 'mediaInputSource', 'samsungvd.remoteControl']);
  it('maps power boolean to switch on/off', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('power', true, caps), { capability: 'switch', command: 'on' });
    assert.deepStrictEqual(tvtree.mapControlCommand('power', false, caps), { capability: 'switch', command: 'off' });
  });
  it('maps volume to setVolume with numeric argument', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('volume', 12, caps), { capability: 'audioVolume', command: 'setVolume', arguments: [12] });
  });
  it('maps mute boolean to mute/unmute', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('mute', true, caps), { capability: 'audioMute', command: 'mute' });
    assert.deepStrictEqual(tvtree.mapControlCommand('mute', false, caps), { capability: 'audioMute', command: 'unmute' });
  });
  it('prefers standard mediaInputSource for input', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('input', 'HDMI1', caps), { capability: 'mediaInputSource', command: 'setInputSource', arguments: ['HDMI1'] });
  });
  it('falls back to samsungvd.mediaInputSource when standard is absent', () => {
    const vcaps = new Set(['samsungvd.mediaInputSource']);
    assert.deepStrictEqual(tvtree.mapControlCommand('input', 'HDMI2', vcaps), { capability: 'samsungvd.mediaInputSource', command: 'setInputSource', arguments: ['HDMI2'] });
  });
  it('maps remote to samsungvd.remoteControl send', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('remote', 'OK', caps), { capability: 'samsungvd.remoteControl', command: 'send', arguments: ['OK'] });
  });
  it('returns null for unknown control', () => {
    assert.strictEqual(tvtree.mapControlCommand('nope', 1, caps), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/tvtree.test.js`
Expected: FAIL with "tvtree.buildControlObjects is not a function".

- [ ] **Step 3: Implement**

In `lib/tvtree.js`, add before `module.exports` the definitions and functions:

```js
// Each control: id (state name), requires (capability id), optional altRequires,
// common (ioBroker common), toCommand(value, caps) -> command payload.
const CONTROL_DEFS = [
  { id: 'power', requires: 'switch',
    common: { name: 'Power', type: 'boolean', role: 'switch.power', read: true, write: true, def: false },
    toCommand: (v) => ({ capability: 'switch', command: v ? 'on' : 'off' }) },
  { id: 'volume', requires: 'audioVolume',
    common: { name: 'Volume', type: 'number', role: 'level.volume', read: true, write: true, min: 0, max: 100, unit: '%' },
    toCommand: (v) => ({ capability: 'audioVolume', command: 'setVolume', arguments: [Number(v)] }) },
  { id: 'volumeUp', requires: 'audioVolume',
    common: { name: 'Volume up', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'audioVolume', command: 'volumeUp' }) },
  { id: 'volumeDown', requires: 'audioVolume',
    common: { name: 'Volume down', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'audioVolume', command: 'volumeDown' }) },
  { id: 'mute', requires: 'audioMute',
    common: { name: 'Mute', type: 'boolean', role: 'media.mute', read: true, write: true, def: false },
    toCommand: (v) => ({ capability: 'audioMute', command: v ? 'mute' : 'unmute' }) },
  { id: 'input', requires: 'mediaInputSource', altRequires: 'samsungvd.mediaInputSource',
    common: { name: 'Input source', type: 'string', role: 'text', read: true, write: true },
    toCommand: (v, caps) => ({ capability: caps && caps.has('mediaInputSource') ? 'mediaInputSource' : 'samsungvd.mediaInputSource', command: 'setInputSource', arguments: [String(v)] }) },
  { id: 'app', requires: 'custom.launchapp',
    common: { name: 'Launch app', type: 'string', role: 'text', read: false, write: true },
    toCommand: (v) => ({ capability: 'custom.launchapp', command: 'launchApp', arguments: [String(v)] }) },
  { id: 'play', requires: 'mediaPlayback',
    common: { name: 'Play', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'mediaPlayback', command: 'play' }) },
  { id: 'pause', requires: 'mediaPlayback',
    common: { name: 'Pause', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'mediaPlayback', command: 'pause' }) },
  { id: 'stop', requires: 'mediaPlayback',
    common: { name: 'Stop', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'mediaPlayback', command: 'stop' }) },
  { id: 'channelUp', requires: 'tvChannel',
    common: { name: 'Channel up', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'tvChannel', command: 'channelUp' }) },
  { id: 'channelDown', requires: 'tvChannel',
    common: { name: 'Channel down', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'tvChannel', command: 'channelDown' }) },
  { id: 'remote', requires: 'samsungvd.remoteControl',
    common: { name: 'Remote key', type: 'string', role: 'text', read: false, write: true,
      states: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', OK: 'OK', BACK: 'BACK', MENU: 'MENU', HOME: 'HOME' } },
    toCommand: (v) => ({ capability: 'samsungvd.remoteControl', command: 'send', arguments: [String(v)] }) },
];

/**
 * @param {Set<string>} caps capability ids the device exposes
 * @returns {Array<{id:string, common:object}>} control objects to create
 */
function buildControlObjects(caps) {
  return CONTROL_DEFS
    .filter((d) => caps.has(d.requires) || (d.altRequires && caps.has(d.altRequires)))
    .map((d) => ({ id: d.id, common: { ...d.common } }));
}

/**
 * @param {string} controlId control state name, e.g. "power"
 * @param {*} value the new value written to the control state
 * @param {Set<string>} caps capability ids the device exposes
 * @returns {{capability:string, command:string, arguments?:any[]}|null}
 */
function mapControlCommand(controlId, value, caps) {
  const def = CONTROL_DEFS.find((d) => d.id === controlId);
  if (!def) {
    return null;
  }
  return def.toCommand(value, caps);
}
```

Update `module.exports` to:

```js
module.exports = { isTvDevice, getCapabilitySet, buildControlObjects, mapControlCommand, CONTROL_DEFS, TV_CATEGORY };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/tvtree.test.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/tvtree.js test/unit/tvtree.test.js
git commit -m "feat(tvtree): consolidated control definitions and command mapping"
```

---

## Task 3: Clean-state derivation

**Files:**
- Modify: `lib/tvtree.js`
- Test: `test/unit/tvtree.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/unit/tvtree.test.js`:

```js
describe('tvtree.deriveCleanStates', () => {
  const status = {
    switch: { switch: { value: 'on', timestamp: 't' } },
    audioVolume: { volume: { value: 12, timestamp: 't', unit: '%' } },
    audioMute: { mute: { value: 'muted', timestamp: 't' } },
    mediaInputSource: {
      inputSource: { value: 'HDMI1', timestamp: 't' },
      supportedInputSources: { value: ['HDMI1', 'HDMI2'], timestamp: 't' }, // array -> skipped
    },
    'custom.picturemode': {
      supportedPictureModesMap: { value: { modeStandard: { id: 'x' } }, timestamp: 't' }, // object -> skipped
    },
  };
  const out = tvtree.deriveCleanStates(status);
  const byPath = Object.fromEntries(out.map((e) => [e.path, e]));

  it('mirrors scalar attribute values as <cap>.<attr>', () => {
    assert.strictEqual(byPath['switch.switch'].value, 'on');
    assert.strictEqual(byPath['audioVolume.volume'].value, 12);
    assert.strictEqual(byPath['audioVolume.volume'].common.unit, '%');
  });
  it('skips array and object values', () => {
    assert.ok(!('mediaInputSource.supportedInputSources' in byPath));
    assert.ok(!('custom.picturemode.supportedPictureModesMap' in byPath));
  });
  it('adds converted convenience states at the root', () => {
    assert.strictEqual(byPath['power'].value, true);
    assert.strictEqual(byPath['power'].common.type, 'boolean');
    assert.strictEqual(byPath['mute'].value, true);
    assert.strictEqual(byPath['volume'].value, 12);
    assert.strictEqual(byPath['input'].value, 'HDMI1');
  });
  it('returns [] for malformed input', () => {
    assert.deepStrictEqual(tvtree.deriveCleanStates(null), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/unit/tvtree.test.js`
Expected: FAIL with "tvtree.deriveCleanStates is not a function".

- [ ] **Step 3: Implement**

In `lib/tvtree.js`, add before `module.exports`:

```js
// Convenience converted states surfaced at state.<id> with friendly names/types.
const STATE_CONVENIENCE = [
  { id: 'power', cap: 'switch', attr: 'switch',
    common: { name: 'Power', type: 'boolean', role: 'indicator', read: true, write: false },
    convert: (v) => v === 'on' || v === true },
  { id: 'mute', cap: 'audioMute', attr: 'mute',
    common: { name: 'Mute', type: 'boolean', role: 'indicator', read: true, write: false },
    convert: (v) => v === 'muted' || v === true },
  { id: 'volume', cap: 'audioVolume', attr: 'volume',
    common: { name: 'Volume', type: 'number', role: 'value', read: true, write: false },
    convert: (v) => Number(v) },
  { id: 'input', cap: 'mediaInputSource', attr: 'inputSource',
    common: { name: 'Input source', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v },
  { id: 'playbackStatus', cap: 'mediaPlayback', attr: 'playbackStatus',
    common: { name: 'Playback status', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v },
  { id: 'contentTitle', cap: 'samsungvd.contentInfo', attr: 'title',
    common: { name: 'Content title', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v },
  { id: 'app', cap: 'tvChannel', attr: 'tvChannelName',
    common: { name: 'Current app/channel', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v },
];

function _isScalar(v) {
  return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);
}

/**
 * @param {any} statusData stripped status object: { <capability>: { <attribute>: { value, ... } } }
 * @returns {Array<{path:string, value:*, common:object}>} clean state entries (scalar mirror + convenience)
 */
function deriveCleanStates(statusData) {
  const out = [];
  if (!statusData || typeof statusData !== 'object') {
    return out;
  }
  // 1) Complete scalar mirror: state.<capability>.<attribute> = value (value only).
  for (const cap of Object.keys(statusData)) {
    const attrs = statusData[cap];
    if (!attrs || typeof attrs !== 'object') {
      continue;
    }
    for (const attr of Object.keys(attrs)) {
      const entry = attrs[attr];
      if (!entry || typeof entry !== 'object' || !('value' in entry)) {
        continue;
      }
      const value = entry.value;
      if (!_isScalar(value) || value === null || value === undefined) {
        continue; // skip objects/arrays (maps, supported* lists) and empty values
      }
      out.push({
        path: `${cap}.${attr}`,
        value,
        common: Object.assign(
          { name: attr, type: typeof value, role: 'value', read: true, write: false },
          entry.unit ? { unit: entry.unit } : {},
        ),
      });
    }
  }
  // 2) Convenience converted states at the root.
  for (const c of STATE_CONVENIENCE) {
    const entry = statusData[c.cap] && statusData[c.cap][c.attr];
    if (!entry || typeof entry !== 'object' || !('value' in entry)) {
      continue;
    }
    if (entry.value === null || entry.value === undefined) {
      continue;
    }
    out.push({ path: c.id, value: c.convert(entry.value), common: Object.assign({}, c.common) });
  }
  return out;
}
```

Update `module.exports` to:

```js
module.exports = { isTvDevice, getCapabilitySet, buildControlObjects, mapControlCommand, deriveCleanStates, CONTROL_DEFS, STATE_CONVENIENCE, TV_CATEGORY };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha test/unit/tvtree.test.js`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add lib/tvtree.js test/unit/tvtree.test.js
git commit -m "feat(tvtree): clean-state derivation (scalar mirror + convenience)"
```

---

## Task 4: Wire object creation in getDeviceList

**Files:**
- Modify: `main.js` (require near top; constructor; getDeviceList device loop)

- [ ] **Step 1: Require the module and add the cache**

Near the other requires at the top of `main.js` (after `const OcfDeviceFactory = require('./lib/ocf/ocfDeviceFactory');`), add:

```js
const tvtree = require('./lib/tvtree');
```

In the constructor, after `this.excludeStateEndingsArray = [];`, add:

```js
    this.cleanStateCache = new Set();
```

- [ ] **Step 2: Push TV metadata into deviceArray**

In `getDeviceList()`, replace the existing line:

```js
          this.deviceArray.push({ id: device.deviceId, type: device.deviceTypeName });
```

with:

```js
          const isTv = tvtree.isTvDevice(device);
          const capabilitySet = tvtree.getCapabilitySet(device);
          this.deviceArray.push({ id: device.deviceId, type: device.deviceTypeName, isTv, caps: capabilitySet });
```

- [ ] **Step 3: Create control + state channels for TVs**

In `getDeviceList()`, immediately after the existing creation of the `.general` channel
(`await this.setObjectNotExistsAsync(device.deviceId + '.general', {...});`), add:

```js
          if (isTv) {
            await this.setObjectNotExistsAsync(device.deviceId + '.control', {
              type: 'channel',
              common: { name: 'Control (send commands here)' },
              native: {},
            });
            await this.setObjectNotExistsAsync(device.deviceId + '.state', {
              type: 'channel',
              common: { name: 'State (current values)' },
              native: {},
            });
            for (const ctrl of tvtree.buildControlObjects(capabilitySet)) {
              await this.setObjectNotExistsAsync(device.deviceId + '.control.' + ctrl.id, {
                type: 'state',
                common: ctrl.common,
                native: {},
              });
            }
          }
```

- [ ] **Step 4: Lint**

Run: `npx eslint main.js lib/tvtree.js`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat: create control/state channels for TV devices"
```

---

## Task 5: Dispatch control commands in onStateChange

**Files:**
- Modify: `main.js` (`onStateChange`; add `sendDeviceCommand` helper)

- [ ] **Step 1: Add a shared command-send helper**

In `main.js`, add this method directly above `onStateChange`:

```js
  /**
   * POST a command payload to a device and schedule a refresh.
   * @param {string} deviceId
   * @param {{commands:Array<object>}} data
   * @returns {Promise<void>}
   */
  async sendDeviceCommand(deviceId, data) {
    this.log.info(JSON.stringify(data));
    await this.requestClient({
      method: 'post',
      url: 'https://api.smartthings.com/v1/devices/' + deviceId + '/commands',
      headers: { 'User-Agent': 'ioBroker', Authorization: 'Bearer ' + this.config.token },
      data: data,
    })
      .then((res) => {
        this.log.info(JSON.stringify(res.data));
        return res.data;
      })
      .catch((error) => {
        this.log.error(error);
        if (error.response) {
          this.log.error(JSON.stringify(error.response.data));
        }
      });
    clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(async () => {
      await this.updateDevices();
    }, 10 * 1000);
  }
```

- [ ] **Step 2: Handle the control channel at the start of onStateChange**

In `onStateChange`, inside `if (state) { if (!state.ack) {`, immediately after
`const deviceId = idArray[2];`, add a control branch:

```js
        if (idArray[3] === 'control') {
          const controlId = idArray.slice(4).join('.');
          const device = this.deviceArray.find((d) => d.id === deviceId);
          const command = tvtree.mapControlCommand(controlId, state.val, device && device.caps);
          if (!command) {
            this.log.warn('Unknown control state: ' + id);
            return;
          }
          const data = { commands: [{ capability: command.capability, command: command.command }] };
          if (command.arguments) {
            data.commands[0].arguments = command.arguments;
          }
          await this.sendDeviceCommand(deviceId, data);
          return;
        }
```

(The existing `capabilities.*` handling below this branch stays unchanged.)

- [ ] **Step 3: Lint**

Run: `npx eslint main.js`
Expected: exit 0.

- [ ] **Step 4: Offline sanity check of the dispatch mapping**

Create `verify-control.js` in the repo root:

```js
const tvtree = require('./lib/tvtree');
const caps = new Set(['switch','audioVolume','audioMute','mediaInputSource','custom.launchapp','mediaPlayback','tvChannel','samsungvd.remoteControl']);
const cases = [['power',true],['power',false],['volume',15],['mute',true],['input','HDMI1'],['app','netflix'],['play',true],['channelUp',true],['remote','OK']];
for (const [id,val] of cases) {
  const c = tvtree.mapControlCommand(id, val, caps);
  console.log(id, '=', val, '->', JSON.stringify(c));
}
```

Run: `node verify-control.js`
Expected: each line prints a valid `{capability, command, arguments?}` (power true→on, false→off, volume→setVolume [15], etc.). Then delete it:

```bash
rm verify-control.js
```

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat: dispatch consolidated control commands in onStateChange"
```

---

## Task 6: Populate the clean state from poll and SSE

**Files:**
- Modify: `main.js` (`updateDevices`; `_handleSseEvent`; add `updateCleanState` method)

- [ ] **Step 1: Add the updateCleanState method**

In `main.js`, add this method directly above `sendDeviceCommand`:

```js
  /**
   * Mirror the current scalar values of a TV into the clean state.* tree, and keep the
   * read/write control.* states in sync with the current value (ack'd, so it does not
   * re-trigger a command).
   * @param {string} deviceId
   * @param {object} statusData stripped status object { <capability>: { <attribute>: { value } } }
   * @returns {Promise<void>}
   */
  async updateCleanState(deviceId, statusData) {
    const syncedControls = new Set(['power', 'volume', 'mute', 'input']);
    for (const entry of tvtree.deriveCleanStates(statusData)) {
      const stateId = deviceId + '.state.' + entry.path;
      if (!this.cleanStateCache.has(stateId)) {
        await this.setObjectNotExistsAsync(stateId, { type: 'state', common: entry.common, native: {} });
        this.cleanStateCache.add(stateId);
      }
      await this.setStateAsync(stateId, entry.value, true);

      // Reflect the current value on the matching writable control (ack=true => no command).
      if (syncedControls.has(entry.path)) {
        const controlId = deviceId + '.control.' + entry.path;
        const controlObj = await this.getObjectAsync(controlId);
        if (controlObj) {
          await this.setStateAsync(controlId, entry.value, true);
        }
      }
    }
  }
```

- [ ] **Step 2: Call updateCleanState after the poll parse**

In `updateDevices()`, immediately after:

```js
          this.responseCache[cacheKey] = data;
```

add:

```js
          if (device.isTv) {
            await this.updateCleanState(device.id, data);
          }
```

- [ ] **Step 3: Call updateCleanState from the SSE handler**

In `_handleSseEvent()`, immediately after the existing
`await this.json2iob.parse(\`${de.deviceId}.status\`, payload, { channelName: 'Status of the device' });`
line, add:

```js
        const sseDevice = this.deviceArray.find((d) => d.id === de.deviceId);
        if (sseDevice && sseDevice.isTv) {
          await this.updateCleanState(de.deviceId, payload);
        }
```

- [ ] **Step 4: Lint**

Run: `npx eslint main.js`
Expected: exit 0.

- [ ] **Step 5: Offline sanity check of clean-state derivation on a realistic payload**

Create `verify-state.js` in the repo root:

```js
const tvtree = require('./lib/tvtree');
const status = {
  switch: { switch: { value: 'on' } },
  audioVolume: { volume: { value: 9, unit: '%' } },
  audioMute: { mute: { value: 'unmuted' } },
  mediaInputSource: { inputSource: { value: 'HDMI2' }, supportedInputSources: { value: ['HDMI1','HDMI2'] } },
  tvChannel: { tvChannelName: { value: 'org.tizen.primevideo' } },
};
for (const e of tvtree.deriveCleanStates(status)) console.log(e.path, '=', JSON.stringify(e.value), '(', e.common.type, ')');
```

Run: `node verify-state.js`
Expected: includes `power = true ( boolean )`, `volume = 9 ( number )`, `mute = false ( boolean )`, `input = "HDMI2"`, `app = "org.tizen.primevideo"`, scalar mirror entries like `switch.switch`, `audioVolume.volume`; and NO `mediaInputSource.supportedInputSources`. Then delete it:

```bash
rm verify-state.js
```

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat: populate clean state.* tree from poll and SSE, sync controls"
```

---

## Task 7: Full check, push, live verification

**Files:** none (validation only)

- [ ] **Step 1: Run unit tests and lint together**

Run: `npx mocha test/unit/tvtree.test.js && npx eslint main.js lib/tvtree.js`
Expected: mocha all green, eslint exit 0.

- [ ] **Step 2: Push the feature branch**

```bash
git push -u origin feature/clean-tv-tree
```

- [ ] **Step 3: Live test (user installs the branch)**

Ask the user to run on the ioBroker host:

```bash
iobroker url "gcaruso73/ioBroker.smartthings#feature/clean-tv-tree" --debug
iobroker restart smartthings.0
```

- [ ] **Step 4: Verify objects via the iobroker MCP**

- Confirm `smartthings.0.<tvDeviceId>.control.*` exists (power, volume, mute, input, app, …) and `…state.*` is populated with current values (power/volume/mute/input).
- Confirm the gate ("Cancello Casa") and "Büro" devices have NO `control`/`state` channels.
- Confirm `capabilities`/`general`/`status` still exist (untouched).

- [ ] **Step 5: Live command test**

- Set `…control.power` to send on/off; set `…control.input`/`…control.app`; confirm the TV reacts and `…state.*` updates (real time via SSE / within 5s via poll). Confirm no "has no existing object" warnings in the log.

- [ ] **Step 6: Merge to master once confirmed**

```bash
git checkout master && git merge --ff-only feature/clean-tv-tree && git push origin master
```

---

## Self-Review

- **Spec coverage:** TV detection (Task 1) ✓; control consolidated channel + dispatch (Tasks 2, 4, 5) ✓; clean complete state mirror + convenience + sync from poll & SSE (Tasks 3, 6) ✓; additive/non-breaking — only `setObjectNotExistsAsync`, no deletions (Tasks 4, 6) ✓; TV-only gating (Tasks 4, 6) ✓; objects created before setState to avoid warnings (Task 6) ✓; verification offline + live (Tasks 1-3, 5, 6, 7) ✓.
- **Deviation from spec:** the `control.input` dynamic enum from `supportedInputSources` is omitted (YAGNI / avoids coupling control creation to status timing); `control.input` is a free-text string. Documented here as an intentional simplification.
- **Type consistency:** `deriveCleanStates` returns `{path,value,common}` used identically in Task 6; `mapControlCommand` returns `{capability,command,arguments?}` consumed in Task 5; `deviceArray` entries carry `{id,type,isTv,caps}` set in Task 4 and read in Tasks 5 & 6.
- **Placeholder scan:** none.
