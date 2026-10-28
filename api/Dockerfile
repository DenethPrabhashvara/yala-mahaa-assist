FROM node:24-alpine
WORKDIR /app
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY api/ ./
RUN mkdir -p logs && chown node:node logs
USER node
EXPOSE 8005
CMD ["node", "server.js"]
