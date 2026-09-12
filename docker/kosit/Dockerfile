# KoSIT Validator + XRechnung 3.0.2 validator configuration.
# Pins are tracked in docker/images.lock; bumping a version is its own
# reviewed task (AGENTS.md §7, §9), not a drive-by edit here.
FROM eclipse-temurin@sha256:bce52ea7da1f72e6bf5bec505e63b6eb55ba79ad1226903579f77eab1a80139a

ARG VALIDATOR_VERSION=1.6.3
ARG VALIDATOR_SHA256=799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9
ARG CONFIG_URL=https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip
ARG CONFIG_SHA256=2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8

WORKDIR /opt/kosit

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o validator.jar \
       "https://github.com/itplr-kosit/validator/releases/download/v${VALIDATOR_VERSION}/validator-${VALIDATOR_VERSION}-standalone.jar" \
  && echo "${VALIDATOR_SHA256}  validator.jar" | sha256sum -c - \
  && curl -fsSL -o config.zip "${CONFIG_URL}" \
  && echo "${CONFIG_SHA256}  config.zip" | sha256sum -c - \
  && unzip -q config.zip -d config \
  && rm config.zip

WORKDIR /data
ENTRYPOINT ["java", "-jar", "/opt/kosit/validator.jar", "-s", "/opt/kosit/config/scenarios.xml", "-r", "/opt/kosit/config"]
