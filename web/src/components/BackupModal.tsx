import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { api, ApiError } from '../auth/api';

const OTP_LEN = 6;

export function BackupModal() {
  const session = useApp((s) => s.session);
  const setBackupOpen = useApp((s) => s.setBackupOpen);
  const markBackupDone = useApp((s) => s.markBackupDone);

  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  if (!session) return null;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.backupStart(session.sessionJwt, email.trim());
      setStep('code');
      setResendIn(60);
      setDigits(Array(OTP_LEN).fill(''));
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : 'could not send the code — try again');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.backupConfirm(session.sessionJwt, email.trim(), code);
      markBackupDone();
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : 'verification failed — try again');
      setDigits(Array(OTP_LEN).fill(''));
      inputsRef.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onDigit = (i: number, value: string) => {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < OTP_LEN - 1) inputsRef.current[i + 1]?.focus();
    const code = next.join('');
    if (code.length === OTP_LEN && next.every(Boolean)) void confirm(code);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LEN);
    if (text.length === OTP_LEN) {
      e.preventDefault();
      setDigits(text.split(''));
      void confirm(text);
    }
  };

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between pb-3">
          <div className="font-semibold">
            {step === 'email' ? 'Back up account data' : step === 'code' ? 'Check your email' : 'Backed up!'}
          </div>
          <button onClick={() => setBackupOpen(false)} className="px-2 text-ink-dim">
            ✕
          </button>
        </div>

        {step === 'email' ? (
          <>
            <p className="pb-3 text-xs text-ink-dim">
              we'll bind your identity to your email — nothing else is stored. you can then sign
              in on any device.
            </p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && emailValid && void sendCode()}
              className="w-full rounded-xl border border-border bg-bg px-3 py-3 text-sm outline-none focus:border-chai/60"
            />
            {error ? <div className="pt-2 text-xs text-err">{error}</div> : null}
            <button
              onClick={() => void sendCode()}
              disabled={!emailValid || busy}
              className="mt-3 w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg disabled:opacity-40"
            >
              {busy ? 'sending…' : 'Send code'}
            </button>
          </>
        ) : step === 'code' ? (
          <>
            <p className="pb-3 text-xs text-ink-dim">
              enter the {OTP_LEN}-digit code sent to <b>{maskEmail(email)}</b>
            </p>
            <div className="flex justify-center gap-2" onPaste={onPaste}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  value={d}
                  onChange={(e) => onDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digits[i] && i > 0) {
                      inputsRef.current[i - 1]?.focus();
                    }
                  }}
                  inputMode="numeric"
                  maxLength={1}
                  disabled={busy}
                  className="h-12 w-10 rounded-lg border border-border bg-bg text-center text-lg font-bold outline-none focus:border-chai/60 disabled:opacity-50"
                />
              ))}
            </div>
            {error ? <div className="pt-2 text-center text-xs text-err">{error}</div> : null}
            <button
              onClick={() => void sendCode()}
              disabled={resendIn > 0 || busy}
              className="mt-3 w-full py-2 text-center text-xs text-ink-dim disabled:opacity-50"
            >
              {resendIn > 0 ? `resend in 0:${String(resendIn).padStart(2, '0')}` : 'resend code'}
            </button>
          </>
        ) : (
          <>
            <p className="pb-4 text-sm text-ink-dim">
              ✓ you can now sign in with <b>{maskEmail(email)}</b> on any device to recover this
              identity.
            </p>
            <button
              onClick={() => setBackupOpen(false)}
              className="w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.trim().split('@');
  const head = user.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(user.length - 1, 2))}@${domain}`;
}

function friendly(err: ApiError): string {
  switch (err.code) {
    case 'InvalidCode':
      return 'wrong code — check your email and try again';
    case 'TooManyAttempts':
      return 'too many attempts — request a new code';
    case 'EmailInUse':
      return 'this email is already linked to another account';
    case 'RateLimitExceeded':
      return 'too many requests — wait a bit and try again';
    default:
      return err.message || 'something went wrong';
  }
}
