FROM node:22-slim

# Install Chrome from Google's apt repo so the binary is at a known, explicit path.
# The puppeteer base image approach was unreliable: it runs as pptruser but we need
# root for Railway, causing puppeteer to look for Chrome in /root/.cache (empty).
RUN apt-get update \
    && apt-get install -y chromium --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# /data is mounted as a Railway volume — configure in Railway dashboard, not here

EXPOSE 3001

CMD ["node", "server.js"]
