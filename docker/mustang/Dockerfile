# Mustang CLI (mustangproject, Apache-2.0) — L3/L5: PDF/A + ZUGFeRD/Factur-X
# profile checks, XML<->PDF extraction, round-trip validation.
FROM eclipse-temurin@sha256:bce52ea7da1f72e6bf5bec505e63b6eb55ba79ad1226903579f77eab1a80139a

ARG MUSTANG_VERSION=2.26.0
ARG MUSTANG_SHA256=42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736

WORKDIR /opt/mustang

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o mustang-cli.jar \
       "https://github.com/ZUGFeRD/mustangproject/releases/download/core-${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar" \
  && echo "${MUSTANG_SHA256}  mustang-cli.jar" | sha256sum -c -

WORKDIR /data
ENTRYPOINT ["java", "-jar", "/opt/mustang/mustang-cli.jar"]
