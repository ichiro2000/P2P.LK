# syntax=docker/dockerfile:1.6
#
# Web service image for DO App Platform.
#
# Why a Dockerfile (instead of the stock node-js buildpack)?
#   We need a headless Chromium so the /api/suspicious/lookup endpoint can
#   follow Binance's `www.binance.com/qr/*` short-links — those redirects
#   are gated by an AWS WAF JS challenge that a plain `fetch()` from Node
#   can't solve. `playwright-core` + Debian's Chromium handles it, and the
#   buildpack doesn't give us a way to apt-install browser binaries.
#
# The ingest worker doesn't need Chromium, so it stays on the buildpack
# (see .do/app.yaml) — this image is for the `web` service only.

# ── Build stage ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install deps with dev so `next build` can do its thing.
COPY package.json package-lock.json ./
# Skip Playwright's bundled browser download — we use Debian's chromium at
# runtime. Saves ~300 MB per layer.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Tell our Playwright helper to use the system Chromium so we don't need
# Playwright's own downloaded binaries.
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Chromium + the minimum set of shared libs + fonts it needs to render
# Binance's WAF challenge page. dumb-init keeps PID 1 clean so Chromium
# child processes get reaped when Node exits.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      dumb-init \
      fonts-liberation \
      fonts-noto-color-emoji \
      fonts-dejavu-core \
      tzdata \
    && rm -rf /var/lib/apt/lists/*

# Non-root for Chromium sandbox safety. The `node` user ships with this
# base image — uid/gid 1000.
USER node

COPY --chown=node:node --from=builder /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=builder /app/.next ./.next
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

EXPOSE 3000

# dumb-init → npm → next start. Don't use shell form; we want signals to
# reach next start directly.
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
