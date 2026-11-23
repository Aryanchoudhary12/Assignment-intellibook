FROM node:24-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* && npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile && pnpm run generate
COPY . .
RUN pnpm run build && chown -R node:node .next
USER node
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:push && exec pnpm start --hostname 0.0.0.0"]
