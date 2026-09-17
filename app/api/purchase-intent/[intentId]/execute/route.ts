import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/require-session';
import { prepareExecution } from '@/lib/server/purchase-execution';
import { purchaseExecutionErrorResponse } from '@/lib/server/purchase-intent-http';

// -----------------------------------------------------------------------------
// Phase 17 — spec Aşama 9: THE idempotent execution endpoint. Calling this
// repeatedly for the same `intentId` never creates a second transaction —
// see `prepareExecution()`'s doc (lib/server/purchase-execution.ts) for the
// full table. This endpoint's job is narrow: validate + advance the
// intent's SERVER-SIDE status to `AWAITING_SIGNATURE` and hand back the
// per-step LI.FI payload the client needs to actually sign/send — it never
// signs or sends anything itself (spec Aşama 4/8: "Private key backend'e
// EKLENMEYECEK", "Signing yalnızca kullanıcı wallet'ında yapılacak").
//
//   POST /api/purchase-intent/:intentId/execute -> PurchaseIntent (with steps[].lifiStep)
// -----------------------------------------------------------------------------

export async function POST(_req: Request, { params }: { params: Promise<{ intentId: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { intentId } = await params;
  const outcome = await prepareExecution(supabaseAdmin(), auth.session, intentId);

  if (!outcome.ok) return purchaseExecutionErrorResponse(outcome.error);
  return NextResponse.json({ intent: outcome.value });
}
