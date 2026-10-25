import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, PageContainer } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { isConfigured } from '../lib/env';

type Mode = 'login' | 'register' | 'forgot';

export default function Login({ initialMode = 'login' }: { initialMode?: Mode }) {
  const { user, signIn, signUp, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  // Only allow same-site relative redirects.
  const dest = from && from.startsWith('/') && !from.startsWith('//') ? from : '/';

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (user) return <Navigate to={dest} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!isConfigured) return setError('Authentication is not configured.');
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        navigate(dest, { replace: true });
      } else if (mode === 'register') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        const r = await signUp(email.trim(), password, name.trim());
        if (r.needsConfirmation) setInfo('Check your inbox to confirm your email address, then log in.');
        else navigate(dest, { replace: true });
      } else {
        await requestPasswordReset(email.trim());
        // Same message whether or not the account exists (no account enumeration).
        setInfo('If an account exists for that email, a reset link is on its way.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const title = { login: 'Welcome back', register: 'Create your account', forgot: 'Reset your password' }[mode];

  return (
    <PageContainer className="flex justify-center py-12">
      <div className="w-full max-w-md rounded-2xl border border-ink-600 bg-ink-800 p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate={false}>
          {mode === 'register' && (
            <div>
              <label className="label" htmlFor="name">Display name</label>
              <input id="name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required className="input" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          {mode !== 'forgot' && (
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" required minLength={mode === 'register' ? 8 : undefined} maxLength={128} className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>
          )}
          {error && <Alert>{error}</Alert>}
          {info && <Alert kind="success">{info}</Alert>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? 'Please wait…' : { login: 'Log in', register: 'Sign up', forgot: 'Send reset link' }[mode]}
          </button>
        </form>
        <div className="mt-5 flex flex-col gap-2 text-sm text-fog-300">
          {mode === 'login' && <>
            <button type="button" className="text-left text-gold-400 hover:underline" onClick={() => { setMode('forgot'); setError(null); setInfo(null); }}>Forgot your password?</button>
            <span>New to CineVault? <button type="button" className="text-gold-400 hover:underline" onClick={() => { setMode('register'); setError(null); setInfo(null); }}>Create an account</button></span>
          </>}
          {mode !== 'login' && <button type="button" className="text-left text-gold-400 hover:underline" onClick={() => { setMode('login'); setError(null); setInfo(null); }}>Back to log in</button>}
          <Link to="/" className="hover:text-gold-400">Continue browsing</Link>
        </div>
      </div>
    </PageContainer>
  );
}
