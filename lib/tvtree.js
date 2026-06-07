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

// Each control: id (state name), requires (capability id), optional altRequires,
// common (ioBroker common), toCommand(value, caps) -> command payload.
const CONTROL_DEFS = [
  {
    id: 'power',
    requires: 'switch',
    common: { name: 'Power', type: 'boolean', role: 'switch.power', read: true, write: true, def: false },
    toCommand: (v) => ({ capability: 'switch', command: v ? 'on' : 'off' }),
  },
  {
    id: 'volume',
    requires: 'audioVolume',
    common: { name: 'Volume', type: 'number', role: 'level.volume', read: true, write: true, min: 0, max: 100, unit: '%' },
    toCommand: (v) => ({ capability: 'audioVolume', command: 'setVolume', arguments: [Number(v)] }),
  },
  {
    id: 'volumeUp',
    requires: 'audioVolume',
    common: { name: 'Volume up', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'audioVolume', command: 'volumeUp' }),
  },
  {
    id: 'volumeDown',
    requires: 'audioVolume',
    common: { name: 'Volume down', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'audioVolume', command: 'volumeDown' }),
  },
  {
    id: 'mute',
    requires: 'audioMute',
    common: { name: 'Mute', type: 'boolean', role: 'media.mute', read: true, write: true, def: false },
    toCommand: (v) => ({ capability: 'audioMute', command: v ? 'mute' : 'unmute' }),
  },
  {
    id: 'input',
    requires: 'mediaInputSource',
    altRequires: 'samsungvd.mediaInputSource',
    common: { name: 'Input source', type: 'string', role: 'text', read: true, write: true },
    toCommand: (v, caps) => ({
      capability: caps && caps.has('mediaInputSource') ? 'mediaInputSource' : 'samsungvd.mediaInputSource',
      command: 'setInputSource',
      arguments: [String(v)],
    }),
  },
  {
    id: 'app',
    requires: 'custom.launchapp',
    common: { name: 'Launch app', type: 'string', role: 'text', read: false, write: true },
    toCommand: (v) => ({ capability: 'custom.launchapp', command: 'launchApp', arguments: [String(v)] }),
  },
  {
    id: 'play',
    requires: 'mediaPlayback',
    common: { name: 'Play', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'mediaPlayback', command: 'play' }),
  },
  {
    id: 'pause',
    requires: 'mediaPlayback',
    common: { name: 'Pause', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'mediaPlayback', command: 'pause' }),
  },
  {
    id: 'stop',
    requires: 'mediaPlayback',
    common: { name: 'Stop', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'mediaPlayback', command: 'stop' }),
  },
  {
    id: 'channelUp',
    requires: 'tvChannel',
    common: { name: 'Channel up', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'tvChannel', command: 'channelUp' }),
  },
  {
    id: 'channelDown',
    requires: 'tvChannel',
    common: { name: 'Channel down', type: 'boolean', role: 'button', read: false, write: true },
    toCommand: () => ({ capability: 'tvChannel', command: 'channelDown' }),
  },
  {
    id: 'remote',
    requires: 'samsungvd.remoteControl',
    common: {
      name: 'Remote key',
      type: 'string',
      role: 'text',
      read: false,
      write: true,
      states: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', OK: 'OK', BACK: 'BACK', MENU: 'MENU', HOME: 'HOME' },
    },
    toCommand: (v) => ({ capability: 'samsungvd.remoteControl', command: 'send', arguments: [String(v)] }),
  },
];

/**
 * @param {Set<string>} caps capability ids the device exposes
 * @returns {Array<{id:string, common:object}>} control objects to create
 */
function buildControlObjects(caps) {
  return CONTROL_DEFS.filter((d) => caps.has(d.requires) || (d.altRequires && caps.has(d.altRequires))).map((d) => ({
    id: d.id,
    common: { ...d.common },
  }));
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

// Convenience converted states surfaced at state.<id> with friendly names/types.
const STATE_CONVENIENCE = [
  {
    id: 'power',
    cap: 'switch',
    attr: 'switch',
    common: { name: 'Power', type: 'boolean', role: 'indicator', read: true, write: false },
    convert: (v) => v === 'on' || v === true,
  },
  {
    id: 'mute',
    cap: 'audioMute',
    attr: 'mute',
    common: { name: 'Mute', type: 'boolean', role: 'indicator', read: true, write: false },
    convert: (v) => v === 'muted' || v === true,
  },
  {
    id: 'volume',
    cap: 'audioVolume',
    attr: 'volume',
    common: { name: 'Volume', type: 'number', role: 'value', read: true, write: false },
    convert: (v) => Number(v),
  },
  {
    id: 'input',
    // Prefer the Samsung vendor capability: on Samsung TVs the standard mediaInputSource
    // is often stale (e.g. "digitalTv") while samsungvd.mediaInputSource is accurate.
    caps: ['samsungvd.mediaInputSource', 'mediaInputSource'],
    attr: 'inputSource',
    common: { name: 'Input source', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v,
  },
  {
    id: 'playbackStatus',
    cap: 'mediaPlayback',
    attr: 'playbackStatus',
    common: { name: 'Playback status', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v,
  },
  {
    id: 'contentTitle',
    cap: 'samsungvd.contentInfo',
    attr: 'title',
    common: { name: 'Content title', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v,
  },
  {
    id: 'app',
    cap: 'tvChannel',
    attr: 'tvChannelName',
    common: { name: 'Current app/channel', type: 'string', role: 'text', read: true, write: false },
    convert: (v) => v,
  },
];

/**
 * @param {*} v value to test
 * @returns {boolean} true for scalar (string/number/boolean) or empty values
 */
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
    const caps = c.caps || [c.cap];
    let entry = null;
    for (const cap of caps) {
      const candidate = statusData[cap] && statusData[cap][c.attr];
      if (candidate && typeof candidate === 'object' && 'value' in candidate) {
        entry = candidate;
        break;
      }
    }
    if (!entry || entry.value === null || entry.value === undefined) {
      continue;
    }
    out.push({ path: c.id, value: c.convert(entry.value), common: Object.assign({}, c.common) });
  }
  return out;
}

module.exports = {
  isTvDevice,
  getCapabilitySet,
  buildControlObjects,
  mapControlCommand,
  deriveCleanStates,
  CONTROL_DEFS,
  STATE_CONVENIENCE,
  TV_CATEGORY,
};
