import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGbizinfo} from '../lib/server/gbizinfo';
import {researchToCompany,isResearchDuplicate} from '../lib/research-company';
import {generateMail,exportCSV,importCSV,sampleCompanies} from '../lib/sales';
const c=normalizeGbizinfo({corporate_number:'1234567890123',name:'テスト用の架空法人',location:'東京都'},null,'2026-10-20T00:00:00Z');
test('import adds source and status without overwriting existing companies, history or draft',()=>{
 const original=sampleCompanies();original[0].draft={subject:'既存の件名',body:'既存の下書き'};const before=JSON.stringify(original);const company=researchToCompany(c);assert.equal(company.employees,null);assert.equal(company.status,'未接触');assert.equal(company.contact,'');assert.equal(company.research?.identity.corporateNumber,'1234567890123');assert.ok(company.notes.includes('gBizINFO'));assert.equal(JSON.stringify(original),before);assert.equal(isResearchDuplicate([...original,company],c),true);assert.equal(isResearchDuplicate(original,c),false);assert.equal(isResearchDuplicate([{...company,name:'名称変更'}],c),true);
});
test('unknown employees and industry remain absent in draft and CSV; real zero survives CSV',()=>{
 const company=researchToCompany(c);const mail=generateMail(company);assert.ok(!mail.body.includes('0名'));assert.ok(!mail.body.includes('null'));assert.ok(!mail.body.includes('未取得業界'));const restored=importCSV(exportCSV([company]))[0];assert.equal(restored.employees,null);assert.ok(restored.notes.includes('1234567890123'));const zero=importCSV(exportCSV([{...company,employees:0}]))[0];assert.equal(zero.employees,0);
});
