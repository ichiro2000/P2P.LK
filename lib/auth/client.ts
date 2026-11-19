"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";

/** Browser auth client. Same origin, so no baseURL needed. */
export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    inferAdditionalFields({
      user: {
        merchantName: { type: "string", required: true },
        whatsapp: { type: "string", required: true },
        binanceUrl: { type: "string", required: false },
        bybitUrl: { type: "string", required: false },
        role: { type: "string", required: false, input: false },
        status: { type: "string", required: false, input: false },
        reviewNote: { type: "string", required: false, input: false },
      },
    }),
  ],
});

/** Header carrying the Turnstile token for protected auth endpoints. */
export function captchaHeaders(token: string | null) {
  return token ? { headers: { "x-captcha-response": token } } : undefined;
}
