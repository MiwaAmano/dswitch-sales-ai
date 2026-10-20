import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGbizinfoReadiness, validateGbizinfoQuery } from '../lib/server/gbizinfo';
import {prefectures} from '../lib/prefectures';
import {GET, POST} from '../app/api/research/gbizinfo/route';
test('no-key and documentation-pending states never expose token or claim readiness',()=>{
 const status=getGbizinfoReadiness(undefined);assert.equal(status.code,'KEY_MISSING');assert.equal(status.ready,false);
 const secret='unit-test-not-a-real-token';const configured=getGbizinfoReadiness(secret);assert.equal(configured.code,'DOCUMENTATION_PENDING');assert.equal(configured.ready,false);assert.ok(!JSON.stringify(configured).includes(secret));assert.equal(getGbizinfoReadiness('   ').keyConfigured,false);
});
test('all 47 prefectures are unique; query validation does not allow unrestricted or malformed input',()=>{
 assert.equal(prefectures.length,47);assert.equal(new Set(prefectures).size,47);
 assert.deepEqual(validateGbizinfoQuery({area:'東京都',keyword:'  法人  ',industry:''}),{area:'東京都',keyword:'法人',industry:''});
 for(const query of [null,[],{}, {area:'',keyword:'',industry:''},{area:'海外',keyword:'会社',industry:''},{area:'',keyword:'x'.repeat(101),industry:''}])assert.throws(()=>validateGbizinfoQuery(query));
});
test('server API GET never caches readiness and POST never returns sample companies',async()=>{
 const response=await GET();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((await response.json()).ready,false);
 const result=await POST(new Request('http://localhost/api/research/gbizinfo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area:'東京都',keyword:'法人',industry:''})}));assert.equal(result.status,503);const data=await result.json();assert.ok(['KEY_MISSING','DOCUMENTATION_PENDING'].includes(data.code));assert.equal(data.candidates,undefined);assert.equal(data.ready,false);
});
test('server API rejects invalid JSON, unbounded queries, and cross-origin requests',async()=>{
 const post=(body:string,origin?:string)=>POST(new Request('http://localhost/api/research/gbizinfo',{method:'POST',headers:origin?{origin}:{},body}));
 assert.equal((await post('{bad')).status,400);assert.equal((await post('x'.repeat(2049))).status,413);assert.equal((await post('{}','https://untrusted.example')).status,403);
});

test('loopback Host remains same-origin when Next.js normalizes the URL',async()=>{
 const result=await POST(new Request('http://localhost:3001/api/research/gbizinfo',{method:'POST',headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001'},body:JSON.stringify({area:'東京都',keyword:'',industry:''})}));assert.equal(result.status,503);assert.notEqual((await result.json()).code,'ORIGIN_DENIED');
});
