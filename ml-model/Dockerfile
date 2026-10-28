FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY ml-model/server.js ml-model/
COPY ml-model/model ml-model/model
USER node
EXPOSE 5000
CMD ["node", "ml-model/server.js"]
