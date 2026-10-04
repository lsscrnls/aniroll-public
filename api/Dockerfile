FROM node:24-alpine
WORKDIR /app
COPY server.js party.js .
# Runs without root. A uid of its own, not the image's "node" (1000): on the host the mounted
# data/ gets chowned to this uid, and 1000 is often a real login account there.
# scripts/deploy.sh --api chowns data/ before starting the container.
RUN mkdir -p data && chown 10001:10001 data
USER 10001:10001
EXPOSE 3001
# /api/health answers once the server runs and can read and write data/
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "server.js"]
