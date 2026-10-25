import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, PageContainer, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';

/** Reached from the password-reset e-mail. Supabase signs the user in with a recovery session. */
export default function ResetPassword() {
  const { user, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (!user) {
    return (
      <PageContainer className="py-12">
        <Alert>This reset link is invalid or has expired. <Link to="/login" className="underline">Request a new one</Link>.</Alert>
      </PageContainer>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await updatePassword(password);
      navigate('/profile', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageContainer className="flex justify-center py-12">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border border-ink-600 bg-ink-800 p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold">Choose a new password</h1>
        <div>
          <label className="label" htmlFor="np">New password</label>
          <input id="np" type="password" className="input" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <label className="label" htmlFor="cp">Confirm password</label>
          <input id="cp" type="password" className="input" required minLength={8} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <Alert>{error}</Alert>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </PageContainer>
  );
}
