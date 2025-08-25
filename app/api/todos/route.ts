import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client'; // Restore Prisma import

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
    include: { dependsOn: true, dependentTasks: true }, // Include dependentTasks here
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

export async function GET() {
  try {
    const todos: TodoWithDependencies[] = await prisma.todo.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: { // Include dependencies and dependent tasks
        dependsOn: true,
        dependentTasks: true, // Include dependent tasks
      },
    });
    return NextResponse.json(todos);
  } catch (error) {
    return NextResponse.json({ error: 'Error fetching todos' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { title, dueDate, dependsOnIds } = await request.json(); // Add dependsOnIds
    if (!title || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    if (dependsOnIds && dependsOnIds.length > 0) {
      // Defer circular dependency check for POST, as discussed.
    }

    let imageUrl: string | null = null;
    try {
      const pexelsApiKey = process.env.PEXELS_API_KEY;
      if (!pexelsApiKey) {
        console.warn('PEXELS_API_KEY is not set. Image generation will be skipped.');
      } else {
        const pexelsRes = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(title)}&per_page=1`, {
          headers: {
            Authorization: pexelsApiKey,
          },
        });
        const pexelsData = await pexelsRes.json();
        if (pexelsData.photos && pexelsData.photos.length > 0) {
          imageUrl = pexelsData.photos[0].src.medium;
        }
      }
    } catch (pexelsError) {
      console.error('Failed to fetch image from Pexels:', pexelsError);
    }

    const data: Prisma.TodoCreateInput = {
      title,
      dueDate: dueDate ? new Date(dueDate) : null,
      imageUrl,
      dependsOn: {
        connect: dependsOnIds ? dependsOnIds.map((id: number) => ({ id })) : [],
      }, // Connect dependencies
    };

    const todo = await prisma.todo.create({
      data: data,
    });
    return NextResponse.json(todo, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Error creating todo' }, { status: 500 });
  }
}