import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assistantTools} from '../lib/assistant-mcp.mjs';
import {remoteControlCoverage} from '../lib/assistant-remote-controls.mjs';

test('every actual Remote Assist special command has a discoverable Assistant tool mapping',async()=>{
  const source=await fs.readFile(new URL('../native/ClawDadRemoteAssistProtocol/Sources/ClawDadRemoteAssistProtocol/RemoteInputProtocol.swift',import.meta.url),'utf8');
  const definition=source.match(/public enum RemoteShortcut[^]*?\n\}/)[0];
  const keys=[...definition.matchAll(/case (\w+)(?: = "([^"]+)")?/g)].map(m=>m[2]||m[1]);
  assert.deepEqual(remoteControlCoverage.filter(c=>c.shortcut).map(c=>c.shortcut).sort(),keys.sort());
  const tools=new Set(assistantTools.map(t=>t[0]));
  for(const item of remoteControlCoverage) {
    assert.ok(item.tools.length||item.device,item.control);
    for(const tool of item.tools)assert.ok(tools.has(tool),`${item.control}: ${tool}`);
  }
});
