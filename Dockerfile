# Install all workspace deps from the lockfile
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

# Build the web dashboard
COPY web/ web/
WORKDIR /repo/web
RUN npm run build

# Build (and test) the API server
WORKDIR /repo/server
COPY server/ .
RUN npm run typecheck && npm test
RUN npm run build

# Runtime image: server serves the API + static dashboard
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/server/dist ./server/dist
COPY --from=build /repo/server/package.json ./server/package.json
COPY --from=build /repo/web/dist ./web/dist
EXPOSE 8080
USER node
CMD ["node", "server/dist/index.js"]
