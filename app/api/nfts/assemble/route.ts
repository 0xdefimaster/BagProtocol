import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/require-session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { assembleBagNftForUser, SlotSelection } from '@/lib/server/nft-repo';
import { getAccessoryById } from '@/data/mock-accessories';
import { computeNftRarity } from '@/lib/domain/nft/rarity-engine';
import { getLeaderboard } from '@/lib/server/leaderboard-repo';
import { GENESIS_SEASON, LEADERBOARD_TOP_N } from '@/lib/config/season';
import { ACCESSORY_SLOTS, Accessory, AccessorySlot } from '@/types/domain';

// -----------------------------------------------------------------------------
// Phase 19 — server-enforced NFT assembly. Replaces
// lib/services/nft-service.ts's assembleBagNFT() (localStorage) — see
// lib/server/nft-repo.ts's doc and supabase/migrations/0010_add_assemble_bag_nft.sql
// for why consuming accessories and minting the NFT happen as one atomic
// call. genesisRank is computed here the same way the old client code did
// (lib/services/leaderboard-service.ts's board.self.rank), just against the
// real Postgres-backed leaderboard instead of the seeded-fake one.
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const selection: SlotSelection = body && typeof body.selection === 'object' && body.selection !== null ? body.selection : {};

  const missing = ACCESSORY_SLOTS.filter((slot) => typeof selection[slot] !== 'string');
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Missing accessories for: ${missing.join(', ')}` },
      { status: 400 }
    );
  }

  const resolved = {} as Record<AccessorySlot, Accessory>;
  for (const slot of ACCESSORY_SLOTS) {
    const accessory = getAccessoryById(selection[slot]!);
    if (!accessory) {
      return NextResponse.json({ ok: false, error: `Unknown accessory for ${slot}.` }, { status: 400 });
    }
    resolved[slot] = accessory;
  }
  const rarity = computeNftRarity(resolved);

  const admin = supabaseAdmin();
  const board = await getLeaderboard(admin, GENESIS_SEASON.id, auth.session.userId, LEADERBOARD_TOP_N);
  const genesisRank = board.self && board.self.rank <= board.topN ? board.self.rank : undefined;

  const outcome = await assembleBagNftForUser(admin, auth.session.userId, GENESIS_SEASON.id, selection, rarity, genesisRank);

  if (!outcome.ok) {
    const message = outcome.error.startsWith('INSUFFICIENT_ACCESSORIES')
      ? "You don't own one of the selected accessories anymore — refresh your inventory and try again."
      : outcome.error;
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, nft: outcome.nft });
}
