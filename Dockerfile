# syntax=docker/dockerfile:1.6
#
# Web service image for DO App Platform.
#
# Why a Dockerfile (instead of the stock node-js buildpack)?
#   We need a headless Chromium so the /api/suspicious/lookup endpoint can
#   follow Binance's `www.binance.com/qr/*` short-links — those redirects
#   are gated by an AWS WAF JS challenge that a plain `fetch()` from Node
#   can't solve. Playwright + its bundled Chromium handles it.
#
# The ingest worker doesn't need Chromium, so it stays on the buildpack
# (see .do/app.yaml) — this image is for the `web` service only.

# ── Build stage ──────────────────────────────────────────────────────────
# Use Playwright's own image as a builder — it already ships with a
# compatible Chromium + every shared library the browser needs. Saves us
# chasing Debian's apt-level chromium packaging footguns.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS builder

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Install with dev deps so `next build` can do its thing. Playwright's
# own browser is preinstalled in the base image at a known path that we
# inherit via the runtime stage below.
RUN npm ci --include=dev

COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# The pwuser is set up in the base image with access to the bundled
# Chromium cache under /ms-playwright. Run as that user so the sandbox
# options we pass to chromium.launch() are honored.

RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

USER pwuser

COPY --chown=pwuser:pwuser --from=builder /app/package.json /app/package-lock.json ./
COPY --chown=pwuser:pwuser --from=builder /app/.next ./.next
COPY --chown=pwuser:pwuser --from=builder /app/public ./public
COPY --chown=pwuser:pwuser --from=builder /app/node_modules ./node_modules

EXPOSE 3000

# dumb-init → npm → next start. Don't use shell form; we want signals to
# reach next start directly so Chromium child processes get cleaned up.
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
