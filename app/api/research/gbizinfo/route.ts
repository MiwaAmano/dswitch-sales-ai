import { NextResponse } from 'next/server';
import { getGbizinfoReadiness, validateGbizinfoQuery } from '@/lib/server/gbizinfo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET() {
  // Presence only. Never return the token, a prefix, or its length.
  return NextResponse.json(getGbizinfoReadiness(process.env.GBIZINFO_API_TOKEN), { headers });
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const expectedOrigin = new URL(request.url);
  // Next.js can normalize request.url to localhost even when Windows uses 127.0.0.1.
  // The browser-supplied Host header identifies the origin serving this request.
  const host = request.headers.get('host');
  if (host) expectedOrigin.host = host;
  if (origin && origin !== expectedOrigin.origin) return NextResponse.json({ code:'ORIGIN_DENIED', message:'この画面から検索し直してください。' }, { status:403, headers });
  const text = await request.text();
  if (text.length > 2048) return NextResponse.json({ code:'INVALID_QUERY', message:'検索条件が長すぎます。' }, { status:413, headers });
  try { validateGbizinfoQuery(JSON.parse(text)); }
  catch (error) { return NextResponse.json({ code:'INVALID_QUERY', message: error instanceof SyntaxError ? '検索条件の形式が不正です。' : error instanceof Error ? error.message : '検索条件を確認してください。' }, { status:400, headers }); }
  const status = getGbizinfoReadiness(process.env.GBIZINFO_API_TOKEN);
  // No fixture fallback, result caching, localStorage writes, or external calls.
  // A verified provider adapter must replace this gate before live search is enabled.
  return NextResponse.json(status, { status:503, headers });
}
