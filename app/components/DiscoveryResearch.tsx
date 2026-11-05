'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Search,
  Download,
  Plus,
  Square,
  RefreshCw,
} from 'lucide-react';
import type { Company } from '@/lib/sales';
import type { ResearchCandidate } from '@/lib/research';
import { isResearchDuplicate } from '@/lib/research-company';
import {
  defaultDiscoveryFilters,
  discoveryCategories,
  discoverySizes,
  exportDiscoveryCSV,
  type DiscoveryFilters,
  type DiscoveryResult,
} from '@/lib/discovery';
import {
  csvColumns,
  suggestColumnMapping,
  validateFileSource,
  MAX_FILE_BYTES,
  type ColumnMapping,
  type CsvColumn,
} from '@/lib/discovery-csv';
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  ImportStats,
} from '@/lib/discovery-protocol';
import { prefectures } from '@/lib/prefectures';
import { describeIndustry } from '@/lib/research-scoring';
export default function DiscoveryResearch({
  companies,
  onRegisterMany,
}: {
  companies: Company[];
  onRegisterMany: (c: ResearchCandidate[]) => void;
}) {
  const worker = useRef<Worker | null>(null),
    pending = useRef<{
      resolve: (r: DiscoveryResponse) => void;
      reject: (e: Error) => void;
    } | null>(null),
    controller = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null),
    [encoding, setEncoding] = useState('utf-8'),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<ColumnMapping | null>(null),
    [sourceUrl, setSourceUrl] = useState('');
  const [stats, setStats] = useState<ImportStats | null>(null),
    [result, setResult] = useState<DiscoveryResult | null>(null),
    [filters, setFilters] = useState<DiscoveryFilters>(defaultDiscoveryFilters),
    [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const w = new Worker(
        new URL('../workers/discovery.worker.ts', import.meta.url),
      );
      worker.current = w;
      w.onmessage = (event: MessageEvent<DiscoveryResponse>) => {
        const data = event.data;
        if (data.type === 'progress') {
          setProgress(data.message);
          return;
        }
        if (data.type === 'error')
          pending.current?.reject(new Error(data.message));
        else pending.current?.resolve(data);
        pending.current = null;
      };
      w.onerror = () => {
        setError(
          'CSV処理用Workerを利用できません。ページを再読み込みしてください。',
        );
        pending.current?.reject(
          new Error(
            'CSV処理用Workerでエラーが発生しました。ページを再読み込みし、CSVを再取り込みしてください。営業データは削除されません。',
          ),
        );
        pending.current = null;
        setReady(false);
      };
      setReady(true);
      return () => {
        w.terminate();
        controller.current?.abort();
        pending.current?.reject(new Error('処理を中止しました。'));
        pending.current = null;
      };
    } catch {
      setError(
        'このブラウザーではCSV処理Workerを起動できません。最新版のEdgeかChromeをご使用ください。',
      );
    }
  }, []);
  function request(message: DiscoveryRequest): Promise<DiscoveryResponse> {
    return new Promise((resolve, reject) => {
      if (!worker.current || pending.current) {
        reject(new Error('前の処理が完了するまでお待ちください。'));
        return;
      }
      pending.current = { resolve, reject };
      worker.current.postMessage(message);
    });
  }
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : '処理に失敗しました。');
  async function inspect(f: File | null) {
    setFile(f);
    setHeaders([]);
    setMapping(null);
    setError('');
    if (!f) return;
    if (
      !f.name.toLowerCase().endsWith('.csv') ||
      f.size > MAX_FILE_BYTES ||
      !f.size
    ) {
      setError(
        '空でない20MB以下のCSVを選択してください。ZIPは解凍し、ExcelはCSVとして保存してください。',
      );
      return;
    }
    setBusy(true);
    setProgress('列名・文字コードを確認中…');
    try {
      const r = await request({ type: 'inspect', file: f, encoding });
      if (r.type === 'headers') {
        setHeaders(r.headers);
        setMapping(suggestColumnMapping(r.headers));
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function importFile() {
    if (!file || !mapping) return;
    setBusy(true);
    setError('');
    setProgress('CSVを検証・取り込み中…');
    try {
      const url = validateFileSource(sourceUrl);
      const r = await request({
        type: 'import',
        file,
        encoding,
        mapping,
        source: { url, fileName: file.name, at: new Date().toISOString() },
      });
      if (r.type === 'imported') {
        setStats(r.stats);
        setResult(null);
        setSelected(new Set());
        setProgress(`${r.stats.total}社を一時データとして取り込みました`);
      }
    } catch (e) {
      fail(e);
      setProgress('');
    } finally {
      setBusy(false);
    }
  }
  async function discover() {
    setBusy(true);
    setError('');
    setProgress('取り込んだ企業を条件確認・採点中…');
    try {
      const r = await request({
        type: 'discover',
        filters,
        exclude: {
          numbers: companies.flatMap((c) =>
            c.research?.identity.corporateNumber
              ? [c.research.identity.corporateNumber]
              : [],
          ),
          names: companies
            .filter((c) => !c.research?.identity.corporateNumber)
            .map((c) => c.name),
        },
      });
      if (r.type === 'result') {
        setResult(r.result);
        setSelected(new Set());
        setProgress(
          `対象${r.result.acquired}社から${r.result.rows.length}社を抽出しました`,
        );
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function enrich() {
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    let done = 0;
    try {
      const r = await request({ type: 'enrichment-targets' });
      if (r.type !== 'targets') return;
      if (!r.numbers.length) {
        setProgress('CSV由来で情報不足の補完対象がありません。');
        return;
      }
      for (const number of r.numbers) {
        if (abort.signal.aborted) break;
        setProgress(`API補完 ${done}/${r.numbers.length}社（最大10回）…`);
        const response = await fetch('/api/research/gbizinfo/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number }),
          signal: abort.signal,
        });
        const value = await response.json();
        if (!response.ok)
          throw new Error(
            `${value.message ?? 'API補完に失敗しました。'} ［${value.code ?? 'ERROR'}］`,
          );
        await request({ type: 'merge-api', candidate: value.candidate });
        done++;
        if (done < r.numbers.length && !abort.signal.aborted)
          await new Promise((resolve) => setTimeout(resolve, 600));
      }
      setProgress(
        `${done}社をAPI補完しました。${abort.signal.aborted ? '中止しました。' : ''}発掘を再実行してください。`,
      );
      if (done) setResult(null);
    } catch (e) {
      if (abort.signal.aborted)
        setProgress(
          `${done}社の補完を保存して中止しました。発掘を再実行してください。`,
        );
      else {
        fail(e);
        setProgress(`${done}社を補完済み。既に取り込んだCSVは保持しています。`);
      }
      if (done) setResult(null);
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  function exportCSV() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([exportDiscoveryCSV(result.rows)], {
        type: 'text/csv;charset=utf-8;',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `dswitch-discovery-${result.rows.length}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const registerable =
    result?.rows.filter((r) => !isResearchDuplicate(companies, r.candidate)) ??
    [];
  return (
    <>
      <div className="info-banner">
        <Search size={20} />
        <div>
          <strong>営業候補を自動発掘 — 取得済みデータから最大100社</strong>
          <p style={{ marginTop: 8, lineHeight: 1.9 }}>
            会社名を知らなくても、取り込んだCSVの範囲から候補を抽出できます。全国の企業を網羅する調査ではありません。架空企業は生成しません。
          </p>
        </div>
      </div>
      <section className="panel research-panel">
        <h2>1. 公式ダウンロードCSVを取り込む</h2>
        <p style={{ lineHeight: 1.9, fontSize: 12, margin: '14px 0' }}>
          gBizINFOの公式ダウンロード画面で取得したCSVをご用意ください。この環境では公式の最新ファイル仕様を直接確認できていないため、列の対応を実ファイルで確認・指定します。公式固有形式の自動判定・自動ダウンロードは未実装です。
        </p>
        <p className="muted" style={{ lineHeight: 1.9, marginBottom: 18 }}>
          CSVはサーバーへアップロードせず、ブラウザー内Workerで処理します。1ファイル20MB・50,000行、取込全体50,000社まで。UTF-8／Shift_JIS、先頭行が列名のCSVのみ。ZIP・JSON・XML・Excelや巨大な全国一括ファイルは未対応です。先に分割・CSV変換してください。
        </p>
        <div className="form-grid">
          <label>
            文字コード
            <select
              disabled={busy}
              value={encoding}
              onChange={(e) => {
                setEncoding(e.target.value);
                setFile(null);
                setHeaders([]);
                setMapping(null);
              }}
            >
              <option value="utf-8">UTF-8</option>
              <option value="shift_jis">Shift_JIS</option>
            </select>
          </label>
          <label>
            CSVファイル
            <input
              key={encoding}
              aria-label="公式CSVファイル"
              disabled={busy || !ready}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void inspect(e.target.files?.[0] ?? null)}
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            出典ページURL（公式サイト・クエリなし）
            <input
              disabled={busy}
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="gBizINFOの公式ダウンロード案内ページのURL"
            />
          </label>
        </div>
        {mapping && (
          <>
            <p style={{ fontSize: 12, lineHeight: 1.9, margin: '20px 0' }}>
              以下の自動候補は公式仕様の認証ではありません。原本の列・説明を確認してから取り込んでください。法人番号と企業名は必須です。存在しない項目は「未取得」のままにします。
            </p>
            <div className="form-grid">
              {(Object.keys(csvColumns) as CsvColumn[]).map((key) => (
                <label key={key}>
                  {csvColumns[key]}
                  <select
                    disabled={busy}
                    value={mapping[key]}
                    onChange={(e) =>
                      setMapping({ ...mapping, [key]: e.target.value })
                    }
                  >
                    <option value="">未取得／指定なし</option>
                    {headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="primary"
              style={{ marginTop: 20 }}
              disabled={busy || !sourceUrl || !mapping.number || !mapping.name}
              onClick={importFile}
            >
              <Upload size={16} />
              列対応を確認して取り込む
            </button>
          </>
        )}
        {stats && (
          <p style={{ lineHeight: 1.9, fontSize: 12, marginTop: 20 }}>
            取込済み：法人番号で重複排除後 {stats.total.toLocaleString()}
            社。直近ファイル {stats.rows}行／除外{stats.invalidRows}
            行（法人番号・企業名不正）／未取得扱いの不正な任意項目
            {stats.invalidFields}件／重複{stats.duplicates}
            件。追加入力は既存の一時データへ統合します。収録差異は後の非欠損値を優先し、差異を記録します。
          </p>
        )}
      </section>
      <section className="panel research-panel">
        <h2>2. 発掘条件</h2>
        <div className="form-grid" style={{ marginTop: 20 }}>
          <label>
            対象地域
            <select
              disabled={busy}
              value={filters.area}
              onChange={(e) => setFilters({ ...filters, area: e.target.value })}
            >
              <option value="">全国（取込範囲内）</option>
              {prefectures.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            業種候補
            <select
              disabled={busy}
              value={filters.category}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  category: e.target.value as DiscoveryFilters['category'],
                })
              }
            >
              {discoveryCategories.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            従業員規模
            <select
              disabled={busy}
              value={filters.size}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  size: e.target.value as DiscoveryFilters['size'],
                })
              }
            >
              {discoverySizes.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            発掘目標
            <select
              disabled={busy}
              value={filters.target}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  target: Number(e.target.value) as DiscoveryFilters['target'],
                })
              }
            >
              {[10, 30, 50, 100].map((n) => (
                <option value={n} key={n}>
                  {n}社
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted" style={{ lineHeight: 1.9, margin: '18px 0' }}>
          業種候補は取得した日本語業種名・事業概要の語句一致です。実際のデスクワーク比率を断定しません。未確認コードしかない場合は推測変換しません。不明な人数を指定人数帯と見なしません。登録済み法人番号と、番号のない旧企業の同名候補は除外します。
        </p>
        <button
          className="primary"
          disabled={busy || !stats?.total || !ready}
          onClick={discover}
        >
          <Search size={16} />
          営業候補を発掘する
        </button>
      </section>
      <section className="panel research-panel">
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            任意：不足情報をAPIで補完する（1回最大10社）
          </summary>
          <p style={{ lineHeight: 1.9, fontSize: 12, margin: '16px 0' }}>
            取込順で情報不足のCSV由来企業を最大10社選び、法人番号でgBizINFO API
            v2へ問い合わせます。ファイル全体や既存営業リストは送信しません。非欠損のAPI値を優先し、CSVとの収録差異・項目別の出典を残します。補完対象は発掘条件での選別前です。1社1リクエスト、600ms以上の間隔、サーバー内30回/分・200回/UTC日の上限です（プロセス再起動でリセット）。
          </p>
          <button
            className="secondary"
            disabled={busy || !stats?.total}
            onClick={enrich}
          >
            <RefreshCw size={15} />
            不足情報をAPIで補完
          </button>
          {busy && controller.current && (
            <button
              className="secondary"
              style={{ marginLeft: 10 }}
              onClick={() => controller.current?.abort()}
            >
              <Square size={14} />
              補完を中止
            </button>
          )}
        </details>
      </section>
      {progress && (
        <div className="info-banner" role="status" aria-live="polite">
          {progress}
        </div>
      )}
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}
      {result && (
        <section className="panel research-panel">
          <h2>
            発掘結果：{result.rows.length}社 / 目標{result.filters.target}社
          </h2>
          <p style={{ fontSize: 12, lineHeight: 1.9, margin: '14px 0' }}>
            条件：{result.filters.area || '全国（取込範囲内）'}・
            {
              discoveryCategories.find(
                ([v]) => v === result.filters.category,
              )?.[1]
            }
            ・{discoverySizes.find(([v]) => v === result.filters.size)?.[1]}
            。以下のランク件数は抽出した最大{result.filters.target}
            社が対象です。結果は発掘実行時点で、登録後の除外件数は再発掘で更新します。
          </p>
          <div
            className="metrics"
            style={{
              gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
            }}
          >
            {[
              ['取得済み企業数', result.acquired],
              ['条件一致', result.matched],
              ['Aランク', result.rankCounts.A],
              ['Bランク', result.rankCounts.B],
              ['Cランク', result.rankCounts.C],
              [
                '情報不足・判定保留',
                result.conditionPending + result.assessmentPending,
              ],
            ].map(([label, count]) => (
              <div className="metric" key={label}>
                <div className="metric-top">{label}</div>
                <div className="metric-number">
                  {count}
                  <span>社</span>
                </div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ lineHeight: 1.9 }}>
            保留の内訳：条件未確認 {result.conditionPending}
            社＋条件一致だが評価要確認 {result.assessmentPending}
            社。後者は「条件一致」にも含まれます。条件不一致 {result.excluded}
            社／登録済み除外 {result.alreadyRegistered}
            社。情報不足は不適合を意味しません。
          </p>
          {result.reasons.map((reason) => (
            <div
              className={result.shortage ? 'warning' : 'info-banner'}
              style={{ marginTop: 16 }}
              key={reason}
            >
              {reason}
            </div>
          ))}
          <div
            className="editor-actions"
            style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}
          >
            <button
              className="secondary"
              disabled={busy || !registerable.length}
              onClick={() =>
                setSelected(
                  new Set(
                    registerable.map(
                      (r) => r.candidate.identity.corporateNumber!,
                    ),
                  ),
                )
              }
            >
              登録可能な企業を全選択
            </button>
            <button
              className="secondary"
              disabled={busy || !selected.size}
              onClick={() => setSelected(new Set())}
            >
              選択解除
            </button>
            <button
              className="primary"
              disabled={busy || !selected.size}
              onClick={() => {
                const items = registerable
                  .filter((r) =>
                    selected.has(r.candidate.identity.corporateNumber!),
                  )
                  .map((r) => r.candidate);
                if (items.length) onRegisterMany(items);
                setSelected(new Set());
              }}
            >
              <Plus size={15} />
              選択企業を一括登録（{selected.size}社）
            </button>
            <button
              className="secondary"
              disabled={busy || !result.rows.length}
              onClick={exportCSV}
            >
              <Download size={15} />
              抽出結果をCSV出力
            </button>
          </div>
          <div
            className="research-results"
            style={{ padding: 0, marginTop: 24 }}
          >
            {result.rows.map(({ candidate: c, score, information }) => {
              const duplicate = isResearchDuplicate(companies, c),
                number = c.identity.corporateNumber!;
              return (
                <article
                  className="research-card"
                  key={number}
                  style={{ overflowWrap: 'anywhere' }}
                >
                  <label style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`${c.name.value}を選択`}
                      disabled={busy || duplicate}
                      checked={selected.has(number) && !duplicate}
                      onChange={(e) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (e.target.checked) next.add(number);
                          else next.delete(number);
                          return next;
                        })
                      }
                    />
                    {duplicate
                      ? '登録済み'
                      : `${score.rank}ランク ${score.total}/100点`}
                  </label>
                  <h3>{c.name.value}</h3>
                  <p>法人番号：{number}</p>
                  <p>所在地：{c.address?.value ?? '未取得'}</p>
                  <p>業種：{describeIndustry(c).display}</p>
                  <p>
                    従業員数：{c.employees ? `${c.employees.value}名` : '不明'}
                  </p>
                  <p>
                    情報充実度：{information.level} ／{' '}
                    {information.pending ? '評価要確認' : '主要項目取得済み'}
                  </p>
                  <p>
                    未確認項目：{information.missing.join('・') || 'なし'}
                    （働き方・導入状況は未確認）
                  </p>
                  {c.website ? (
                    <a href={c.website.value} target="_blank" rel="noreferrer">
                      公式サイト（取得情報）↗
                    </a>
                  ) : (
                    <p>公式サイト：未取得</p>
                  )}
                  <details>
                    <summary>評価理由・内訳</summary>
                    {score.parts.map((p) => (
                      <p key={p.key} style={{ lineHeight: 1.8 }}>
                        {p.label} {p.points}/{p.max}点：{p.reason}
                      </p>
                    ))}
                    <p style={{ lineHeight: 1.8 }}>{score.limitations}</p>
                  </details>
                  {c.dataConflicts?.length ? (
                    <details>
                      <summary>API／CSV等の収録差異あり（要確認）</summary>
                      {c.dataConflicts.map((conflict, i) => (
                        <p key={i} style={{ lineHeight: 1.8 }}>
                          {conflict.field}：旧取得値「{conflict.previous.value}
                          」→採用値「{conflict.kept.value}」。旧出典{' '}
                          {conflict.previous.sourceUrl}／採用出典{' '}
                          {conflict.kept.sourceUrl}
                        </p>
                      ))}
                    </details>
                  ) : null}
                  <p>
                    取得元：
                    {c.name.source === 'gbizinfo-download'
                      ? 'gBizINFO CSV（利用者指定）'
                      : 'gBizINFO API v2'}
                  </p>
                  <a href={c.name.sourceUrl} target="_blank" rel="noreferrer">
                    出典ページ ↗
                  </a>
                  <p>
                    {c.name.source === 'gbizinfo-download'
                      ? 'CSV取込日時'
                      : 'API取得日時'}
                    ：{new Date(c.name.retrievedAt).toLocaleString('ja-JP')}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <p className="muted" style={{ lineHeight: 1.9, margin: '20px 0' }}>
        取込データ・未登録結果はこのタブを離れると破棄されます。必要な結果はCSV出力または営業リストへ登録してください。既存の営業データ・履歴・下書きを消去する処理はありません。CSVの取得日時欄は本アプリへの取込時刻であり、原本の更新日時ではありません。公式の利用条件・出典表示・第三者権利を確認したデータだけを取り込んでください。
      </p>
    </>
  );
}
