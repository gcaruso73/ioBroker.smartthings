# Clean TV object tree (`control` + `state`) — Design

Date: 2026-06-07
Status: Approved (design)
Scope: `ioBroker.smartthings` fork (gcaruso73). Additive feature, fork-only for now
(kept separate from the SSE bugfix PR to upstream TA2k).

## Problem

The generated object tree is hard to read and use. For a Samsung TV a device has
hundreds of raw states under `capabilities.*` (cryptic command names like
`switch-on`, `samsungvd.remoteControl-send`), `general.*` (metadata) and `status.*`
(deeply nested values, German strings baked into IDs, `supported*` lists, maps,
`.timestamp`/`.unit` siblings). The user cannot tell **where to send commands** and
**where the current values are**.

## Goal

Add, **only for TV-category devices**, two clear channels per device:

- `control.*` — writable, consolidated commands (where you send commands).
- `state.*` — read-only, clean mirror of current values (where you read state).

The raw `capabilities` / `general` / `status` channels are **left untouched**
(additive, non-breaking, no data loss).

## TV detection

A device is treated as a TV when one of its components has a category named
`Television` (from the `/v1/devices` response `components[].categories[].name`).
No hard-coded device IDs. Fallback: treat as TV if it exposes both `switch` and
`mediaInputSource`/`samsungvd.mediaInputSource` capabilities.

`deviceArray` entries gain `isTv: boolean` and a `capabilitySet: Set<string>`
(capability ids present) so command/state creation can be conditional.

## `control` channel (writable, consolidated)

Created only for TV devices, and each control only if the backing capability exists.
Each control state is read+write where a current value exists (so it doubles as a
live indicator), or write-only `button` for momentary actions.

| State | Type / role | Backing command (POST /v1/devices/$id/commands) |
|-------|-------------|--------------------------------------------------|
| `control.power` | boolean, `switch.power` (r/w) | `switch` → `on` (true) / `off` (false) |
| `control.volume` | number 0–100, `level.volume` (r/w) | `audioVolume` → `setVolume` [val] |
| `control.volumeUp` | boolean, `button` (w) | `audioVolume` → `volumeUp` |
| `control.volumeDown` | boolean, `button` (w) | `audioVolume` → `volumeDown` |
| `control.mute` | boolean, `media.mute` (r/w) | `audioMute` → `mute` (true) / `unmute` (false) |
| `control.input` | string, `text` (r/w), `states` from supported inputs | `mediaInputSource` (or `samsungvd.mediaInputSource`) → `setInputSource` [val] |
| `control.app` | string, `text` (w) | `custom.launchapp` → `launchApp` [val] |
| `control.play` / `pause` / `stop` | boolean, `button` (w) | `mediaPlayback` → `play`/`pause`/`stop` |
| `control.channelUp` / `channelDown` | boolean, `button` (w) | `tvChannel` → `channelUp`/`channelDown` |
| `control.remote` | string, `text` (w), `states` UP/DOWN/LEFT/RIGHT/OK/BACK/MENU/HOME | `samsungvd.remoteControl` → `send` [val] |

`input` capability selection: prefer standard `mediaInputSource` if present, else
`samsungvd.mediaInputSource`. Its `states` enum is filled from the device's
`supportedInputSources` list when available.

### Command dispatch

`onStateChange` gains a branch: if the changed id is `<deviceId>.control.<name>`
(ack=false), look up the mapping above, build
`{ commands: [{ capability, command, arguments? }] }`, POST it (reusing the existing
request/error handling), then schedule the existing `updateDevices()` refresh.
The existing `<deviceId>.capabilities.*` handling is unchanged.

## `state` channel (read-only, clean complete mirror)

Created only for TV devices. Complete but clean mirror of the current values:

- For every attribute in the polled status that has a **scalar** `.value`
  (string / number / boolean), create `state.<capability>.<attribute>` = value
  (value only — no `.timestamp`, no `.unit`).
- **Skip** non-scalar values (objects/arrays) → this automatically excludes the
  `supported*` lists and `*Map` structures and the German-in-ID noise.
- Plus convenience converted states at the root for the common ones:
  - `state.power` (boolean, from `switch.switch` `on`/`off`)
  - `state.mute` (boolean, from `audioMute.mute` `muted`/`unmuted` or boolean)
  - `state.volume` (number, from `audioVolume.volume`)
  - `state.input` (string, from the input capability `inputSource`)
  - `state.app` / `state.contentTitle` (string, from `tvChannel.tvChannelName` /
    `samsungvd.contentInfo.title` when present)
  - `state.playbackStatus` (string, from `mediaPlayback.playbackStatus`)

All `state.*` objects are read-only (`write:false`).

### Keeping `state` in sync

A helper `updateCleanState(deviceId, statusData)`:
- Called in `updateDevices()` right after `json2iob.parse(... '.status' ...)`, using
  the same parsed `data`.
- Called in `_handleSseEvent()` after the json2iob write, for the single changed
  attribute (incremental update).

Objects are created with `setObjectNotExistsAsync` (awaited) before `setStateAsync`
to avoid "has no existing object" warnings. A per-instance `Set` caches created
clean-state paths to avoid redundant object calls on every poll.

Rejected alternative: ioBroker `alias` objects live under the `alias.0` namespace,
not under `smartthings.0.<device>`, so they cannot provide the per-device clean tree
the user wants, and cannot express the consolidated power/mute conversions cleanly.

## Out of scope

- Non-TV devices (gate "Cancello Casa", "Büro") get no `control`/`state` layer.
- No deletion/renaming of the existing raw tree.
- Whether to propose this upstream is deferred; the SSE bugfix PR stays separate.

## Verification plan

- Offline harness (mock adapter + real `json2iob`) to assert: control mapping builds
  the right command payloads; `updateCleanState` produces the right scalar paths and
  skips objects/arrays; power/mute convert to boolean.
- Live on the instance: install the branch, confirm `control.power` toggles the TV,
  `control.input`/`control.app` work, and `state.*` reflects current values in real
  time (via SSE) and via poll. Confirm no warnings and the raw tree is untouched.
