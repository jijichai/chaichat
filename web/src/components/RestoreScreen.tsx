import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { api, ApiError } from '../auth/api';
import { adoptVerifiedSession } from '../auth/provision';

const OTP_LEN = 6;

export function RestoreScreen({ onBack }: { onBack: () => void }) {
  const adoptSession = useApp((s) => s.adoptSession);
  const [step, setStep] = useState<'email' | 'code'>('email');
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

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.restoreStart(email.trim());
      setStep('code');
      setResendIn(60);
      setDigits(Array(OTP_LEN).fill(''));
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    } catch {
      setError('could not send the code — try again');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const verified = await api.restoreConfirm(email.trim(), code);
      const session = adoptVerifiedSession(verified);
      adoptSession(session);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'InvalidCode'
          ? 'wrong code — check your email and try again'
          : 'could not sign you in — try again',
      );
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

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8">
      <div className="text-4xl">🍵</div>
      <div className="text-lg font-semibold">
        {step === 'email' ? 'Sign in with email' : 'Check your email'}
      </div>

      {step === 'email' ? (
        <div className="flex w-full max-w-xs flex-col gap-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && emailValid && void sendCode()}
            className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm outline-none focus:border-chai/60"
          />
          {error ? <div className="text-xs text-err">{error}</div> : null}
          <button
            onClick={() => void sendCode()}
            disabled={!emailValid || busy}
            className="w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg disabled:opacity-40"
          >
            {busy ? 'sending…' : 'Send code'}
          </button>
          <button onClick={onBack} className="py-2 text-xs text-ink-dim">
            ← back
          </button>
        </div>
      ) : (
        <div className="flex w-full max-w-xs flex-col gap-3">
          <p className="text-center text-xs text-ink-dim">
            enter the {OTP_LEN}-digit code sent to <b>{email.trim()}</b>
          </p>
          <div className="flex justify-center gap-2">
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
                className="h-12 w-10 rounded-lg border border-border bg-surface text-center text-lg font-bold outline-none focus:border-chai/60 disabled:opacity-50"
              />
            ))}
          </div>
          {error ? <div className="text-center text-xs text-err">{error}</div> : null}
          <button
            onClick={() => void sendCode()}
            disabled={resendIn > 0 || busy}
            className="py-1 text-center text-xs text-ink-dim disabled:opacity-50"
          >
            {resendIn > 0 ? `resend in 0:${String(resendIn).padStart(2, '0')}` : 'resend code'}
          </button>
          <button onClick={() => setStep('email')} className="py-1 text-center text-xs text-ink-dim">
            ← different email
          </button>
        </div>
      )}
    </div>
  );
}
