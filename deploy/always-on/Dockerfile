# Kore, always on: `kore mcp --http --sync` over a git clone of a vault,
# with no desktop app anywhere. Build from the repository root:
#
#   docker build -f deploy/always-on/Dockerfile -t kore-host .
#
# See docs/always-on.md for running it.

FROM rust:1-bookworm AS cli
WORKDIR /src
COPY . .
RUN cargo build --release --locked -p kore-cli

FROM node:22-bookworm-slim AS indexer
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kore/core... \
 && pnpm --filter @kore/core build:indexer

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=cli /src/target/release/kore /usr/local/bin/kore
COPY --from=indexer /src/packages/core/dist/kore-indexer.mjs /usr/local/bin/kore-indexer.mjs
COPY deploy/always-on/entrypoint.sh /usr/local/bin/kore-host
ENV KORE_VAULT=/vault \
    KORE_LISTEN=0.0.0.0:8765 \
    KORE_SYNC_EVERY=60
RUN mkdir -p /vault && chown node:node /vault
VOLUME /vault
EXPOSE 8765
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kore-host"]
