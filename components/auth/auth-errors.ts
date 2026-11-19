/** Better Auth client error → a sentence a person can act on. */
export type AuthErr = { code?: string; message?: string; status?: number } | null | undefined;

const BY_CODE: Record<string, string> = {
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Sign in instead.",
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PASSWORD: "That password isn't right.",
  PASSWORD_TOO_SHORT: "That password is too short.",
  PASSWORD_TOO_LONG: "That password is too long.",
  EMAIL_NOT_VERIFIED: "Verify your email before signing in.",
  INVALID_OTP: "That code isn't right. Check the latest email and try again.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes. Send a new one.",
  USER_NOT_FOUND: "We couldn't find an account with that email.",
  MISSING_RESPONSE: "Complete the human check first.",
  VERIFICATION_FAILED: "The human check failed. Try it again.",
};

export function authErrorMessage(err: AuthErr, fallback = "Something went wrong. Try again."): string {
  if (!err) return fallback;
  if (err.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (err.code && BY_CODE[err.code]) return BY_CODE[err.code];
  if (err.message && err.message.length < 200) return err.message;
  return fallback;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
