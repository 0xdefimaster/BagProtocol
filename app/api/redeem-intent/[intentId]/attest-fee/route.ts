import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/require-session';
import { signFeeAttestation, RouterNotConfiguredError } from '@/lib/server/redeem-fee-attestation';

// -----------------------------------------------------------------------------
// V11 — the signing endpoint RedeemFeeRouter.redeem() needs before it can
// be called at all: the client cannot construct a valid attestation itself
// (it doesn't have REDEEM_FEE_ATTESTOR_PRIVATE_KEY, by design — see
// RedeemFeeRouter.sol's own module doc). Every value in the returned
// attestation was loaded and computed server-side by signFeeAttestation()
// — this route is pure I/O + auth + error mapping, same split as every
// other redeem-intent route.
//
//   POST /api/redeem-intent/:intentId/attest-fee -> FeeAttestation
//
// signFeeAttestation() now builds one RedeemLeg per distinct asset in the
// redemption (multi-asset support, V11) — the MultiAssetRedemptionNotSupportedError
// fail-closed path from the prior single-leg design no longer exists; this
// route was updated to match (previously imported that removed symbol,
// which no longer compiled — fixed here).
//
// Deliberately fails closed (503), never with a fabricated attestation,
// for the one real gap this repo currently has: RouterNotConfiguredError
// (REDEEM_FEE_ROUTER_ADDRESS/CREATOR_REWARDS_VAULT_ADDRESS unset — nothing
// has been deployed yet).
// -----------------------------------------------------------------------------

export async function POST(_req: Request, { params }: { params: Promise<{ intentId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { intentId } = await params;

  try {
    const attestation = await signFeeAttestation(supabaseAdmin(), auth.session.userId, intentId);
    return NextResponse.json({ attestation });
  } catch (err) {
    if (err instanceof RouterNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Failed to sign fee attestation.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
