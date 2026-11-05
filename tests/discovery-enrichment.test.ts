import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnrichmentBudget } from '../lib/server/enrichment-limits';
import { getGbizinfoCompany } from '../lib/server/gbizinfo';
import { POST } from '../app/api/research/gbizinfo/enrich/route';
test('enrichment budget enforces minute and day caps without unbounded retries', () => {
  const now = Date.UTC(2026, 9, 20);
  const minute = new EnrichmentBudget();
  for (let i = 0; i < 30; i++) assert.equal(minute.take(now), true);
  assert.equal(minute.take(now + 1), false);
  assert.equal(minute.take(now + 60000), true);
  const day = new EnrichmentBudget();
  for (let i = 0; i < 200; i++) assert.equal(day.take(now + i * 61000), true);
  assert.equal(day.take(now + 200 * 61000), false);
  assert.equal(day.take(now + 86400000), true);
});
test('corporate-number enrichment sends exactly one authenticated v2 request and returns only normalized fields', async () => {
  let count = 0;
  const r = await getGbizinfoCompany('1234567890123', 'fixture-only', {
    fetcher: async (url, init) => {
      count++;
      assert.equal(
        new URL(String(url)).pathname,
        '/hojin/v2/hojin/1234567890123',
      );
      assert.equal(
        new Headers(init?.headers).get('X-hojinInfo-api-token'),
        'fixture-only',
      );
      return Response.json({
        'hojin-infos': [
          {
            corporate_number: '1234567890123',
            name: '試験用架空法人',
            employee_number: 100,
            secret_unused: 'not forwarded',
          },
        ],
      });
    },
  });
  assert.equal(count, 1);
  assert.equal(r.employees?.value, 100);
  assert.equal(r.name.source, 'gbizinfo');
  assert.ok(!JSON.stringify(r).includes('not forwarded'));
});
test('enrichment rejects malformed IDs and missing key with zero external calls', async () => {
  let count = 0;
  const fetcher: typeof fetch = async () => {
    count++;
    throw Error('not called');
  };
  await assert.rejects(
    () => getGbizinfoCompany('bad', 'fixture', { fetcher }),
    { code: 'INVALID_QUERY' },
  );
  await assert.rejects(
    () => getGbizinfoCompany('1234567890123', undefined, { fetcher }),
    { code: 'KEY_MISSING' },
  );
  assert.equal(count, 0);
});
test('enrichment route rejects cross-origin, oversized and malformed requests before outbound calls', async () => {
  const request = (body: string, origin?: string) =>
    POST(
      new Request('http://localhost/api/research/gbizinfo/enrich', {
        method: 'POST',
        body,
        headers: origin ? { origin } : {},
      }),
    );
  assert.equal((await request('{}', 'https://untrusted.example')).status, 403);
  assert.equal((await request('x'.repeat(101))).status, 400);
  assert.equal((await request('not json')).status, 400);
  assert.equal((await request('{"number":"bad"}')).status, 400);
});
