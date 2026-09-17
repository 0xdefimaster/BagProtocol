import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { consumeNonce } from '@/lib/auth/nonce';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase/server';
import { STARTING_DEMO_BALANCE } from '@/lib/config/market';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SIGNATURE_RE = /^0x[a-fA-F0-9]+$/;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase is not configured on this deployment yet.' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const walletAddress = typeof body?.walletAddress === 'string' ? body.walletAddress : null;
  const signature = typeof body?.signature === 'string' ? body.signature : null;
  const nonce = typeof body?.nonce === 'string' ? body.nonce : null;

  if (!walletAddress || !ADDRESS_RE.test(walletAddress) || !signature || !SIGNATURE_RE.test(signature) || !nonce) {
    return NextResponse.json(
      { error: 'walletAddress, signature and nonce are all required.' },
      { status: 400 }
    );
  }

  // One-time-use nonce lookup — returns the exact message that was signed,
  // or null if it's missing, mismatched, or expired (already deleted either way).
  const message = await consumeNonce(walletAddress, nonce);
  if (!message) {
    return NextResponse.json(
      { error: 'Sign-in request expired or was already used. Request a new one and try again.' },
      { status: 401 }
    );
  }

  const isValidSignature = await verifyMessage({
    address: walletAddress as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);

  if (!isValidSignature) {
    return NextResponse.json({ error: 'Signature does not match this wallet.' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const normalizedAddress = walletAddress.toLowerCase();

  const { data: existingUser, error: selectError } = await admin
    .from('users')
    .select('id, wallet_address, display_name')
    .eq('wallet_address', normalizedAddress)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  let user = existingUser;

  if (!user) {
    const { data: createdUser, error: insertError } = await admin
      .from('users')
      .insert({ wallet_address: normalizedAddress })
      .select('id, wallet_address, display_name')
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    user = createdUser;

    // Seed the 1:1 portfolio row now so getPortfolio never needs a
    // "lazily create on first read" branch client-side — the $10,000 demo
    // balance starts the moment the account exists, same as before.
    const { error: portfolioError } = await admin
      .from('portfolios')
      .insert({ user_id: user.id, cash_balance: STARTING_DEMO_BALANCE });
    if (portfolioError) {
      return NextResponse.json({ error: portfolioError.message }, { status: 500 });
    }
  }

  const token = await createSessionToken({ userId: user.id, walletAddress: user.wallet_address });
  setSessionCookie(token);

  return NextResponse.json({
    user: { id: user.id, walletAddress: user.wallet_address, displayName: user.display_name },
  });
}
