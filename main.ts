// Sokoban solver: every level is a hallway with rooms off it (one door each),
// boxes never leave their room, so each room is solved push-optimally on its own
// and the rooms are joined by the player's walk through the hallway. The level's
// push-optimal count is the sum of the rooms' optima, so solving every room in
// its optimum solves the level in its optimum.
// A room is an A* over pushes (Hart, Nilsson and Raphael, 1968): a state is the
// player's square and the boxes', a step costs one push, and the estimate is the
// cheapest assignment of boxes to goals by walking distance around the walls.
// Deadlock pruning: corners, boxes against a wall run with no goal on it, and
// full 2x2 blocks of walls and boxes. The search is bounded by expansions, never
// by the clock, so two runs write the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const CH = ['u', 'd', 'l', 'r'];
const CAP = 400_000; // expansions per room, a bound on work, never on time

type Grid = { w: number; h: number; wall: Uint8Array };

function wallAt(g: Grid, x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= g.w || y >= g.h || g.wall[y * g.w + x] === 1;
}

/** The squares the player reaches from `from`, walking `dom` around `occ`. */
function reachSet(from: number, occ: Set<number>, dom: Set<number>, w: number): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!;
    const cx = c % w;
    const cy = (c / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k]!;
      const ny = cy + DY[k]!;
      if (nx < 0 || ny < 0) continue;
      const n = ny * w + nx;
      if (dom.has(n) && !occ.has(n) && !seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

/** A walk from `from` to `to` over `dom` around `occ`, as move letters, or null. */
function walkPath(from: number, to: number, occ: Set<number>, dom: Set<number>, w: number): string | null {
  if (from === to) return '';
  const prev = new Map<number, number>([[from, -1]]);
  const prevCh = new Map<number, string>();
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!;
    const cx = c % w;
    const cy = (c / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k]!;
      const ny = cy + DY[k]!;
      if (nx < 0 || ny < 0) continue;
      const n = ny * w + nx;
      if (!dom.has(n) || occ.has(n) || prev.has(n)) continue;
      prev.set(n, c);
      prevCh.set(n, CH[k]!);
      if (n === to) {
        let s = '';
        let t = n;
        while (t !== from) {
          s = prevCh.get(t)! + s;
          t = prev.get(t)!;
        }
        return s;
      }
      q.push(n);
    }
  }
  return null;
}

/** Walking distance from `from` to every cell of `dom`, -1 where unreachable. */
function bfsDist(from: number, dom: Set<number>, w: number, size: number): Int32Array {
  const d = new Int32Array(size).fill(-1);
  d[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!;
    const cx = c % w;
    const cy = (c / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k]!;
      const ny = cy + DY[k]!;
      if (nx < 0 || ny < 0) continue;
      const n = ny * w + nx;
      if (dom.has(n) && d[n] < 0) {
        d[n] = d[c]! + 1;
        q.push(n);
      }
    }
  }
  return d;
}

function perms(n: number): number[][] {
  if (n <= 1) return [[0]];
  const out: number[][] = [];
  const a = [...Array(n).keys()];
  const go = (k: number): void => {
    if (k === n) {
      out.push(a.slice());
      return;
    }
    for (let i = k; i < n; i++) {
      [a[k], a[i]] = [a[i]!, a[k]!];
      go(k + 1);
      [a[k], a[i]] = [a[i]!, a[k]!];
    }
  };
  go(0);
  return out;
}

/** True when a box sits where no push can save it. Boxes on goals are never dead. */
function deadlocked(bs: number[], goalSet: Set<number>, g: Grid): boolean {
  const boxSet = new Set(bs);
  for (const b of bs) {
    if (goalSet.has(b)) continue;
    const x = b % g.w;
    const y = (b / g.w) | 0;
    const up = wallAt(g, x, y - 1);
    const dn = wallAt(g, x, y + 1);
    const lf = wallAt(g, x - 1, y);
    const rt = wallAt(g, x + 1, y);
    if ((up && lf) || (up && rt) || (dn && lf) || (dn && rt)) return true;
    // Against a wall whose whole run holds no goal and whose ends are both
    // shut: a run the box can leave where its wall ends is no deadlock.
    const runs: [number, number, number, number][] = [
      [0, -1, 1, 0],
      [0, 1, 1, 0],
      [-1, 0, 0, 1],
      [1, 0, 0, 1],
    ];
    for (const [wx, wy, px, py] of runs) {
      if (!wallAt(g, x + wx, y + wy)) continue;
      let hasGoal = false;
      let openEnd = false;
      for (const s of [1, -1]) {
        for (let k = 1; ; k++) {
          const cx = x + px * s * k;
          const cy = y + py * s * k;
          if (wallAt(g, cx, cy)) break; // the run is capped by a wall
          if (!wallAt(g, cx + wx, cy + wy)) {
            openEnd = true; // the wall ends here: the box can leave the run
            break;
          }
          if (goalSet.has(cy * g.w + cx)) {
            hasGoal = true;
            break;
          }
        }
        if (hasGoal || openEnd) break;
      }
      if (!hasGoal && !openEnd) return true;
    }
    // A 2x2 block of walls and boxes, holding a box off its goal.
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
      const cells = [
        (y + oy) * g.w + (x + ox),
        (y + oy) * g.w + (x + ox + 1),
        (y + oy + 1) * g.w + (x + ox),
        (y + oy + 1) * g.w + (x + ox + 1),
      ];
      let full = true;
      let hasBox = false;
      for (const c of cells) {
        if (wallAt(g, c % g.w, (c / g.w) | 0)) continue;
        if (boxSet.has(c)) {
          hasBox = true;
          continue;
        }
        full = false;
        break;
      }
      if (full && hasBox) {
        for (const c of cells) if (boxSet.has(c) && !goalSet.has(c)) return true;
      }
    }
  }
  return false;
}

/**
 * Solve one room push-optimally. The player starts on `out`, the hallway square
 * outside the door, and ends there again; boxes move only inside `cells`.
 * Returns the moves (walks and pushes, then the walk back out), or null.
 */
function solveRoom(
  cells: Set<number>,
  out: number,
  rboxes: number[],
  rgoals: number[],
  g: Grid,
): string | null {
  const dom = new Set(cells);
  dom.add(out);
  const goalSet = new Set(rgoals);
  const n = rboxes.length;
  const dist = rgoals.map((goal) => bfsDist(goal, dom, g.w, g.w * g.h));
  const ps = perms(n);
  const heur = (bs: number[]): number => {
    let best = Infinity;
    for (const p of ps) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const d = dist[p[i]!]![bs[i]!]!;
        if (d < 0) {
          s = Infinity;
          break;
        }
        s += d;
      }
      if (s < best) best = s;
    }
    return best;
  };
  const keyOf = (p: number, bs: number[]): number => {
    let k = p;
    let m = 512;
    for (const b of bs) {
      k += b * m;
      m *= 512;
    }
    return k;
  };
  // A binary heap on [f, g, seq, id]: lowest f first, deepest first on a tie.
  const heap: [number, number, number, number][] = [];
  const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  const hpush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const hpop = (): [number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };
  const start = rboxes.slice().sort((a, b) => a - b);
  const sp: number[] = [out];
  const sb: number[][] = [start];
  const sg: number[] = [0];
  const spar: number[] = [-1];
  const spush: number[] = [-1]; // the push that made the state, box cell * 4 + dir
  const best = new Map<number, number>([[keyOf(out, start), 0]]);
  let seq = 0;
  hpush([heur(start), 0, seq++, 0]);
  let expanded = 0;
  let goalId = -1;
  while (heap.length > 0) {
    const [, gv, , id] = hpop();
    const p = sp[id]!;
    const bs = sb[id]!;
    if (best.get(keyOf(p, bs)) !== gv) continue;
    if (bs.every((b) => goalSet.has(b))) {
      goalId = id;
      break;
    }
    if (++expanded > CAP) return null;
    const occ = new Set(bs);
    const reach = reachSet(p, occ, dom, g.w);
    for (let bi = 0; bi < n; bi++) {
      const b = bs[bi]!;
      const bx = b % g.w;
      const by = (b / g.w) | 0;
      for (let k = 0; k < 4; k++) {
        const dest = (by + DY[k]!) * g.w + (bx + DX[k]!);
        if (!cells.has(dest) || occ.has(dest)) continue;
        const from = (by - DY[k]!) * g.w + (bx - DX[k]!);
        if (!reach.has(from)) continue;
        const nb = bs.slice();
        nb[bi] = dest;
        nb.sort((a, b2) => a - b2);
        if (deadlocked(nb, goalSet, g)) continue;
        const h2 = heur(nb);
        if (!isFinite(h2)) continue;
        const nk = keyOf(b, nb);
        const ng = gv + 1;
        if (best.has(nk) && best.get(nk)! <= ng) continue;
        best.set(nk, ng);
        const nid = sp.length;
        sp.push(b);
        sb.push(nb);
        sg.push(ng);
        spar.push(id);
        spush.push(b * 4 + k);
        hpush([ng + h2, ng, seq++, nid]);
      }
    }
  }
  if (goalId < 0) return null;
  const pushes: number[] = [];
  for (let t = goalId; t > 0; t = spar[t]!) pushes.push(spush[t]!);
  pushes.reverse();
  // Turn the pushes into moves: walk to each push, push, then walk back out.
  let moves = '';
  let p = out;
  const bs = start.slice();
  const occ = new Set(bs);
  for (const enc of pushes) {
    const b = (enc / 4) | 0;
    const k = enc % 4;
    const from = (Math.floor(b / g.w) - DY[k]!) * g.w + ((b % g.w) - DX[k]!);
    const path = walkPath(p, from, occ, dom, g.w);
    if (path === null) return null;
    moves += path + CH[k]!;
    occ.delete(b);
    const d = b + DY[k]! * g.w + DX[k]!;
    occ.add(d);
    bs[bs.indexOf(b)] = d;
    bs.sort((a, b2) => a - b2);
    p = b;
  }
  const exit = walkPath(p, out, occ, dom, g.w);
  if (exit === null) return null;
  return moves + exit;
}

function solve(text: string): string {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  let boxes: number[] = [];
  let player = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const c = row[x] ?? '#';
      const i = y * w + x;
      if (c !== '#') wall[i] = 0;
      if ('.*+'.includes(c)) goals.push(i);
      if ('$*'.includes(c)) boxes.push(i);
      if ('@+'.includes(c)) player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  const g: Grid = { w, h, wall };
  const H = Math.floor(player / w);
  // The rooms: a door is a floor cell in the row beside the hallway, over a floor
  // cell of the hallway; its room is the flood fill on its side of the hallway.
  const rooms: { cells: Set<number>; door: number; out: number; boxes: number[]; goals: number[] }[] = [];
  const claimed = new Set<number>();
  for (let x = 0; x < w; x++) {
    for (const s of [-1, 1]) {
      const y = H + s;
      if (y < 0 || y >= h) continue;
      const door = y * w + x;
      if (wall[door] === 1 || wall[H * w + x] === 1 || claimed.has(door)) continue;
      const cells = new Set<number>([door]);
      const q = [door];
      for (let i = 0; i < q.length; i++) {
        const c = q[i]!;
        const cx = c % w;
        const cy = (c / w) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = cx + DX[k]!;
          const ny = cy + DY[k]!;
          if (nx < 0 || ny < 0 || ny >= h) continue;
          if (s < 0 ? ny >= H : ny <= H) continue;
          const n = ny * w + nx;
          if (wall[n] === 1 || cells.has(n)) continue;
          cells.add(n);
          q.push(n);
        }
      }
      cells.forEach((c) => claimed.add(c));
      const rb = boxes.filter((b) => cells.has(b));
      const rg = goals.filter((gl) => cells.has(gl));
      if (rb.length === 0) continue;
      rooms.push({ cells, door, out: H * w + x, boxes: rb, goals: rg });
    }
  }
  // Every box must belong to a room; anything else leaves the level unsolved.
  const inRoom = new Set<number>();
  rooms.forEach((r) => r.cells.forEach((c) => inRoom.add(c)));
  if (boxes.some((b) => !inRoom.has(b))) return '';
  const floorAll = new Set<number>();
  for (let i = 0; i < w * h; i++) if (wall[i] === 0) floorAll.add(i);
  let moves = '';
  let cur = player;
  const occAll = new Set(boxes);
  for (const r of rooms) {
    const rm = solveRoom(r.cells, r.out, r.boxes, r.goals, g);
    if (rm === null) return '';
    const path = walkPath(cur, r.out, occAll, floorAll, w);
    if (path === null) return '';
    moves += path + rm;
    for (const b of r.boxes) occAll.delete(b);
    for (const gl of r.goals) occAll.add(gl);
    cur = r.out;
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
