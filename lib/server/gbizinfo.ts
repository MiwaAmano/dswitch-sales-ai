/** Server-side only: import from route handlers, never from client components.
 * Do not guess current endpoint, authentication scheme or response mappings.
 * Unlock only after official current API documentation and terms are reviewed.
 */
export const GBIZINFO_REVIEW = {
  verified: false,
  officialUrl: 'https://info.gbiz.go.jp/',
  reason: '最新の公式API仕様・利用条件・料金を確認できていないため、外部APIへの接続はまだ有効化していません。',
} as const;
export type Readiness = {
  provider: 'gbizinfo';
  ready: boolean;
  keyConfigured: boolean;
  documentationVerified: boolean;
  code: 'KEY_MISSING' | 'DOCUMENTATION_PENDING';
  message: string;
  officialUrl: string;
};
export function getGbizinfoReadiness(token: string | undefined): Readiness {
  const keyConfigured = Boolean(token?.trim());
  return {
    provider: 'gbizinfo', ready: false, keyConfigured,
    documentationVerified: GBIZINFO_REVIEW.verified,
    code: keyConfigured ? 'DOCUMENTATION_PENDING' : 'KEY_MISSING',
    message: keyConfigured ? GBIZINFO_REVIEW.reason : 'gBizINFOのAPIキーが未設定です。設定手順をご確認ください。サンプル企業は検索結果に表示しません。',
    officialUrl: GBIZINFO_REVIEW.officialUrl,
  };
}
import { prefectures } from '../prefectures';
export type GbizinfoQuery = { keyword: string; area: string; industry: string };
export function validateGbizinfoQuery(value: unknown): GbizinfoQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('検索条件を確認してください。');
  const v = value as Record<string, unknown>;
  for (const key of ['keyword','area','industry']) if (typeof v[key] !== 'string' || (v[key] as string).length > 100) throw new Error('検索条件は各100文字以内で入力してください。');
  const query = { keyword: (v.keyword as string).trim(), area: (v.area as string).trim(), industry: (v.industry as string).trim() };
  if (query.area && !prefectures.includes(query.area)) throw new Error('都道府県を選択してください。');
  if (!query.keyword && !query.area && !query.industry) throw new Error('全国を検索する場合は、キーワードまたは業種を指定してください。');
  return query;
}
