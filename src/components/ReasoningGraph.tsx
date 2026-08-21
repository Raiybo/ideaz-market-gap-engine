"use client";

/**
 * Live view of the engine reasoning.
 *
 * The analysis is already a graph — a country fans out to data sources, sources
 * resolve into signals, sectors fan out to segments, segments resolve into
 * findings — so this draws that structure as it is built rather than
 * visualising a finished result. A node appears the moment the engine commits
 * to doing that piece of work and changes colour when it resolves, which means
 * an unresolved node is genuinely where the engine is waiting.
 *
 * Layout is a radial tree rather than a force simulation. With ~120 nodes a
 * force layout converges into a hairball that hides exactly the structure worth
 * seeing; a radial tree keeps depth legible (sources near the centre, findings
 * at the rim) and stays stable as nodes arrive, so the picture does not
 * reshuffle every time a request returns.
 */

import { useMemo, useState } from "react";

import type { TraceNode, TraceStatus } from "@/lib/engine/trace";

const VIEW_W = 1320;
const VIEW_H = 620;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;

/**
 * Ring radius per depth, as separate x and y radii. The container is much wider
 * than it is tall, so a circular layout would waste the sides and cram the
 * vertical — an ellipse uses the space that is actually there.
 */
const RINGS_X = [0, 250, 420, 500, 520];
const RINGS_Y = [0, 148, 248, 292, 302];

/**
 * How much of a child's angular wedge is proportional to its subtree size
 * versus divided equally among siblings.
 *
 * Purely proportional is what you want at rest, but it breaks during the run:
 * before the sectors arrive, World Bank's 23 indicators are 92% of the graph
 * and squeeze Comtrade and OpenStreetMap into a slice too narrow to label. The
 * equal share is a floor that keeps every branch readable while the shape of
 * the graph is still changing.
 */
const PROPORTIONAL_WEIGHT = 0.62;

const STATUS_COLOR: Record<TraceStatus, string> = {
  pending: "var(--border)",
  active: "var(--accent)",
  ok: "var(--positive)",
  empty: "var(--warning)",
  error: "var(--danger)",
};

const KIND_RADIUS: Record<TraceNode["kind"], number> = {
  country: 13,
  source: 8.5,
  sector: 7,
  signal: 3.4,
  segment: 3.4,
  finding: 6.5,
};

interface Placed {
  node: TraceNode;
  x: number;
  y: number;
  depth: number;
  angle: number;
  radius: number;
}

interface LayoutResult {
  placed: Map<string, Placed>;
  order: string[];
}

/**
 * Radial tree layout. Each subtree receives an angular wedge proportional to
 * the number of leaves beneath it, so a source with 23 indicators is not
 * crushed into the same slice as one with a single child.
 */
function layout(nodes: Map<string, TraceNode>): LayoutResult {
  const children = new Map<string, string[]>();
  const roots: string[] = [];

  for (const [id, node] of nodes) {
    if (node.parent && nodes.has(node.parent)) {
      const list = children.get(node.parent) ?? [];
      list.push(id);
      children.set(node.parent, list);
    } else {
      roots.push(id);
    }
  }

  const leafCount = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id);
    if (!kids || kids.length === 0) {
      leafCount.set(id, 1);
      return 1;
    }
    const total = kids.reduce((sum, kid) => sum + countLeaves(kid), 0);
    leafCount.set(id, total);
    return total;
  };
  roots.forEach(countLeaves);

  const placed = new Map<string, Placed>();
  const order: string[] = [];

  const place = (
    id: string,
    depth: number,
    startAngle: number,
    endAngle: number,
  ) => {
    const node = nodes.get(id);
    if (!node) return;

    const angle = (startAngle + endAngle) / 2;
    const d = Math.min(depth, RINGS_X.length - 1);
    // Depth 0 sits dead centre; everything else is polar around it.
    const x = depth === 0 ? CX : CX + Math.cos(angle) * RINGS_X[d];
    const y = depth === 0 ? CY : CY + Math.sin(angle) * RINGS_Y[d];

    const weightBoost = node.weight ? Math.min(node.weight, 100) / 100 : 0;
    const radius =
      KIND_RADIUS[node.kind] +
      (node.kind === "segment" || node.kind === "sector"
        ? weightBoost * 5.5
        : 0);

    placed.set(id, { node, x, y, depth, angle, radius });
    order.push(id);

    const kids = children.get(id);
    if (!kids || kids.length === 0) return;

    const span = endAngle - startAngle;
    const total = kids.reduce((sum, kid) => sum + (leafCount.get(kid) ?? 1), 0);
    const equal = 1 / kids.length;
    let cursor = startAngle;
    for (const kid of kids) {
      const proportional = (leafCount.get(kid) ?? 1) / total;
      const share =
        (PROPORTIONAL_WEIGHT * proportional +
          (1 - PROPORTIONAL_WEIGHT) * equal) *
        span;
      place(kid, depth + 1, cursor, cursor + share);
      cursor += share;
    }
  };

  // Start at -90deg so the first branch grows upward, which reads as a
  // beginning rather than an arbitrary slice.
  const rootSpan = (Math.PI * 2) / Math.max(roots.length, 1);
  roots.forEach((id, i) => {
    const start = -Math.PI / 2 + i * rootSpan;
    place(id, 0, start, start + rootSpan);
  });

  return { placed, order };
}

/** Curved edge, bowed toward the centre so sibling branches stay separable. */
function edgePath(from: Placed, to: Placed): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const pull = 0.22;
  const qx = mx + (CX - mx) * pull;
  const qy = my + (CY - my) * pull;
  return `M ${from.x} ${from.y} Q ${qx} ${qy} ${to.x} ${to.y}`;
}

/** Segment labels shown, taken from the top of the score distribution. */
const LABELLED_SEGMENTS = 7;

interface LabelSpec {
  id: string;
  text: string;
  priority: number;
}

/**
 * Decide which nodes get a label, then drop any that would collide.
 *
 * Scores cluster tightly — a country can have twenty segments between 58 and
 * 66 — so a fixed score threshold either labels almost everything or almost
 * nothing. Ranking and taking a fixed count is stable across countries, and a
 * greedy collision pass afterwards keeps the survivors readable.
 */
function chooseLabels(placed: Map<string, Placed>): Map<string, string> {
  const candidates: LabelSpec[] = [];

  const segments = Array.from(placed.values())
    .filter((p) => p.node.kind === "segment")
    .sort((a, b) => (b.node.weight ?? 0) - (a.node.weight ?? 0))
    .slice(0, LABELLED_SEGMENTS);
  const topSegmentIds = new Set(segments.map((p) => p.node.id));

  for (const p of placed.values()) {
    const { node, depth } = p;
    if (depth === 0) candidates.push({ id: node.id, text: node.label, priority: 100 });
    else if (node.kind === "source") candidates.push({ id: node.id, text: node.label, priority: 90 });
    else if (node.kind === "sector") candidates.push({ id: node.id, text: node.label, priority: 80 });
    else if (node.kind === "finding") candidates.push({ id: node.id, text: node.label, priority: 70 });
    else if (topSegmentIds.has(node.id)) {
      candidates.push({ id: node.id, text: node.label, priority: 60 + (node.weight ?? 0) / 100 });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  const kept = new Map<string, string>();
  const taken: Array<{ x: number; y: number; right: boolean }> = [];

  for (const c of candidates) {
    const p = placed.get(c.id);
    if (!p) continue;
    if (p.depth === 0) {
      kept.set(c.id, c.text);
      continue;
    }
    const right = Math.cos(p.angle) >= 0;
    const clash = taken.some(
      (t) =>
        t.right === right &&
        Math.abs(t.y - p.y) < 13 &&
        Math.abs(t.x - p.x) < 190,
    );
    if (clash) continue;
    taken.push({ x: p.x, y: p.y, right });
    kept.set(c.id, c.text);
  }

  return kept;
}

export interface ReasoningGraphProps {
  nodes: Map<string, TraceNode>;
  phase: string | null;
  note: string | null;
  running: boolean;
  elapsedMs: number | null;
}

export function ReasoningGraph({
  nodes,
  phase,
  note,
  running,
  elapsedMs,
}: ReasoningGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { placed, order } = useMemo(() => layout(nodes), [nodes]);
  const labels = useMemo(() => chooseLabels(placed), [placed]);

  const counts = useMemo(() => {
    let resolved = 0;
    let active = 0;
    for (const node of nodes.values()) {
      if (node.status === "active" || node.status === "pending") active += 1;
      else resolved += 1;
    }
    return { resolved, active, total: nodes.size };
  }, [nodes]);

  const hoveredNode = hovered ? placed.get(hovered) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${running ? "animate-pulse" : ""}`}
            style={{
              background: running ? "var(--accent)" : "var(--positive)",
            }}
          />
          <span className="text-sm font-medium">
            {phase ?? (running ? "Starting…" : "Reasoning complete")}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-[var(--muted)]">
          <span>
            {counts.resolved}/{counts.total} resolved
          </span>
          {elapsedMs !== null && <span>{(elapsedMs / 1000).toFixed(1)}s</span>}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-[380px] w-full sm:h-[520px]"
          role="img"
          aria-label="Live graph of the engine's reasoning"
        >
          {/* Depth rings, as a quiet reference for how far out a node sits. */}
          {[1, 2, 3].map((d) => (
            <ellipse
              key={d}
              cx={CX}
              cy={CY}
              rx={RINGS_X[d]}
              ry={RINGS_Y[d]}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
              opacity={0.35}
            />
          ))}

          <g>
            {order.map((id) => {
              const p = placed.get(id)!;
              const parentId = p.node.parent;
              if (!parentId) return null;
              const parent = placed.get(parentId);
              if (!parent) return null;
              const activeEdge =
                p.node.status === "active" || p.node.status === "pending";
              return (
                <path
                  key={`e-${id}`}
                  d={edgePath(parent, p)}
                  fill="none"
                  className={`rg-edge ${activeEdge ? "rg-edge-active" : ""}`}
                  stroke={
                    hovered === id || hovered === parentId
                      ? "var(--accent)"
                      : STATUS_COLOR[p.node.status]
                  }
                  strokeWidth={p.depth <= 1 ? 1.6 : 1}
                  opacity={
                    hovered && hovered !== id && hovered !== parentId
                      ? 0.12
                      : activeEdge
                        ? 0.55
                        : 0.32
                  }
                />
              );
            })}
          </g>

          <g>
            {order.map((id) => {
              const p = placed.get(id)!;
              const color = STATUS_COLOR[p.node.status];
              const label = hovered === id ? p.node.label : (labels.get(id) ?? null);
              const dim = hovered !== null && hovered !== id;
              const isActive = p.node.status === "active";
              // Labels flip side past the vertical so text never reads
              // backwards on the left half of the ring.
              const flip = Math.cos(p.angle) < 0 && p.depth > 0;

              return (
                <g
                  key={id}
                  className="rg-node rg-appear"
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={dim ? 0.3 : 1}
                  onMouseEnter={() => setHovered(id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "pointer" }}
                >
                  {isActive && (
                    <circle
                      className="rg-pulse"
                      r={p.radius}
                      fill={color}
                      style={
                        { "--rg-r": `${p.radius}px` } as React.CSSProperties
                      }
                    />
                  )}
                  <circle
                    r={p.radius}
                    fill={p.node.status === "pending" ? "var(--surface)" : color}
                    stroke={color}
                    strokeWidth={1.5}
                  />
                  {/* Generous invisible hit area — the dots are small. */}
                  <circle r={Math.max(p.radius + 7, 12)} fill="transparent" />
                  {label && (
                    <text
                      x={p.depth === 0 ? 0 : flip ? -(p.radius + 6) : p.radius + 6}
                      y={p.depth === 0 ? p.radius + 16 : 3.5}
                      textAnchor={
                        p.depth === 0 ? "middle" : flip ? "end" : "start"
                      }
                      fontSize={p.depth === 0 ? 15 : p.depth === 1 ? 11.5 : 10}
                      fontWeight={p.depth <= 1 ? 600 : 400}
                      fill={
                        p.depth <= 1 ? "var(--foreground)" : "var(--muted)"
                      }
                      style={{ pointerEvents: "none" }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Hover detail. Positioned over the graph rather than in a tooltip so
            it never gets clipped by the SVG viewport. */}
        {hoveredNode && (
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/95 px-3 py-2 backdrop-blur">
            <p className="text-xs font-semibold">{hoveredNode.node.label}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {hoveredNode.node.detail ??
                (hoveredNode.node.status === "active"
                  ? "In flight…"
                  : "Waiting to start")}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">
        {(
          [
            ["active", "in flight"],
            ["ok", "resolved"],
            ["empty", "no data"],
            ["error", "failed"],
          ] as Array<[TraceStatus, string]>
        ).map(([status, text]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: STATUS_COLOR[status] }}
            />
            {text}
          </span>
        ))}
        {note && (
          <span className="ml-auto truncate font-mono opacity-80">{note}</span>
        )}
      </div>
    </div>
  );
}
