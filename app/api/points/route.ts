import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/require-session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { getUserPoints, listTransactions } from '@/lib/server/points-repo';
import { GENESIS_SEASON } from '@/lib/config/season';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  try {
    const admin = supabaseAdmin();
    const season = GENESIS_SEASON;
    const [points, transactions] = await Promise.all([
      getUserPoints(admin, auth.session.userId, season.id),
      listTransactions(admin, auth.session.userId, season.id),
    ]);
    return NextResponse.json({ season, points, transactions });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
