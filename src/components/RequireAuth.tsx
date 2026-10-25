import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';

/** Route guards are a UX convenience; data access is enforced by RLS and server functions. */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
