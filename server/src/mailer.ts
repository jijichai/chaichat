/** Backup-OTP email via the Cloudflare Email Service send_email binding. */

export async function sendOtpEmail(env: Env, to: string, code: string): Promise<void> {
  const subject = `${code} is your chaichat backup code`;
  const text = [
    `Your chaichat backup code is: ${code}`,
    '',
    'Enter it in the app to bind this email to your account.',
    'The code expires in 10 minutes. If you did not request this, ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">🍵 chaichat</h2>
      <p>Your backup code is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:12px 0">${code}</p>
      <p style="color:#666;font-size:13px">
        Enter it in the app to bind this email to your account.<br/>
        The code expires in 10 minutes. If you did not request this, ignore this email.
      </p>
    </div>`;

  // Local dev: the binding may be absent or unable to deliver — log instead.
  if (env.DEV_FAKE_EPDS === '1') {
    console.log(JSON.stringify({ level: 'info', message: 'DEV OTP email', to, code }));
    return;
  }

  await env.EMAIL.send({
    to,
    from: { email: env.EMAIL_FROM, name: 'chaichat' },
    subject,
    text,
    html,
  });
}
