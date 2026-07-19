# Production image — secrets are injected at runtime by Railway, not baked into the image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Runtime IDL JSON isn't emitted by tsc — copy it into dist so TxLINE can load it.
COPY src/services/txline/idl ./dist/services/txline/idl

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["node", "dist/agent-server.js"]
