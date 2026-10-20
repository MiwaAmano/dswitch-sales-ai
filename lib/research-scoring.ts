import type {ResearchCandidate} from './research';
/** No code mapping is enabled without a verified gBizINFO code-system definition.
 * In particular, do NOT assume G / 39 / 3911 are JSIC codes merely from their shape.
 * Japanese names actually returned by the API can be displayed verbatim.
 */
export function describeIndustry(candidate:ResearchCandidate){
 const raw=candidate.industryValues??(candidate.industry?.value?candidate.industry.value.split(' / '):[]);
 const labels=raw.filter(v=>/[\u3040-\u30ff\u3400-\u9fff]/u.test(v));
 const unknownCodes=raw.filter(v=>!labels.includes(v));
 return {labels,unknownCodes,display:[...labels,...(unknownCodes.length?[`業種未確認（コード：${unknownCodes.join(' / ')}）`]:[])].join(' / ')||'業種未確認',basis:labels.length?'APIが返した日本語表記（コードの独自変換なし）':'公式のコード定義を未確認のため変換・業種加点なし'};
}
export const SCORE_VERSION='dswitch-office-snacks-v1';
export type SalesRank='A'|'B'|'C';
export type ScorePart={key:'industry'|'employees'|'business'|'completeness';label:string;points:number;max:number;reason:string;missing:boolean};
export type SalesScore={total:number;rank:SalesRank;parts:ScorePart[];version:typeof SCORE_VERSION;limitations:string};
export const rankForScore=(score:number):SalesRank=>score>=80?'A':score>=60?'B':'C';
const primary=['情報通信業','金融業、保険業','学術研究、専門・技術サービス業'];
const secondary=['不動産業、物品賃貸業','卸売業、小売業','教育、学習支援業'];
const normalize=(s:string)=>s.normalize('NFKC').replace(/[，,]/g,'、').replace(/\s/g,'').replace(/^[A-Z0-9.-]+[:：]/i,'');
const businessWords=['ソフトウェア','システム開発','情報処理','コンサルティング','デザイン','広告','事務','研究','受託開発'];
const isKnownEmployees=(n:number|null|undefined):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function scoreCandidate(candidate:ResearchCandidate):SalesScore{
 const industry=describeIndustry(candidate),labels=industry.labels.map(normalize);
 const high=primary.find(x=>labels.includes(normalize(x))),medium=secondary.find(x=>labels.includes(normalize(x)));
 const industryPoints=high?35:medium?20:0;
 const n=candidate.employees?.value;
 let employeePoints=0,employeeReason='従業員数が不明のため加点なし';
 if(isKnownEmployees(n)){
  employeePoints=n===0?0:n<10?10:n<20?22:n<300?30:n<1000?22:15;
  employeeReason=`API取得の従業員数${n.toLocaleString()}名：${employeePoints}点（人数帯による試作の優先順位）`;
 }
 const summary=candidate.businessSummary?.value??'',matches=businessWords.filter(w=>summary.normalize('NFKC').includes(w));
 const known=[['企業名',Boolean(candidate.name.value.trim())],['所在地',Boolean(candidate.address?.value.trim())],['業種名',industry.labels.length>0],['従業員数',isKnownEmployees(n)],['公式サイト',Boolean(candidate.website?.value)]] as const;
 const parts:ScorePart[]=[
  {key:'industry',label:'業種の親和性',points:industryPoints,max:35,reason:high||medium?`APIの業種表記「${high??medium}」が対象業種ルールに一致。実際の働き方は未確認`:industry.labels.length?'取得した業種名は対象ルールに一致しないため加点なし':'業種未確認のため加点なし',missing:!industry.labels.length},
  {key:'employees',label:'従業員規模',points:employeePoints,max:30,reason:employeeReason,missing:!isKnownEmployees(n)},
  {key:'business',label:'事業内容の親和性',points:Math.min(matches.length*10,20),max:20,reason:summary?matches.length?`取得した事業概要に「${matches.join('」「')}」を含む（1語10点、上限20点）。文脈・働き方は未確認`:'取得した事業概要に対象語がないため加点なし':'事業概要が未取得のため加点なし',missing:!summary},
  {key:'completeness',label:'企業情報の充実度',points:known.filter(([,ok])=>ok).length*3,max:15,reason:`各3点：${known.map(([name,ok])=>`${name}${ok?'あり':'未確認'}`).join('・')}`,missing:known.some(([,ok])=>!ok)},
 ];
 const total=parts.reduce((sum,p)=>sum+p.points,0);
 return {total,rank:rankForScore(total),parts,version:SCORE_VERSION,limitations:'営業先の優先順位を付ける試作スコアです。成約確率や導入可否ではありません。デスクワーク比率・出社率・福利厚生の導入状況は未確認です。未取得による低得点は不適合を意味しません。'};
}
export const employeeOptions=[['all','すべて（不明を含む）'],['unknown','不明（未取得）のみ'],['known','人数取得済みのみ'],['0-9','0〜9名'],['10-19','10〜19名'],['20-49','20〜49名'],['50-99','50〜99名'],['100-299','100〜299名'],['300-999','300〜999名'],['1000+','1,000名以上']] as const;
export type EmployeeFilter=typeof employeeOptions[number][0];
export type ResearchSort='api'|'score-desc'|'score-asc';
export function selectResearchCandidates(candidates:ResearchCandidate[],employees:EmployeeFilter,rank:SalesRank|'',sort:ResearchSort){
 const rows=candidates.map((candidate,index)=>({candidate,index,score:scoreCandidate(candidate)})).filter(({candidate,score})=>{
  if(rank&&score.rank!==rank)return false;
  const n=candidate.employees?.value,known=isKnownEmployees(n);
  if(employees==='unknown')return !known;if(employees==='all')return true;if(!known)return false;if(employees==='known')return true;if(employees==='1000+')return n>=1000;
  const [min,max]=employees.split('-').map(Number);return n>=min&&n<=max;
 });
 if(sort!=='api')rows.sort((a,b)=>(sort==='score-desc'?b.score.total-a.score.total:a.score.total-b.score.total)||a.index-b.index);
 return rows;
}
export function exportResearchCSV(candidates:ResearchCandidate[]):string{
 const rows:unknown[][]=[['企業名','法人番号','所在地','業種','業種の取得表記','従業員数','公式サイト','営業適性スコア','ランク','業種の親和性（35点）','従業員規模（30点）','事業内容の親和性（20点）','企業情報の充実度（15点）','評価理由','評価上の注意','取得元','元データの出典','取得日時','評価ルール']];
 for(const c of candidates){const score=scoreCandidate(c);rows.push([c.name.value,c.identity.corporateNumber??'未取得',c.address?.value??'未取得',describeIndustry(c).display,c.industry?.value??'未取得',c.employees?.value??'不明',c.website?.value??'未取得',score.total,score.rank,...score.parts.map(p=>p.points),score.parts.map(p=>`${p.label}：${p.reason}`).join('\n'),score.limitations,c.name.sourceUrl,[...new Set([c.name,c.address,c.industry,c.website,c.employees,c.businessSummary].flatMap(e=>e?.upstreamSource?[e.upstreamSource]:[]))].join(' / ')||'未取得',c.name.retrievedAt,score.version]);}
 const escape=(value:unknown)=>{let s=String(value??'');if(/^[\s]*[=+@\-]/u.test(s)||/^[\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(row=>row.map(escape).join(',')).join('\r\n');
}
