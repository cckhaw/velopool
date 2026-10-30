import { FOOT_X, R } from './physics.js';

export const groupOf = (id) => (id === 8 ? 'eight' : id < 8 ? 'solid' : 'stripe');

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Standard triangle rack: 8 in the middle, one solid and one stripe in the back corners.
export function rackLayout() {
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  const cornerA = solids.pop();
  const cornerB = stripes.pop();
  const rest = shuffle([...solids, ...stripes]);
  const order = new Array(15);
  order[4] = 8;
  order[10] = Math.random() < 0.5 ? cornerA : cornerB;
  order[14] = order[10] === cornerA ? cornerB : cornerA;
  let k = 0;
  for (let i = 0; i < 15; i++) if (order[i] === undefined) order[i] = rest[k++];
  const out = [];
  const gap = 2 * R + 0.0004;
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      out.push({ id: order[idx++], x: FOOT_X + row * gap * Math.sqrt(3) / 2, y: (j - row / 2) * gap });
    }
  }
  return out;
}

// ctx: { group, isBreak, shot: {first, pocketed[], cuePocketed, rail}, before: ids in play }
export function resolveShot(ctx) {
  const { group, isBreak, shot, before } = ctx;
  const mine = group ? before.filter((id) => groupOf(id) === group) : null;
  const cleared = !!group && mine.length === 0;
  const legalTarget = (id) => (group ? (cleared ? id === 8 : groupOf(id) === group) : id !== 8);

  let foul = false;
  let reason = '';
  if (shot.cuePocketed) {
    foul = true;
    reason = 'Scratch';
  } else if (shot.first == null) {
    foul = true;
    reason = 'No ball hit';
  } else if (!legalTarget(shot.first)) {
    foul = true;
    reason = group ? (cleared ? 'Must hit the 8-ball first' : 'Wrong ball first') : 'Hit the 8-ball first';
  } else if (!shot.pocketed.length && !shot.rail && !isBreak) {
    foul = true;
    reason = 'No rail after contact';
  }

  let winner = null; // 'shooter' | 'opponent'
  let respot8 = false;
  if (shot.pocketed.includes(8)) {
    if (isBreak) respot8 = true;
    else winner = !foul && cleared ? 'shooter' : 'opponent';
  }

  let assign = null;
  if (!group && !foul && !isBreak) {
    const first = shot.pocketed.find((id) => id !== 8);
    if (first) assign = groupOf(first);
  }
  const g = group || assign;
  const keep =
    !foul && !winner && shot.pocketed.some((id) => id !== 8 && (g ? groupOf(id) === g : true));

  return { foul, reason, assign, keep, winner, respot8 };
}
