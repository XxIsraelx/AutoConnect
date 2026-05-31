export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ImpersonatePage from './ImpersonateContent';

export default function Page() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-slate-500">
          <span className="text-sm">Carregando…</span>
        </div>
      </div>
    }>
      <ImpersonatePage />
    </Suspense>
  );
}
