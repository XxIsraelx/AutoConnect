'use client';

import { useEffect, useState } from 'react';

type HealthResponse = { status: string; db: string; ts: string };

export function ApiHealth() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/health`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return <p className="text-sm text-red-500">API offline: {error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-slate-500">Conectando à API…</p>;
  }
  return (
    <p className="text-sm text-slate-500">
      API: <span className="font-mono">{data.status}</span> · DB:{' '}
      <span className="font-mono">{data.db}</span>
    </p>
  );
}
