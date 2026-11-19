# The API image. It lives at the repo root because the build needs the whole workspace.
# Render's free plan has no pre-deploy step, so migrations run when the container starts.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @reomi/api...
RUN pnpm --filter @reomi/api build
RUN pnpm --filter @reomi/api deploy --prod --legacy /app

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
USER node
EXPOSE 8080
CMD ["sh", "-c", "node dist/release.js && node dist/server.js"]
