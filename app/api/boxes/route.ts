import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/require-session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { buyBoxForUser, listBoxesForUser } from '@/lib/server/box-repo';
import { BOX_CONFIG } from '@/lib/config/boxes';
import { GENESIS_SEASON } from '@/lib/config/season';
import { BoxTypeId } from '@/types/domain';

// -----------------------------------------------------------------------------
// Phase 18 — server-enforced box purchase. Replaces
// lib/services/box-service.ts's buyBox() (localStorage) — see
// lib/server/box-repo.ts's module doc and supabase/MIGRATION.md's "known
// regression" section for why that path was already silently broken.
// -----------------------------------------------------------------------------

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const boxes = await listBoxesForUser(supabaseAdmin(), auth.session.userId);
  return NextResponse.json({ boxes });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const boxType = body && typeof body.boxType === 'string' ? (body.boxType as BoxTypeId) : null;
  const clientRequestId = body && typeof body.clientRequestId === 'string' ? body.clientRequestId : undefined;

  if (!boxType || !(boxType in BOX_CONFIG)) {
    return NextResponse.json({ ok: false, error: 'A valid boxType is required.' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const outcome = await buyBoxForUser(admin, auth.session.userId, GENESIS_SEASON.id, boxType, clientRequestId);

  if (!outcome.ok) {
    const message = outcome.error === 'INSUFFICIENT_POINTS' ? 'Not enough BAG Points.' : outcome.error;
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, box: outcome.box });
}
