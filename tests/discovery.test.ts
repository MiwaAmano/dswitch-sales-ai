import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  importDiscoveryText,
  suggestColumnMapping,
  validateHeaders,
  validateFileSource,
  mergeCandidate,
  DiscoveryImport,
} from '../lib/discovery-csv';
import {
  discoverCandidates,
  defaultDiscoveryFilters,
  conditionStatus,
  informationStatus,
  exportDiscoveryCSV,
} from '../lib/discovery';
import { parseCSV } from '../lib/sales';
import {
  researchToCompany,
  isResearchDuplicate,
} from '../lib/research-company';
const header = [
  '法人番号',
  '法人名',
  '所在地',
  '業種',
  '従業員数',
  '企業ホームページ',
  '事業概要',
];
const mapping = suggestColumnMapping(header);
const source = {
  url: 'https://content.info.gbiz.go.jp/',
  fileName: 'unit-fixtures.csv',
  at: '2026-10-20T00:00:00Z',
};
const row = (
  i: number,
  n = '100',
  industry = '情報通信業',
  summary = 'ソフトウェア システム開発',
) => [
  String(1234567890000 + i),
  `単体試験用架空法人${i}`,
  '東京都千代田区',
  industry,
  n,
  'https://example.com',
  summary,
];
const csv = (rows: string[][]) =>
  [header, ...rows]
    .map((r) => r.map((v) => '"' + v.replaceAll('"', '""') + '"').join(','))
    .join('\r\n');
const load = (rows: string[][]) =>
  importDiscoveryText(csv(rows), mapping, source);
test('CSV pipeline yields exactly 100 sourced unique candidates from 150 matches without generation', () => {
  const imported = load(Array.from({ length: 150 }, (_, i) => row(i)));
  const result = discoverCandidates(
    imported.data.values(),
    defaultDiscoveryFilters,
  );
  assert.equal(result.acquired, 150);
  assert.equal(result.matched, 150);
  assert.equal(result.rows.length, 100);
  assert.equal(result.shortage, 0);
  assert.equal(result.rankCounts.A, 100);
  for (const r of result.rows) {
    assert.ok(imported.data.has(r.candidate.identity.corporateNumber!));
    assert.equal(r.candidate.name.source, 'gbizinfo-download');
    assert.equal(r.candidate.name.sourceFileName, 'unit-fixtures.csv');
  }
  assert.ok(result.reasons[0].includes('網羅'));
});
test('unknown employee or industry is pending, not matching nor a fabricated bad company', () => {
  const imported = load([
    row(1),
    row(2, ''),
    row(3, '100', 'G', ''),
    row(4, '5'),
  ]);
  const r = discoverCandidates(imported.data.values(), defaultDiscoveryFilters);
  assert.equal(r.matched, 1);
  assert.equal(r.conditionPending, 2);
  assert.equal(r.excluded, 1);
  assert.equal(r.shortage, 99);
  assert.ok(r.reasons[0].includes('条件未確認2社'));
});
test('all supported targets and employee boundaries are enforced, not API params', () => {
  const d = load(Array.from({ length: 120 }, (_, i) => row(i))).data;
  for (const target of [10, 30, 50, 100] as const)
    assert.equal(
      discoverCandidates(d.values(), { ...defaultDiscoveryFilters, target })
        .rows.length,
      target,
    );
  const c = load([row(1, '500')])
    .data.values()
    .next().value!;
  assert.equal(
    conditionStatus(c, { ...defaultDiscoveryFilters, size: '300-500' }),
    'match',
  );
  assert.equal(
    conditionStatus(c, { ...defaultDiscoveryFilters, size: '501+' }),
    'excluded',
  );
  assert.equal(
    conditionStatus(c, { ...defaultDiscoveryFilters, area: '大阪府' }),
    'excluded',
  );
  assert.throws(() =>
    discoverCandidates(d.values(), {
      ...defaultDiscoveryFilters,
      target: 101 as 100,
    }),
  );
});
test('same corporate number merges nonmissing fields, records conflicts and keeps item provenance', () => {
  const a = load([row(1, '100')])
    .data.values()
    .next().value!;
  const b = load([row(1, '200')])
    .data.values()
    .next().value!;
  b.employees = {
    ...b.employees!,
    source: 'gbizinfo',
    sourceUrl: 'https://api.info.gbiz.go.jp/hojin/v2/hojin/1234567890001',
  };
  b.website = null;
  const merged = mergeCandidate(a, b);
  assert.equal(merged.employees?.value, 200);
  assert.equal(merged.employees?.source, 'gbizinfo');
  assert.equal(merged.website?.source, 'gbizinfo-download');
  assert.ok(
    merged.dataConflicts?.some(
      (d) => d.field === 'employees' && d.previous.value === 100,
    ),
  );
  assert.equal(informationStatus(merged).pending, true);
  const duplicate = load([row(1), row(1)]);
  assert.equal(duplicate.data.size, 1);
  assert.equal(duplicate.stats.duplicates, 1);
});
test('CSV column mapping and field validation do not guess missing or malformed values', () => {
  assert.throws(() => validateHeaders(['法人番号', '法人番号']));
  assert.throws(() => validateHeaders(header, { ...mapping, name: '' }));
  assert.throws(() =>
    importDiscoveryText('法人番号,法人名\n"bad', mapping, source),
  );
  const r = load([
    row(1, 'not-a-number'),
    row(2, '0'),
    ['bad', 'name', '', '', '', '', ''],
  ]);
  assert.equal(r.stats.invalidRows, 1);
  assert.equal(r.stats.invalidFields, 1);
  assert.equal(r.data.get('1234567890001')?.employees, null);
  assert.equal(r.data.get('1234567890002')?.employees?.value, 0);
  assert.throws(() => validateFileSource('https://example.com'));
  assert.throws(() =>
    validateFileSource('https://content.info.gbiz.go.jp/?token=bad'),
  );
});
test('transaction limit rejects import without clearing previously loaded data', () => {
  const old = load([row(1)]).data;
  const p = new DiscoveryImport(mapping, source);
  p.rows = 50000;
  assert.throws(() =>
    p.accept([Object.fromEntries(header.map((h, i) => [h, row(2)[i]]))]),
  );
  assert.equal(old.size, 1);
});
test('existing corporate IDs and legacy same names are excluded before selecting top 100', () => {
  const d = load([row(1), row(2), row(3)]).data;
  const r = discoverCandidates(d.values(), defaultDiscoveryFilters, {
    numbers: ['1234567890001'],
    names: ['単体試験用架空法人2'],
  });
  assert.equal(r.alreadyRegistered, 2);
  assert.equal(r.rows.length, 1);
  const company = researchToCompany(r.rows[0].candidate);
  assert.ok(company.notes.includes('ダウンロードCSV'));
  assert.ok(
    isResearchDuplicate(
      [{ ...company, name: '変更後の社名' }],
      r.rows[0].candidate,
    ),
  );
});
test('CSV export carries required columns, unknown information, scores, sources and no raw spreadsheet formulas', () => {
  const d = load([row(1, '100', 'G', 'ソフトウェア システム開発')]).data;
  const r = discoverCandidates(d.values(), defaultDiscoveryFilters);
  assert.equal(r.assessmentPending, 1);
  assert.equal(
    informationStatus(r.rows[0].candidate).missing.includes('業種'),
    true,
  );
  r.rows[0].candidate.name.value = '=HYPERLINK("bad")';
  const [h, v] = parseCSV(exportDiscoveryCSV(r.rows));
  for (const name of [
    '都道府県',
    '営業適性スコア',
    'ランク',
    '情報充実度',
    '評価理由',
    'データ取得元',
    '取得日時',
  ])
    assert.ok(h.includes(name));
  assert.equal(v[h.indexOf('都道府県')], '東京都');
  assert.ok(v[0].startsWith("'="));
  assert.ok(v[h.indexOf('項目別取得元')].includes('unit-fixtures.csv'));
});
test('category word matching does not infer work style from company name or code alone', () => {
  const c = load([row(1, '100', 'G', '')])
    .data.values()
    .next().value!;
  c.name.value = 'ソフトウェア IT WEB制作';
  assert.equal(conditionStatus(c, defaultDiscoveryFilters), 'pending');
  const digital = load([row(2, '100', '', 'DIGITALのみ')])
    .data.values()
    .next().value!;
  assert.equal(
    conditionStatus(digital, { ...defaultDiscoveryFilters, category: 'it' }),
    'excluded',
  );
});

test('bulk registration is prepared atomically with duplicates removed and old history/drafts untouched', async () => {
  const { prepareResearchBatch } = await import('../lib/research-company');
  const data = load([row(1), row(2)]).data;
  const candidates = [...data.values()];
  const old = researchToCompany(candidates[0]);
  old.draft = { subject: '旧件名', body: '旧本文' };
  const snapshot = JSON.stringify(old);
  const batch = prepareResearchBatch([old], [...candidates, candidates[1]]);
  assert.equal(batch.added, 1);
  assert.equal(batch.duplicates, 2);
  assert.equal(batch.companies.length, 2);
  assert.equal(JSON.stringify(old), snapshot);
  assert.equal(batch.companies[0], old);
  assert.throws(() =>
    prepareResearchBatch(
      [old],
      Array.from({ length: 101 }, () => candidates[1]),
    ),
  );
});
