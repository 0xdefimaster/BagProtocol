import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/require-session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { createBag, getCurrentBagVersion, listBags } from '@/lib/server/bag-repo';
import { listAssets } from '@/lib/server/asset-repo';
import {
  AssetAddressLookup,
  CreateBagApiRequest,
  mapBagRecordToApiResponse,
  mapBagRecordsToApiResponse,
  mapCreateBagRequestToRecipeInput,
} from '@/lib/mappers/bag-mapper';
import { BagStatus, ChainId, SUPPORTED_CHAINS } from '@/types/basket-protocol';

// -----------------------------------------------------------------------------
// First non-deploy `/api/bags` route. Same split as every other route in
// this app: parse -> call repository -> map result to an HTTP response.
// All ownership/validation/state-machine logic lives in
// `lib/server/bag-repo.ts` (validateBasketRecipe, DUPLICATE_SLUG, etc.) —
// this file never re-implements any of it.
//
//   GET  /api/bags            public listing (Explore) -> ACTIVE bags only
//   GET  /api/bags?mine=1     caller's own bags, any status (requires session)
//   POST /api/bags            create a bag for the signed-in caller
// -----------------------------------------------------------------------------

function isBagStatus(value: unknown): value is BagStatus {
  return value === 'DRAFT' || value === 'ACTIVE' || value === 'ARCHIVED';
}

function isChainId(value: string | undefined): value is ChainId {
  return typeof value === 'string' && (SUPPORTED_CHAINS as readonly string[]).includes(value);
}

/**
 * Phase 17 — resolves a create payload's composition symbols against the
 * VERIFIED asset registry so `mapCreateBagRequestToRecipeInput` can give
 * real `chain`/`address`/`decimals` instead of always falling back to
 * `__PENDING__`. Server-side and registry-sourced only — nothing here ever
 * reads chain/address off the request body per-asset, only the symbol.
 *
 * Resolution when a symbol exists as a VERIFIED asset on more than one
 * chain (e.g. registered on both `robinhood` and `ethereum`): the entry on
 * the bag's own requested chain wins; other chains only fill symbols that
 * are still unresolved after that first pass. This is a best-effort,
 * documented tie-break — not a promise that every multi-chain symbol
 * collision is disambiguated correctly (same caveat this lookup always
 * had, just no longer silently unused).
 */
async function buildAssetAddressLookup(
  admin: ReturnType<typeof supabaseAdmin>,
  composition: CreateBagApiRequest['composition'],
  bagChain: ChainId
): Promise<AssetAddressLookup> {
  const wantedSymbols = new Set(composition.map((pos) => pos.symbol.toUpperCase()));
  if (wantedSymbols.size === 0) return {};

  const verified = await listAssets(admin, { status: 'VERIFIED' });

  const lookup: AssetAddressLookup = {};
  // Pass 1: prefer a match on the bag's own chain.
  for (const asset of verified) {
    const key = asset.symbol.toUpperCase();
    if (wantedSymbols.has(key) && asset.chain === bagChain && !lookup[key]) {
      lookup[key] = { chain: asset.chain, address: asset.address, decimals: asset.decimals };
    }
  }
  // Pass 2: fill anything still unresolved from any other chain.
  for (const asset of verified) {
    const key = asset.symbol.toUpperCase();
    if (wantedSymbols.has(key) && !lookup[key]) {
      lookup[key] = { chain: asset.chain, address: asset.address, decimals: asset.decimals };
    }
  }

  return lookup;
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const mine = searchParams.get('mine') === '1' || searchParams.get('mine') === 'true';
  const statusParam = searchParams.get('status');

  const admin = supabaseAdmin();

  let creatorId: string | undefined;
  if (mine) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    creatorId = auth.session.userId;
  }

  const bags = await listBags(admin, {
    creatorId,
    status: isBagStatus(statusParam) ? statusParam : undefined,
  });

  const versions = await Promise.all(bags.map((bag) => getCurrentBagVersion(admin, bag.id)));
  const versionsById = new Map(bags.map((bag, i) => [bag.id, versions[i]]));

  return NextResponse.json({ bags: mapBagRecordsToApiResponse(bags, versionsById) }, { status: 200 });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured on this deployment yet.' }, { status: 503 });
  }

  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as CreateBagApiRequest | null;
  if (!body || typeof body.name !== 'string' || !body.name.trim() || !Array.isArray(body.composition)) {
    return NextResponse.json({ error: 'name and composition are required.' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const bagChain: ChainId = isChainId(body.chain) ? body.chain : 'ethereum';
  const assetsByAddress = await buildAssetAddressLookup(admin, body.composition, bagChain);
  const input = mapCreateBagRequestToRecipeInput(body, auth.session.userId, assetsByAddress);
  const result = await createBag(admin, input);

  if (!result.ok) {
    switch (result.error) {
      case 'VALIDATION_FAILED':
        return NextResponse.json({ error: 'Recipe validation failed.', issues: result.issues }, { status: 422 });
      case 'DUPLICATE_SLUG':
        return NextResponse.json({ error: result.message }, { status: 409 });
      case 'DB_ERROR':
        return NextResponse.json({ error: result.message }, { status: 502 });
    }
  }

  const bag = mapBagRecordToApiResponse(result.bag, result.version);
  return NextResponse.json({ bag }, { status: 201 });
}
