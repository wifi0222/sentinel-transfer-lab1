FROM node:20.18.0-alpine AS build
WORKDIR /build
COPY package*.json ./
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev

FROM node:20.18.0-alpine
RUN addgroup -g 10001 -S sft && adduser -u 10001 -S -G sft sft
WORKDIR /app
COPY --from=build --chown=sft:sft /build/package*.json ./
COPY --from=build --chown=sft:sft /build/node_modules ./node_modules
COPY --from=build --chown=sft:sft /build/server/package.json ./server/package.json
COPY --from=build --chown=sft:sft /build/server/dist ./server/dist
COPY --from=build --chown=sft:sft /build/web/dist ./web/dist
RUN mkdir -p /app/data && chown sft:sft /app/data
USER sft
EXPOSE 8443
CMD ["node", "server/dist/index.js"]

