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
 * Layout is a left-to-right pipeline, one column per stage of the reasoning.
 * An earlier version drew a radial tree, which was compact but read as
 * decoration: depth was a ring radius nobody could name, labels flipped
 * direction on the left half, and sources and sectors shared a ring despite
 * being different kinds of work. Columns fix all three — every stage gets a
 * heading that says what it is and why it happens, reading order matches
 * execution order, and every label sits horizontally to the right of its node.
 *
 * The other change is subtraction. The radial version drew all ~120 nodes,
 * and the 26 World Bank indicators alone were most of the picture while
 * carrying almost none of the meaning. Everything hanging off a source is now
 * a small cell in a grid beside it: the same live texture as those cells fill
 * in, in a twentieth of the space, with the detail still available on hover.
 */

import { useMemo, useState } from "react";

import type { TraceNode, TraceStatus } from "@/lib/engine/trace";

const VIEW_W = 1440;
const VIEW_H = 600;

/** Where the lane body starts, below the stage headings. */
const BODY_TOP = 96;
const BODY_BOTTOM = VIEW_H - 30;
const LANE_LEFT = 118;
/** Reserved on the right so the last lane's labels have somewhere to go. */
const LANE_RIGHT_PAD = 210;

type LaneKind = "country" | "source" | "sector" | "segment" | "finding";

interface LaneSpec {
  kind: LaneKind;
  title: string;
  /** One line saying what this stage is for. This is the whole point. */
  blurb: string;
}

/**
 * The five stages, in the order the engine performs them. The blurbs are the
 * part that makes the picture legible — without them the columns are just
 * dots, and a viewer has to already know the pipeline to read it.
 */
const LANES: LaneSpec[] = [
  { kind: "country", title: "1 · Market", blurb: "The country being examined" },
  { kind: "source", title: "2 · Evidence", blurb: "Public data, fetched live" },
  { kind: "sector", title: "3 · Sectors", blurb: "Demand split by industry" },
  { kind: "segment", title: "4 · Candidates", blurb: "Scored: demand vs supply" },
  { kind: "finding", title: "5 · Beachheads", blurb: "Top gaps, drilled to a product" },
];

const LANE_KINDS = new Set<string>(LANES.map((l) => l.kind));

/**
 * Plain-English gloss for each phase the engine announces. The phase label
 * alone ("Measuring what crosses the border") says what is happening but not
 * why it tells us anything, which is the question the graph exists to answer.
 */
const PHASE_BLURB: Record<string, string> = {
  "Reading the market":
    "Pulling population, income, industry mix and prices — this sizes the demand side.",
  "Measuring what crosses the border":
    "Comparing what the country imports against what it makes. A large import bill with no local production is the raw shape of a gap.",
  "Scoring every segment":
    "Every candidate industry scored on how much demand exists, how much is already supplied locally, and whether local conditions let you actually build it.",
  "Finding the way in":
    "For each surviving gap, choosing the entry route its binding constraint allows — substitute, finish locally, distribute, export or serve.",
  "Reading the document":
    "Extracting the text of your upload so it can be placed in the taxonomy.",
  "Locating the idea in the taxonomy":
    "Working out which market your idea actually competes in, and where.",
  "Judging the idea":
    "Running your idea through the same demand-versus-supply test every gap gets.",
};

const STATUS_COLOR: Record<TraceStatus, string> = {
  pending: "var(--border)",
  active: "var(--accent)",
  ok: "var(--positive)",
  empty: "var(--warning)",
  error: "var(--danger)",
};

const STATUS_WORD: Record<TraceStatus, string> = {
  pending: "Queued",
  active: "Working…",
  ok: "Done",
  empty: "No data",
  error: "Failed",
};

const KIND_RADIUS: Record<LaneKind, number> = {
  country: 12,
  source: 8.5,
  sector: 6,
  segment: 4.2,
  finding: 7,
};

/**
 * A lane taller than this many nodes wraps into sub-columns. Seventy-three
 * candidates in a single column sit six pixels apart and merge into one solid
 * bar — the individual dots, which are the whole point, stop being visible.
 */
const MAX_PER_COLUMN = 30;
const MAX_SUBCOLUMNS = 3;
const SUBCOL_GAP = 22;

/**
 * Lanes whose parents are themselves spread out are clustered beside their
 * parent rather than distributed down the column. Spreading them evenly makes
 * every edge a long diagonal and the middle of the picture turns into a
 * hairball; anchoring each group to its parent keeps edges short and parallel,
 * so you can see which sector a candidate came from without tracing a line.
 */
const CLUSTER_ROWS = 3;
const CLUSTER_PITCH = 11;

/** Cell grid geometry for everything aggregated under a source. */
const CELL = 4;
const CELL_PITCH = 5.6;
const CELLS_PER_ROW = 13;

interface Placed {
  node: TraceNode;
  x: number;
  y: number;
  r: number;
  laneIndex: number;
  /** Offset to the label, past any sub-columns to this node's right. */
  labelDx: number;
  /** Children of a source, drawn as a grid rather than as their own nodes. */
  cells: TraceNode[];
}

interface ActiveLane extends LaneSpec {
  x: number;
  count: number;
}

interface LayoutResult {
  placed: Placed[];
  byId: Map<string, Placed>;
  lanes: ActiveLane[];
  labels: Set<string>;
}

function trim(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Findings arrive prefixed; the lane heading already says what they are. */
function displayLabel(node: TraceNode): string {
  return node.label.replace(/^Beachhead — /, "");
}

/**
 * Column layout.
 *
 * Node order within a lane is arrival order, never score order. Sorting by
 * score looks tidier in a screenshot but reshuffles the column every time a
 * result lands, and a picture that rearranges itself while you are reading it
 * is unreadable. Scores drive which nodes get labelled, not where they sit.
 */
function layout(nodes: Map<string, TraceNode>): LayoutResult {
  const all = Array.from(nodes.values());

  const cellsBySource = new Map<string, TraceNode[]>();
  const laneMembers = new Map<LaneKind, TraceNode[]>();
  for (const lane of LANES) laneMembers.set(lane.kind, []);

  for (const node of all) {
    const parent = node.parent ? nodes.get(node.parent) : undefined;
    // Anything hanging off a source is texture, not structure: the 26 World
    // Bank indicators and Comtrade's baseline year are progress, not decisions.
    if (parent?.kind === "source") {
      const list = cellsBySource.get(parent.id) ?? [];
      list.push(node);
      cellsBySource.set(parent.id, list);
      continue;
    }
    if (!LANE_KINDS.has(node.kind)) continue;
    laneMembers.get(node.kind as LaneKind)!.push(node);
  }

  // Every stage keeps a fixed column whether or not it has anything in it yet.
  // Laying out only the stages that have arrived slides the whole picture
  // sideways each time a new one opens, and stopping things from moving is most
  // of what makes this readable. An empty column doubles as a preview of what
  // the engine is about to do.
  const span = VIEW_W - LANE_LEFT - LANE_RIGHT_PAD;
  const lanes: ActiveLane[] = LANES.map((lane, i) => ({
    ...lane,
    x: LANE_LEFT + (span / (LANES.length - 1)) * i,
    count: (laneMembers.get(lane.kind) ?? []).length,
  }));

  const placed: Placed[] = [];
  const byId = new Map<string, Placed>();
  const height = BODY_BOTTOM - BODY_TOP;

  const radiusFor = (node: TraceNode, kind: LaneKind): number =>
    KIND_RADIUS[kind] +
    (kind === "segment" || kind === "sector"
      ? (Math.min(node.weight ?? 0, 100) / 100) * 3.4
      : 0);

  const clamp = (v: number) => Math.min(Math.max(v, BODY_TOP), BODY_BOTTOM);

  lanes.forEach((lane, laneIndex) => {
    const members = laneMembers.get(lane.kind)!;
    if (members.length === 0) return;

    const add = (
      node: TraceNode,
      x: number,
      y: number,
      r: number,
      labelDx: number,
    ) => {
      const entry: Placed = {
        node,
        x,
        y,
        r,
        laneIndex,
        labelDx,
        cells: cellsBySource.get(node.id) ?? [],
      };
      placed.push(entry);
      byId.set(node.id, entry);
    };

    // Candidates and beachheads hang off parents that are themselves spread
    // down a column, so they cluster beside whichever parent produced them.
    // Lanes above have a single parent, where clustering would just stack
    // everything on one point.
    if (lane.kind === "segment" || lane.kind === "finding") {
      const groups = new Map<string, TraceNode[]>();
      for (const node of members) {
        const key = node.parent ?? "__orphan";
        const list = groups.get(key) ?? [];
        list.push(node);
        groups.set(key, list);
      }

      let orphanIndex = 0;
      for (const [parentId, group] of groups) {
        const parent = byId.get(parentId);
        const cols = Math.min(
          Math.max(Math.ceil(group.length / CLUSTER_ROWS), 1),
          MAX_SUBCOLUMNS,
        );
        const rows = Math.ceil(group.length / cols);
        const baseY =
          parent?.y ??
          BODY_TOP +
            (height / Math.max(groups.size - 1, 1)) * orphanIndex++;

        group.forEach((node, i) => {
          const col = Math.floor(i / rows);
          const row = i % rows;
          const r = radiusFor(node, lane.kind);
          add(
            node,
            lane.x + col * SUBCOL_GAP,
            clamp(baseY - ((rows - 1) / 2) * CLUSTER_PITCH + row * CLUSTER_PITCH),
            r,
            (cols - 1 - col) * SUBCOL_GAP + r + 7,
          );
        });
      }
      return;
    }

    const subCols = Math.min(
      Math.max(Math.ceil(members.length / MAX_PER_COLUMN), 1),
      MAX_SUBCOLUMNS,
    );
    const rows = Math.ceil(members.length / subCols);
    const pitch = rows > 1 ? height / (rows - 1) : 0;

    members.forEach((node, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const r = radiusFor(node, lane.kind);
      add(
        node,
        lane.x + col * SUBCOL_GAP,
        rows === 1 ? BODY_TOP + height / 2 : BODY_TOP + pitch * row,
        r,
        (subCols - 1 - col) * SUBCOL_GAP + r + 7,
      );
    });
  });

  return { placed, byId, lanes, labels: chooseLabels(placed) };
}

/** Segment labels shown, taken from the top of the score distribution. */
const LABELLED_SEGMENTS = 9;
/** Vertical clearance a label needs before it collides with its neighbour. */
const LABEL_CLEARANCE = 13;

/**
 * Decide which nodes carry a visible label.
 *
 * Everything outside the candidate lane is labelled: there are few enough of
 * them that the column stays readable and each one is a decision worth naming.
 * Candidates are the crowded lane, so only the highest scorers are named, and
 * any that would overprint a neighbour is dropped.
 */
function chooseLabels(placed: Placed[]): Set<string> {
  const kept = new Set<string>();

  const ranked = placed
    .filter((p) => p.node.kind === "segment")
    .slice()
    .sort((a, b) => (b.node.weight ?? 0) - (a.node.weight ?? 0))
    .slice(0, LABELLED_SEGMENTS);
  const topSegments = new Set(ranked.map((p) => p.node.id));

  const takenY: number[] = [];
  for (const p of placed) {
    if (p.node.kind !== "segment") {
      kept.add(p.node.id);
      continue;
    }
    if (!topSegments.has(p.node.id)) continue;
    if (takenY.some((y) => Math.abs(y - p.y) < LABEL_CLEARANCE)) continue;
    takenY.push(p.y);
    kept.add(p.node.id);
  }

  return kept;
}

/** Horizontal cubic between columns, flat at both ends so lanes read cleanly. */
function edgePath(from: Placed, to: Placed): string {
  const dx = Math.max((to.x - from.x) * 0.45, 18);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
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
  const { placed, byId, lanes, labels } = useMemo(() => layout(nodes), [nodes]);

  const counts = useMemo(() => {
    let resolved = 0;
    for (const node of nodes.values()) {
      if (node.status !== "active" && node.status !== "pending") resolved += 1;
    }
    return { resolved, total: nodes.size };
  }, [nodes]);

  const hoveredNode = hovered ? nodes.get(hovered) : null;
  const explanation = phase ? PHASE_BLURB[phase] : null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${running ? "animate-pulse" : ""}`}
              style={{ background: running ? "var(--accent)" : "var(--positive)" }}
            />
            <span className="text-sm font-medium">
              {phase ?? (running ? "Starting…" : "Reasoning complete")}
            </span>
          </div>
          {/* The reason this stage exists, not just its name. */}
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--muted)]">
            {explanation ??
              (running
                ? "Each column below is one stage of the analysis. Work moves left to right."
                : "Every dot is a decision or a lookup. Hover any of them to see what it found.")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 font-mono text-xs text-[var(--muted)]">
          <span>
            {counts.resolved}/{counts.total} resolved
          </span>
          {elapsedMs !== null && <span>{(elapsedMs / 1000).toFixed(1)}s</span>}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-[400px] w-full sm:h-[540px]"
          role="img"
          aria-label="Live graph of the engine's reasoning, one column per stage"
        >
          {/* Stage headings. These carry the explanation the dots cannot. */}
          <g>
            {lanes.map((lane) => (
              <g key={lane.kind} opacity={lane.count > 0 ? 1 : 0.4}>
                <line
                  x1={lane.x}
                  y1={BODY_TOP - 26}
                  x2={lane.x}
                  y2={BODY_BOTTOM + 14}
                  stroke="var(--border)"
                  strokeWidth={1}
                  opacity={0.35}
                />
                <text
                  x={lane.x}
                  y={38}
                  textAnchor="middle"
                  fontSize={12.5}
                  fontWeight={600}
                  fill="var(--foreground)"
                >
                  {lane.title}
                </text>
                <text
                  x={lane.x}
                  y={56}
                  textAnchor="middle"
                  fontSize={10.5}
                  fill="var(--muted)"
                >
                  {lane.blurb}
                </text>
                <text
                  x={lane.x}
                  y={74}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--font-mono, monospace)"
                  fill="var(--muted)"
                  opacity={0.75}
                >
                  {lane.count > 0 ? lane.count : "not yet"}
                </text>
              </g>
            ))}
          </g>

          <g>
            {placed.map((p) => {
              const parent = p.node.parent ? byId.get(p.node.parent) : undefined;
              if (!parent) return null;
              const flowing =
                p.node.status === "active" || p.node.status === "pending";
              const lit = hovered === p.node.id || hovered === parent.node.id;
              return (
                <path
                  key={`e-${p.node.id}`}
                  d={edgePath(parent, p)}
                  fill="none"
                  className={`rg-edge ${flowing ? "rg-edge-active" : ""}`}
                  stroke={lit ? "var(--accent)" : STATUS_COLOR[p.node.status]}
                  strokeWidth={p.laneIndex <= 1 ? 1.6 : 1}
                  opacity={
                    hovered && !lit ? 0.1 : flowing ? 0.5 : 0.28
                  }
                />
              );
            })}
          </g>

          <g>
            {placed.map((p) => {
              const color = STATUS_COLOR[p.node.status];
              const dim = hovered !== null && hovered !== p.node.id;
              const isActive = p.node.status === "active";
              const showLabel = labels.has(p.node.id) || hovered === p.node.id;
              const labelX = p.labelDx;

              return (
                <g
                  key={p.node.id}
                  className="rg-node rg-appear"
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={dim ? 0.32 : 1}
                  onMouseEnter={() => setHovered(p.node.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "pointer" }}
                >
                  {isActive && (
                    <circle
                      className="rg-pulse"
                      r={p.r}
                      fill={color}
                      style={{ "--rg-r": `${p.r}px` } as React.CSSProperties}
                    />
                  )}
                  <circle
                    r={p.r}
                    fill={p.node.status === "pending" ? "var(--surface)" : color}
                    stroke={color}
                    strokeWidth={1.5}
                  />
                  <circle r={Math.max(p.r + 7, 12)} fill="transparent" />

                  {showLabel && (
                    <text
                      x={labelX}
                      y={p.cells.length > 0 ? -1 : 3.5}
                      fontSize={p.laneIndex === 0 ? 13 : 10.5}
                      fontWeight={p.node.kind === "segment" ? 400 : 600}
                      fill={
                        p.node.kind === "segment"
                          ? "var(--muted)"
                          : "var(--foreground)"
                      }
                      /* Halo in the panel colour, painted under the glyphs, so
                         an edge passing behind a label does not read as a
                         strikethrough. */
                      stroke="var(--surface)"
                      strokeWidth={4.5}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      style={{ pointerEvents: "none" }}
                    >
                      {trim(displayLabel(p.node), 26)}
                    </text>
                  )}

                  {/* Everything gathered under a source, as filling cells. */}
                  {p.cells.length > 0 && (
                    <g>
                      {p.cells.map((cell, i) => (
                        <rect
                          key={cell.id}
                          x={labelX + (i % CELLS_PER_ROW) * CELL_PITCH}
                          y={7 + Math.floor(i / CELLS_PER_ROW) * CELL_PITCH}
                          width={CELL}
                          height={CELL}
                          rx={1}
                          fill={
                            cell.status === "pending"
                              ? "var(--surface-2)"
                              : STATUS_COLOR[cell.status]
                          }
                          opacity={cell.status === "pending" ? 0.9 : 0.85}
                          onMouseEnter={() => setHovered(cell.id)}
                        />
                      ))}
                      <text
                        x={labelX}
                        y={
                          7 +
                          Math.ceil(p.cells.length / CELLS_PER_ROW) *
                            CELL_PITCH +
                          9
                        }
                        fontSize={9}
                        fill="var(--muted)"
                        style={{ pointerEvents: "none" }}
                      >
                        {p.cells.filter((c) => c.status === "ok").length}/
                        {p.cells.length} returned
                      </text>
                    </g>
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
            <p className="text-xs font-semibold">
              {displayLabel(hoveredNode)}
              <span className="ml-2 font-normal text-[var(--muted)]">
                {STATUS_WORD[hoveredNode.status]}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {hoveredNode.detail ??
                (hoveredNode.status === "active"
                  ? "In flight…"
                  : "Waiting to start")}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">
        {(
          [
            ["active", "working"],
            ["ok", "found data"],
            ["empty", "nothing there"],
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
        <span className="opacity-70">bigger dot = higher score</span>
        {note && (
          <span className="ml-auto truncate font-mono opacity-80">{note}</span>
        )}
      </div>
    </div>
  );
}
