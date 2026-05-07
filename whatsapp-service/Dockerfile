# Uses the official Puppeteer image which includes a compatible Chrome build
FROM ghcr.io/puppeteer/puppeteer:24

USER root

# Skip re-downloading Chrome on npm install; use the Chrome bundled in the base image.
# Do NOT override PUPPETEER_EXECUTABLE_PATH — the base image already sets it correctly.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# /data is mounted as a Railway volume — configure in Railway dashboard, not here

EXPOSE 3001

CMD ["node", "server.js"]
