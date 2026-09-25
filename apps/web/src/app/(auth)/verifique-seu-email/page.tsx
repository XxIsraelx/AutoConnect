import { Suspense } from 'react';
import ConteudoDaVerificacao from './ConteudoDaVerificacao';

export default function VerifiqueEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConteudoDaVerificacao />
    </Suspense>
  );
}
