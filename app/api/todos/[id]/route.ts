import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client'; // Ensure Prisma is imported for types

interface Params {
  params: {
    id: string;
  };
}

// Define a type for todo items that includes their dependencies
type TodoWithDependencies = Prisma.TodoGetPayload<{ include: { dependsOn: true, dependentTasks: true } }>;

// Helper function to check for circular dependencies
async function checkCircularDependency(todoId: number, dependencyId: number, visited: Set<number>): Promise<boolean> {
  if (visited.has(dependencyId)) {
    return false; // Already visited this node in the current path, no new circularity here
  }
  visited.add(dependencyId);

  // If the dependency itself depends on the todoId, it's a circular dependency
  if (todoId === dependencyId) {
    return true;
  }

  const dependency: TodoWithDependencies | null = await prisma.todo.findUnique({
    where: { id: dependencyId },
    include: { dependsOn: true },
  });

  if (!dependency) {
    return false; // Dependency not found, cannot form a circular dependency
  }

  for (const dep of dependency.dependsOn) {
    if (await checkCircularDependency(todoId, dep.id, visited)) {
      return true;
    }
  }

  return false;
}

export async function PUT(request: Request, { params }: Params) {
  const todoId = parseInt(params.id);
  if (isNaN(todoId)) {
    return NextResponse.json({ error: 'Invalid Todo ID' }, { status: 400 });
  }

  try {
    const { dependsOnIds } = await request.json();

    if (dependsOnIds && dependsOnIds.length > 0) {
      for (const newDepId of dependsOnIds) {
        // Check for self-dependency
        if (todoId === newDepId) {
          return NextResponse.json({ error: 'A task cannot depend on itself' }, { status: 400 });
        }
        // Check for circular dependencies
        if (await checkCircularDependency(todoId, newDepId, new Set<number>())) {
          // Fetch titles for a more descriptive error message
          const todo = await prisma.todo.findUnique({ where: { id: todoId } });
          const newDep = await prisma.todo.findUnique({ where: { id: newDepId } });
          const todoTitle = todo?.title || `Task ${todoId}`;
          const newDepTitle = newDep?.title || `Task ${newDepId}`;
          return NextResponse.json({ error: `Circular dependency detected: '${newDepTitle}' already depends on '${todoTitle}'.` }, { status: 400 });
        }
      }
    }

    const updatedTodo = await prisma.todo.update({
      where: { id: todoId },
      data: {
        dependsOn: {
          set: dependsOnIds ? dependsOnIds.map((id: number) => ({ id })) : [], // Disconnect existing and connect new
        },
      },
      include: { // Include updated dependencies in the response
        dependsOn: true,
      },
    });

    return NextResponse.json(updatedTodo, { status: 200 });
  } catch (error) {
    console.error('Error updating todo dependencies:', error);
    return NextResponse.json({ error: 'Error updating todo dependencies' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const id = parseInt(params.id);
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await prisma.todo.delete({
      where: { id },
    });
    return NextResponse.json({ message: 'Todo deleted' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Error deleting todo' }, { status: 500 });
  }
}
