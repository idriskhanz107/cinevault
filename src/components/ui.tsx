import { AlertTriangle, Film, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <Loader2 className="h-5 w-5 animate-spin text-gold-400" aria-hidden />
    </span>
  );
}

export function CardSkeleton() {
  return (
    <div aria-hidden className="w-40 shrink-0 sm:w-44">
      <div className="skeleton aspect-[2/3] w-full rounded-lg" />
      <div className="skeleton mt-2 h-4 w-3/4 rounded" />
      <div className="skeleton mt-1 h-3 w-1/2 rounded" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden" role="status" aria-label="Loading movies">
      {Array.from({ length: 7 }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" role="status" aria-label="Loading movies">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden>
          <div className="skeleton aspect-[2/3] w-full rounded-lg" />
          <div className="skeleton mt-2 h-4 w-3/4 rounded" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, message, action, icon }: { title: string; message?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-500 px-6 py-14 text-center">
      <div className="mb-3 text-fog-500">{icon ?? <Film className="h-10 w-10" aria-hidden />}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {message && <p className="mt-1 max-w-md text-sm text-fog-300">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-crimson-500/40 bg-crimson-500/10 px-6 py-10 text-center">
      <AlertTriangle className="mb-2 h-8 w-8 text-crimson-500" aria-hidden />
      <p className="max-w-md text-sm text-fog-100">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="btn btn-ghost mt-4">Try again</button>}
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-crimson-500/50 bg-crimson-500/10',
    success: 'border-emerald-500/50 bg-emerald-500/10',
    info: 'border-gold-400/40 bg-gold-400/10',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
