FROM node:24.19.0-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"

RUN apk upgrade --no-cache \
    && apk list --installed libssl3 libcrypto3 \
    && corepack enable pnpm \
    && corepack install --global pnpm@11.24.0 \
    && pnpm --version \
    && pnpm add --global @tiangong-lca/mcp-server@0.2.1

EXPOSE 80

CMD ["tiangong-lca-mcp-http"]
