FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bot ./bot
COPY miniapp ./miniapp
COPY runtime ./runtime
RUN mkdir -p /data/bot /data/reports /data/bridge /data/cache && chown -R node:node /data
ENV NODE_ENV=production
USER node
WORKDIR /data/cache
CMD ["node", "/app/runtime/start.cjs", "bot"]
