import {describeIndustry,scoreCandidate} from './research-scoring';
import type {Company} from './sales';
import type {ResearchCandidate} from './research';
export function isResearchDuplicate(companies:Company[],candidate:ResearchCandidate):boolean{
 const number=candidate.identity.corporateNumber;
 return companies.some(c=>number&&c.research?.identity.corporateNumber?c.research.identity.corporateNumber===number:c.name.normalize('NFKC').trim()===candidate.name.value.normalize('NFKC').trim());
}
export function researchToCompany(candidate:ResearchCandidate):Company{
 if(!candidate.identity.corporateNumber||!/^\d{13}$/.test(candidate.identity.corporateNumber)||!candidate.name.value.trim())throw new Error('法人番号または企業名を確認できないため登録できません。');
 const score=scoreCandidate(candidate);
 const provider=candidate.name.source==='gbizinfo-download'?'gBizINFOダウンロードCSV（利用者指定）':'gBizINFO API v2';
 return {id:crypto.randomUUID(),name:candidate.name.value,industry:describeIndustry(candidate).display,location:candidate.address?.value??'',employees:candidate.employees?.value??null,website:candidate.website?.value??'',contact:'',priority:score.rank==='A'?'高':score.rank==='B'?'中':'低',status:'未接触',lastContact:'',nextContact:'',notes:`出典：${provider}\n法人番号：${candidate.identity.corporateNumber}\n取得元：${candidate.name.sourceUrl}\n取得日時：${candidate.name.retrievedAt}\n元ファイル：${candidate.name.sourceFileName??"API情報または未取得"}\n収録差異：${candidate.dataConflicts?.map(d=>d.field).join(" / ")||"なし"}\n元データの出典：${[...new Set([candidate.name,candidate.address,candidate.industry,candidate.website,candidate.employees,candidate.businessSummary].flatMap(e=>e?.upstreamSource?[e.upstreamSource]:[]))].join(" / ")||"元データの出典情報なし"}\n${candidate.businessSummary?.value?'事業概要：'+candidate.businessSummary.value+'\n':''}営業適性スコア：${score.total}/100（${score.rank}ランク）\n評価ルール：${score.version}\n${score.parts.map(p=>`${p.label}：${p.points}/${p.max}点 ${p.reason}`).join("\n")}\n${score.limitations}`,history:[{id:crypto.randomUUID(),date:new Date().toLocaleDateString('sv-SE'),message:`${provider}から企業を登録`}],research:candidate,researchScore:score};
}

/** Build a whole batch before persisting; never mutate the existing records. */
export function prepareResearchBatch(existing:Company[],candidates:ResearchCandidate[]){
 if(candidates.length>100)throw Error('一括登録は100社までです。');const companies=[...existing];let added=0,duplicates=0;
 for(const candidate of candidates){if(isResearchDuplicate(companies,candidate)){duplicates++;continue;}companies.push(researchToCompany(candidate));added++;}
 return {companies,added,duplicates};
}
