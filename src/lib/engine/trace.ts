/**
 * Reasoning trace.
 *
 * The engine's work is a graph: a country fans out to data sources, sources
 * resolve into signals, signals feed sectors, sectors fan out to segments, and
 * segments resolve into findings. That structure already exists implicitly in
 * the call tree — this module makes it observable so the UI can draw it as it
 * happens rather than showing a spinner and a finished list.
 *
 * Every node is announced before the work behind it starts, so the graph shows
 * pending work as well as completed work. A node that never leaves `active` is
 * itself information: it is where the engine is stuck.
 */

export type TraceNodeKind =
  | "country"
  | "source"
  | "signal"
  | "sector"
  | "segment"
  | "finding";

export type TraceStatus =
  /** Announced, not started. */
  | "pending"
  /** Work in flight. */
  | "active"
  /** Resolved with data. */
  | "ok"
  /** Resolved, but the source had nothing for us. */
  | "empty"
  /** Failed. The engine continues; the node stays red. */
  | "error";

export interface TraceNode {
  id: string;
  kind: TraceNodeKind;
  label: string;
  /** Drawn as an edge parent -> id. */
  parent?: string;
  status: TraceStatus;
  /** One line the UI shows on hover. */
  detail?: string;
  /** Drives node radius where it means something (score, USD). */
  weight?: number;
}

export type TraceEvent =
  | { t: "phase"; label: string }
  | { t: "node"; node: TraceNode }
  | {
      t: "status";
      id: string;
      status: TraceStatus;
      detail?: string;
      weight?: number;
    }
  | { t: "edge"; from: string; to: string }
  | { t: "note"; text: string }
  | { t: "result"; payload: unknown }
  | { t: "error"; message: string }
  | { t: "done" };

export interface Tracer {
  phase(label: string): void;
  node(node: Omit<TraceNode, "status"> & { status?: TraceStatus }): void;
  status(
    id: string,
    status: TraceStatus,
    extra?: { detail?: string; weight?: number },
  ): void;
  edge(from: string, to: string): void;
  note(text: string): void;
}

export function makeTracer(emit: (event: TraceEvent) => void): Tracer {
  return {
    phase: (label) => emit({ t: "phase", label }),
    node: (node) => emit({ t: "node", node: { status: "pending", ...node } }),
    status: (id, status, extra) =>
      emit({ t: "status", id, status, ...extra }),
    edge: (from, to) => emit({ t: "edge", from, to }),
    note: (text) => emit({ t: "note", text }),
  };
}

/**
 * Used by every call path that is not being watched, so instrumentation costs
 * nothing when nobody is looking at the graph.
 */
export const NULL_TRACER: Tracer = {
  phase: () => {},
  node: () => {},
  status: () => {},
  edge: () => {},
  note: () => {},
};
