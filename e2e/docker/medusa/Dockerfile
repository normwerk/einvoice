# T-078 "fast" profile: builds the committed e2e/app/ scaffold (docs/quickstart-medusa.md's pinned
# `create-medusa-app@2.19.0`; its `@medusajs/*` packages are pinned to 2.21.0) with the plugin packages
# installed from the stand's own Verdaccio — never workspace-linked (plan-e2e.md §2). Digest tracked in
# e2e/docker/images.lock, same convention as docker/images.lock for the conformance validator images
# (AGENTS.md §7).
FROM node@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85

# Medusa's own dependency tree pulls in native addons (argon2, etc.) that need a real toolchain on alpine.
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY . .

EXPOSE 9500

# `npm install` runs here, not as a `RUN` step above, for two real reasons (both found by a real build,
# not anticipated): (1) a Dockerfile `RUN` has no route to the `verdaccio` service's own DNS name — that
# only exists on the compose network at container-run time, once `docker compose up` has actually attached
# this container to it, never during a standalone image build; (2) baking it into an image layer would let
# Docker's build cache silently skip a real reinstall across runs whenever `e2e/app/`'s own files hadn't
# changed, even though Verdaccio's own storage is wiped fresh every run (tmpfs) — this app installing
# whatever the harness *just* published is the entire point (plan-e2e.md §2), not a cached snapshot of an
# earlier run. The real cost is a slower boot every time; correctness over speed here.
#
# Idempotent on every start: `db:migrate` is a no-op against an already-migrated database, and `user`
# tolerates a user that already exists (the harness may restart this container against the same, still
# running stand while iterating on scenarios) rather than failing the whole chain.
# EINVOICE_E2E_NPM_INSTALL_FLAGS is empty except for a Medusa release below the plugin's peer range
# (src/harness/medusa-version.ts), which installs only with --legacy-peer-deps.
#
# T-210: with EINVOICE_E2E_ADMIN=1 the dashboard is built first and served from the build. `--admin-only`
# builds the dashboard alone, into .medusa/admin: a full `medusa build` also type-checks the backend, fails on
# medusa-config.ts's import of an ESM package, and exits non-zero although the dashboard was built.
# `medusa start` serves ./public/admin, and only outside NODE_ENV=development — in development it tries the
# dashboard's dev server, which does not load here (`virtual:medusa/i18n`). Not `production` either, which
# changes more than the dashboard; `staging` is any other value.
CMD ["sh", "-c", "npm install $EINVOICE_E2E_NPM_INSTALL_FLAGS && export PATH=\"/app/node_modules/.bin:$PATH\" && medusa db:migrate && (medusa user -e admin@einvoice-e2e.example -p supersecret || true) && if [ \"$EINVOICE_E2E_ADMIN\" = 1 ]; then medusa build --admin-only && mkdir -p public && ln -sfn ../.medusa/admin public/admin && NODE_ENV=staging medusa start; else medusa start; fi"]
