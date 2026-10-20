import { NextResponse } from 'next/server';
import { EnrichmentBudget } from '@/lib/server/enrichment-limits';
import { GbizinfoError, getGbizinfoCompany } from '@/lib/server/gbizinfo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
let busy = false;
const budget = new EnrichmentBudget();
export async function POST(request: Request) {
  const expected = new URL(request.url),
    host = request.headers.get('host');
  if (host) expected.host = host;
  const origin = request.headers.get('origin');
  if (origin && origin !== expected.origin)
    return NextResponse.json(
      { code: 'ORIGIN_DENIED', message: 'アプリの画面から実行してください。' },
      { status: 403, headers },
    );
  if (busy)
    return NextResponse.json(
      { code: 'ENRICH_BUSY', message: '補完処理が実行中です。' },
      { status: 429, headers },
    );
  try {
    const body = await request.text();
    if (body.length > 100)
      throw new GbizinfoError('INVALID_QUERY', '補完条件が不正です。', 400);
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new GbizinfoError(
        'INVALID_QUERY',
        '補完条件の形式が不正です。',
        400,
      );
    }
    const number = (input as { number?: unknown } | null)?.number;
    if (typeof number !== 'string' || !/^\d{13}$/.test(number))
      throw new GbizinfoError(
        'INVALID_QUERY',
        '法人番号は13桁で指定してください。',
        400,
      );
    if (!process.env.GBIZINFO_API_TOKEN?.trim())
      throw new GbizinfoError(
        'KEY_MISSING',
        '.env.localにAPIトークンを設定し、再起動してください。',
        503,
      );
    if (!budget.take())
      throw new GbizinfoError(
        'LOCAL_LIMIT',
        '補完のローカル上限（30回/分・200回/UTC日）に達しました。時間をおいてください。',
        429,
      );
    busy = true;
    try {
      return NextResponse.json(
        {
          candidate: await getGbizinfoCompany(
            number,
            process.env.GBIZINFO_API_TOKEN,
            { signal: request.signal },
          ),
        },
        { headers },
      );
    } finally {
      busy = false;
    }
  } catch (error) {
    if (error instanceof GbizinfoError)
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status, headers },
      );
    return NextResponse.json(
      {
        code: 'SERVER_ERROR',
        message: '補完処理に失敗しました。設定を確認してください。',
      },
      { status: 500, headers },
    );
  }
}
