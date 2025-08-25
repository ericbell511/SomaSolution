import React, { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Node,
  Edge,
  ReactFlowProvider,
  BackgroundVariant,
  useReactFlow, // Import useReactFlow
  ReactFlowInstance // Import ReactFlowInstance type
} from 'reactflow';

import 'reactflow/dist/style.css';

interface ReactFlowGraphProps {
  initialNodes: Node[];
  initialEdges: Edge[];
  onNodeClick?: (nodeId: string) => void;
  highlightedNodeId?: string | null;
}

const ReactFlowGraph: React.FC<ReactFlowGraphProps> = ({ initialNodes, initialEdges, onNodeClick, highlightedNodeId }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  // Removed: const { fitView } = useReactFlow();
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  // This effect updates styles for highlighting without changing positions
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        style: {
          ...node.style,
          border: node.id === highlightedNodeId ? '2px solid blue' : (node.style && node.style.border),
          boxShadow: node.id === highlightedNodeId ? '0 0 10px rgba(0, 0, 255, 0.5)' : (node.style && node.style.boxShadow),
        },
      }))
    );
    setEdges((eds) =>
      eds.map((edge) => {
        // Apply styles to edges based on highlighting and critical path
        const isEdgeCritical = edge.animated; // Assuming animated implies critical path
        const isSourceHighlighted = edge.source === highlightedNodeId;
        
        let strokeColor = isEdgeCritical ? 'red' : 'blue';
        if (isSourceHighlighted) {
          strokeColor = 'black'; // Dependent of
        }

        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: strokeColor,
            strokeWidth: isSourceHighlighted || isEdgeCritical ? 2 : 1,
          },
        };
      })
    );
  }, [highlightedNodeId, setNodes, setEdges]);

  // This effect updates initial nodes/edges if the props change (e.g., todos list changes)
  // It does NOT call fitView, only updates the nodes/edges state
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    onNodeClick?.(node.id);
  }, [onNodeClick]);

  const onReactFlowInit = useCallback((instance: ReactFlowInstance) => {
    setReactFlowInstance(instance);
    instance.fitView(); // Fit view only once on initialization
  }, []);

  return (
    <div style={{ width: '100%', height: '500px', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: 'white' }}> {/* Set background to white here */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onInit={onReactFlowInit}
      >
        <Controls />
        {/* <MiniMap width={100} height={100} /> Removed minimap */}
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} /> {/* Use BackgroundVariant.Dots */}
      </ReactFlow>
    </div>
  );
};

export default ReactFlowGraph;
