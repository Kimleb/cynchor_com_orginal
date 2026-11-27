FROM node:22-alpine
# Source and production deps are baked into the image (no bind mounts).
WORKDIR /opt/target
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js db.js entrypoint.sh ./
RUN chmod 0755 entrypoint.sh
# The image root is read-only at run time; /app is a tmpfs filled by entrypoint.sh. NODE_ENV stays unset: production disables seeding.
ENV PORT=8080 HOST=0.0.0.0 RANGE_DB_PATH=:memory:
USER node
EXPOSE 8080
ENTRYPOINT ["/opt/target/entrypoint.sh"]
