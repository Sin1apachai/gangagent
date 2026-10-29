FROM node:22-bookworm-slim AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build && npm test

FROM rust:1.92-bookworm AS rust-build
WORKDIR /build
COPY server/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/target cargo build --locked --release && cargo test --locked --release && cp target/release/agent-office /build/agent-office-bin

FROM debian:bookworm-slim AS runtime
RUN useradd --system --uid 10001 office
WORKDIR /app
COPY --from=rust-build /build/agent-office-bin /app/agent-office
COPY --from=web-build /web/dist /app/web
COPY --from=rust-build /build/Cargo.lock /app/build-info/Cargo.lock
COPY --from=web-build /web/package-lock.json /app/build-info/package-lock.json
USER office
EXPOSE 8080
CMD ["/app/agent-office"]

FROM node:22-bookworm-slim AS worker
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git acl && rm -rf /var/lib/apt/lists/*
RUN npm install --global --no-audit --no-fund @openai/codex@0.165.0 @anthropic-ai/claude-code@2.1.312
RUN useradd --create-home --uid 10001 --user-group office
ENV HOME=/home/office CODEX_HOME=/home/office/.codex CLAUDE_CONFIG_DIR=/home/office/.claude
WORKDIR /app
COPY --from=rust-build /build/agent-office-bin /app/agent-office
CMD ["/app/agent-office", "--worker"]
