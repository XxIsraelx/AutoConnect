export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import SignupPage from './SignupContent';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="text-slate-500 text-sm">Carregando…</span></div>}>
      <SignupPage />
    </Suspense>
  );
}
