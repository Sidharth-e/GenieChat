/**
 * Positions the drawn graph with d3-force.
 *
 * Pure, deterministic and renderer-unaware, like the module it replaces: the
 * simulation owns the geometry and knows nothing about a canvas, so the
 * decisions worth testing — where a node starts, what a tick changes, what
 * "settled" means — need no browser.
 *
 * It is a *stepper* rather than a one-shot call. The renderer owns the frame
 * loop and asks for ticks while the simulation is hot, which is what keeps a
 * layout of thousands of nodes off the render path: the work is spread across
 * frames instead of blocking the one that mounted the component.
 *
 * `forceSimulation()` starts a timer of its own the moment it is constructed.
 * That timer is stopped here and never restarted — a `restart()` would tick the
 * graph in the background while the renderer also ticks it, and the two would
 * fight over the same nodes.
 */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import {
  MEMORY_GRAPH_ALPHA_DECAY,
  MEMORY_GRAPH_CHARGE_STRENGTH,
  MEMORY_GRAPH_COLLIDE_PADDING,
  MEMORY_GRAPH_LINK_DISTANCE,
  MEMORY_GRAPH_SEED_RADIUS_FRACTION,
  MEMORY_GRAPH_VELOCITY_DECAY,
} from "@/constants/memory";

/** One node the layout positions. The renderer paints the same array it hands in. */
export interface MemoryLayoutNode {
  id: string;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** d3's pin: a node with both set does not move. */
  fx?: number | null;
  fy?: number | null;
}

export interface MemoryLayoutInput {
  id: string;
  radius: number;
}

export interface MemoryLayoutEdge {
  source: string;
  target: string;
}

export interface MemoryLayoutOptions {
  width: number;
  height: number;
}

export interface MemoryLayoutSimulation {
  /** The same array the caller seeded, mutated in place. */
  readonly nodes: MemoryLayoutNode[];
  alpha(): number;
  tick(iterations?: number): void;
  /** Wake a settled simulation, e.g. after a drag, a resize or a filter change. */
  reheat(alpha?: number): void;
  /** Hold a node at a point, or release it back to the simulation when `y` is null. */
  pin(id: string, x: number, y: number | null): void;
}

/**
 * The angle between successive points of a phyllotaxis spiral — the golden
 * angle, which is what keeps the seeds from lining up on spokes.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Places every node on a golden-angle spiral out to a fraction of the viewport's
 * short side, centred.
 *
 * Every position is assigned explicitly, so nothing depends on d3's own
 * initialization and the same input always produces the same picture — a
 * remount must not reshuffle the graph.
 */
export function seedMemoryLayout(
  inputs: MemoryLayoutInput[],
  width: number,
  height: number,
): MemoryLayoutNode[] {
  const maxRadius = MEMORY_GRAPH_SEED_RADIUS_FRACTION * (Math.min(width, height) / 2);
  const centerX = width / 2;
  const centerY = height / 2;

  return inputs.map((input, index) => {
    // sqrt spreads the seeds evenly by *area* rather than by radius, so the
    // outer ring is not crowded while the middle is empty.
    const radius = maxRadius * Math.sqrt(index / Math.max(inputs.length, 1));
    const angle = index * GOLDEN_ANGLE;
    return {
      id: input.id,
      radius: input.radius,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
    };
  });
}

/**
 * Builds the simulation over an already-seeded node array.
 *
 * `nodes` is returned as-is, so the renderer keeps painting the array it handed
 * in. The edges are copied and filtered first: `forceLink` rewrites each link's
 * `source` and `target` from ids to node objects, and doing that to the caller's
 * edge list would mutate the view it came from. It also *throws* on a link
 * naming a node that is not in the array, so an edge whose endpoint the node
 * ceiling dropped has to be removed here rather than left to fail at
 * initialization.
 */
export function createMemoryLayout(
  nodes: MemoryLayoutNode[],
  edges: MemoryLayoutEdge[],
  options: MemoryLayoutOptions,
): MemoryLayoutSimulation {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
    }));

  const simulation: Simulation<MemoryLayoutNode, undefined> = forceSimulation(nodes)
    .force(
      "link",
      forceLink<MemoryLayoutNode, { source: string; target: string }>(links)
        .id((node) => node.id)
        .distance(MEMORY_GRAPH_LINK_DISTANCE),
    )
    .force("charge", forceManyBody().strength(MEMORY_GRAPH_CHARGE_STRENGTH))
    .force(
      "collide",
      forceCollide<MemoryLayoutNode>((node) => node.radius + MEMORY_GRAPH_COLLIDE_PADDING),
    )
    .force("center", forceCenter(options.width / 2, options.height / 2))
    .alphaDecay(MEMORY_GRAPH_ALPHA_DECAY)
    .velocityDecay(MEMORY_GRAPH_VELOCITY_DECAY)
    // d3 starts its own timer on construction — the renderer drives ticks.
    .stop();

  return {
    nodes,
    alpha: () => simulation.alpha(),
    tick: (iterations = 1) => simulation.tick(iterations),
    reheat: (alpha = 0.6) => {
      simulation.alpha(alpha);
    },
    pin: (id, x, y) => {
      const node = nodes.find((candidate) => candidate.id === id);
      if (!node) return;
      if (y === null) {
        node.fx = null;
        node.fy = null;
        return;
      }
      node.fx = x;
      node.fy = y;
      node.x = x;
      node.y = y;
    },
  };
}
