# Build stage: compile TS -> dist, keep production deps only.
FROM node:24 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.check.json ./
COPY src ./src
# tsc only emits JS; the DB reads schema.sql (a non-TS asset) next to dist/db/index.js,
# so copy it into dist/ or the container fails to boot (ENOENT dist/db/schema.sql).
RUN npm run build && cp src/db/schema.sql dist/db/schema.sql && npm prune --omit=dev

# Runtime: Debian-based node:24 (not Alpine) — the capture pipeline launches
# the `chrome` channel (Google Chrome), which has no musl/Alpine build.
FROM node:24
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget ca-certificates fonts-liberation \
        libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 \
        libdrm2 libgbm1 libnspr4 libnss3 libx11-6 libxcomposite1 \
        libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN useradd -m webcap && mkdir -p /data && chown webcap /data
USER webcap
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/main.js"]
