import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client'; // Import Prisma as a type namespace

export async function GET() {
  try {
    const todos = await prisma.todo.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
    return NextResponse.json(todos);
  } catch (error) {
    return NextResponse.json({ error: 'Error fetching todos' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { title, dueDate } = await request.json();
    if (!title || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
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

    const todoData: Prisma.TodoCreateInput = {
      title,
      dueDate: dueDate ? new Date(dueDate) : null,
      imageUrl, // Add imageUrl here
    };
    const todo = await prisma.todo.create({
      data: todoData,
    });
    return NextResponse.json(todo, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Error creating todo' }, { status: 500 });
  }
}