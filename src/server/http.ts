import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { HttpError } from './runs';

/** Who is acting. The demo has no login; the UI sends the chosen name and role. */
export function actor(req: Request): string {
  const name = decodeURIComponent(req.headers.get('x-user-name') ?? '').trim();
  const role = decodeURIComponent(req.headers.get('x-user-role') ?? '').trim();
  if (!name) return 'anonymous';
  return role ? `${name} (${role})` : name;
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return NextResponse.json({ error: 'A record with the same key already exists.' }, { status: 409 });
      }
      console.error(e);
      return NextResponse.json({ error: (e as Error).message ?? 'Unexpected error' }, { status: 500 });
    }
  };
}

export async function readCsvFromRequest(req: Request): Promise<{ text: string; name: string }> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = (form.get('file') ?? form.get('batch') ?? form.get('csv')) as File | null;
    if (!file || typeof file === 'string') throw new HttpError(400, 'Attach the PR batch CSV as form field "file".');
    return { text: await file.text(), name: file.name };
  }
  if (type.includes('application/json')) {
    const body = (await req.json()) as { csv?: string; name?: string };
    if (!body.csv) throw new HttpError(400, 'JSON body must contain "csv".');
    return { text: body.csv, name: body.name ?? 'api-batch.csv' };
  }
  const text = await req.text();
  if (!text.trim()) throw new HttpError(400, 'Send the PR batch CSV as the request body, as multipart field "file", or as JSON {"csv": "..."}');
  return { text, name: req.headers.get('x-file-name') ?? 'api-batch.csv' };
}
