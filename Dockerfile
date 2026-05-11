FROM node:24-slim

# Puppeteer drives the distro Chromium instead of downloading its own.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data && chown -R node:node /app
USER node

# Same as `npm start`: .env is dockerignored, so -if-exists skips it and compose supplies the environment.
CMD ["node", "--env-file-if-exists=.env", "src/main.ts"]
