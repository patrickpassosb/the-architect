"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  BackgroundVariant,
  MarkerType,
  Position,
} from "@xyflow/react";
import dagre from "dagre";
import type {
  BlueprintJson,
  SavedNodePosition,
} from "@the-architect/shared-types";
import { Save, RotateCcw } from "lucide-react";

import "@xyflow/react/dist/style.css";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ArchitectureCanvasProps = {
  blueprint: BlueprintJson | null;
  savedPositions: SavedNodePosition[];
  onSaveLayout: (positions: SavedNodePosition[]) => Promise<void>;
  saving: boolean;
};

type NodeTypeStyle = {
  bg: string;
  border: string;
  accent: string;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

const TYPE_STYLES: Record<string, NodeTypeStyle> = {
  client:   { bg: "rgba(99,240,210,0.12)",  border: "rgba(99,240,210,0.45)",  accent: "#63f0d2" },
  service:  { bg: "rgba(98,183,255,0.12)",   border: "rgba(98,183,255,0.45)",  accent: "#62b7ff" },
  database: { bg: "rgba(127,125,255,0.12)",  border: "rgba(127,125,255,0.45)", accent: "#7f7dff" },
  queue:    { bg: "rgba(255,68,56,0.12)",    border: "rgba(255,68,56,0.4)",    accent: "#ff4438" },
  external: { bg: "rgba(246,130,121,0.12)",  border: "rgba(246,130,121,0.4)",  accent: "#f68279" },
  default:  { bg: "rgba(255,255,255,0.06)",  border: "rgba(255,255,255,0.15)", accent: "#93a6c4" },
};

/* ------------------------------------------------------------------ */
/* Dagre layout helper                                                 */
/* ------------------------------------------------------------------ */

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 120, ranksep: 160 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      sourcePosition: direction === "TB" ? Position.Bottom : Position.Right,
      targetPosition: direction === "TB" ? Position.Top : Position.Left,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Helpers: convert blueprint data → React Flow nodes/edges            */
/* ------------------------------------------------------------------ */

function blueprintToNodes(blueprint: BlueprintJson, saved: SavedNodePosition[]): Node[] {
  const posMap = new Map(saved.map((p) => [p.id, { x: p.x, y: p.y }]));

  return blueprint.nodes.map((n) => {
    const style = TYPE_STYLES[n.type ?? "default"] ?? TYPE_STYLES.default;
    const savedPos = posMap.get(n.id);

    return {
      id: n.id,
      type: "default",
      position: savedPos ?? { x: 0, y: 0 },
      data: {
        label: (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px" }}>
            {n.icon && (
              <img
                src={n.icon}
                alt=""
                width={22}
                height={22}
                style={{ borderRadius: 4, flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.2, color: style.accent }}>{n.label}</div>
              {n.description && (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.25, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                  {n.description}
                </div>
              )}
            </div>
          </div>
        ),
      },
      style: {
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 12,
        color: "#e6efff",
        width: NODE_WIDTH,
        padding: "6px 10px",
        backdropFilter: "blur(8px)",
      },
    };
  });
}

function blueprintToEdges(blueprint: BlueprintJson): Edge[] {
  return blueprint.edges.map((e, idx) => ({
    id: `edge-${idx}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    type: "smoothstep",
    animated: true,
    style: { stroke: "rgba(98,183,255,0.5)", strokeWidth: 1.5 },
    labelStyle: { fill: "#ffffff", fontSize: 11, fontWeight: 500 },
    labelBgStyle: { fill: "rgba(20,23,31,0.85)", fillOpacity: 1 },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(98,183,255,0.6)" },
  }));
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function ArchitectureCanvas({
  blueprint,
  savedPositions,
  onSaveLayout,
  saving,
}: ArchitectureCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hasUnsaved, setHasUnsaved] = useState(false);

  // Convert blueprint to React Flow format
  useEffect(() => {
    if (!blueprint) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const hasSaved = savedPositions.length > 0;
    let rfNodes = blueprintToNodes(blueprint, savedPositions);
    const rfEdges = blueprintToEdges(blueprint);

    // If no saved positions, use dagre for auto-layout
    if (!hasSaved) {
      rfNodes = applyDagreLayout(rfNodes, rfEdges, "TB");
    }

    setNodes(rfNodes);
    setEdges(rfEdges);
    setHasUnsaved(false);
  }, [blueprint, savedPositions, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      // Mark unsaved if a node was dragged
      const hasDrag = changes.some(
        (c) => c.type === "position" && c.dragging
      );
      if (hasDrag) {
        setHasUnsaved(true);
      }
    },
    [onNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
    },
    [onEdgesChange]
  );

  const handleSave = useCallback(async () => {
    const positions: SavedNodePosition[] = nodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
    }));
    await onSaveLayout(positions);
    setHasUnsaved(false);
  }, [nodes, onSaveLayout]);

  const handleReLayout = useCallback(() => {
    if (!blueprint) return;
    const rfEdges = blueprintToEdges(blueprint);
    let rfNodes = blueprintToNodes(blueprint, []);
    rfNodes = applyDagreLayout(rfNodes, rfEdges, "TB");
    setNodes(rfNodes);
    setEdges(rfEdges);
    setHasUnsaved(true);
  }, [blueprint, setNodes, setEdges]);

  if (!blueprint || blueprint.nodes.length === 0) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "rgba(255,255,255,0.4)",
        fontSize: 14,
      }}>
        No blueprint data. Click &quot;Generate Blueprint&quot; after chatting.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
      <style>{`
        .react-flow__controls {
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: #1a1d24 !important;
          border: 2px solid #62b7ff !important;
          border-radius: 10px !important;
          padding: 4px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.8) !important;
        }
        .react-flow__controls-button {
          background: #2a2f3a !important;
          border: 1px solid #3f444e !important;
          border-radius: 6px !important;
          color: #ffffff !important;
          fill: #ffffff !important;
          width: 36px !important;
          height: 36px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s ease;
        }
        .react-flow__controls-button:hover {
          background: #62b7ff !important;
          border-color: #ffffff !important;
        }
        .react-flow__controls-button svg {
          fill: #ffffff !important;
          width: 18px !important;
          height: 18px !important;
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "rgba(7,11,20,0.95)" }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.05)" />
        <Controls
          showInteractive={false}
        />
        <Panel position="top-right">
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleReLayout}
              title="Re-layout with dagre"
              style={{
                background: "rgba(20,23,31,0.9)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                color: "#93a6c4",
                padding: "6px 10px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
              }}
            >
              <RotateCcw size={13} /> Auto-Layout
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !hasUnsaved}
              title="Save node positions"
              style={{
                background: hasUnsaved ? "linear-gradient(140deg, #62b7ff 0%, #63f0d2 100%)" : "rgba(20,23,31,0.9)",
                border: hasUnsaved ? "1px solid rgba(130,232,255,0.75)" : "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                color: hasUnsaved ? "#041726" : "#93a6c4",
                padding: "6px 10px",
                cursor: saving || !hasUnsaved ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                fontWeight: hasUnsaved ? 700 : 400,
                opacity: saving || !hasUnsaved ? 0.5 : 1,
              }}
            >
              <Save size={13} /> {saving ? "Saving..." : "Save Layout"}
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
