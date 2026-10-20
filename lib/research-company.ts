import type {Company} from './sales';
import type {ResearchCandidate} from './research';
export function isResearchDuplicate(companies:Company[],candidate:ResearchCandidate):boolean{
 const number=candidate.identity.corporateNumber;
 return companies.some(c=>number&&c.research?.identity.corporateNumber?c.research.identity.corporateNumber===number:c.name.normalize('NFKC').trim()===candidate.name.value.normalize('NFKC').trim());
}
export function researchToCompany(candidate:ResearchCandidate):Company{
 if(!candidate.identity.corporateNumber||!/^\d{13}$/.test(candidate.identity.corporateNumber)||!candidate.name.value.trim())throw new Error('法人番号または企業名を確認できないため登録できません。');
 return {id:crypto.randomUUID(),name:candidate.name.value,industry:candidate.industry?.value??'',location:candidate.address?.value??'',employees:candidate.employees?.value??null,website:candidate.website?.value??'',contact:'',priority:'中',status:'未接触',lastContact:'',nextContact:'',notes:`出典：gBizINFO API v2\n法人番号：${candidate.identity.corporateNumber}\n取得元：${candidate.name.sourceUrl}\n取得日時：${candidate.name.retrievedAt}\n元データの出典：${[...new Set([candidate.name,candidate.address,candidate.industry,candidate.website,candidate.employees,candidate.businessSummary].flatMap(e=>e?.upstreamSource?[e.upstreamSource]:[]))].join(" / ")||"APIに出典情報なし"}\n${candidate.businessSummary?.value?'事業概要：'+candidate.businessSummary.value+'\n':''}営業優先度「中」は登録時の初期値です。デスクワーク比率・導入ニーズは未確認です。`,history:[{id:crypto.randomUUID(),date:new Date().toLocaleDateString('sv-SE'),message:'gBizINFO API v2から企業を登録'}],research:candidate};
}
