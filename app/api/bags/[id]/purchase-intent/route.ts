import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/require-session';
import { createPurchaseIntentForUser } from '@/lib/server/purchase-execution';
import { purchaseExecutionErrorResponse } from '@/lib/server/purchase-intent-http';

// -----------------------------------------------------------------------------
// Phase 17 — spec Aşama 2/6: creates the server-side `PurchaseIntent` that
// backs the "Purchase" button in `PurchasePreviewModal`. Deliberately a
// SEPARATE route from `.../purchase-preview` (which stays exactly as it
// was — Phase 12/14, unauthenticated, no wallet needed, still used for the
// live "Allocation vs Live Quote" display before a wallet is even
// connected): this route requires a signed-in session (spec Aşama 1 —
// "Wallet disconnected ise execution disabled olsun") and its result is
// bound to that session's real wallet address, never a placeholder.
//
//   POST /api/bags/:id/purchase-intent   { inputAssetId, amount } -> PurchaseIntent
// -----------------------------------------------------------------------------

interface CreatePurchaseIntentBody {
  inputAssetId: string;
  /** Human decimal string, e.g. "100" — same convention as .../purchase-preview. */
  amount: string;
}

function isCreatePurchaseIntentBody(value: unknown): value is CreatePurchaseIntentBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.inputAssetId === 'string' && typeof body.amount === 'string';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  // Wallet disconnected / not signed in -> 401, which the client reads as
  // "show Connect Wallet" (spec Aşama 1/6) rather than proceeding with any
  // placeholder identity.
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!isCreatePurchaseIntentBody(body)) {
    return NextResponse.json({ error: 'Expected { inputAssetId: string, amount: string }.' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const outcome = await createPurchaseIntentForUser({
    admin,
    session: auth.session,
    bagId: id,
    inputAssetId: body.inputAssetId,
    amount: body.amount,
  });

  if (!outcome.ok) return purchaseExecutionErrorResponse(outcome.error);
  return NextResponse.json({ intent: outcome.value });
}
