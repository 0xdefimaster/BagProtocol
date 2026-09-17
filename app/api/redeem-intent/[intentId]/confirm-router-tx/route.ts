import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/require-session';
import { verifyAndIndexRouterRedemption, RouterTxVerificationError } from '@/lib/server/redeem-router-confirmation';

// -----------------------------------------------------------------------------
// V11 — POST /api/redeem-intent/:intentId/confirm-router-tx
//
// Called by hooks/use-redeem-execution.ts right after the user's wallet
// returns a txHash from RedeemFeeRouter.redeem(). This route does NOT trust
// that the tx succeeded just because the browser says so — see
// verifyAndIndexRouterRedemption()'s own doc for the independent on-chain
// checks performed before any DB write happens.
// -----------------------------------------------------------------------------

export async function POST(req: Request, { params }: { params: Promise<{ intentId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { intentId } = await params;
  const body = await req.json().catch(() => null);
  const txHash = body?.txHash;
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: 'A valid 32-byte txHash is required.' }, { status: 400 });
  }

  try {
    await verifyAndIndexRouterRedemption(supabaseAdmin(), auth.session.userId, intentId, txHash as `0x${string}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RouterTxVerificationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : 'Failed to verify redemption transaction.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
