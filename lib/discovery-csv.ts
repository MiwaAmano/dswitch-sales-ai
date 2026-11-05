import Papa from 'papaparse';
import type { Evidence, ResearchCandidate } from './research';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DATASET_ROWS = 50000;
export type CsvColumn =
  | 'number'
  | 'name'
  | 'address'
  | 'industry'
  | 'employees'
  | 'website'
  | 'summary';
export const csvColumns: Record<CsvColumn, string> = {
  number: '法人番号（必須）',
  name: '企業名（必須）',
  address: '所在地',
  industry: '業種の取得表記',
  employees: '従業員数',
  website: '公式サイト',
  summary: '事業概要',
};
export type ColumnMapping = Record<CsvColumn, string>;
export type FileProvenance = { url: string; fileName: string; at: string };
const aliases: Record<CsvColumn, string[]> = {
  number: ['法人番号', 'corporate_number'],
  name: ['法人名', '企業名', 'name'],
  address: ['本社所在地', '所在地', 'location'],
  industry: ['業種', 'industry'],
  employees: ['従業員数', 'employee_number'],
  website: ['企業ホームページ', '公式サイト', 'company_url'],
  summary: ['事業概要', 'business_summary'],
};
export function suggestColumnMapping(headers: string[]): ColumnMapping {
  return Object.fromEntries(
    Object.entries(aliases).map(([key, values]) => [
      key,
      values.find((v) => headers.includes(v)) ?? '',
    ]),
  ) as ColumnMapping;
}
export function validateHeaders(headers: string[], mapping?: ColumnMapping) {
  if (
    headers.length < 2 ||
    headers.length > 200 ||
    headers.some((h) => !h || h.length > 200) ||
    new Set(headers).size !== headers.length
  )
    throw Error('列名が空・重複しているか、列数が2〜200列の範囲外です。');
  if (mapping) {
    if (!mapping.number || !mapping.name)
      throw Error('法人番号と企業名の列を指定してください。');
    const selected = Object.values(mapping).filter(Boolean);
    if (new Set(selected).size !== selected.length)
      throw Error('同じ列を複数の項目に指定しないでください。');
    if (selected.some((h) => !headers.includes(h)))
      throw Error('指定した列がファイル内にありません。');
  }
}
export function validateFileSource(url: string) {
  if (url.length > 2048)
    throw Error('出典URLは2048文字以内で指定してください。');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw Error('公式の出典ページURLを入力してください。');
  }
  if (
    u.protocol !== 'https:' ||
    ![
      'content.info.gbiz.go.jp',
      'info.gbiz.go.jp',
      'help.info.gbiz.go.jp',
    ].includes(u.hostname) ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  )
    throw Error(
      '出典はgBizINFO公式ページのHTTPS URLを指定してください。トークン等を含むクエリ・認証情報は指定できません。',
    );
  return u.href;
}
export function parseDiscoveryRecord(
  row: Record<string, string>,
  mapping: ColumnMapping,
  source: FileProvenance,
): { candidate: ResearchCandidate | null; invalidFields: number } {
  const get = (key: CsvColumn) =>
    (mapping[key] ? (row[mapping[key]] ?? '') : '').trim();
  const number = get('number'),
    name = get('name');
  if (!/^\d{13}$/.test(number) || !name || name.length > 200)
    return { candidate: null, invalidFields: 0 };
  let invalidFields = 0;
  const e = <T>(value: T): Evidence<T> => ({
    value,
    source: 'gbizinfo-download',
    sourceUrl: source.url,
    retrievedAt: source.at,
    sourceFileName: source.fileName,
  });
  const bounded = (key: CsvColumn, max: number) => {
    const v = get(key);
    if (v.length > max) {
      invalidFields++;
      return '';
    }
    return v;
  };
  const count = bounded('employees', 32);
  let employees: number | null = null;
  if (count && !['不明', '未取得', '-'].includes(count)) {
    if (/^(\d+|\d{1,3}(,\d{3})+)$/.test(count)) {
      const n = Number(count.replaceAll(',', ''));
      if (Number.isSafeInteger(n) && n >= 0) employees = n;
      else invalidFields++;
    } else invalidFields++;
  }
  const site = bounded('website', 2048);
  let website: string | null = null;
  if (site) {
    try {
      const u = new URL(site);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        throw Error();
      website = site;
    } catch {
      invalidFields++;
    }
  }
  const rawIndustry = bounded('industry', 5000);
  let industryValues = rawIndustry ? [rawIndustry] : [];
  if (rawIndustry.startsWith('[')) {
    try {
      const values: unknown = JSON.parse(rawIndustry);
      if (!Array.isArray(values) || values.some((v) => typeof v !== 'string'))
        throw Error();
      industryValues = values.map((v) => v.trim()).filter(Boolean);
    } catch {
      invalidFields++;
      industryValues = [];
    }
  }
  const address = bounded('address', 2000),
    summary = bounded('summary', 10000);
  return {
    candidate: {
      id: `gbizinfo-${number}`,
      identity: { corporateNumber: number, placeId: null },
      name: e(name),
      address: address ? e(address) : null,
      industry: industryValues.length ? e(industryValues.join(' / ')) : null,
      industryValues,
      employees: employees === null ? null : e(employees),
      website: website ? e(website) : null,
      businessSummary: summary ? e(summary) : null,
    },
    invalidFields,
  };
}
export function mergeCandidate(
  previous: ResearchCandidate,
  incoming: ResearchCandidate,
): ResearchCandidate {
  if (previous.identity.corporateNumber !== incoming.identity.corporateNumber)
    throw Error('法人番号が一致しません。');
  const conflicts = [
    ...(previous.dataConflicts ?? []),
    ...(incoming.dataConflicts ?? []),
  ];
  for (const field of [
    'name',
    'address',
    'industry',
    'employees',
    'website',
    'businessSummary',
  ] as const) {
    const old = previous[field],
      next = incoming[field];
    if (old && next && old.value !== next.value)
      conflicts.push({ field, previous: old, kept: next });
  }
  return {
    ...previous,
    ...incoming,
    address: incoming.address ?? previous.address,
    industry: incoming.industry ?? previous.industry,
    industryValues: incoming.industry
      ? incoming.industryValues
      : previous.industryValues,
    employees: incoming.employees ?? previous.employees,
    website: incoming.website ?? previous.website,
    businessSummary: incoming.businessSummary ?? previous.businessSummary,
    dataConflicts: conflicts.slice(-10),
  };
}
export class DiscoveryImport {
  staged = new Map<string, ResearchCandidate>();
  rows = 0;
  invalidRows = 0;
  invalidFields = 0;
  duplicates = 0;
  constructor(
    public mapping: ColumnMapping,
    public source: FileProvenance,
  ) {
    validateFileSource(source.url);
  }
  accept(rows: Record<string, string>[]) {
    for (const row of rows) {
      this.rows++;
      if (this.rows > MAX_DATASET_ROWS)
        throw Error(
          '1ファイルの上限50,000行を超えました。ファイルを分割してください。',
        );
      const parsed = parseDiscoveryRecord(row, this.mapping, this.source);
      this.invalidFields += parsed.invalidFields;
      if (!parsed.candidate) {
        this.invalidRows++;
        continue;
      }
      const number = parsed.candidate.identity.corporateNumber!;
      const old = this.staged.get(number);
      if (old) this.duplicates++;
      this.staged.set(
        number,
        old ? mergeCandidate(old, parsed.candidate) : parsed.candidate,
      );
    }
  }
  commit(existing: Map<string, ResearchCandidate>) {
    const merged = new Map(existing);
    let duplicateExisting = 0;
    for (const [number, c] of this.staged) {
      const old = merged.get(number);
      if (old) duplicateExisting++;
      merged.set(number, old ? mergeCandidate(old, c) : c);
    }
    if (merged.size > MAX_DATASET_ROWS)
      throw Error(
        '取込データ全体の上限50,000社を超えました。条件を絞ったファイルをご使用ください。',
      );
    return {
      data: merged,
      stats: {
        rows: this.rows,
        invalidRows: this.invalidRows,
        invalidFields: this.invalidFields,
        duplicates: this.duplicates + duplicateExisting,
        total: merged.size,
      },
    };
  }
}
export function importDiscoveryText(
  text: string,
  mapping: ColumnMapping,
  source: FileProvenance,
  existing = new Map<string, ResearchCandidate>(),
) {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
  });
  if (
    parsed.errors.length ||
    Object.keys(parsed.meta.renamedHeaders ?? {}).length
  )
    throw Error('CSVの列数・引用符・列名を確認してください。');
  validateHeaders(parsed.meta.fields ?? [], mapping);
  const pipeline = new DiscoveryImport(mapping, source);
  pipeline.accept(parsed.data);
  return pipeline.commit(existing);
}
