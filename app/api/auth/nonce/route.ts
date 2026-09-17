import { NextRequest, NextResponse } from 'next/server';
import { issueNonce } from '@/lib/auth/nonce';
import { isSupabaseConfigured } from '@/lib/supabase/server';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase is not configured on this deployment yet.' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const walletAddress = typeof body?.walletAddress === 'string' ? body.walletAddress : null;

  if (!walletAddress || !ADDRESS_RE.test(walletAddress)) {
    return NextResponse.json({ error: 'A valid walletAddress is required.' }, { status: 400 });
  }

  try {
    const { nonce, message } = await issueNonce(walletAddress);
    return NextResponse.json({ nonce, message });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
