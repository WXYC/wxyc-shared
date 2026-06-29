/**
 * Tests for the @wxyc/shared/auto-dj type guards.
 *
 * TDD: these lock the discriminated-union narrowing over the Arduino <->
 * orchestrator management-channel messages.
 */
import { describe, it, expect } from 'vitest';
import {
  isHeartbeat,
  isCommand,
  isAck,
  isNowPlaying,
  isErrorReport,
  isButtonToggle,
  type AutoDJWebSocketMessage,
} from '../src/auto-dj/index.js';

const heartbeat: AutoDJWebSocketMessage = {
  type: 'heartbeat',
  state: 'CONNECTED',
  transport: 'ethernet',
  uptime_s: 1,
  free_ram: 1,
  firmware_version: '2.0.0',
  config_hash: 'abc',
  loop_max_ms: 1,
  reconnect_count: 0,
  tracks_detected: 0,
  tracks_posted: 0,
  errors_since_boot: 0,
};
const command: AutoDJWebSocketMessage = { type: 'command', id: 'c1', action: 'pause' };
const ack: AutoDJWebSocketMessage = { type: 'ack', id: 'c1', status: 'ok' };
const nowPlaying: AutoDJWebSocketMessage = {
  type: 'now_playing',
  sh_id: 1,
  artist: 'Juana Molina',
  title: 'la paradoja',
  album: 'DOGA',
  is_live: false,
};
const errorReport: AutoDJWebSocketMessage = {
  type: 'error',
  level: 'error',
  module: 'mgmt_client',
  code: 'WS_DISCONNECT',
  message: 'dropped',
  state: 'CONNECTING',
  uptime_s: 1,
  free_ram: 1,
  count: 1,
};
const buttonToggle: AutoDJWebSocketMessage = { type: 'button_toggle', timestamp: 1709852100 };

const all = [heartbeat, command, ack, nowPlaying, errorReport, buttonToggle];

describe('auto-dj message type guards', () => {
  it('each guard matches exactly one message type', () => {
    const guards = [isHeartbeat, isCommand, isAck, isNowPlaying, isErrorReport, isButtonToggle];
    for (const guard of guards) {
      expect(all.filter(guard)).toHaveLength(1);
    }
  });

  it('narrows so discriminant-specific fields are accessible', () => {
    for (const msg of all) {
      if (isHeartbeat(msg)) expect(msg.state).toBe('CONNECTED');
      else if (isCommand(msg)) expect(msg.action).toBe('pause');
      else if (isAck(msg)) expect(msg.status).toBe('ok');
      else if (isNowPlaying(msg)) expect(msg.sh_id).toBe(1);
      else if (isErrorReport(msg)) expect(msg.code).toBe('WS_DISCONNECT');
      else if (isButtonToggle(msg)) expect(msg.timestamp).toBe(1709852100);
    }
  });
});
