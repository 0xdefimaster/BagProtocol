import { NextResponse } from 'next/server';
import { PurchaseExecutionError } from '@/lib/server/purchase-execution';

// -----------------------------------------------------------------------------
// Phase 17 — one place every purchase-intent route maps a typed
// `PurchaseExecutionError` (lib/server/purchase-execution.ts) to an HTTP
// status + JSON body, so the mapping can't drift between routes (spec
// Aşama 16: "Error handling raw LI.FI/provider errorlarını client'a
// sızdırmayacak" — every message here is already a human-safe string by
// the time it reaches this file; nothing here ever forwards a raw
// error/stack trace).
// -----------------------------------------------------------------------------

export function purchaseExecutionErrorResponse(error: PurchaseExecutionError): NextResponse {
  switch (error.kind) {
    case 'BAG_NOT_FOUND':
      return NextResponse.json({ error: 'Bag not found.' }, { status: 404 });
    case 'NO_PUBLISHED_RECIPE':
      return NextResponse.json({ error: 'This Bag has no published recipe yet.' }, { status: 409 });
    case 'REGISTRY_INVALID':
      return NextResponse.json(
        { error: 'This Bag references one or more assets that are no longer verified in the registry.', details: error.details },
        { status: 409 }
      );
    case 'UNKNOWN_INPUT_ASSET':
      return NextResponse.json({ error: 'Unknown or unverified input asset.' }, { status: 400 });
    case 'PREVIEW_ERROR':
      return NextResponse.json({ error: error.message }, { status: 422 });
    case 'PRICE_UNAVAILABLE':
      return NextResponse.json(
        { error: 'Live pricing is temporarily unavailable. Please try again shortly.' },
        { status: 503 }
      );
    case 'QUOTE_FAILED':
      return NextResponse.json({ error: error.message, failureCode: error.failureCode }, { status: 422 });
    case 'PURCHASE_IN_PROGRESS':
      return NextResponse.json(
        { error: 'A purchase is already in progress for this Bag.', intentId: error.intentId },
        { status: 409 }
      );
    case 'NOT_FOUND':
      return NextResponse.json({ error: 'Purchase intent not found.' }, { status: 404 });
    case 'FORBIDDEN':
      return NextResponse.json({ error: 'This purchase intent does not belong to you.' }, { status: 403 });
    case 'EXPIRED':
      return NextResponse.json({ error: 'This purchase quote has expired. Start a new purchase.' }, { status: 409 });
    case 'ROUTE_CHANGED':
      return NextResponse.json(
        { error: "This Bag's composition changed since this purchase was quoted. Start a new purchase." },
        { status: 409 }
      );
    case 'INVALID_STATE':
      return NextResponse.json({ error: `This purchase is not in a state that allows this action (${error.status}).` }, { status: 409 });
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}
