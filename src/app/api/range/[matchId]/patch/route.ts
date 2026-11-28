import { hasRangeAccess } from '@/lib/team-rules';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkRateLimit } from '@/lib/session';
import { getMatchAccess, recordRangeEvent } from '@/lib/range-runtime/lobby';
import { patchTargetFile, PATCHABLE_FILES, MAX_PATCH_BYTES, type PatchableFile } from '@/lib/range-runtime/targetHttp';
import { ensureScorerRunning } from '@/lib/range-runtime/scorer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Patch console: Blue members replace an allowlisted target source file inside the running container, which restarts the target.
export async function POST(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!await hasRangeAccess(user.id)) return NextResponse.json({ success: false, error: 'Complete team formation and accept the rules of engagement.' }, { status: 403 });
    const access = getMatchAccess(user.id, matchId);
    if (access === null || access.side !== 'BLUE') {
      return NextResponse.json({ success: false, error: 'Forbidden: the patch console is for the Blue team of this match.' }, { status: 403 });
    }
    const rl = checkRateLimit(`rpatch_${user.id}`, 20, 60);
    if (rl.allowed === false) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });
    }
    const range = access.range;
    if (!access.matchActive || range === undefined || range.status !== 'RUNNING' || range.container_id === null) {
      return NextResponse.json({ success: false, error: 'The match target is not running.' }, { status: 409 });
    }
    const body = (await req.json().catch(() => null)) ?? {};
    const file = (PATCHABLE_FILES as readonly string[]).includes(body.file) ? (body.file as PatchableFile) : null;
    const content = typeof body.content === 'string' ? body.content : '';
    if (file === null) {
      return NextResponse.json({ success: false, error: `file must be one of: ${PATCHABLE_FILES.join(', ')}` }, { status: 400 });
    }
    if (content === '' || Buffer.byteLength(content) > MAX_PATCH_BYTES) {
      return NextResponse.json({ success: false, error: `content is required and must be at most ${MAX_PATCH_BYTES} bytes.` }, { status: 400 });
    }
    ensureScorerRunning();
    const result = await patchTargetFile(range.container_id, file, content);
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: `Patch rejected: ${result.error}` }, { status: 422 });
    }
    recordRangeEvent({ matchId: access.sessionId, scope: 'BLUE', action: 'RANGE_PATCH_APPLIED', userId: user.id, details: `patched ${file} (${Buffer.byteLength(content)} bytes), target restarting` });
    return NextResponse.json({ success: true, file, restarting: true });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
