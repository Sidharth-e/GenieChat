/**
 * Positions a memory graph without a layout library.
 *
 * A force-directed simulation is the honest choice for this data: it has no
 * natural hierarchy (so a layered layout like dagre would invent one), and the
 * structure worth seeing — dense clusters of related memories, entities shared
 * between them — is exactly what a force layout surfaces.
 *
 * Hand-rolled rather than `d3-force` for two reasons. It stays a pure function,
 * so it lives under `lib/` with the rest of the logic and gets unit tests rather
 * than being a library call nothing covers. And it is *deterministic*: there is
 * no `Math.random` anywhere, so the same graph lays out identically every time
 * the component mounts. A layout that reshuffled on every render would make the
 * graph unreadable across a single session, which is the entire point of drawing
 * it.
 *
 * The cost is O(n²) per iteration, which is why the view caps total nodes —
 * see `MEMORY_GRAPH_NODE_LIMIT`.
 */
import {
  MEMORY_GRAPH_LAYOUT_CENTER_PULL,
  MEMORY_GRAPH_LAYOUT_HEIGHT,
  MEMORY_GRAPH_LAYOUT_ITERATIONS,
  MEMORY_GRAPH_LAYOUT_MAX_STEP,
  MEMORY_GRAPH_LAYOUT_TEMPERATURE_DECAY,
  MEMORY_GRAPH_LAYOUT_WIDTH,
} from "@/constants/memory";

export interface GraphLayoutInput {
  id: string;
  /**
   * Rough half-width of the drawn node, in layout units. Bigger nodes push
   * harder, so a row of long memory cards does not overlap itself.
   */
  radius: number;
}

export interface GraphLayoutPoint {
  x: number;
  y: number;
}

export interface GraphLayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
}

/** The radius a node is assumed to have when scaling repulsion. */
const BASE_RADIUS = 60;

/**
 * Padding kept between a node and the canvas edge, in layout units. A fixed
 * value rather than a fraction of the ideal spacing: the ideal spacing shrinks
 * as `1/√n`, so a margin derived from it would crowd a dense graph against the
 * boundary exactly when there is least room to spare.
 */
const CANVAS_MARGIN = 40;

/**
 * The seeded spiral's outer radius, as a fraction of the shorter canvas side.
 * The seed has to land *inside* the box: a spiral that overshoots gets clamped
 * on the first iteration, and nodes pinned to an edge have their repulsion
 * cancelled by the clamp — the graph then never opens up.
 */
const SEED_RADIUS_FRACTION = 0.35;

/**
 * The golden angle, in radians. Used for the seeded start positions: stepping
 * a spiral by it packs points without ever aligning them, so no two nodes start
 * coincident and the simulation never has to escape a degenerate stack.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Returns one point per node id, inside `width` × `height`.
 *
 * The algorithm is Fruchterman–Reingold: repulsion `k²/d`, attraction `d²/k`,
 * both against `k` — the ideal edge length that the canvas area and the node
 * count imply. The two forces are equal at `d = k`, which is what makes the
 * result need no per-graph tuning. Three departures from the textbook version,
 * each for a reason worth naming:
 *
 * 1. **Radius-scaled repulsion.** Otherwise a memory node carrying a sentence
 *    occupies the same space as an entity pill and the two draw on top of each
 *    other.
 * 2. **A per-iteration step cap.** Repulsion diverges as `d → 0`, so a pair that
 *    drifts coincident is flung across the canvas in one step, dragging its
 *    neighbours behind it. The cooling schedule already limits travel; the cap
 *    bounds the early iterations where the temperature is still high.
 * 3. **A fixed iteration count.** A convergence test on a graph that never fully
 *    settles would not terminate; 160 iterations is where the picture stops
 *    visibly moving at the cap size.
 */
export function layoutMemoryGraph(
  nodes: GraphLayoutInput[],
  edges: { source: string; target: string }[],
  options: GraphLayoutOptions = {},
): Record<string, GraphLayoutPoint> {
  const count = nodes.length;
  if (count === 0) return {};

  const width = options.width ?? MEMORY_GRAPH_LAYOUT_WIDTH;
  const height = options.height ?? MEMORY_GRAPH_LAYOUT_HEIGHT;
  const iterations = options.iterations ?? MEMORY_GRAPH_LAYOUT_ITERATIONS;

  const index = new Map<string, number>();
  for (let i = 0; i < count; i += 1) index.set(nodes[i].id, i);

  // The ideal edge length: the space each node would get if the canvas were
  // divided evenly. Every force below is expressed against it, which is why the
  // simulation does not need retuning when the panel is resized.
  const ideal = Math.sqrt((width * height) / count);
  const idealSquared = ideal * ideal;

  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const dxs = new Float64Array(count);
  const dys = new Float64Array(count);
  const radiusScale = new Float64Array(count);

  const centreX = width / 2;
  const centreY = height / 2;

  // Seeded on a golden-angle spiral, bounded to `SEED_RADIUS_FRACTION` of the
  // shorter side so every start point is inside the canvas. `Math.sqrt(i / count)`
  // rather than a linear ramp in `i`: it spaces the seeds evenly by *area*, which
  // is the distribution the simulation aims for, so the first iterations refine a
  // roughly right picture instead of spreading a clump outwards.
  const seedRadius = Math.min(width, height) * SEED_RADIUS_FRACTION;
  for (let i = 0; i < count; i += 1) {
    const distance = seedRadius * Math.sqrt((i + 0.5) / count);
    const angle = i * GOLDEN_ANGLE;
    xs[i] = centreX + distance * Math.cos(angle);
    ys[i] = centreY + distance * Math.sin(angle);
    radiusScale[i] = Math.max(nodes[i].radius, 1) / BASE_RADIUS;
  }

  // Edge endpoints resolved once, not per iteration: `index.get` on every pass
  // would be the most expensive thing in the loop for no benefit.
  const springs: { a: number; b: number }[] = [];
  for (const edge of edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    // A self-edge or a dangling reference is skipped rather than thrown on: the
    // assembler already guarantees both endpoints exist, and a layout is not
    // the place to discover otherwise.
    if (a === undefined || b === undefined || a === b) continue;
    springs.push({ a, b });
  }

  // Kept inside the canvas, and never more than a quarter of the shorter side so
  // a deliberately small canvas cannot produce an inverted clamp range.
  const margin = Math.min(CANVAS_MARGIN, Math.min(width, height) / 4);

  let temperature = Math.min(width, height) / 10;

  for (let step = 0; step < iterations; step += 1) {
    dxs.fill(0);
    dys.fill(0);

    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let dx = xs[i] - xs[j];
        let dy = ys[i] - ys[j];
        let distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < 1e-6) {
          // Coincident. The nudge is derived from the indices rather than
          // random, so determinism survives the degenerate case.
          dx = ((i % 7) + 1) * 0.01;
          dy = ((j % 7) + 1) * 0.01;
          distanceSquared = dx * dx + dy * dy;
        }

        const distance = Math.sqrt(distanceSquared);
        const scale = (radiusScale[i] + radiusScale[j]) / 2;
        const force = (idealSquared * scale) / distance;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        dxs[i] += fx;
        dys[i] += fy;
        dxs[j] -= fx;
        dys[j] -= fy;
      }
    }

    for (const { a, b } of springs) {
      const dx = xs[a] - xs[b];
      const dy = ys[a] - ys[b];
      const distance = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      // The pull, against the repulsion's push. The two are equal at `d = ideal`,
      // which is what settles a connected pair at the ideal spacing rather than
      // wherever the constants happen to balance.
      const force = (distance * distance) / ideal;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      dxs[a] -= fx;
      dys[a] -= fy;
      dxs[b] += fx;
      dys[b] += fy;
    }

    for (let i = 0; i < count; i += 1) {
      dxs[i] += (centreX - xs[i]) * MEMORY_GRAPH_LAYOUT_CENTER_PULL;
      dys[i] += (centreY - ys[i]) * MEMORY_GRAPH_LAYOUT_CENTER_PULL;

      const magnitude = Math.sqrt(dxs[i] * dxs[i] + dys[i] * dys[i]);
      if (magnitude < 1e-9) continue;

      const travel = Math.min(magnitude, temperature, MEMORY_GRAPH_LAYOUT_MAX_STEP);
      xs[i] += (dxs[i] / magnitude) * travel;
      ys[i] += (dys[i] / magnitude) * travel;

      // Clamped to the canvas so a runaway node cannot leave the drawing area.
      // React Flow fits the result to the panel afterwards, so this is a
      // sanity bound, not the visible extent.
      xs[i] = Math.min(Math.max(xs[i], margin), width - margin);
      ys[i] = Math.min(Math.max(ys[i], margin), height - margin);
    }

    temperature *= MEMORY_GRAPH_LAYOUT_TEMPERATURE_DECAY;
  }

  const positions: Record<string, GraphLayoutPoint> = {};
  for (let i = 0; i < count; i += 1) {
    positions[nodes[i].id] = {
      // Rounded to whole units: a sub-pixel difference is invisible, and it
      // keeps a snapshot of the output stable enough to assert on.
      x: Math.round(xs[i]),
      y: Math.round(ys[i]),
    };
  }
  return positions;
}
