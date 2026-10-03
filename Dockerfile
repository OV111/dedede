FROM node:22-slim

WORKDIR /app

# dependencies first, so this layer is cached until package files change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production PORT=3000
RUN mkdir -p data && chown node:node data

# never run as root
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
