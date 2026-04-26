# Uses the official Puppeteer image which includes a compatible Chrome build
FROM ghcr.io/puppeteer/puppeteer:22

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# /data is mounted as a Railway volume for session persistence
VOLUME ["/data"]

EXPOSE 3001

CMD ["node", "server.js"]
