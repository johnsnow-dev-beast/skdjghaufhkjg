FROM node:22-bullseye

# Install all system dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    build-essential \
    # Canvas dependencies
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    # Sharp dependencies
    libvips-dev \
    # FFmpeg for media processing
    ffmpeg \
    # Playwright/Chromium dependencies
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    # General utilities
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install npm dependencies (postinstall will run playwright install)
RUN npm install

# Set environment variables for Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# Copy application source
COPY . .

# Create health check server
RUN echo 'const http = require("http"); const server = http.createServer((req, res) => { res.writeHead(200); res.end("ok"); }); server.listen(8000, "0.0.0.0", () => { console.log("✅ Health check server running on port 8000"); });' > health.js

# Start health server in background, then start the bot
CMD node health.js & node index.js