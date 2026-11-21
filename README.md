# sokoban-solver: a push-optimal Sokoban solver

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/amphibians-o/makefun-sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/amphibians-o/makefun-sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Entry for the make.fun bounty [“Build the best Sokoban solver, 21 November 2026”](https://make.fun/bounty/sokoban-solver-01-run-20261121).

`main.ts` is a dependency-free program (Node 22, run as `node /bot/main.ts`) that
answers every instance of a set in one run, writing `/output/<id>/solution.txt`
for each.

## How it works

Every level is a hallway with rooms off it, one door each, and a box pushed out
of a door into the hallway can never come back — so the rooms are independent
problems, joined only by the player's walk, and the level's push-optimal count
is the sum of the rooms' optima. The solver:

- finds each room by flood-filling from its door, staying on its side of the
  hallway;
- solves each room push-optimally with A* over pushes: a state is the player's
  square and the boxes', a step costs one push, and the estimate is the cheapest
  assignment of boxes to goals by walking distance around the walls;
- prunes dead positions: corners, boxes against a wall run with no goal on it
  and no way off the wall, and full 2×2 blocks of walls and boxes;
- walks the player between rooms through the hallway and writes the moves out.

The search is bounded by expansions, never by the clock, so two runs write the
same bytes.

## Verification

- The kit's practice set: **1,000,000** — every instance solved in exactly its
  push-optimal count (13, 16, 29, 47, 60 pushes).
- Six further sets drawn with the kit's own generator from fresh seeds:
  **1,000,000** on each (35 instances in total, all push-optimal).
- The kit's `grade-local` (process driver): score 1,000,000, all 5 instances
  1000/1000, L1 regrade reproduced byte for byte.
- The house baseline (plain-astar 1.0.0) scores 200,000 on the practice set —
  it solves only the first instance — so this entry beats it by 800,000.
- Runtime on the practice set: under 1 second for the whole set (limit 60 s).
