# Image for your own server. compose.yaml builds two targets from this file:
# `game` (the Node room server) and `caddy` (HTTPS in front of it). DEPLOY.md.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# index.html from src/ plus the Discord SDK bundle; esbuild is a devDependency
RUN npm run build:activity

# The Caddyfile is baked in: a bind-mounted file would keep pointing at the
# old copy after a deploy replaces the project directory.
FROM caddy:2-alpine AS caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile

FROM node:24-alpine AS game
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
# server/worker.js runs the same combat core as the browser
COPY src/60-weapons.js src/62-combat-core.js ./src/
COPY --from=build /app/index.html ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/index.js"]
