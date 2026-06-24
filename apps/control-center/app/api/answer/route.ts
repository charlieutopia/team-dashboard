import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// LOCAL MVP: append the answer to data/answers.json so the grill loop works
// end-to-end in dev. PROD TODO (separate slice): write answers back to the
// utopia-docs wiki as structured pages via a SERVER-ONLY GitHub token — not
// built here, and no token lives in this app.
const ANSWERS = path.join(process.cwd(), 'data', 'answers.json');

export async function POST(req: Request) {
  let body: { id?: string; question?: string; answer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.answer || !body.answer.trim()) {
    return NextResponse.json({ error: 'empty answer' }, { status: 400 });
  }

  const entry = {
    id: body.id ?? null,
    question: body.question ?? null,
    answer: body.answer.trim(),
    answered_at: new Date().toISOString(),
  };

  try {
    let list: unknown[] = [];
    try {
      list = JSON.parse(await fs.readFile(ANSWERS, 'utf8')) as unknown[];
    } catch {
      list = [];
    }
    list.push(entry);
    await fs.writeFile(ANSWERS, JSON.stringify(list, null, 2) + '\n');
    return NextResponse.json({ ok: true, persisted: true });
  } catch {
    // Vercel's runtime FS is read-only — the prod writeback slice handles
    // persistence. Don't fail the request; the answer was received.
    return NextResponse.json({ ok: true, persisted: false });
  }
}
