export type PasswordRule = { label: string; ok: boolean };

export function passwordRules(pw: string): PasswordRule[] {
  return [
    { label: "One capital letter", ok: /[A-Z]/.test(pw) },
    { label: "One small letter", ok: /[a-z]/.test(pw) },
    { label: "One number", ok: /[0-9]/.test(pw) },
    { label: "8 or more characters", ok: pw.length >= 8 },
  ];
}

export function passwordValid(pw: string): boolean {
  return passwordRules(pw).every((r) => r.ok);
}
