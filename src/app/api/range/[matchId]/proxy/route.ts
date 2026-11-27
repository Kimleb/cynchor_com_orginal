import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkRateLimit } from '@/lib/session';
import { getMatchAccess, recordRangeEvent } from '@/lib/range-runtime/lobby';
import { requestTarget } from '@/lib/range-runtime/targetHttp';
import { ensureScorerRunning } from '@/lib/range-runtime/scorer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_CHARS = 16 * 1024;
// Attack console: Red members send requests to their match's target. The container address never leaves the server.
export async function POST(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const access = getMatchAccess(user.id, matchId);
    if (access === null || access.side !== 'RED') {
      return NextResponse.json({ success: false, error: 'Forbidden: the attack console is for the Red team of this match.' }, { status: 403 });
    }
    const rl = checkRateLimit(`rproxy_${user.id}`, 120, 60);
    if (rl.allowed === false) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });
    }
    const range = access.range;
    if (!access.matchActive || range === undefined || range.status !== 'RUNNING' || range.container_id === null) {
      return NextResponse.json({ success: false, error: 'The match target is not running.' }, { status: 409 });
    }
    const body = (await req.json().catch(() => null)) ?? {};
    const method = body.method === 'POST' ? 'POST' : body.method === 'GET' || body.method === undefined ? 'GET' : null;
    const path = typeof body.path === 'string' ? body.path : '';
    // Origin-form paths only: no scheme/host, no whitespace or control characters (blocks request smuggling and SSRF).
    if (method === null || !/^\/[\x21-\x7e]{0,1999}$/.test(path) || path.startsWith('//')) {
      return NextResponse.json({ success: false, error: 'method must be GET or POST and path must start with a single "/".' }, { status: 400 });
    }
    let payload: unknown;
    if (method === 'POST' && body.body !== undefined) {
      if (JSON.stringify(body.body).length > MAX_BODY_CHARS) {
        return NextResponse.json({ success: false, error: 'Request body too large.' }, { status: 413 });
      }
      payload = body.body;
    }
    const cookie = typeof body.cookie === 'string' && /^fc_sid=[a-f0-9]{1,64}$/.test(body.cookie) ? body.cookie : undefined;
    ensureScorerRunning();
    let result;
    try {
      result = await requestTarget(range.container_id, { method, path, body: payload, cookie });
    } catch {
      recordRangeEvent({ matchId: access.sessionId, scope: 'RED', action: 'RANGE_PROXY_REQUEST', userId: user.id, details: `${method} ${path} -> 502` });
      return NextResponse.json({ success: false, error: 'The target did not answer (it may be restarting).' }, { status: 502 });
    }
    recordRangeEvent({ matchId: access.sessionId, scope: 'RED', action: 'RANGE_PROXY_REQUEST', userId: user.id, details: `${method} ${path} -> ${result.status}` });
    const setCookie = result.setCookie[0]?.split(';')[0] ?? null;
    return NextResponse.json({ success: true, status: result.status, contentType: result.contentType, body: result.body, cookie: setCookie });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
