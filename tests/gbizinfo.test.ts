import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getGbizinfoReadiness,validateGbizinfoQuery,searchGbizinfo,normalizeGbizinfo,GBIZINFO_API} from '../lib/server/gbizinfo';
import {prefectures} from '../lib/prefectures';
import {GET,POST} from '../app/api/research/gbizinfo/route';
const token='test-fixture-only-not-a-real-token';
const base={corporate_number:'1234567890123',name:'テスト専用架空企業',location:'東京都'};
const detail={...base,company_url:'https://example.com',employee_number:42,industry:['情報通信業'],business_summary:'テスト用ソフトウェア事業','meta-data':{source:{name:'試験用名称出典',industry:'試験用業種出典'}}};
const q={keyword:'テスト',area:'東京都',industry:'',page:1};
const response=(rows:unknown[])=>Response.json({'hojin-infos':rows});
test('readiness reports presence, never validity or token value; no key makes zero network calls',async()=>{
 assert.equal(getGbizinfoReadiness(undefined).ready,false);assert.equal(getGbizinfoReadiness(token).ready,true);assert.ok(!JSON.stringify(getGbizinfoReadiness(token)).includes(token));
 let calls=0;await assert.rejects(()=>searchGbizinfo(q,undefined,{fetcher:async()=>{calls++;return response([])}}),{code:'KEY_MISSING'});assert.equal(calls,0);
});
test('query validates 47 prefectures, trimmed name, bounded pages and disallows industry-only nationwide crawl',()=>{
 assert.equal(prefectures.length,47);assert.equal(new Set(prefectures).size,47);assert.deepEqual(validateGbizinfoQuery({...q,keyword:' 名称 '}),{...q,keyword:'名称'});
 for(const v of [null,[],{}, {...q,area:'海外'},{...q,page:0},{...q,page:11},{...q,page:'1'},{...q,keyword:'x'.repeat(101)},{...q,keyword:'',area:'',industry:'IT'}])assert.throws(()=>validateGbizinfoQuery(v));
});
test('v2 URL, prefecture code, header, no caching, and detail enrichment follow reference schema',async()=>{
 const calls:{url:URL;init:RequestInit|undefined}[]=[];
 const data=await searchGbizinfo(q,token,{fetcher:async(url,init)=>{const u=new URL(String(url));calls.push({url:u,init});return response(u.pathname.endsWith('/1234567890123')?[detail]:[base]);}});
 assert.equal(calls.length,2);assert.equal(calls[0].url.origin,'https://api.info.gbiz.go.jp');assert.equal(calls[0].url.pathname,'/hojin/v2/hojin');assert.equal(calls[0].url.searchParams.get('prefecture'),'13');assert.equal(calls[0].url.searchParams.get('name'),'テスト');assert.equal(calls[0].url.searchParams.get('limit'),'10');assert.equal(calls[0].init?.cache,'no-store');assert.equal(calls[0].init?.redirect,'error');assert.equal(new Headers(calls[0].init?.headers).get('X-hojinInfo-api-token'),token);
 assert.equal(data.candidates[0].name.upstreamSource,'試験用名称出典');assert.equal(data.candidates[0].industry?.upstreamSource,'試験用業種出典');assert.equal(data.candidates[0].employees?.value,42);assert.equal(data.candidates[0].industry?.value,'情報通信業');assert.equal(data.candidates[0].website?.value,'https://example.com');assert.equal(data.candidates[0].name.sourceUrl,GBIZINFO_API+'/1234567890123');assert.ok(!JSON.stringify(data).includes(token));
});
test('industry is an explicit page-local filter; does not send nonexistent industry API parameter',async()=>{
 const data=await searchGbizinfo({...q,industry:'ソフトウェア'},token,{fetcher:async(url)=>{const u=new URL(String(url));assert.equal(u.searchParams.has('industry'),false);return response(u.pathname.endsWith('/1234567890123')?[detail]:[base]);}});assert.equal(data.candidates.length,1);assert.equal(data.scannedCount,1);assert.ok(data.warnings[0].includes('このページ'));
 const none=await searchGbizinfo({...q,industry:'金融'},token,{fetcher:async(url)=>response(String(url).includes('/1234567890123')?[detail]:[base])});assert.equal(none.candidates.length,0);
});
test('missing fields stay null, actual zero retained, unsafe website rejected, no invented name',()=>{
 const c=normalizeGbizinfo(base,null,'2026-10-20T00:00:00Z');assert.equal(c.employees,null);assert.equal(c.website,null);assert.equal(c.industry,null);assert.equal(c.name.sourceUrl,GBIZINFO_API);
 assert.equal(normalizeGbizinfo(base,{...detail,employee_number:0},'x').employees?.value,0);assert.equal(normalizeGbizinfo(base,{...detail,employee_number:-1,company_url:'javascript:alert(1)'},'x').website,null);assert.throws(()=>normalizeGbizinfo({corporate_number:'bad'},null,'x'));
});
test('partial detail failure keeps sourced base fields but warns and does not fabricate details',async()=>{
 const result=await searchGbizinfo(q,token,{fetcher:async url=>String(url).includes('/1234567890123')?new Response('Unavailable',{status:500}):response([base])});assert.equal(result.detailFailures,1);assert.equal(result.candidates[0].employees,null);assert.equal(result.candidates[0].name.sourceUrl,GBIZINFO_API);assert.ok(result.warnings.length);
});
test('HTTP errors, 200 error envelope, wrong JSON and network failures are safe and distinguishable',async()=>{
 for(const [status,code] of [[401,'AUTH_FAILED'],[403,'ACCESS_DENIED'],[429,'RATE_LIMIT'],[500,'UPSTREAM_ERROR'],[404,'ENDPOINT_NOT_FOUND']] as const)await assert.rejects(()=>searchGbizinfo(q,token,{fetcher:async()=>new Response(token,{status})}),e=>{const error=e as Error&{code:string};assert.equal(error.code,code);assert.ok(!error.message.includes(token));return true});
 await assert.rejects(()=>searchGbizinfo(q,token,{fetcher:async()=>Response.json({errors:[{message:token}]})}),{code:'API_REJECTED'});
 await assert.rejects(()=>searchGbizinfo(q,token,{fetcher:async()=>Response.json({unknown:[]})}),{code:'INVALID_RESPONSE'});
 await assert.rejects(()=>searchGbizinfo(q,token,{fetcher:async()=>new Response('HTML')}),{code:'INVALID_RESPONSE'});
 await assert.rejects(()=>searchGbizinfo(q,token,{fetcher:async()=>{throw Error(token)}}),{code:'NETWORK_ERROR'});
});
test('zero search is valid and does not fetch details; aborted request does not masquerade as zero results',async()=>{
 let calls=0;const r=await searchGbizinfo(q,token,{fetcher:async()=>{calls++;return response([])}});assert.equal(calls,1);assert.equal(r.candidates.length,0);assert.equal(r.hasNextPage,false);
 const abort=new AbortController();abort.abort();await assert.rejects(()=>searchGbizinfo(q,token,{signal:abort.signal,fetcher:async()=>{throw Error('aborted')}}),{code:'TIMEOUT'});
});
test('server API no key is non-cacheable and returns no sample results; rejects invalid and cross-origin requests',async()=>{
 const original=process.env.GBIZINFO_API_TOKEN;delete process.env.GBIZINFO_API_TOKEN;
 try{const status=await GET();assert.equal(status.headers.get('Cache-Control'),'no-store');assert.equal((await status.json()).ready,false);
 const post=(body:string,headers:Record<string,string>={})=>POST(new Request('http://localhost/api/research/gbizinfo',{method:'POST',headers,body}));
 const r=await post(JSON.stringify(q));assert.equal(r.status,503);assert.equal((await r.json()).code,'KEY_MISSING');assert.equal((await post('{bad')).status,400);assert.equal((await post('x'.repeat(2049))).status,413);assert.equal((await post('{}',{origin:'https://bad.example'})).status,403);
 const local=await POST(new Request('http://localhost:3001/api/research/gbizinfo',{method:'POST',headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001'},body:JSON.stringify(q)}));assert.equal(local.status,503);
 }finally{if(original===undefined)delete process.env.GBIZINFO_API_TOKEN;else process.env.GBIZINFO_API_TOKEN=original;}
});
