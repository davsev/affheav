FROM node:22-slim

# System libraries required by Chrome/Chromium headless — no browser installed here;
# puppeteer downloads its own pinned Chromium build during npm install.
RUN apt-get update \
    && apt-get install -y \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-6 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxrandr2 \
        libxss1 \
        libxtst6 \
        wget \
        xdg-utils \
        --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# puppeteer downloads its compatible Chromium here (no PUPPETEER_SKIP_CHROMIUM_DOWNLOAD)
RUN npm install --omit=dev

COPY . .

# /data is mounted as a Railway volume — configure in Railway dashboard, not here

EXPOSE 3001

CMD ["node", "server.js"]
