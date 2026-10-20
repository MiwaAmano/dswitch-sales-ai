/** Real research results are intentionally separate from legacy Company records.
 * Unknown headcount must never silently become 0 or enter outbound templates.
 * No network requests or credentials belong in this client-safe module.
 */
export type ResearchSource = 'gbizinfo' | 'google-places' | 'company-website' | 'manual';
export type Evidence<T> = {
  value: T;
  source: ResearchSource;
  sourceUrl: string;
  retrievedAt: string;
  upstreamSource?: string;
};
export type ResearchCandidate = {
  id: string;
  identity: { corporateNumber: string | null; placeId: string | null };
  name: Evidence<string>;
  address: Evidence<string> | null;
  industry: Evidence<string> | null;
  website: Evidence<string> | null;
  employees: Evidence<number> | null;
  businessSummary?: Evidence<string> | null;
};
export type RealResearchFilters = { area: string | null; industry: string | null; keyword: string; limit: number };
/** A production adapter must run on the server, after its current terms are reviewed. */
export interface RealResearchProvider {
  search(filters: RealResearchFilters, signal?: AbortSignal): Promise<{ candidates: ResearchCandidate[]; nextCursor: string | null }>;
}
export type FitAssessment = {
  label: '業種に基づく候補' | '要確認';
  basis: string[];
  limitations: string[];
  rulesVersion: 'industry-v1';
};
const deskRelatedIndustries = ['情報通信業', 'IT・通信', 'ソフトウェア', 'コンサルティング', '広告・デザイン', '金融業', '金融・保険', '専門サービス業'];
/** A transparent industry heuristic, never an assertion about actual work style or sales probability. */
export function assessFit(candidate: ResearchCandidate): FitAssessment {
  const industry = candidate.industry?.value.trim();
  const matches = industry ? deskRelatedIndustries.filter(term => industry.includes(term)) : [];
  return {
    label: matches.length ? '業種に基づく候補' : '要確認',
    basis: matches.length ? [`取得済み業種「${industry}」が対象業種ルールに一致`] : [industry ? `取得済み業種「${industry}」について個別確認が必要` : '業種の取得情報なし'],
    limitations: ['業種だけを使った仮評価です。デスクワーク比率・福利厚生ニーズ・導入意思・成約見込みは未確認です。', 'd switchの具体的な対象条件とサービス内容を確認後、評価ルールを調整します。'],
    rulesVersion: 'industry-v1',
  };
}
export function displayEvidence<T>(evidence: Evidence<T> | null, format: (value:T)=>string = String): string {
  return evidence === null ? '未取得' : format(evidence.value);
}
export function candidateIdentityKey(candidate: ResearchCandidate): string {
  if (candidate.identity.corporateNumber) return `corporate:${candidate.identity.corporateNumber}`;
  if (candidate.identity.placeId) return `place:${candidate.identity.placeId}`;
  return `candidate:${candidate.id}`;
}
export type StorageReview = {
  source: ResearchSource;
  purpose: 'crm-and-csv';
  /** Must only be supplied by trusted server policy after an actual terms review. */
  approved: boolean;
  reviewedAt: string;
  termsUrl: string;
};
/** Fail closed: absence of a policy review never means that data may be retained.
 * Google-derived fields are deliberately unsupported for CRM persistence in this phase.
 * Saving a place ID alone needs a separate ID-only model, not a Company snapshot.
 */
export function checkPersistence(candidate: ResearchCandidate, reviews: readonly StorageReview[]): { allowed: boolean; reasons: string[] } {
  const evidence = [candidate.name, candidate.address, candidate.industry, candidate.website, candidate.employees, candidate.businessSummary??null].filter((e): e is Evidence<string> | Evidence<number> => e !== null);
  const reasons: string[] = [];
  for (const e of evidence) {
    if (!e.sourceUrl || !validHttpsUrl(e.sourceUrl) || !Number.isFinite(Date.parse(e.retrievedAt))) reasons.push('出典URLまたは取得日時が未確認です');
    if (e.source === 'google-places') reasons.push('Google Places由来の項目は、この段階ではCRM・CSVへの保存対象外です');
    else if (!reviews.some(r => r.source === e.source && r.purpose === 'crm-and-csv' && r.approved && Number.isFinite(Date.parse(r.reviewedAt)) && validHttpsUrl(r.termsUrl))) reasons.push(`${e.source}のCRM・CSV利用条件が未確認です`);
  }
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}
function validHttpsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
