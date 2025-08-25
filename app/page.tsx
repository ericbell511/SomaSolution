"use client"
import { useState, useEffect } from 'react';
import { Prisma } from '@prisma/client'; // Ensure Prisma is imported
import dynamic from 'next/dynamic'; // Import dynamic
import { Edge, Node, Position, ReactFlowProvider } from 'reactflow'; // Import Edge, Node, Position, and ReactFlowProvider types from react-flow
import dagre from '@dagrejs/dagre'; // Import dagre

const ReactFlowGraph = dynamic(() => import('./components/ReactFlowGraph'), { ssr: false }); // Dynamically import with ssr: false

// Utility type to make properties non-nullable where expected after parsing
type RequiredAndParsed<T, K extends keyof T> = T & { [P in K]-?: NonNullable<T[P]> extends infer U ? (U extends Date | null ? Date : U) : NonNullable<T[P]> };

interface ClientTodo extends RequiredAndParsed<Prisma.TodoGetPayload<{ include: { dependsOn: true, dependentTasks: true } }>, 'id' | 'title' | 'createdAt'> {
  createdAt: Date; // Overridden to ensure Date object after parsing
  dueDate: Date | null; // Overridden to ensure Date object after parsing
  dependsOn: ClientTodo[]; // Self-referencing type
  dependentTasks: ClientTodo[]; // Add dependent tasks
}

// --- Graph Layout Function ---
const g = new dagre.graphlib.Graph();
g.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 170;
const nodeHeight = 80;

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  g.setGraph({
    rankdir: direction,
    ranksep: 50, // Vertical spacing between ranks
    nodesep: 50, // Horizontal spacing between nodes in the same rank
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  nodes.forEach((node) => {
    const nodeWithPosition = g.node(node.id);
    node.targetPosition = Position.Top;
    node.sourcePosition = Position.Bottom;

    // We are shifting the dagre node layout to the center of the screen
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };

    return node;
  });

  return { nodes, edges };
};

// --- Graph Helper Functions (Conceptual Outlines) ---

// Function to build an adjacency list representation of the dependency graph
const buildDependencyGraph = (todos: ClientTodo[]) => {
  const graph = new Map<number, number[]>(); // Map todoId to an array of todoIds it depends on
  const reverseGraph = new Map<number, number[]>(); // Map todoId to an array of todoIds that depend on it
  const nodes = new Set<number>();

  todos.forEach(todo => {
    if (todo.id !== undefined) {
      nodes.add(todo.id);
      if (!graph.has(todo.id)) graph.set(todo.id, []);
      if (!reverseGraph.has(todo.id)) reverseGraph.set(todo.id, []);
    }
  });

  todos.forEach(todo => {
    if (todo.id !== undefined && todo.dependsOn) {
      todo.dependsOn.forEach(dep => {
        if (dep.id !== undefined && nodes.has(dep.id)) {
          graph.get(todo.id)?.push(dep.id);
          reverseGraph.get(dep.id)?.push(todo.id);
        }
      });
    }
  });
  return { graph, reverseGraph, nodes: Array.from(nodes) };
};

// Function to perform topological sort (Kahn's algorithm for simplicity, also detects cycles)
const topologicalSort = (graph: Map<number, number[]>, nodes: number[]) => {
  const inDegree = new Map<number, number>(nodes.map(node => [node, 0]));
  const adj: Map<number, number[]> = new Map(nodes.map(node => [node, []]));

  // Build adjacency list for topological sort (dependencies point to dependents)
  nodes.forEach(u => {
    graph.get(u)?.forEach(v => {
      adj.get(v)?.push(u);
      inDegree.set(u, (inDegree.get(u) || 0) + 1);
    });
  });

  const queue: number[] = [];
  nodes.forEach(node => {
    if (inDegree.get(node) === 0) {
      queue.push(node);
    }
  });

  const sortedOrder: number[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    sortedOrder.push(u);

    adj.get(u)?.forEach(v => {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    });
  }

  // If sortedOrder.length !== nodes.length, there's a cycle
  return { sortedOrder, hasCycle: sortedOrder.length !== nodes.length };
};

// Function to calculate earliest possible start dates and critical path
const calculateTaskInsights = (todos: ClientTodo[]): { insights: Map<number, { earliestStart: Date; isCritical: boolean }>; hasCycle: boolean } => {
  const { graph, reverseGraph, nodes } = buildDependencyGraph(todos);
  const { sortedOrder, hasCycle } = topologicalSort(reverseGraph, nodes); // Topological sort on reverse graph for dependencies

  const insights = new Map<number, { earliestStart: Date; isCritical: boolean }>();

  if (hasCycle) {
    console.error("Circular dependency detected! Cannot calculate critical path.");
    todos.forEach(todo => insights.set(todo.id, { earliestStart: new Date(0), isCritical: false }));
    return { insights, hasCycle };
  }

  // Initialize earliest start dates
  todos.forEach(todo => insights.set(todo.id, { earliestStart: new Date(todo.createdAt), isCritical: false }));

  // Calculate earliest start dates based on dependencies
  for (const todoId of sortedOrder) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) continue;

    let maxPredecessorCompletion = new Date(todo.createdAt);

    // Find the latest completion time of all direct dependencies
    const dependencies = graph.get(todoId) || [];
    for (const depId of dependencies) {
      const depInsight = insights.get(depId);
      if (depInsight && depInsight.earliestStart) {
        const dep = todos.find(t => t.id === depId);
        if (dep && dep.dueDate) {
          maxPredecessorCompletion = new Date(Math.max(maxPredecessorCompletion.getTime(), dep.dueDate.getTime()));
        } else {
          maxPredecessorCompletion = new Date(Math.max(maxPredecessorCompletion.getTime(), depInsight.earliestStart.getTime()));
        }
      }
    }
    insights.get(todoId)!.earliestStart = new Date(Math.max(insights.get(todoId)!.earliestStart.getTime(), maxPredecessorCompletion.getTime()));
  }

  // Critical Path Calculation (simplified: longest path based on earliest start)
  let maxProjectCompletionTime = 0;
  let lastTaskOnCriticalPath: ClientTodo | null = null;

  sortedOrder.forEach(todoId => {
    const earliestCompletionTime = insights.get(todoId)!.earliestStart.getTime();
    if (earliestCompletionTime > maxProjectCompletionTime) {
      maxProjectCompletionTime = earliestCompletionTime;
      lastTaskOnCriticalPath = todos.find(t => t.id === todoId) || null;
    }
  });

  // Backtrack from the last task on the longest path to find all critical tasks
  if (lastTaskOnCriticalPath) {
    let current: number | undefined = (lastTaskOnCriticalPath.id as any); // Apply any cast here
    while (current !== undefined) {
      insights.get(current)!.isCritical = true;
      const currentTodo = todos.find(t => t.id === current);
      if (!currentTodo || !currentTodo.dependsOn || currentTodo.dependsOn.length === 0) break;

      let nextCriticalDepId: number | undefined;
      let maxDepCompletionTime = -1;

      for (const dep of currentTodo.dependsOn) {
        const depInsight = insights.get(dep.id)!;
        const depCompletionTime = dep.dueDate ? dep.dueDate.getTime() : depInsight.earliestStart.getTime();

        if (depCompletionTime >= maxDepCompletionTime) {
          maxDepCompletionTime = depCompletionTime;
          nextCriticalDepId = dep.id;
        }
      }
      current = nextCriticalDepId;
    }
  }

  return { insights, hasCycle: false };
};

// Function to transform todos and insights into React Flow nodes and edges
const getReactFlowElements = (todos: ClientTodo[], taskInsights: Map<number, { earliestStart: Date; isCritical: boolean }>, highlightedNodeId: string | null): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Using position based on index initially, you might want a more sophisticated layout later
  const nodeWidth = 150;
  const nodeHeight = 50;
  const xOffset = 200;
  const yOffset = 100;

  todos.forEach((todo, index) => {
    const isCritical = taskInsights.has(todo.id) && taskInsights.get(todo.id)!.isCritical;
    const earliestStart = taskInsights.has(todo.id) ? taskInsights.get(todo.id)!.earliestStart.toLocaleDateString() : 'N/A';

    // Highlight node border/shadow if it's the highlighted node
    const isNodeHighlighted = (todo.id as any).toString() === highlightedNodeId; // Use current todo's ID for highlighting

    nodes.push({
      id: (todo.id as any).toString(), // Explicitly cast to any to resolve 'never' type issue
      position: { x: (index % 3) * xOffset, y: Math.floor(index / 3) * yOffset }, // Simple grid layout
      data: {
        label: (
          <div className={`p-2 border rounded ${isCritical ? 'bg-red-200 border-red-500' : 'bg-blue-100 border-blue-400'}`}>
            <strong>{todo.title}</strong><br />
            Due: {todo.dueDate ? todo.dueDate.toLocaleDateString() : 'N/A'}<br />
            Start: {earliestStart}
            {isCritical && <span className="ml-1 font-bold text-red-700"> (Critical)</span>}
          </div>
        ),
      },
      style: {
        border: isNodeHighlighted ? '2px solid blue' : (isCritical ? '2px solid red' : '1px solid blue'),
        boxShadow: isNodeHighlighted ? '0 0 10px rgba(0, 0, 255, 0.5)' : undefined, // Add shadow for highlighted
      },
    });

    // Create edges for dependencies
    if (todo.dependsOn && todo.dependsOn.length > 0) {
      (todo.dependsOn as any[]).forEach((dep) => { // Cast to any[] here due to persistent 'never' error
        const sourceId = (dep as any).id.toString();
        const targetId = (todo.id as any).toString();

        let strokeColor = isCritical ? 'red' : 'blue'; // Default for 'depends on' is blue (non-critical)

        // If the source node (dependency) is highlighted, its outgoing edge is a "dependent of" relation (black)
        if (highlightedNodeId === sourceId) {
          strokeColor = 'black';
        }
        // If the target node (current todo) is highlighted, its incoming edge is a "depends on" relation (blue)
        // This is already the default non-critical color, so no explicit change here unless critical (red).
        // Critical path (red) takes precedence over blue/black if applicable.

        edges.push({
          id: `e${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          animated: isCritical,
          style: { stroke: strokeColor, strokeWidth: isNodeHighlighted || isCritical ? 2 : 1 }, // Thicker stroke for highlighted/critical
        });
      });
    }
  });

  return { nodes, edges };
};

export default function Home() {
  const [newTodo, setNewTodo] = useState('');
  const [newDueDate, setNewDueDate] = useState(''); // Add state for new due date
  const [todos, setTodos] = useState<ClientTodo[]>([]); // Use ClientTodo type
  const [selectedDependencies, setSelectedDependencies] = useState<number[]>([]); // New state for selected dependencies
  const [taskInsights, setTaskInsights] = useState<Map<number, { earliestStart: Date; isCritical: boolean }>>(new Map());
  const [showDependencyModal, setShowDependencyModal] = useState(false); // New state for modal visibility
  const [currentTodoForDependencyUpdate, setCurrentTodoForDependencyUpdate] = useState<ClientTodo | null>(null); // New state for todo being updated
  const [selectedDependenciesForUpdate, setSelectedDependenciesForUpdate] = useState<number[]>([]); // New state for selected dependencies in modal
  const [nodes, setNodes] = useState<Node[]>([]); // New state for React Flow nodes
  const [edges, setEdges] = useState<Edge[]>([]); // New state for React Flow edges
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null); // New state for highlighted node
  const [mounted, setMounted] = useState(false); // New state to track if component is mounted on client

  useEffect(() => {
    setMounted(true); // Set mounted to true after first client-side render
    fetchTodos();
  }, []);

  // Function to open the dependency modal
  const openDependencyModal = (todo: ClientTodo) => {
    setCurrentTodoForDependencyUpdate(todo);
    setSelectedDependenciesForUpdate(todo.dependsOn.map(dep => dep.id)); // Pre-select existing dependencies
    setShowDependencyModal(true);
  };

  // Function to close the dependency modal
  const closeDependencyModal = () => {
    setShowDependencyModal(false);
    setCurrentTodoForDependencyUpdate(null);
    setSelectedDependenciesForUpdate([]);
  };

  // Function to handle updating dependencies for a todo
  const handleUpdateDependencies = async () => {
    if (!currentTodoForDependencyUpdate) return;

    try {
      const res = await fetch(`/api/todos/${currentTodoForDependencyUpdate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOnIds: selectedDependenciesForUpdate }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update dependencies');
      }

      closeDependencyModal();
      fetchTodos(); // Refresh todos after update
    } catch (error: any) {
      console.error('Error updating dependencies:', error.message);
      alert(`Error: ${error.message}`); // Display error to user
    }
  };

  // Recalculate insights and React Flow elements whenever todos change
  useEffect(() => {
    if (todos.length > 0) {
      const { insights, hasCycle } = calculateTaskInsights(todos);
      setTaskInsights(insights);
      if (hasCycle) {
        console.warn('Graph has a cycle, critical path calculations may be inaccurate.');
      }
      // Get React Flow elements and apply layout
      let { nodes: newNodes, edges: newEdges } = getReactFlowElements(todos, insights, highlightedNodeId); // Pass highlightedNodeId
      ({ nodes: newNodes, edges: newEdges } = getLayoutedElements(newNodes, newEdges)); // Apply layout
      setNodes(newNodes);
      setEdges(newEdges);
    } else {
      setTaskInsights(new Map());
      setNodes([]); // Clear nodes
      setEdges([]); // Clear edges
    }
  }, [todos, highlightedNodeId]); // Add highlightedNodeId to dependency array

  const fetchTodos = async () => {
    try {
      const res = await fetch('/api/todos');
      const data = await res.json();

      // Parse dueDate strings into Date objects
      const parsedTodos: ClientTodo[] = data.map((todo: any) => ({
        ...todo,
        createdAt: new Date(todo.createdAt), // Ensure createdAt is also a Date object
        dueDate: todo.dueDate ? new Date(todo.dueDate) : null,
        // Recursively parse dependsOn items if they also contain date strings
        dependsOn: todo.dependsOn ? todo.dependsOn.map((dep: any) => ({
          ...dep,
          createdAt: new Date(dep.createdAt),
          dueDate: dep.dueDate ? new Date(dep.dueDate) : null
        })) : [],
        // Ensure other relations are also parsed if they contain dates
        dependentTasks: todo.dependentTasks ? todo.dependentTasks.map((dep: any) => ({
          ...dep,
          createdAt: new Date(dep.createdAt),
          dueDate: dep.dueDate ? new Date(dep.dueDate) : null
        })) : []
      }));

      setTodos(parsedTodos);
    } catch (error) {
      console.error('Failed to fetch todos:', error);
    } finally {
      setNewDueDate('');
      setSelectedDependencies([]); // Clear selected dependencies on fetch/refresh
    }
  };

  const handleAddTodo = async () => {
    if (!newTodo.trim()) {
      alert('Todo title cannot be empty.');
      return;
    }

    // Client-side circular dependency check for new todos
    if (selectedDependencies.length > 0) {
      // Temporarily create a mock todo to check for cycles with existing todos
      const mockNewTodo: ClientTodo = {
        id: -1, // Use a temporary, non-existent ID for the new todo
        title: newTodo,
        createdAt: new Date(),
        dueDate: newDueDate ? new Date(newDueDate) : null,
        imageUrl: null,
        dependsOn: todos.filter(t => selectedDependencies.includes(t.id)), // Filter actual ClientTodo objects
        dependentTasks: [], // Initialize dependentTasks for mock todo
      };
      const combinedTodos = [...todos, mockNewTodo];
      const { insights, hasCycle } = calculateTaskInsights(combinedTodos);

      if (hasCycle) { // Assuming calculateTaskInsights returns hasCycle property now
        alert('Cannot add task: Creating this dependency would lead to a circular dependency.');
        return;
      }
    }

    try {
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTodo,
          dueDate: newDueDate,
          dependsOnIds: selectedDependencies,
        }),
      });
      setNewTodo('');
      setNewDueDate('');
      setSelectedDependencies([]);
      fetchTodos();
    } catch (error: any) {
      console.error('Failed to add todo:', error.message);
      alert(`Error adding todo: ${error.message}`);
    }
  };

  const handleDeleteTodo = async (id:any) => {
    try {
      await fetch(`/api/todos/${id}`, {
        method: 'DELETE',
      });
      fetchTodos();
    } catch (error) {
      console.error('Failed to delete todo:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-500 to-red-500 flex flex-col items-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-center text-white mb-8">Things To Do App</h1>
        <div className="flex mb-6">
          <input
            type="text"
            className="flex-grow p-3 rounded-l-full focus:outline-none text-gray-700"
            placeholder="Add a new todo"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
          />
          <input
            type="date"
            className="p-3 focus:outline-none text-gray-700"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
          />
          <button
            onClick={handleAddTodo}
            className="bg-white text-indigo-600 p-3 rounded-r-full hover:bg-gray-100 transition duration-300"
          >
            Add
          </button>
        </div>
        <div className="mb-4 w-full border rounded-md p-3 bg-white bg-opacity-90">
          <h3 className="text-gray-800 text-lg font-semibold mb-2">Dependencies:</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {todos.filter(t => t.id !== undefined).map((todo) => (
              <label key={todo.id} className="flex items-center space-x-2 text-gray-700">
                <input
                  type="checkbox"
                  value={todo.id}
                  checked={selectedDependencies.includes(todo.id)}
                  onChange={(e) => {
                    const todoId = parseInt(e.target.value);
                    if (e.target.checked) {
                      setSelectedDependencies((prev) => [...prev, todoId]);
                    } else {
                      setSelectedDependencies((prev) => prev.filter((id) => id !== todoId));
                    }
                  }}
                  className="form-checkbox h-5 w-5 text-indigo-600"
                />
                <span>{todo.title}</span>
              </label>
            ))}
          </div>
        </div>
        <ul>
          {todos.map((todo:ClientTodo) => {
            const isOverdue = todo.dueDate && new Date(todo.dueDate) < new Date();
            return (
              <li
                key={todo.id}
                className="flex flex-col bg-white bg-opacity-90 p-4 mb-4 rounded-lg shadow-lg"
              >
                <div className="flex justify-between items-start w-full mb-2">
                  <span className="text-gray-800 text-lg font-semibold flex-grow mr-4">{todo.title}</span>
                  <button
                    onClick={() => openDependencyModal(todo)}
                    className="text-blue-500 hover:text-blue-700 transition duration-300 flex-shrink-0 mr-2" // Plus button moved, added mr-2
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteTodo(todo.id)}
                    className="text-red-500 hover:text-red-700 transition duration-300 flex-shrink-0"
                  >
                    {/* Delete Icon */}
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="flex items-start w-full">
                  <div className="flex-grow pr-4">
                    {todo.dueDate && (
                      <div className={`text-sm ${isOverdue ? 'text-red-500' : 'text-gray-600'} mb-1`}>
                        Due: {new Date(todo.dueDate).toLocaleDateString()}
                      </div>
                    )}

                    {taskInsights.has(todo.id) && (
                      <div className="text-sm">
                        <div className="text-blue-500 mb-1">
                          Earliest Start: {taskInsights.get(todo.id)!.earliestStart.toLocaleDateString()}
                        </div>
                        {taskInsights.get(todo.id)!.isCritical && (
                          <div className="text-orange-700 font-bold">Critical Path!</div>
                        )}
                      </div>
                    )}

                    {todo.dependsOn && todo.dependsOn.length > 0 && (
                      <div className="text-sm text-gray-500 mt-2">
                        <strong>Needs to be done After:</strong> {todo.dependsOn.map((dep) => dep.title).join(', ')}
                      </div>
                    )}

                    {todo.dependentTasks && todo.dependentTasks.length > 0 && (
                      <div className="text-sm text-gray-500 mt-2">
                        <strong>Needs to be done Before:</strong> {todo.dependentTasks.map((dep) => dep.title).join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Right side for image, between text and delete button but below text */}
                  {todo.imageUrl ? (
                    <img src={todo.imageUrl} alt={todo.title} className="w-24 h-24 object-cover rounded flex-shrink-0" />
                  ) : (todo.imageUrl === null && todo.title) ? (
                    <span className="text-gray-500 flex-shrink-0">Loading image...</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Dependency Graph Visualization */}
      <div className="w-full max-w-md md:w-1/2 md:ml-4">
        <h2 className="text-3xl font-bold text-center text-white mb-8">Dependency Graph</h2>
        {mounted ? (
          <ReactFlowProvider>
            <ReactFlowGraph
              initialNodes={nodes}
              initialEdges={edges}
              onNodeClick={(nodeId) => setHighlightedNodeId(nodeId)}
              highlightedNodeId={highlightedNodeId}
            />
          </ReactFlowProvider>
        ) : (
          <div className="text-gray-500 text-center">Loading graph...</div>
        )}
      </div>

      {/* Dependency Update Modal */}
      {showDependencyModal && currentTodoForDependencyUpdate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Update Dependencies for "{currentTodoForDependencyUpdate.title}"</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 max-h-60 overflow-y-auto border p-2 rounded">
              {todos.filter(t => t.id !== currentTodoForDependencyUpdate.id).map((todo) => (
                <label key={todo.id} className="flex items-center space-x-2 text-gray-700">
                  <input
                    type="checkbox"
                    value={todo.id}
                    checked={selectedDependenciesForUpdate.includes(todo.id)}
                    onChange={(e) => {
                      const todoId = parseInt(e.target.value);
                      if (e.target.checked) {
                        setSelectedDependenciesForUpdate((prev) => [...prev, todoId]);
                      } else {
                        setSelectedDependenciesForUpdate((prev) => prev.filter((id) => id !== todoId));
                      }
                    }}
                    className="form-checkbox h-5 w-5 text-indigo-600"
                  />
                  <span>{todo.title}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end space-x-4">
              <button
                onClick={closeDependencyModal}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateDependencies}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition duration-300"
              >
                Save Dependencies
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
