FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/dist ./dist
# Server depends on dist for static serving in production
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist-server/index.js"]
