# ✅ Use the official Playwright image (Chromium + deps preinstalled)
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime env
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
