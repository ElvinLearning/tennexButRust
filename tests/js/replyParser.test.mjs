import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplyParser, parseReply, SentenceBuffer, cleanSpeech } from '../../public/js/replyParser.js';

function streamed(chunks) {
  const p = new ReplyParser();
  let say = '';
  let screen = '';
  for (const c of chunks) {
    const o = p.push(c);
    say += o.say;
    screen += o.screen;
  }
  const o = p.end();
  return { say: say + o.say, screen: screen + o.screen };
}

const REPLY = 'SAY: Done. Leaderboard is on my screen.\nSCREEN:\nconst board = [];\nexport default board;';

test('splits speech and screen', () => {
  assert.deepEqual(parseReply(REPLY), {
    say: 'Done. Leaderboard is on my screen.',
    screen: 'const board = [];\nexport default board;',
    hasScreen: true,
  });
});

test('markers never leak, at any chunk boundary (AC3)', () => {
  for (let size = 1; size <= 9; size++) {
    const chunks = REPLY.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
    const r = streamed(chunks);
    assert.equal(r.say.trim(), 'Done. Leaderboard is on my screen.', `size ${size}`);
    assert.equal(r.screen, 'const board = [];\nexport default board;', `size ${size}`);
  }
  const r = streamed(['SAY: Hi there.\nSCR', 'EEN:\nhello']);
  assert.equal(r.say.trim(), 'Hi there.');
  assert.equal(r.screen, 'hello');
});

test('no SCREEN section means speech only (AC4)', () => {
  const r = parseReply('SAY: Sure, happy to help with that.');
  assert.equal(r.say, 'Sure, happy to help with that.');
  assert.equal(r.screen, '');
  assert.equal(r.hasScreen, false);
  assert.equal(parseReply('Just talking, no markers.').say, 'Just talking, no markers.');
});

test('<think> blocks are hidden, even split across chunks', () => {
  const r = streamed(['<thi', 'nk>let me plan SAY: fake\nSCREEN: fake</th', 'ink>\nSAY: Real answer.\nSCREEN:\nreal']);
  assert.equal(r.say.trim(), 'Real answer.');
  assert.equal(r.screen, 'real');
  assert.equal(parseReply('SAY: a<think>x</think> b\nSCREEN:\nc<think>y</think>d').screen, 'cd');
});

test('SAY: inside the screen is content, not a marker', () => {
  const r = parseReply('SAY: yaml below.\nSCREEN:\nsteps:\n  SAY: hello');
  assert.equal(r.screen, 'steps:\n  SAY: hello');
});

test('tolerates bold markers and extra whitespace', () => {
  const r = parseReply('**SAY:** Here you go.\n\n**SCREEN:**\n\n# Plan');
  assert.equal(r.say, 'Here you go.');
  assert.equal(r.screen, '# Plan');
});

test('sentence buffer releases whole sentences as they finish (AC1)', () => {
  const b = new SentenceBuffer();
  assert.deepEqual(b.push('Hello there'), []);
  assert.deepEqual(b.push('. How are'), ['Hello there.']);
  assert.deepEqual(b.push(' you? I'), ['How are you?']);
  assert.deepEqual(b.push(' use e.g. tests and v3.6 now.'), []);
  assert.deepEqual(b.flush(), ['I use e.g. tests and v3.6 now.']);
  assert.deepEqual(b.flush(), []);
});

test('speech cleanup removes markdown', () => {
  assert.equal(cleanSpeech('**Bold** and `code` see [docs](http://x.y)'), 'Bold and code see docs');
});
