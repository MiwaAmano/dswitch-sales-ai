/// <reference lib="webworker" />
import Papa from 'papaparse';
import type { ResearchCandidate } from '@/lib/research';
import {
  DiscoveryImport,
  MAX_FILE_BYTES,
  validateHeaders,
  mergeCandidate,
} from '@/lib/discovery-csv';
import { discoverCandidates, informationStatus } from '@/lib/discovery';
import type {
  DiscoveryRequest,
  DiscoveryResponse,
} from '@/lib/discovery-protocol';
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let data = new Map<string, ResearchCandidate>();
let busy = false;
const send = (response: DiscoveryResponse) => ctx.postMessage(response);
ctx.onmessage = async (event: MessageEvent<DiscoveryRequest>) => {
  const req = event.data;
  if (busy) {
    send({
      type: 'error',
      message: '前のファイル処理が完了するまでお待ちください。',
    });
    return;
  }
  try {
    if (req.type === 'inspect' || req.type === 'import') {
      if (
        !req.file.name.toLowerCase().endsWith('.csv') ||
        req.file.size > MAX_FILE_BYTES ||
        req.file.size === 0
      )
        throw Error(
          'CSVファイル（空でない20MB以下）を指定してください。ZIP・Excelファイルは未対応です。',
        );
      busy = true;
      let text: string;
      try {
        text = new TextDecoder(req.encoding, { fatal: true }).decode(
          await req.file.arrayBuffer(),
        );
      } catch {
        throw Error(
          '文字コードを正しく読み取れません。UTF-8／Shift_JISの選択と元ファイルを確認してください。',
        );
      }
      const fail = (e: unknown) => {
        busy = false;
        send({
          type: 'error',
          message:
            e instanceof Error
              ? e.message
              : 'CSVを読み込めませんでした。形式・文字コードを確認してください。',
        });
      };
      if (req.type === 'inspect') {
        Papa.parse<string[]>(text, {
          preview: 1,
          skipEmptyLines: 'greedy',
          complete: (result) => {
            try {
              if (result.errors.length)
                throw Error('CSVの引用符・形式を確認してください。');
              const headers = (result.data[0] ?? []).map((h) =>
                h.replace(/^\uFEFF/, '').trim(),
              );
              validateHeaders(headers);
              busy = false;
              send({ type: 'headers', headers });
            } catch (e) {
              fail(e);
            }
          },
        });
        return;
      }
      const pipeline = new DiscoveryImport(req.mapping, req.source);
      let failed = false;
      Papa.parse<Record<string, string>>(text, {
        header: true,
        chunkSize: 1024 * 1024,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
        chunk: (
          result: Papa.ParseResult<Record<string, string>>,
          parser: Papa.Parser,
        ) => {
          try {
            if (
              result.errors.length ||
              Object.keys(result.meta.renamedHeaders ?? {}).length
            )
              throw Error('CSVの列数・引用符・重複列名を確認してください。');
            validateHeaders(result.meta.fields ?? [], req.mapping);
            pipeline.accept(result.data);
            send({
              type: 'progress',
              message: `CSV ${pipeline.rows.toLocaleString()}行を検証・処理中…`,
            });
          } catch (e) {
            failed = true;
            parser.abort();
            fail(e);
          }
        },
        complete: () => {
          if (failed) return;
          try {
            const imported = pipeline.commit(data);
            data = imported.data;
            busy = false;
            send({ type: 'imported', stats: imported.stats });
          } catch (e) {
            fail(e);
          }
        },
      });
      return;
    }
    if (req.type === 'discover') {
      send({
        type: 'result',
        result: discoverCandidates(
          data.values(),
          req.filters,
          req.exclude,
          (count) =>
            send({
              type: 'progress',
              message: `${count.toLocaleString()}社を条件確認・採点中…`,
            }),
        ),
      });
      return;
    }
    if (req.type === 'enrichment-targets') {
      send({
        type: 'targets',
        numbers: [...data.values()]
          .filter(
            (c) =>
              c.name.source === 'gbizinfo-download' &&
              informationStatus(c).missing.length > 0,
          )
          .slice(0, 10)
          .map((c) => c.identity.corporateNumber!),
      });
      return;
    }
    if (req.type === 'merge-api') {
      const number = req.candidate.identity.corporateNumber;
      if (!number || !data.has(number))
        throw Error('補完対象の法人番号が取込データにありません。');
      data.set(number, mergeCandidate(data.get(number)!, req.candidate));
      send({ type: 'merged', total: data.size });
    }
  } catch (error) {
    busy = false;
    send({
      type: 'error',
      message:
        error instanceof Error
          ? error.message
          : '取込データを処理できませんでした。',
    });
  }
};
