FROM node:20-alpine

WORKDIR /workspace

COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.node.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm install

COPY apps/worker apps/worker
COPY packages/core packages/core
COPY packages/shared-types packages/shared-types

RUN npm run build -w packages/shared-types \
  && npm run build -w packages/core \
  && npm run build -w apps/worker

ENV NODE_ENV=production
ENV WORKER_PORT=8080

EXPOSE 8080

CMD ["npm", "run", "start", "-w", "apps/worker"]
