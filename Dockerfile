# Aiko — 3D anime qiz sayti + Telegram bot
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NODE_NO_WARNINGS=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.js ./
COPY lib ./lib
COPY scripts ./scripts
# baza shu papkada saqlanadi (docker volume)
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js", "--prod"]
