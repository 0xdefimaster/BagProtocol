import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/require-session';
import { prepareRedeemExecution } from '@/lib/server/redeem-execution';
import { redeemExecutionErrorResponse } from '@/lib/server/redeem-intent-http';

// -----------------------------------------------------------------------------
// Phase 21 — exit-side counterpart to .../purchase-intent/[intentId]/
// execute/route.ts. Same idempotency guarantee (repeated calls never
// create a second transaction — see `prepareRedeemExecution()`'s doc) and
// same signing boundary: this never signs or sends anything itself, only
// advances server-side status and hands back the per-step LI.FI payload
// for the client's own wallet to sign.
//
//   POST /api/redeem-intent/:intentId/execute -> RedeemIntent (with steps[].lifiStep)
// -----------------------------------------------------------------------------

export async function POST(_req: Request, { params }: { params: Promise<{ intentId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { intentId } = await params;
  const outcome = await prepareRedeemExecution(supabaseAdmin(), auth.session, intentId);

  if (!outcome.ok) return redeemExecutionErrorResponse(outcome.error);
  return NextResponse.json({ intent: outcome.value });
}
