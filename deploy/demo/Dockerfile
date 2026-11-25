# syntax=docker/dockerfile:1
FROM node:24-slim AS nodebin

FROM python:3.14-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Node 24 for demo-llm.mjs, seed.ts, and storefront scripts.
COPY --from=nodebin /usr/local/bin/node /usr/local/bin/node
COPY --from=nodebin /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Core tools + Linux Bot Desktop (Xvnc, minimal Xfce, Chromium).
# Intentionally omits sudo, xfce4-terminal, thunar, and mousepad to minimize attack surface.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      bash \
      procps \
      openssl \
      tini \
      tigervnc-standalone-server \
      xfce4-panel \
      xfwm4 \
      xfdesktop4 \
      xfce4-settings \
      dbus-x11 \
      x11-xserver-utils \
      x11-utils \
      x11-xkb-utils \
      xauth \
      fonts-dejavu-core \
      adwaita-icon-theme \
      chromium && \
    rm -rf /var/lib/apt/lists/*

# Non-root runtime user.
RUN groupadd --gid 10001 hermes && \
    useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash hermes

ARG HERMES_TAG=v0.21.6
ARG HERMES_COMMIT=818c13be1dc4fd28987e1e881a9408224afd4535
ARG PLUGIN_REPO=https://github.com/Madd-Technologies/blobs-hermes-bot-plugins.git
ARG PLUGIN_REF=c4a245ea7d72d587f2ba9b6e421901545f5e22ce

# Install Hermes Agent v0.21.6 into an isolated venv.
RUN git clone --quiet --depth 1 --branch "${HERMES_TAG}" https://github.com/NousResearch/hermes-agent.git /opt/hermes-agent && \
    test "$(git -C /opt/hermes-agent rev-parse HEAD)" = "${HERMES_COMMIT}" && \
    python3 -m venv /opt/hermes-agent/venv && \
    /opt/hermes-agent/venv/bin/pip install --quiet --upgrade pip && \
    /opt/hermes-agent/venv/bin/pip install --quiet -e /opt/hermes-agent && \
    /opt/hermes-agent/venv/bin/pip install --quiet "PyYAML==6.0.3"

# Pre-bake the pinned hermes-dashboard plugin as a local git repo for offline runtime installs.
RUN git clone --quiet "${PLUGIN_REPO}" /tmp/plugins-src && \
    git -C /tmp/plugins-src checkout --quiet "${PLUGIN_REF}" && \
    cp -R /tmp/plugins-src/hermes-dashboard /opt/hermes-dashboard-plugin && \
    rm -rf /tmp/plugins-src && \
    git -C /opt/hermes-dashboard-plugin init -b main >/dev/null && \
    git -C /opt/hermes-dashboard-plugin config user.name "Blobs Demo Builder" && \
    git -C /opt/hermes-dashboard-plugin config user.email "demo-builder@blobs.local" && \
    git -C /opt/hermes-dashboard-plugin add -A && \
    git -C /opt/hermes-dashboard-plugin commit --quiet -m "Pinned hermes-dashboard ${PLUGIN_REF}"

# Copy demo world scripts and Hermes client library modules needed by seed.ts.
WORKDIR /opt/blobs-demo
COPY scripts/demo /opt/blobs-demo/scripts/demo
COPY src/lib/hermes /opt/blobs-demo/src/lib/hermes
COPY deploy/demo/entrypoint.sh /opt/blobs-demo/entrypoint.sh
RUN chmod +x /opt/blobs-demo/entrypoint.sh && \
    mkdir -p /data/hermes /data/workspace /data/run /data/logs && \
    chown -R hermes:hermes /opt/blobs-demo /opt/hermes-agent /opt/hermes-dashboard-plugin /data /home/hermes

USER hermes
WORKDIR /data
EXPOSE 9219

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/blobs-demo/entrypoint.sh"]
CMD ["serve"]
