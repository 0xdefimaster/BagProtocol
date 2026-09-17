import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/require-session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { getBagById, getCurrentBagVersion, updateBagMetadata } from '@/lib/server/bag-repo';
import { mapBagRecordToApiResponse } from '@/lib/mappers/bag-mapper';

// -----------------------------------------------------------------------------
// Single-bag read/edit route. Same ownership contract `bag-repo.ts` already
// documents: GET is public for ACTIVE bags (mirrors the `bags` RLS read
// policy) but requires the caller to be the creator for DRAFT/ARCHIVED
// bags, and PATCH always requires session.userId === bag.creatorId — this
// is the first route that actually enforces that check, per the note in
// bag-repo.ts's header ("whichever route calls updateBagMetadata() ...
// MUST ... reject with 403 if session.userId !== bag.creatorId").
// -----------------------------------------------------------------------------

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const bag = await getBagById(admin, params.id);
  if (!bag) return NextResponse.json({ error: 'Bag not found.' }, { status: 404 });

  if (bag.status !== 'ACTIVE') {
    const auth = await requireSession();
    if (!auth.ok || auth.session.userId !== bag.creatorId) {
      // Same "don't confirm existence" reasoning as the deploy route.
      return NextResponse.json({ error: 'Bag not found.' }, { status: 404 });
    }
  }

  const version = await getCurrentBagVersion(admin, bag.id);
  return NextResponse.json({ bag: mapBagRecordToApiResponse(bag, version) }, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const admin = supabaseAdmin();
  const bag = await getBagById(admin, params.id);
  if (!bag) return NextResponse.json({ error: 'Bag not found.' }, { status: 404 });
  if (bag.creatorId !== auth.session.userId) {
    return NextResponse.json({ error: 'You do not have permission to edit this bag.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string; symbol?: string; description?: string };
  const updated = await updateBagMetadata(admin, bag.id, {
    name: body.name,
    symbol: body.symbol,
    description: body.description,
  });

  const version = await getCurrentBagVersion(admin, updated.id);
  return NextResponse.json({ bag: mapBagRecordToApiResponse(updated, version) }, { status: 200 });
}
