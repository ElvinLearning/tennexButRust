import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, normalizeNames, mentionQuery, matchAgents, completeMention } from '../../public/js/router.js';

const to = (text, near = null) => route(text, near).targets;

test('team and everyone go to all five', () => {
  assert.deepEqual(to('team, build a leaderboard'), ['tenx', 'assert', 'vector', 'deploy', 'critic']);
  assert.equal(to('Everyone: standup time').length, 5);
  assert.equal(route('team, build a leaderboard').text, 'build a leaderboard');
});

test('a leading name addresses that agent', () => {
  assert.deepEqual(to('Critic, review this', 'tenx'), ['critic']);
  assert.deepEqual(to('@critic review this', 'tenx'), ['critic']);
  assert.deepEqual(to('hey critic review this', 'tenx'), ['critic']);
  assert.deepEqual(to('vector what is the plan', 'tenx'), ['vector']);
  assert.equal(route('Critic, review this').text, 'review this');
});

test('verb names need @, a greeting or punctuation (AC1)', () => {
  assert.deepEqual(to('deploy it to staging', 'tenx'), ['tenx']);
  assert.deepEqual(to('assert that the list is sorted', 'critic'), ['critic']);
  assert.deepEqual(to('Deploy, ship it to staging', 'tenx'), ['deploy']);
  assert.deepEqual(to('hey deploy ship it', 'tenx'), ['deploy']);
  assert.deepEqual(to('@deploy ship it', 'tenx'), ['deploy']);
  assert.deepEqual(to('Assert: write tests', 'tenx'), ['assert']);
});

test('speech-recognition spellings reach Tenx (AC2)', () => {
  assert.deepEqual(to('10x, build it'), ['tenx']);
  assert.deepEqual(to('ten x build a login page'), ['tenx']);
  assert.deepEqual(to('hey 10x make a game'), ['tenx']);
  assert.equal(normalizeNames('ask @10x about it'), 'ask @Tenx about it');
  assert.equal(normalizeNames('a 10xer'), 'a 10xer');
});

test('exactly one @mention anywhere', () => {
  assert.deepEqual(to('can you look at this @critic', 'tenx'), ['critic']);
  assert.deepEqual(to('ping @critic and @critic again', 'tenx'), ['critic']);
  assert.deepEqual(to('@nobody here', 'tenx'), ['tenx']);
  // two different mentions: fall back to whoever is nearby
  assert.deepEqual(to('pair up, @critic and @assert', 'vector'), ['vector']);
});

test('falls back to the nearby agent, else nobody heard (AC3)', () => {
  assert.deepEqual(to('build a leaderboard', 'assert'), ['assert']);
  const r = route('build a leaderboard', null);
  assert.deepEqual(r.targets, []);
  assert.match(r.error, /^Nobody heard/);
});

test('names inside words are not addresses', () => {
  assert.deepEqual(to('vectorize the images', 'tenx'), ['tenx']);
  assert.deepEqual(to('deployment is broken', 'critic'), ['critic']);
  assert.deepEqual(to('teammates should sync', 'critic'), ['critic']);
});

test('mention autocomplete', () => {
  assert.equal(mentionQuery('hey @cr'), 'cr');
  assert.equal(mentionQuery('hey @'), '');
  assert.equal(mentionQuery('mail me@cr'), null);
  assert.deepEqual(matchAgents('de').map((a) => a.id), ['deploy']);
  assert.equal(matchAgents('').length, 5);
  assert.deepEqual(completeMention('hey @cr', 7, 'critic'), { text: 'hey @critic ', caret: 12 });
});
