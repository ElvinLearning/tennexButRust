import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefCommand, PRESETS } from '../../public/js/brief.js';
import { simReply, streamSim } from '../../public/js/sim.js';
import { parseReply } from '../../public/js/replyParser.js';
import { AGENTS } from '../../public/js/agents.js';

test('/brief sets, clears, shows and uses presets', () => {
  assert.equal(briefCommand('hello'), null);
  assert.equal(briefCommand('/brief make a todo app').brief, 'make a todo app');
  assert.equal(briefCommand('/brief clear').brief, null);
  for (const name of ['roblox', 'cozy', 'higgsfield', 'wolf']) {
    assert.equal(briefCommand(`/brief ${name}`).brief, PRESETS[name]);
  }
  const show = briefCommand('/brief', 'abc');
  assert.equal(show.brief, undefined);
  assert.match(show.message, /abc/);
});

test('every sim reply follows the SAY/SCREEN format and never claims results', () => {
  for (const a of AGENTS) {
    const r = parseReply(simReply(a.id, 'build a leaderboard'));
    assert.ok(r.say.length > 0, a.id);
    assert.ok(r.hasScreen && r.screen.length > 0, a.id);
    assert.doesNotMatch(r.say, /all tests pass|deployed successfully|I ran/i, a.id);
  }
});

test('sim streaming delivers the full text and can be aborted', async () => {
  let got = '';
  await streamSim('SAY: hi.\nSCREEN:\nx', (t) => { got += t; }, undefined, { delay: 0 });
  assert.equal(got, 'SAY: hi.\nSCREEN:\nx');
  const ctl = new AbortController();
  const p = streamSim('long text '.repeat(50), () => {}, ctl.signal, { delay: 0 });
  ctl.abort();
  await assert.rejects(p, { name: 'AbortError' });
});
