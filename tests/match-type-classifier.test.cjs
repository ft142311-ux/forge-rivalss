'use strict';
const assert = require('node:assert/strict');
const { classifyMatch, isCanonicalSeason1LeagueMatch } = require('../scripts/match-type-classifier.cjs');

assert.equal(classifyMatch('friendly1', { type: 'friendly' }), 'friendly');
assert.equal(classifyMatch('basket1', { type: 'basket', source: 'cw-basket' }), 'basket');
assert.equal(classifyMatch('cup1', { type: 'cup', cupId: 'cup_s1' }), 'cup');
assert.equal(classifyMatch('tournament1', { matchType: 'tournament', tournamentId: 'tour1' }), 'tournament');
assert.equal(classifyMatch('trial1', { isTrial: true }), 'trial');
assert.equal(classifyMatch('league1', { type: 'league', season: 1, version: 140, leagueId: 'ALPHA' }), 'league');
assert.equal(classifyMatch('mystery1', {}), 'unknown');
assert.equal(isCanonicalSeason1LeagueMatch('match_v140_S1_LALPHA_V3_G1_T14_R2_vs_R1', { type:'league', season:1, version:140, leagueId:'ALPHA', level:3, groupId:1 }), true);
assert.equal(isCanonicalSeason1LeagueMatch('friendly1', { type:'friendly', season:1, version:140, leagueId:'ALPHA', level:3, groupId:1 }), false);
console.log('PASS: match type classifier and canonical league guard');
