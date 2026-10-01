import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from './api/client';
import { Button, Field, Input } from './components/ui';

const KEY = 'agent-flow.token';

export const getToken = () => localStorage.getItem(KEY);

export interface Identity {
  workspaceId: string;
  actor: string;
  /** Pages allowed to embed the canvas and receive annotations. */
  embedOrigins: string[];
}

/** Renders children once a valid token is stored; otherwise asks for one. */
export function AuthGate({ children }: { children: (identity: Identity, signOut: () => void) => ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [checking, setChecking] = useState(() => !!getToken());

  const signOut = () => {
    localStorage.removeItem(KEY);
    setIdentity(null);
  };

  useEffect(() => {
    if (getToken()) {
      api.me().then(setIdentity, signOut).finally(() => setChecking(false));
    }
    window.addEventListener('agent-flow:unauthorized', signOut);
    return () => window.removeEventListener('agent-flow:unauthorized', signOut);
  }, []);

  if (checking) return null;
  if (!identity) return <SignIn onSignedIn={setIdentity} />;
  return <>{children(identity, signOut)}</>;
}

function SignIn({ onSignedIn }: { onSignedIn: (identity: Identity) => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const identity = await api.me(token.trim());
      localStorage.setItem(KEY, token.trim());
      onSignedIn(identity);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'This token is not valid.' : 'Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-slate-50">
      <form onSubmit={submit} className="w-96 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Agent Flow</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">Sign in with your workspace access token.</p>
        <Field label="Access token" error={error} hint="Tokens are issued by your administrator (AUTH_TOKENS on the server).">

          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus required />
        </Field>
        <Button type="submit" variant="primary" className="mt-6 w-full" disabled={busy || !token.trim()}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
