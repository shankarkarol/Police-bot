# Use the official Playwright image (Chromium + deps preinstalled)
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

# Install deps (no lockfile → use npm install)
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Optional: slim the image (keep only prod deps after build)
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
