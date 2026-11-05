import type { ResearchCandidate } from './research';
import {
  describeIndustry,
  scoreCandidate,
  type SalesScore,
} from './research-scoring';
import { prefectures } from './prefectures';
export const discoveryCategories = [
  ['desktop', 'デスクワーク関連候補（対象5分類）'],
  ['it', 'IT・ソフトウェア'],
  ['advertising', '広告・マーケティング'],
  ['consulting', 'コンサルティング'],
  ['staffing', '人材サービス'],
  ['web', 'Web制作'],
  ['other', 'その他（取得情報あり）'],
] as const;
export const discoverySizes = [
  ['50-500', '50〜500名（初期設定）'],
  ['10-49', '10〜49名'],
  ['50-99', '50〜99名'],
  ['100-299', '100〜299名'],
  ['300-500', '300〜500名'],
  ['501+', '501名以上'],
] as const;
export type DiscoveryFilters = {
  area: string;
  category: (typeof discoveryCategories)[number][0];
  size: (typeof discoverySizes)[number][0];
  target: 10 | 30 | 50 | 100;
};
export const defaultDiscoveryFilters: DiscoveryFilters = {
  area: '',
  category: 'desktop',
  size: '50-500',
  target: 100,
};
export function prefectureOf(c: ResearchCandidate): string | null {
  return prefectures.find((p) => c.address?.value.startsWith(p)) ?? null;
}
const terms = {
  it: ['IT', 'ソフトウェア', 'システム開発', '情報処理', '情報通信業'],
  advertising: ['広告', 'マーケティング', '市場調査'],
  consulting: ['コンサルティング', '経営相談'],
  staffing: ['人材', '職業紹介', '労働者派遣'],
  web: [
    'WEB制作',
    'WEB開発',
    'WEBデザイン',
    'WEBサイト',
    'ウェブ制作',
    'ホームページ制作',
    'サイト制作',
  ],
} as const;
export function conditionStatus(
  c: ResearchCandidate,
  f: DiscoveryFilters,
): 'match' | 'pending' | 'excluded' {
  const states: ('yes' | 'no' | 'unknown')[] = [];
  if (f.area) {
    const p = prefectureOf(c);
    states.push(p ? (p === f.area ? 'yes' : 'no') : 'unknown');
  }
  const labels = describeIndustry(c).labels,
    observed = [...labels, c.businessSummary?.value ?? '']
      .join(' ')
      .normalize('NFKC')
      .toUpperCase();
  const hasInfo = Boolean(labels.length || c.businessSummary?.value);
  const categories = Object.entries(terms)
    .filter(([, words]) =>
      words.some((word) =>
        word === 'IT'
          ? /\bIT\b/.test(observed)
          : observed.includes(word.normalize('NFKC').toUpperCase()),
      ),
    )
    .map(([key]) => key);
  states.push(
    !hasInfo
      ? 'unknown'
      : f.category === 'desktop'
        ? categories.length
          ? 'yes'
          : 'no'
        : f.category === 'other'
          ? categories.length
            ? 'no'
            : 'yes'
          : categories.includes(f.category)
            ? 'yes'
            : 'no',
  );
  const n = c.employees?.value;
  if (n === undefined || n === null) states.push('unknown');
  else if (f.size === '501+') states.push(n >= 501 ? 'yes' : 'no');
  else {
    const [min, max] = f.size.split('-').map(Number);
    states.push(n >= min && n <= max ? 'yes' : 'no');
  }
  return states.includes('no')
    ? 'excluded'
    : states.includes('unknown')
      ? 'pending'
      : 'match';
}
export function informationStatus(c: ResearchCandidate) {
  const score = scoreCandidate(c);
  const missing = [
    ...(!describeIndustry(c).labels.length ? ['業種'] : []),
    ...(c.employees ? [] : ['従業員数']),
    ...(c.website ? [] : ['公式サイト']),
    ...(c.address ? [] : ['所在地']),
    ...(c.businessSummary ? [] : ['事業概要']),
  ];
  const points = score.parts.find((p) => p.key === 'completeness')!.points;
  return {
    level: points === 15 ? '高' : points >= 9 ? '中' : '低',
    missing,
    pending: missing.length > 0 || Boolean(c.dataConflicts?.length),
  };
}
export type DiscoveryRow = {
  candidate: ResearchCandidate;
  score: SalesScore;
  information: ReturnType<typeof informationStatus>;
};
export type DiscoveryResult = {
  rows: DiscoveryRow[];
  acquired: number;
  matched: number;
  conditionPending: number;
  assessmentPending: number;
  excluded: number;
  alreadyRegistered: number;
  rankCounts: { A: number; B: number; C: number };
  shortage: number;
  reasons: string[];
  filters: DiscoveryFilters;
};
export function discoverCandidates(
  data: Iterable<ResearchCandidate>,
  filters: DiscoveryFilters,
  exclude: { numbers: string[]; names: string[] } = { numbers: [], names: [] },
  progress?: (count: number) => void,
): DiscoveryResult {
  if (
    !discoveryCategories.some(([v]) => v === filters.category) ||
    !discoverySizes.some(([v]) => v === filters.size) ||
    ![10, 30, 50, 100].includes(filters.target) ||
    (filters.area && !prefectures.includes(filters.area))
  )
    throw Error('発掘条件が不正です。');
  const numbers = new Set(exclude.numbers),
    names = new Set(exclude.names.map((n) => n.normalize('NFKC').trim()));
  const result: DiscoveryResult = {
    rows: [],
    acquired: 0,
    matched: 0,
    conditionPending: 0,
    assessmentPending: 0,
    excluded: 0,
    alreadyRegistered: 0,
    rankCounts: { A: 0, B: 0, C: 0 },
    shortage: 0,
    reasons: [],
    filters,
  };
  const seen = new Set<string>();
  for (const c of data) {
    const number = c.identity.corporateNumber;
    if (!number || seen.has(number)) continue;
    seen.add(number);
    result.acquired++;
    if (result.acquired % 1000 === 0) progress?.(result.acquired);
    if (
      numbers.has(number) ||
      names.has(c.name.value.normalize('NFKC').trim())
    ) {
      result.alreadyRegistered++;
      continue;
    }
    const state = conditionStatus(c, filters);
    if (state === 'pending') {
      result.conditionPending++;
      continue;
    }
    if (state === 'excluded') {
      result.excluded++;
      continue;
    }
    result.matched++;
    const row = {
      candidate: c,
      score: scoreCandidate(c),
      information: informationStatus(c),
    };
    if (row.information.pending) result.assessmentPending++;
    result.rows.push(row);
    result.rows.sort(
      (a, b) =>
        b.score.total - a.score.total ||
        (a.candidate.identity.corporateNumber ?? '').localeCompare(
          b.candidate.identity.corporateNumber ?? '',
        ),
    );
    if (result.rows.length > filters.target) result.rows.pop();
  }
  for (const row of result.rows) result.rankCounts[row.score.rank]++;
  result.shortage = Math.max(0, filters.target - result.rows.length);
  if (result.shortage)
    result.reasons.push(
      `目標${filters.target}社に対し条件一致は${result.matched}社です。条件未確認${result.conditionPending}社、条件不一致${result.excluded}社、登録済み除外${result.alreadyRegistered}社。未取得値を推測して補っていません。`,
    );
  result.reasons.push(
    `対象は取り込んだ${result.acquired}社のみです。全国企業を網羅した結果ではありません。`,
  );
  return result;
}
export function exportDiscoveryCSV(rows: DiscoveryRow[]): string {
  const table: unknown[][] = [
    [
      '企業名',
      '法人番号',
      '都道府県',
      '所在地',
      '業種',
      '従業員数',
      '公式サイト',
      '営業適性スコア',
      'ランク',
      '情報充実度',
      '判定状況',
      '未確認項目',
      '評価理由',
      'データ取得元',
      '取得日時',
      '元データ出典',
      '項目別取得元',
      '評価ルール',
    ],
  ];
  for (const { candidate: c, score, information } of rows)
    table.push([
      c.name.value,
      c.identity.corporateNumber,
      prefectureOf(c) ?? '未取得',
      c.address?.value ?? '未取得',
      describeIndustry(c).display,
      c.employees?.value ?? '不明',
      c.website?.value ?? '未取得',
      score.total,
      score.rank,
      information.level,
      information.pending ? '要確認' : '主要項目取得済み',
      [
        ...information.missing,
        ...(c.dataConflicts?.length ? ['収録差異（要確認）'] : []),
      ].join(' / ') || 'なし',
      score.parts
        .map((p) => `${p.label} ${p.points}/${p.max}点：${p.reason}`)
        .join('\n') +
        '\n' +
        score.limitations +
        (c.dataConflicts?.length
          ? '\n収録差異（要確認）：' +
            c.dataConflicts
              .map(
                (d) =>
                  `${d.field}：旧「${d.previous.value}」→採用「${d.kept.value}」`,
              )
              .join(' / ')
          : ''),
      c.name.sourceUrl,
      c.name.retrievedAt,
      [
        ...new Set(
          [
            c.name,
            c.address,
            c.industry,
            c.employees,
            c.website,
            c.businessSummary,
          ].flatMap((e) => (e?.upstreamSource ? [e.upstreamSource] : [])),
        ),
      ].join(' / ') || '未取得',
      (
        [
          'name',
          'address',
          'industry',
          'employees',
          'website',
          'businessSummary',
        ] as const
      )
        .flatMap((k) =>
          c[k]
            ? [
                `${k}: ${c[k]!.source} ${c[k]!.sourceUrl} ${c[k]!.retrievedAt}${c[k]!.sourceFileName ? ' ' + c[k]!.sourceFileName : ''}`,
              ]
            : [],
        )
        .join('\n'),
      score.version,
    ]);
  const escape = (v: unknown) => {
    let s = String(v ?? '');
    if (/^\s*[=+@-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + table.map((r) => r.map(escape).join(',')).join('\r\n');
}
