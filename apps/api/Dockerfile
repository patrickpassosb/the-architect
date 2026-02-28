FROM node:20-alpine

WORKDIR /workspace

COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.node.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm install

COPY apps/api apps/api
COPY packages/core packages/core
COPY packages/shared-types packages/shared-types

RUN npm run build -w packages/shared-types \
  && npm run build -w packages/core \
  && npm run build -w apps/api

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "run", "start", "-w", "apps/api"]
