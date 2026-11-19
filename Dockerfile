# The API image. It lives at the repo root because the build needs the whole workspace, and
# Railway picks up a root Dockerfile with no configuration.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @agnipath/api...
RUN pnpm --filter @agnipath/api build
RUN pnpm --filter @agnipath/api deploy --prod --legacy /app

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
