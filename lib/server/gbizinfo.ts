import { prefectures } from '../prefectures';
import type { Evidence, ResearchCandidate } from '../research';
export const GBIZINFO_API = 'https://api.info.gbiz.go.jp/hojin/v2/hojin';
export const GBIZINFO_OFFICIAL = 'https://content.info.gbiz.go.jp/api/index.html';
export const PAGE_SIZE = 10;
export const MAX_PAGE = 10;
export class GbizinfoError extends Error {
  constructor(public code:string,message:string,public status=502,public upstreamStatus?:number){super(message);}
}
export function getGbizinfoReadiness(token:string|undefined){
 const configured=Boolean(token?.trim());
 return {provider:'gbizinfo',ready:configured,keyConfigured:configured,code:configured?'CONFIGURED':'KEY_MISSING',message:configured?'APIトークンを読み込みました。企業検索を実行して接続を確認してください（トークンの有効性は未検証です）。':'gBizINFOのAPIトークンが未設定です。.env.localに設定してアプリを再起動してください。サンプル企業は表示しません。',officialUrl:GBIZINFO_OFFICIAL};
}
export type GbizinfoQuery={keyword:string;area:string;industry:string;page:number};
export function validateGbizinfoQuery(value:unknown):GbizinfoQuery{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GbizinfoError('INVALID_QUERY','検索条件を確認してください。',400);
 const v=value as Record<string,unknown>;
 for(const key of ['keyword','area','industry'])if(typeof v[key]!=='string'||(v[key] as string).length>100)throw new GbizinfoError('INVALID_QUERY','検索条件は各100文字以内で入力してください。',400);
 const q={keyword:(v.keyword as string).trim(),area:(v.area as string).trim(),industry:(v.industry as string).trim(),page:v.page===undefined?1:v.page};
 if(q.area&&!prefectures.includes(q.area))throw new GbizinfoError('INVALID_QUERY','都道府県を選択してください。',400);
 if(!q.keyword&&!q.area)throw new GbizinfoError('INVALID_QUERY','法人名または都道府県を指定してください。全国の場合は法人名が必要です。',400);
 if(typeof q.page!=='number'||!Number.isInteger(q.page)||q.page<1||q.page>MAX_PAGE)throw new GbizinfoError('INVALID_QUERY',`ページ番号は1〜${MAX_PAGE}で指定してください。`,400);
 return q as GbizinfoQuery;
}
export type GbizinfoSearchResult={candidates:ResearchCandidate[];page:number;hasNextPage:boolean;scannedCount:number;detailFailures:number;warnings:string[];fetchedAt:string};
type Fetcher=typeof fetch;
type RecordValue=Record<string,unknown>;
const record=(v:unknown):v is RecordValue=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function text(v:unknown):string|null{return typeof v==='string'&&v.trim()?v.trim():null;}
function website(v:unknown):string|null{const s=text(v);if(!s)return null;try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?s:null;}catch{return null;}}
function throwHttp(status:number):never{
 if(status===401)throw new GbizinfoError('AUTH_FAILED','gBizINFOが認証を拒否しました（401）。トークンの有効性とコピー漏れを確認してください。',401,status);
 if(status===403)throw new GbizinfoError('ACCESS_DENIED','アクセスが拒否されました（403）。API利用権限、接続先の通信許可、サービス側の制限を確認してください。トークン不正とは限りません。',403,status);
 if(status===429)throw new GbizinfoError('RATE_LIMIT','gBizINFOの利用制限に達しました（429）。時間をおいて再検索してください。自動再試行は行いません。',429,status);
 if(status===400)throw new GbizinfoError('UPSTREAM_QUERY','gBizINFOが検索条件を受け付けませんでした（400）。条件を減らして再検索してください。',400,status);
 if(status===404)throw new GbizinfoError('ENDPOINT_NOT_FOUND','gBizINFOの接続先または法人詳細が見つかりません（404）。API v2の仕様変更もご確認ください。',502,status);
 throw new GbizinfoError('UPSTREAM_ERROR',`gBizINFOでエラーが発生しました（HTTP ${status}）。時間をおいて再検索してください。`,502,status);
}
async function api(url:URL,token:string,fetcher:Fetcher,signal:AbortSignal):Promise<RecordValue[]>{
 let response:Response;
 try{response=await fetcher(url,{headers:{'X-hojinInfo-api-token':token,Accept:'application/json'},cache:'no-store',redirect:'error',signal});}
 catch{if(signal.aborted)throw new GbizinfoError('TIMEOUT','検索が中断されたか、制限時間を超えました。条件を絞って再検索してください。',504);throw new GbizinfoError('NETWORK_ERROR','gBizINFOへ接続できません。インターネット、プロキシ、api.info.gbiz.go.jpの通信許可を確認してください。',502);}
 if(!response.ok)throwHttp(response.status);
 let payload:unknown;try{payload=await response.json();}catch{throw new GbizinfoError('INVALID_RESPONSE','gBizINFOの応答がJSON形式ではありません。サービスの障害や通信制限をご確認ください。');}
 if(!record(payload))throw new GbizinfoError('INVALID_RESPONSE','gBizINFOの応答形式が想定と異なります。API v2の仕様をご確認ください。');
 if(Array.isArray(payload.errors)&&payload.errors.length)throw new GbizinfoError('API_REJECTED','gBizINFOがエラー情報を返しました。トークンと検索条件をご確認ください。');
 if(!Array.isArray(payload['hojin-infos'])||payload['hojin-infos'].some(v=>!record(v)))throw new GbizinfoError('INVALID_RESPONSE','gBizINFOの応答に法人情報の配列がありません。API v2の仕様をご確認ください。');
 return payload['hojin-infos'] as RecordValue[];
}
export function normalizeGbizinfo(base:RecordValue,detail:RecordValue|null,at:string):ResearchCandidate{
 const number=text(base.corporate_number),name=text(detail?.name)??text(base.name);
 if(!number||!/^\d{13}$/.test(number)||!name)throw new GbizinfoError('INVALID_RESPONSE','法人番号または法人名が欠けた応答のため登録できません。');
 const sourceUrl=`${GBIZINFO_API}/${number}`;
 const e=<T>(value:T,url=sourceUrl,field='name'):Evidence<T>=>{
  const meta=url===sourceUrl?detail?.['meta-data']:base['meta-data'];
  const original=record(meta)?record(meta.source)?text(meta.source[field]):text(meta.source):null;
  return {value,source:'gbizinfo',sourceUrl:url,retrievedAt:at,...(original?{upstreamSource:original}:{})};
 };
 const industry=Array.isArray(detail?.industry)?detail.industry.filter((v):v is string=>typeof v==='string'&&Boolean(v.trim())).join(' / '):null;
 const employees=detail?.employee_number;
 const location=text(detail?.location)??text(base.location);
 const url=website(detail?.company_url);
 return {id:`gbizinfo-${number}`,identity:{corporateNumber:number,placeId:null},name:e(name,text(detail?.name)?sourceUrl:GBIZINFO_API),address:location?e(location,text(detail?.location)?sourceUrl:GBIZINFO_API,'location'):null,industry:industry?e(industry,sourceUrl,'industry'):null,website:url?e(url,sourceUrl,'company_url'):null,employees:typeof employees==='number'&&Number.isSafeInteger(employees)&&employees>=0?e(employees,sourceUrl,'employee_number'):null,businessSummary:text(detail?.business_summary)?e(text(detail?.business_summary)!,sourceUrl,'business_summary'):null};
}
/** No samples, automatic retries, arbitrary URLs or key logging. At most 1+10 requests per page. */
export async function searchGbizinfo(q:GbizinfoQuery,token:string|undefined,options:{fetcher?:Fetcher;signal?:AbortSignal}={}):Promise<GbizinfoSearchResult>{
 const key=token?.trim();if(!key)throw new GbizinfoError('KEY_MISSING',getGbizinfoReadiness(token).message,503);
 if(/[^\x21-\x7e]/.test(key))throw new GbizinfoError('TOKEN_FORMAT','トークンに空白・改行・全角文字が含まれています。.env.localの値を確認してください。',400);
 const timeout=AbortSignal.timeout(25000),stop=new AbortController(),signal=AbortSignal.any([timeout,stop.signal,...(options.signal?[options.signal]:[])]),fetcher=options.fetcher??fetch;
 const url=new URL(GBIZINFO_API);if(q.keyword)url.searchParams.set('name',q.keyword);
 if(q.area)url.searchParams.set('prefecture',String(prefectures.indexOf(q.area)+1).padStart(2,'0'));
 url.searchParams.set('page',String(q.page));url.searchParams.set('limit',String(PAGE_SIZE));url.searchParams.set('metadata_flg','true');
 const raw=await api(url,key,fetcher,signal);if(raw.length>PAGE_SIZE)throw new GbizinfoError('INVALID_RESPONSE','APIが件数上限を超える結果を返しました。仕様をご確認ください。');
 const at=new Date().toISOString();let detailFailures=0;const candidates:ResearchCandidate[]=[];let cursor=0;
 try{await Promise.all(Array.from({length:Math.min(3,raw.length)},async()=>{while(cursor<raw.length&&!signal.aborted){const index=cursor++,base=raw[index],number=text(base.corporate_number);if(!number||!/^\d{13}$/.test(number))throw new GbizinfoError('INVALID_RESPONSE','法人番号の形式が不正です。');let detail:RecordValue|null=null;
 try{const rows=await api(new URL(`${GBIZINFO_API}/${number}?metadata_flg=true`),key,fetcher,signal);detail=rows.find(r=>r.corporate_number===number)??null;if(!detail)detailFailures++;}
 catch(e){if(e instanceof GbizinfoError&&['AUTH_FAILED','ACCESS_DENIED','RATE_LIMIT','TIMEOUT'].includes(e.code))throw e;detailFailures++;}
 candidates[index]=normalizeGbizinfo(base,detail,at);
 }}));}catch(error){stop.abort();throw error;}
 if(signal.aborted)throw new GbizinfoError('TIMEOUT','検索が中断されたか、制限時間を超えました。',504);
 const needle=q.industry.normalize('NFKC').toLocaleLowerCase();
 const filtered=needle?candidates.filter(c=>`${c.industry?.value??''} ${c.businessSummary?.value??''}`.normalize('NFKC').toLocaleLowerCase().includes(needle)):candidates;
 const warnings:string[]=[];if(detailFailures)warnings.push(`${detailFailures}社の詳細を取得できませんでした。該当企業の業種・サイト・従業員数は未取得です。再検索で改善する場合があります。`);
 if(needle)warnings.push('業種条件は、このページで取得した業種・事業概要の部分一致です。全国の全法人への業種検索ではありません。情報がない企業は一致に含めません。');
 return {candidates:filtered,page:q.page,hasNextPage:raw.length===PAGE_SIZE&&q.page<MAX_PAGE,scannedCount:raw.length,detailFailures,warnings,fetchedAt:at};
}
