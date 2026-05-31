export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import VerificarEmailPage from './VerificarEmailContent';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="text-slate-500 text-sm">Verificando…</span></div>}>
      <VerificarEmailPage />
    </Suspense>
  );
}
