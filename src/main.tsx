import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import { WatchlistProvider } from './context/WatchlistContext';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { Spinner } from './components/ui';
import Home from './pages/Home';
import Browse from './pages/Browse';
import Genres from './pages/Genres';
import MovieDetail from './pages/MovieDetail';
import Login from './pages/Login';
import StaticPage, { NotFound } from './pages/StaticPage';
import { useEffect } from 'react';

// Heavier / role-specific pages are code-split.
const Watch = lazy(() => import('./pages/Watch'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Profile = lazy(() => import('./pages/Profile'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const MovieForm = lazy(() => import('./pages/admin/MovieForm'));

/** Supabase emits PASSWORD_RECOVERY after the e-mail link is opened; send the user to the form. */
function RecoveryRedirect() {
  const { recovering } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (recovering && window.location.pathname !== '/reset-password') navigate('/reset-password', { replace: true });
  }, [recovering, navigate]);
  return null;
}

const fallback = <div className="flex justify-center py-24"><Spinner /></div>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CatalogProvider>
          <WatchlistProvider>
            <RecoveryRedirect />
            <Suspense fallback={fallback}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="movies" element={<Browse />} />
                  <Route path="recent" element={<Browse title="Recently Added" defaultSort="recent" />} />
                  <Route path="genres" element={<Genres />} />
                  <Route path="movie/:id" element={<MovieDetail />} />
                  <Route path="watch/:id" element={<Watch />} />
                  <Route path="login" element={<Login />} />
                  <Route path="register" element={<Login initialMode="register" />} />
                  <Route path="reset-password" element={<ResetPassword />} />
                  <Route path="watchlist" element={<RequireAuth><Watchlist /></RequireAuth>} />
                  <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
                  <Route path="admin" element={<RequireAuth admin><Dashboard /></RequireAuth>} />
                  <Route path="admin/movies/new" element={<RequireAuth admin><MovieForm /></RequireAuth>} />
                  <Route path="admin/movies/:id" element={<RequireAuth admin><MovieForm /></RequireAuth>} />
                  <Route path="about" element={<StaticPage page="about" />} />
                  <Route path="contact" element={<StaticPage page="contact" />} />
                  <Route path="privacy" element={<StaticPage page="privacy" />} />
                  <Route path="terms" element={<StaticPage page="terms" />} />
                  <Route path="home" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </WatchlistProvider>
        </CatalogProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
