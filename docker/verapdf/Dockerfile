# veraPDF Greenfield CLI — L3: PDF/A-3b conformance.
# veraPDF-apps is GPL-3.0/MPL-2.0; this is fine here because it is invoked as
# an external tool via `docker run`, never linked into or imported by any
# runtime package (AGENTS.md §5.1, §6 — conformance tooling is dev-only).
#
# The official distribution is an IzPack installer (no plain CLI-only
# archive), so we run it non-interactively with a pinned pack selection
# (auto-install.xml keeps only the "veraPDF CLI" pack).
FROM eclipse-temurin@sha256:bce52ea7da1f72e6bf5bec505e63b6eb55ba79ad1226903579f77eab1a80139a

ARG VERAPDF_SHA256=6cc6341cb1af644044054b81f00a6590a7918abb18f762243de115258bcad838

WORKDIR /build
COPY auto-install.xml .

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o verapdf-installer.zip "https://software.verapdf.org/releases/verapdf-installer.zip" \
  && echo "${VERAPDF_SHA256}  verapdf-installer.zip" | sha256sum -c - \
  && unzip -q verapdf-installer.zip \
  && cd verapdf-greenfield-* \
  && chmod +x verapdf-install \
  && ./verapdf-install /build/auto-install.xml \
  && cd / && rm -rf /build

WORKDIR /data
ENTRYPOINT ["/opt/verapdf/verapdf"]
