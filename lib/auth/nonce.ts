import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/server';

// -----------------------------------------------------------------------------
// Sign-In-With-Wallet nonce. Flow:
//   1. Client asks for a nonce for its wallet address.
//   2. Server generates one, builds the exact message the wallet will sign,
//      and stores {nonce, message, expires_at} keyed by wallet_address.
//   3. Client signs `message` with personal_sign and posts the signature
//      back along with the nonce it received.
//   4. Server looks the nonce back up (one-time use, deleted on read),
//      confirms it matches and hasn't expired, and verifies the signature
//      against the *stored* message — never a message reconstructed from
//      scratch, since that would drift (timestamp, wording) from what was
//      actually signed.
// -----------------------------------------------------------------------------

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete the wallet prompt

function normalize(walletAddress: string): string {
  return walletAddress.toLowerCase();
}

export function buildSignMessage(walletAddress: string, nonce: string): string {
  return [
    'Bag Protocol wants you to sign in with your wallet.',
    '',
    'This request will not trigger a blockchain transaction or cost any gas.',
    '',
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

export async function issueNonce(walletAddress: string): Promise<{ nonce: string; message: string }> {
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = buildSignMessage(walletAddress, nonce);
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();

  const { error } = await supabaseAdmin()
    .from('auth_nonces')
    .upsert(
      { wallet_address: normalize(walletAddress), nonce, message, expires_at: expiresAt },
      { onConflict: 'wallet_address' }
    );

  if (error) throw new Error(error.message);
  return { nonce, message };
}

/** Returns the exact signed message on success, or null if the nonce is missing/mismatched/expired. Always one-time use. */
export async function consumeNonce(walletAddress: string, nonce: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const wallet = normalize(walletAddress);

  const { data, error } = await admin
    .from('auth_nonces')
    .select('nonce, message, expires_at')
    .eq('wallet_address', wallet)
    .maybeSingle();

  if (error || !data) return null;

  // Always delete on read attempt — a nonce is single-use whether or not it
  // ends up matching, so a captured/replayed request can never succeed twice.
  await admin.from('auth_nonces').delete().eq('wallet_address', wallet);

  if (data.nonce !== nonce) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  return data.message as string;
}
