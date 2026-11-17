import { NextResponse } from 'next/server';
import { handle } from '@/server/http';
import { getChat, handleChat } from '@/server/chat';
import { HttpError } from '@/server/runs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { sessionId?: string; message: string; department?: string };
  if (!body.message?.trim()) throw new HttpError(400, 'Message is empty.');
  const name = decodeURIComponent(req.headers.get('x-user-name') ?? '').trim() || 'Requester';
  return NextResponse.json(await handleChat({ sessionId: body.sessionId, message: body.message, user: name, department: body.department }));
});

export const GET = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get('sessionId');
  if (!id) throw new HttpError(400, 'sessionId required');
  const chat = await getChat(id);
  if (!chat) throw new HttpError(404, 'Chat not found');
  return NextResponse.json(chat);
});
