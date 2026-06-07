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

describe('tvtree.buildControlObjects', () => {
  it('includes controls only for present capabilities', () => {
    const caps = new Set(['switch', 'audioVolume', 'audioMute']);
    const ids = tvtree.buildControlObjects(caps).map((c) => c.id);
    assert.ok(ids.includes('power'));
    assert.ok(ids.includes('volume'));
    assert.ok(ids.includes('volumeUp'));
    assert.ok(ids.includes('mute'));
    assert.ok(!ids.includes('channelUp')); // no tvChannel capability
    assert.ok(!ids.includes('app')); // no custom.launchapp capability
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
  it('uses standard mediaInputSource when the vendor capability is absent', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('input', 'HDMI1', caps), { capability: 'mediaInputSource', command: 'setInputSource', arguments: ['HDMI1'] });
  });
  it('prefers samsungvd.mediaInputSource when present (only that one accepts setInputSource on Samsung TVs)', () => {
    const both = new Set(['mediaInputSource', 'samsungvd.mediaInputSource']);
    assert.deepStrictEqual(tvtree.mapControlCommand('input', 'HDMI2', both), { capability: 'samsungvd.mediaInputSource', command: 'setInputSource', arguments: ['HDMI2'] });
  });
  it('maps remote to samsungvd.remoteControl send', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('remote', 'OK', caps), { capability: 'samsungvd.remoteControl', command: 'send', arguments: ['OK'] });
  });
  it('maps channel to tvChannel setTvChannel with a string argument', () => {
    assert.deepStrictEqual(tvtree.mapControlCommand('channel', 10, caps), { capability: 'tvChannel', command: 'setTvChannel', arguments: ['10'] });
  });
  it('returns null for unknown control', () => {
    assert.strictEqual(tvtree.mapControlCommand('nope', 1, caps), null);
  });
});

describe('tvtree channel state/control wiring', () => {
  it('builds a channel control when tvChannel is present', () => {
    const ids = tvtree.buildControlObjects(new Set(['tvChannel'])).map((c) => c.id);
    assert.ok(ids.includes('channel'));
    assert.ok(ids.includes('channelUp'));
  });
  it('derives a channel convenience state from tvChannel.tvChannel', () => {
    const s = { tvChannel: { tvChannel: { value: 101 } } };
    const map = Object.fromEntries(tvtree.deriveCleanStates(s).map((e) => [e.path, e.value]));
    assert.strictEqual(map['channel'], '101');
  });
});

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
  it('prefers samsungvd.mediaInputSource over the standard (stale) one for input', () => {
    const s = {
      mediaInputSource: { inputSource: { value: 'digitalTv' } },
      'samsungvd.mediaInputSource': { inputSource: { value: 'HDMI2' } },
    };
    const map = Object.fromEntries(tvtree.deriveCleanStates(s).map((e) => [e.path, e.value]));
    assert.strictEqual(map['input'], 'HDMI2');
  });
});
