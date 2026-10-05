// Home's numbers: the next episode, what is waiting, the week. Times are local (run with TZ=Europe/Berlin)
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upNext, glance, until, heroEntry } from '../../js/upnext.js';

const at = (s) => new Date(s).getTime() / 1000;
const NOW = at('2026-10-05T10:00:00');            // a Monday morning
const show = (id, { status = 'RELEASING', episodes = 12, next = null, progress = 0 } = {}) => ({
    progress,
    media: { id, status, episodes, title: { romaji: `Show ${id}` },
        nextAiringEpisode: next ? { episode: next[0], airingAt: at(next[1]), timeUntilAiring: at(next[1]) - NOW } : null },
});

test('upNext: episodes waiting while a show airs', () => {
    const u = upNext(show(1, { next: [8, '2026-10-07T16:00:00'], progress: 4 }));
    assert.equal(u.out, 7);
    assert.equal(u.behind, 3);
    assert.equal(u.status, '3 episodes waiting');
    assert.equal(u.next, 5);
    assert.ok(u.canWatch);
});

test('upNext: caught up on an airing show says when the next one comes', () => {
    const u = upNext(show(1, { next: [8, '2026-10-07T16:00:00'], progress: 7 }));
    assert.equal(u.behind, 0);
    assert.equal(u.status, 'Episode 8 airs in 2d');
    assert.equal(u.canWatch, false);
});

test('heroEntry: the most recent show with an episode to watch, else the most recent', () => {
    const waiting = show(1, { next: [8, '2026-10-07T16:00:00'], progress: 7 });    // caught up, next one airs Wednesday
    const ready = show(2, { next: [5, '2026-10-08T16:00:00'], progress: 2 });
    assert.equal(heroEntry([waiting, ready]), ready);
    assert.equal(heroEntry([waiting]), waiting);
    assert.equal(heroEntry([]), undefined);
});

test('upNext: finished and unknown lengths', () => {
    assert.equal(upNext(show(1, { status: 'FINISHED', progress: 12 })).status, 'All caught up');
    assert.equal(upNext(show(1, { status: 'FINISHED', progress: 11 })).status, 'Ready to watch');
    const open = upNext(show(1, { status: 'FINISHED', episodes: null, progress: 3 }));
    assert.equal(open.behind, null);
    assert.ok(open.canWatch);
});

test('until: days, hours, minutes, never 0m', () => {
    assert.equal(until(3 * 86400 + 5), '3d');
    assert.equal(until(5 * 3600), '5h');
    assert.equal(until(90), '2m');
    assert.equal(until(5), '1m');
});

test('glance: the soonest watched episode is next, waiting episodes add up', () => {
    const g = glance([
        show(1, { next: [5, '2026-10-08T18:00:00'], progress: 2 }),
        show(2, { next: [3, '2026-10-06T12:00:00'], progress: 2 }),
        show(3, { status: 'FINISHED', progress: 10 }),
    ], NOW);
    assert.equal(g.next.media.id, 2);
    assert.equal(g.waitingTotal, 2 + 0 + 2);
    assert.equal(g.waiting.length, 2);
    assert.equal(g.today, 0);
});

test('glance: weekly shows sit on their weekday, Monday first', () => {
    const g = glance([
        show(1, { next: [5, '2026-10-11T18:00:00'] }),     // Sunday
        show(2, { next: [3, '2026-10-07T12:00:00'] }),     // Wednesday
    ], NOW);
    assert.deepEqual(g.byDay.map(d => d.map(m => m.id)), [[], [], [2], [], [], [], [1]]);
});

test('glance: nothing watched airs, so the next Planning premiere counts down', () => {
    const g = glance([show(1, { status: 'FINISHED', progress: 3 })], NOW, [
        show(10, { status: 'NOT_YET_RELEASED', next: [1, '2026-10-09T16:00:00'] }),
        show(11, { status: 'NOT_YET_RELEASED', next: [1, '2026-10-06T16:00:00'] }),
    ]);
    assert.equal(g.next.media.id, 11);
    assert.equal(g.next.premiere, true);
});

test('glance: the week holds Planning premieres until Sunday ends, not later', () => {
    const g = glance([], NOW, [
        show(10, { status: 'NOT_YET_RELEASED', next: [1, '2026-10-06T16:00:00'] }),   // Tuesday
        show(11, { status: 'NOT_YET_RELEASED', next: [1, '2026-10-11T23:30:00'] }),   // Sunday night
        show(12, { status: 'NOT_YET_RELEASED', next: [1, '2026-10-12T09:00:00'] }),   // next Monday: not this week
    ]);
    assert.deepEqual(g.week.map(e => e.media.id), [10, 11]);
    assert.deepEqual(g.byDay[0], [], 'next Monday must not land on today');
});

test('glance: a planned show that already started airs weekly in the week', () => {
    // On Planning, episode 1 out today, episode 2 next Monday
    const g = glance([], NOW, [show(20, { status: 'RELEASING', next: [2, '2026-10-12T16:00:00'] })]);
    assert.deepEqual(g.week.map(e => e.media.id), [20]);
    assert.deepEqual(g.byDay[0].map(m => m.id), [20]);
    assert.equal(g.next, null, 'only premieres count down, not running Planning shows');
});

test('glance: the week ends right on Sunday too', () => {
    const sunday = at('2026-10-11T22:00:00');
    const g = glance([], sunday, [
        show(10, { status: 'NOT_YET_RELEASED', next: [1, '2026-10-11T23:00:00'] }),
        show(11, { status: 'NOT_YET_RELEASED', next: [1, '2026-10-12T01:00:00'] }),
    ]);
    assert.deepEqual(g.week.map(e => e.media.id), [10]);
});
