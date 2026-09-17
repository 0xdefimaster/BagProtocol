import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/require-session';
import { verifyRedeemExecution } from '@/lib/server/redeem-execution';
import { redeemExecutionErrorResponse } from '@/lib/server/redeem-intent-http';

// -----------------------------------------------------------------------------
// Phase 21 — exit-side counterpart to .../purchase-intent/[intentId]/
// verify/route.ts. The ONLY path that can ever move a RedeemIntent to
// COMPLETED (and thereby actually burn shares / remove holdings) — only
// after checking real on-chain status and confirming the received asset
// matches what was quoted, never from the client's own say-so. Safe to
// call repeatedly (see `verifyRedeemExecution()`'s doc).
//
//   POST /api/redeem-intent/:intentId/verify -> RedeemIntent
// -----------------------------------------------------------------------------

export async function POST(_req: Request, { params }: { params: Promise<{ intentId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { intentId } = await params;
  const outcome = await verifyRedeemExecution(supabaseAdmin(), auth.session, intentId);

  if (!outcome.ok) return redeemExecutionErrorResponse(outcome.error);
  return NextResponse.json({ intent: outcome.value });
}
