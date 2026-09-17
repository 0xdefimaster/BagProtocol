import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/require-session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { openBoxForUser } from '@/lib/server/box-repo';

// -----------------------------------------------------------------------------
// Phase 18 — server-enforced box opening. Replaces
// lib/services/box-service.ts's openBox() (localStorage) — see
// lib/server/box-repo.ts's openBoxForUser() doc for the atomic
// compare-and-swap that makes a duplicated/concurrent open request safe.
// -----------------------------------------------------------------------------

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const outcome = await openBoxForUser(supabaseAdmin(), auth.session.userId, id);

  if (!outcome.ok) {
    const status = outcome.error === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }

  return NextResponse.json({ ok: true, box: outcome.box, accessory: outcome.accessory });
}
