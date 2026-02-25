FROM node:20-alpine AS builder
WORKDIR /app
ENV HUSKY=0

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/api/package.json packages/api/package.json

RUN npm install

COPY packages/shared packages/shared
COPY packages/api packages/api

RUN npm run build -w @supervise-ai/shared
RUN npm run build -w @supervise-ai/api

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0

COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/api/package.json packages/api/package.json

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api/dist packages/api/dist

EXPOSE 3000

CMD ["npm", "run", "start:prod", "-w", "@supervise-ai/api"]
