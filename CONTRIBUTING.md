# Contributing to HDPsyChart

Thanks for your interest. This project is MIT-licensed and welcomes contributions.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Rust | stable | `rust-toolchain.toml` pins the components and the `wasm32-unknown-unknown` target |
| wasm-pack | 0.13+ | `cargo install wasm-pack` |
| Node.js | 20+ | |

## Local setup

```bash
git clone https://github.com/ernsoylu/psypro.git
cd psypro
cd web && npm install
npm run dev          # builds the WASM package, then starts Vite
```

`npm run dev` rebuilds the WASM package first. If you change Rust code while the
dev server is running, re-run `npm run wasm` — Vite will pick up the new module.

## Checks to run before opening a PR

These are exactly what CI runs, so a green local run means a green CI run.

```bash
# Rust
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Web (from web/)
npm run typecheck
npm run lint
npm run test
```

Run a single test with `cargo test -p psychro-core <name> -- --exact --nocapture`
or `npx vitest run src/App.test.tsx -t "renders the application shell"`.

## Architecture rules

These boundaries are what make the project testable and forkable. A PR that
crosses them will be asked to change, so it is worth knowing them up front.

1. **All thermodynamics lives in `crates/psychro-core`.** TypeScript never
   reimplements psychrometric math, not even for a quick preview — two
   implementations will drift.
2. **`crates/psychro-wasm` contains no calculations.** It only translates across
   the JS boundary. Logic placed there is invisible to `cargo test`.
3. **Types flow one way.** `wasm-bindgen` generates `.d.ts` into `web/src/wasm/`;
   the frontend imports those. Do not hand-write a TypeScript mirror of a Rust struct.
4. **The engine is stateless.** Unit system and altitude are call arguments, never
   ambient state inside the crate.
5. **No hard-coded colours, dimensions, or user-facing strings** in components.
   Colours and layout dimensions come from `web/src/theme.css`; strings go
   through the i18n layer.
6. **No required network calls to proprietary services.** The app must run fully
   offline and self-hosted.
7. **Public Rust items carry Rustdoc.** `missing_docs` is a warning and CI treats
   warnings as errors.

## Dependencies

New dependencies — npm and crates alike — must be permissively licensed
(MIT / Apache-2.0 / BSD or equivalent). A copyleft transitive dependency is a
blocker. Please note the license of anything you add in the PR description.

Note: TypeScript is pinned to 6.x because `typescript-eslint` does not yet
support TypeScript 7.

## Pull requests

`main` is protected — work on a branch and open a PR.

```bash
git checkout -b feat/<short-slug>
git push -u origin HEAD
gh pr create --fill
```

Keep PRs scoped to one phase of `DEVELOPMENT_PLAN.md` where possible, and say
which phase in the description.

## Translations

UI strings live in JSON files. Adding a language should not require touching any
React code — if it does, that is a bug worth reporting.
