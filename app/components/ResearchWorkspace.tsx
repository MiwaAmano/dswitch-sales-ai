'use client';
import { useState } from 'react';
import GbizinfoResearch from './GbizinfoResearch';
import DiscoveryResearch from './DiscoveryResearch';
import type { Company } from '@/lib/sales';
import type { ResearchCandidate } from '@/lib/research';
export default function ResearchWorkspace({
  companies,
  onRegister,
  onRegisterMany,
}: {
  companies: Company[];
  onRegister: (c: ResearchCandidate) => void;
  onRegisterMany: (c: ResearchCandidate[]) => void;
}) {
  const [tab, setTab] = useState<'name' | 'discovery'>('name');
  return (
    <>
      <div className="tabs" role="tablist" aria-label="リサーチ方法">
        <button
          role="tab"
          aria-selected={tab === 'name'}
          className={tab === 'name' ? 'selected' : ''}
          onClick={() => {
            if (
              tab === 'discovery' &&
              !confirm(
                'このタブの取込CSV・未登録結果は破棄されます。必要な結果をCSV出力・登録しましたか？',
              )
            )
              return;
            setTab('name');
          }}
        >
          企業名から検索
        </button>
        <button
          role="tab"
          aria-selected={tab === 'discovery'}
          className={tab === 'discovery' ? 'selected' : ''}
          onClick={() => setTab('discovery')}
        >
          営業候補を自動発掘
        </button>
      </div>
      {tab === 'name' ? (
        <GbizinfoResearch companies={companies} onRegister={onRegister} />
      ) : (
        <DiscoveryResearch
          companies={companies}
          onRegisterMany={onRegisterMany}
        />
      )}
    </>
  );
}
