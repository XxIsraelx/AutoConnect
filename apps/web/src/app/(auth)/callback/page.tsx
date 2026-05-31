export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import AuthCallbackPage from './CallbackContent';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="text-slate-500 text-sm">Processando…</span></div>}>
      <AuthCallbackPage />
    </Suspense>
  );
}
