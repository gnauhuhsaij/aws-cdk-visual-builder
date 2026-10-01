import {
  Background,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from "@xyflow/react";
import { BookOpen, Expand, LocateFixed, Lock, Minus, Plus, Unlock } from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { InfraNode } from "./InfraNode";
import { awsResources, resourceByType } from "../data/awsResources";
import type { InfraEdge, InfraNode as InfraNodeType } from "../types";
import { allowsPracticeConnection, expectedResource, practiceNodeIds, type WalkthroughStepId } from '../walkthrough/defaultProject';

const nodeTypes = { infraNode: InfraNode };

type CanvasProps = {
  nodes: InfraNodeType[];
  edges: InfraEdge[];
  selectedNodeId?: string;
  selectedEdgeId?: string;
  onNodesChange: OnNodesChange<InfraNodeType>;
  onEdgesChange: OnEdgesChange<InfraEdge>;
  onConnect: OnConnect;
  onAddResource: (type: string, position: XYPosition) => void;
  onDropResource: (type: string, event: DragEvent<HTMLDivElement>) => void;
  onSelectionChange: (selection: {
    nodes: InfraNodeType[];
    edges: InfraEdge[];
  }) => void;
  onFocusChange: (selection: {
    nodes: InfraNodeType[];
    edges: InfraEdge[];
  }) => void;
  isEmpty: boolean;
  onOpenGuide: () => void;
  walkthroughStep?: WalkthroughStepId;
};

export function Canvas({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onAddResource,
  onDropResource,
  onSelectionChange,
  onFocusChange,
  isEmpty,
  onOpenGuide,
  walkthroughStep,
}: CanvasProps) {
  const { fitView, screenToFlowPosition, setCenter, zoomIn, zoomOut } =
    useReactFlow<InfraNodeType, InfraEdge>();
  const shellRef = useRef<HTMLElement>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);

  useEffect(() => {
    if (!walkthroughStep || walkthroughStep === 'welcome') {
      setIsPaletteOpen(false);
      setIsLocked(false);
    }
  }, [walkthroughStep]);

  useEffect(() => {
    if (!walkthroughStep || nodes.length === 0) return;
    const timer = window.setTimeout(() => void fitView({ padding: 0.25, maxZoom: 1, duration: 220 }), 100);
    return () => clearTimeout(timer);
  }, [walkthroughStep, nodes.length, fitView]);

  useEffect(() => {
    if (!isPaletteOpen || !walkthroughStep) return;
    shellRef.current?.querySelector(`[data-resource="${expectedResource(walkthroughStep)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [isPaletteOpen, walkthroughStep]);

  useEffect(() => {
    if (selectedNode) {
      setCenter(selectedNode.position.x + 99, selectedNode.position.y + 32, {
        duration: 420,
        zoom: 1,
      });
      return;
    }

    if (selectedEdge) {
      const source = nodes.find((node) => node.id === selectedEdge.source);
      const target = nodes.find((node) => node.id === selectedEdge.target);

      if (source && target) {
        setCenter(
          (source.position.x + target.position.x) / 2 + 99,
          (source.position.y + target.position.y) / 2 + 32,
          {
            duration: 420,
            zoom: 1,
          },
        );
      }
    }
  }, [
    nodes,
    selectedEdge,
    selectedEdgeId,
    selectedNode,
    selectedNodeId,
    setCenter,
  ]);

  useEffect(() => {
    const onFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (!shellRef.current) return;
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement === shellRef.current)
        await document.exitFullscreen();
      return;
    }
    setIsFullscreen(true);
    await shellRef.current.requestFullscreen().catch(() => {
      // Keep the CSS fullscreen fallback active if the browser blocks the Fullscreen API.
    });
  }

  function addResourceFromPalette(type: string) {
    const bounds = shellRef.current?.getBoundingClientRect();
    const position = screenToFlowPosition({
      x: (bounds?.left || 0) + (bounds?.width || window.innerWidth) / 2,
      y: (bounds?.top || 0) + (bounds?.height || window.innerHeight) / 2,
    });
    onAddResource(type, position);
    setIsPaletteOpen(false);
  }

  return (
    <main
      className={`canvas-shell ${isFullscreen ? "canvas-shell-fullscreen" : ""}`}
      ref={shellRef}
    >
      <ReactFlow
        nodes={walkthroughStep ? nodes.map((node) => ({
          ...node,
          draggable: walkthroughStep === 'move-bucket' && node.id === practiceNodeIds.s3,
          selectable: walkthroughStep === 'select-lambda' && node.id === practiceNodeIds.lambda,
          connectable: walkthroughStep === 'connect-api' || walkthroughStep === 'connect-bucket',
        })) : nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={
          onNodesChange as (changes: NodeChange<InfraNodeType>[]) => void
        }
        onEdgesChange={
          onEdgesChange as (changes: EdgeChange<InfraEdge>[]) => void
        }
        onConnect={(connection: Connection) => onConnect(connection)}
        isValidConnection={walkthroughStep ? (connection) => allowsPracticeConnection(walkthroughStep, connection.source, connection.target) : undefined}
        connectionMode={ConnectionMode.Loose}
        onSelectionChange={onSelectionChange}
        onNodeClick={walkthroughStep ? (_, node) => onSelectionChange({ nodes: [node], edges: [] }) : undefined}
        onEdgeClick={walkthroughStep ? (_, edge) => onSelectionChange({ nodes: [], edges: [edge] }) : undefined}
        onNodeDoubleClick={(_, node) => { if (!walkthroughStep) onFocusChange({ nodes: [node], edges: [] }); }}
        onEdgeDoubleClick={(_, edge) => { if (!walkthroughStep) onFocusChange({ nodes: [], edges: [edge] }); }}
        onPaneClick={() => {
          onSelectionChange({ nodes: [], edges: [] });
          onFocusChange({ nodes: [], edges: [] });
        }}
        onDrop={(event) => {
          const type = event.dataTransfer.getData(
            "application/infracanvas-resource",
          );
          if (type) onDropResource(type, event);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        fitView
        nodesDraggable={!isLocked}
        nodesConnectable={!isLocked}
        elementsSelectable={!isLocked}
        panOnDrag={!isLocked && !walkthroughStep}
        zoomOnDoubleClick={!isLocked && !walkthroughStep}
        zoomOnPinch={!isLocked && !walkthroughStep}
        zoomOnScroll={!isLocked && !walkthroughStep}
        deleteKeyCode={walkthroughStep ? null : ["Backspace", "Delete"]}
        connectionLineStyle={{ stroke: "#f5f5f5", strokeWidth: 3 }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "#f5f5f5", strokeWidth: 3 },
          markerEnd: { type: "arrowclosed", color: "#f5f5f5" },
        }}
      >
        <Background color="#2b2b2b" gap={22} />
        <Panel position="top-left" className="canvas-add-panel">
          <button
            type="button"
            className="canvas-add-button"
            data-tour="add-component"
            aria-label="Add component"
            title="Add component"
            onClick={() => setIsPaletteOpen((current) => !current)}
          >
            <Plus size={19} />
          </button>
          {isPaletteOpen && (
            <div className="canvas-palette">
              <div className="canvas-palette-header">
                <strong>Add component</strong>
                <span>Select one to place it on the board</span>
              </div>
              <div className="canvas-palette-list">
                {awsResources.map((resource) => {
                  const Icon = resource.Icon;
                  return (
                    <button
                      type="button"
                      key={resource.type}
                      className="canvas-palette-item"
                      data-resource={resource.type}
                      disabled={Boolean(walkthroughStep && expectedResource(walkthroughStep) !== resource.type)}
                      onClick={() => addResourceFromPalette(resource.type)}
                    >
                      <span
                        className="resource-icon"
                        style={{ color: resource.color }}
                      >
                        <Icon size={18} />
                      </span>
                      <span>
                        <strong>{resource.label}</strong>
                        <small>{resource.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>
        <MiniMap
          className="canvas-minimap"
          position="bottom-right"
          pannable
          zoomable
          nodeBorderRadius={6}
          nodeColor={(node) => {
            const data = node.data as InfraNodeType["data"];
            return resourceByType[data.resourceType].color;
          }}
          nodeStrokeColor="#0a0a0a"
          maskColor="rgb(0 0 0 / 62%)"
          nodeStrokeWidth={2}
        />
        <Panel
          position="bottom-left"
          className="canvas-controls"
          aria-label="Canvas controls"
        >
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoomIn({ duration: 180 })}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoomOut({ duration: 180 })}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label="Fit workflow"
            title="Fit workflow"
            onClick={() => fitView({ duration: 260, padding: 0.2 })}
          >
            <LocateFixed size={16} />
          </button>
          <span className="canvas-controls-divider" />
          <button
            type="button"
            aria-label={isLocked ? "Unlock canvas" : "Lock canvas"}
            title={isLocked ? "Unlock canvas" : "Lock canvas"}
            className={isLocked ? "active" : ""}
            onClick={() => setIsLocked((value) => !value)}
          >
            {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
          </button>
          <button
            type="button"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className={isFullscreen ? "active" : ""}
            onClick={toggleFullscreen}
          >
            <Expand size={16} />
          </button>
        </Panel>
      </ReactFlow>
      {isEmpty && !walkthroughStep && (
        <div className="canvas-empty-state">
          <BookOpen size={23} aria-hidden="true" />
          <h2>Start with an AWS flow</h2>
          <p>Build your first CDK graph step by step, or use + to add a component.</p>
          <button type="button" onClick={onOpenGuide}>Open quick guide</button>
        </div>
      )}
    </main>
  );
}
