import { NextRequest, NextResponse } from 'next/server';

// -----------------------------------------------------------------------------
// Shared-secret auth for scheduler-triggered routes (settlement worker,
// reconciliation job) — these are never called by a signed-in user's
// browser, so `requireSession()` (cookie-based) is the wrong tool here.
// Standard "Authorization: Bearer <CRON_SECRET>" convention (matches
// Vercel Cron's own recommended pattern; works identically for any other
// external scheduler that can set one header).
//
// Fails closed: if `CRON_SECRET` is unset, EVERY call is rejected — never
// silently open. Set `CRON_SECRET` in the deployment's env before wiring
// up a scheduler to call these routes.
// -----------------------------------------------------------------------------

export function requireCronSecret(req: NextRequest): NextResponse | null {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured on this deployment — refusing all calls.' }, { status: 503 });
  }

  const header = req.headers.get('authorization');
  if (header !== `Bearer ${configured}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  return null;
}
