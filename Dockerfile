# PsyPro self-hosting image: a fresh clone builds here with no toolchain on the
# host beyond Docker itself. Three stages mirror CI's pins — same wasm-pack,
# same Node major — so "it works in CI" and "it works in the image" agree.

# --- Stage 1: compile the calculation engine to WASM -------------------------
# `latest` tracks the stable channel; rust-toolchain.toml stays authoritative.
FROM rust:latest AS wasm

# Same pin as CI: v0.9.1-era wasm-pack predates Cargo workspace inheritance and
# cannot parse `license.workspace = true`.
ARG WASM_PACK_VERSION=v0.15.0
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) triple=x86_64-unknown-linux-musl ;; \
      arm64) triple=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/rustwasm/wasm-pack/releases/download/${WASM_PACK_VERSION}/wasm-pack-${WASM_PACK_VERSION}-${triple}.tar.gz" \
       | tar -xz --strip-components=1 -C /usr/local/bin "wasm-pack-${WASM_PACK_VERSION}-${triple}/wasm-pack"

WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates crates
COPY vendor vendor

# rust-toolchain.toml declares the target; add it explicitly so the build never
# depends on rustup's auto-install behaviour inside the image.
RUN rustup target add wasm32-unknown-unknown \
    && wasm-pack build crates/psychro-wasm --target web --out-dir /wasm --out-name psychro

# --- Stage 2: typecheck and bundle the frontend ------------------------------
FROM node:20 AS web

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web .
COPY --from=wasm /wasm ./src/wasm
RUN npx tsc --noEmit && npx vite build

# --- Stage 3: serve the static bundle ----------------------------------------
FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /app/web/dist /usr/share/nginx/html

EXPOSE 80
