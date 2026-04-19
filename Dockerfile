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

# Pin the Playwright browser cache to an absolute path so lookups match
# no matter where the process is invoked from (DO App Platform sets
# runtime cwd to /workspace, which would otherwise send Playwright
# looking at /workspace/.cache/ms-playwright/* and miss the browser the
# base image pre-installed at /ms-playwright/*).
#
# Skip the post-install download: the base image already has a matching
# Chromium at that path, so `npm ci` should never re-fetch it.

# ── Build stage ──────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS builder

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
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
