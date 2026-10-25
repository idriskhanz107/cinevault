import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Clapperboard, LogIn, LogOut, Menu, Shield, User, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { isConfigured, isDemoMode } from '../lib/env';
import { SearchBar } from './SearchBar';
import { Alert } from './ui';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight" aria-label="CineVault home">
      <Clapperboard className="h-6 w-6 text-gold-400" aria-hidden />
      <span>Cine<span className="text-gold-400">Vault</span></span>
    </Link>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 text-sm font-medium transition-colors hover:text-gold-400 ${isActive ? 'text-gold-400' : 'text-fog-300'}`;

export function Layout() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const { connected } = useCatalog();
  const [open, setOpen] = useState(false);

  const links = (
    <>
      <NavLink to="/" end className={linkClass} onClick={() => setOpen(false)}>Home</NavLink>
      <NavLink to="/movies" end className={linkClass} onClick={() => setOpen(false)}>Movies</NavLink>
      <NavLink to="/genres" className={linkClass} onClick={() => setOpen(false)}>Genres</NavLink>
      <NavLink to="/recent" className={linkClass} onClick={() => setOpen(false)}>Recently Added</NavLink>
      <NavLink to="/watchlist" className={linkClass} onClick={() => setOpen(false)}>My Watchlist</NavLink>
      {isAdmin && <NavLink to="/admin" className={linkClass} onClick={() => setOpen(false)}><Shield className="mr-1 inline h-3.5 w-3.5" aria-hidden />Admin</NavLink>}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav aria-label="Primary" className="hidden items-center gap-3 lg:flex">{links}</nav>
          <div className="ml-auto flex items-center gap-3">
            <SearchBar className="hidden w-72 md:block" />
            {user ? (
              <div className="flex items-center gap-2">
                <Link to="/profile" className="btn btn-ghost !px-3 !py-1.5" aria-label="Profile">
                  <User className="h-4 w-4" aria-hidden />
                  <span className="hidden max-w-24 truncate sm:inline">{profile?.display_name || 'Profile'}</span>
                </Link>
                <button type="button" onClick={() => void signOut()} className="btn btn-ghost !px-3 !py-1.5" aria-label="Log out">
                  <LogOut className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : (
              !isDemoMode && <Link to="/login" className="btn btn-primary !py-1.5"><LogIn className="h-4 w-4" aria-hidden />Log in</Link>
            )}
            <button type="button" className="rounded p-2 lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" aria-label="Toggle menu">
              {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </div>
        {open && (
          <div id="mobile-nav" className="border-t border-white/5 px-4 py-3 lg:hidden">
            <SearchBar className="mb-3 md:hidden" />
            <nav aria-label="Mobile" className="flex flex-col gap-2">{links}</nav>
          </div>
        )}
      </header>

      {isDemoMode && (
        <div className="bg-gold-400 px-4 py-1.5 text-center text-xs font-semibold text-black">
          DEMO MODE — sample fictional movies. Set VITE_DEMO_MODE=false and configure Supabase for real data.
        </div>
      )}
      {!isConfigured && !isDemoMode && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4">
          <Alert kind="info">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and fill in your project values (see README).</Alert>
        </div>
      )}

      <main id="main" className="flex-1"><Outlet /></main>

      <footer className="mt-12 border-t border-white/5 bg-ink-950 py-8 text-sm text-fog-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            {!isDemoMode && isConfigured && (
              <span className="flex items-center gap-1 text-xs" title="Live catalogue updates">
                <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-fog-500'}`} aria-hidden />
                {connected ? 'Live' : 'Offline'}
              </span>
            )}
          </div>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-5">
            <Link to="/about" className="hover:text-gold-400">About</Link>
            <Link to="/contact" className="hover:text-gold-400">Contact</Link>
            <Link to="/privacy" className="hover:text-gold-400">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-gold-400">Terms of Service</Link>
          </nav>
          <p>© {new Date().getFullYear()} CineVault</p>
        </div>
      </footer>
    </div>
  );
}
