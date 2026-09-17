import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { getLeaderboard } from '@/lib/server/leaderboard-repo';
import { GENESIS_SEASON, LEADERBOARD_TOP_N } from '@/lib/config/season';

// Readable without signing in — leaderboards are public — but "self" only
// resolves when there's a session, since a guest has no `users` row.
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  try {
    const session = await getSession();
    const result = await getLeaderboard(
      supabaseAdmin(),
      GENESIS_SEASON.id,
      session?.userId ?? '',
      LEADERBOARD_TOP_N
    );
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
