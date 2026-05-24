export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">AutoConnect</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Plataforma operacional para concessionárias
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
