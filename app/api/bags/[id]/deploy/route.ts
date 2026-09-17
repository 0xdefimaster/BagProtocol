import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/require-session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { deployBagToChain } from '@/lib/server/deploy-bag';
import { ChainId, SUPPORTED_CHAINS } from '@/types/basket-protocol';

// -----------------------------------------------------------------------------
// The first `/api/bags/*` route (Phase 3 was repository-only). Deliberately
// thin: requireSession() -> parse -> deployBagToChain() -> map result to an
// HTTP status. All the actual ownership/state-machine/adapter-selection
// logic lives in lib/server/deploy-bag.ts, same split as app/api/trades
// (route parses the request and maps results to responses; lib/server/*
// holds the logic) — see that orchestrator's header for why it re-checks
// ownership itself even though this route already calls requireSession().
// -----------------------------------------------------------------------------

function isChainId(value: unknown): value is ChainId {
  return typeof value === 'string' && (SUPPORTED_CHAINS as readonly string[]).includes(value);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const chain = isChainId(body?.chain) ? body.chain : undefined;

  const admin = supabaseAdmin();
  const result = await deployBagToChain(admin, auth.session.userId, params.id, chain);

  if (result.ok) {
    return NextResponse.json({ deployment: result.deployment }, { status: 200 });
  }

  switch (result.error) {
    case 'BAG_NOT_FOUND':
      return NextResponse.json({ error: 'Bag not found.' }, { status: 404 });
    case 'FORBIDDEN':
      // Never reveal *why* beyond "forbidden" — not "this bag belongs to
      // someone else", which would confirm the bag's existence/ownership
      // to a caller who shouldn't be probing it.
      return NextResponse.json({ error: 'You do not have permission to deploy this bag.' }, { status: 403 });
    case 'NO_VERSION':
      return NextResponse.json({ error: 'Bag has no composition version to deploy.' }, { status: 409 });
    case 'ALREADY_IN_PROGRESS_OR_DEPLOYED':
      return NextResponse.json(
        { error: 'This bag is already deploying or deployed on that chain.', deployment: result.deployment },
        { status: 409 }
      );
    case 'DEPLOYMENT_FAILED':
      return NextResponse.json({ error: `Deployment failed: ${result.message}` }, { status: 502 });
  }
}
