FROM node:24-alpine AS admin
WORKDIR /src
COPY adminportal/package*.json ./
RUN npm ci
COPY adminportal/ ./
RUN npm run build

FROM node:24-alpine AS farmer
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAPS_MAP_ID
WORKDIR /src
COPY farmerportal/package*.json ./
RUN npm ci
COPY farmerportal/ ./
RUN npm run build

FROM caddy:2-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin /src/dist /srv/admin
COPY --from=farmer /src/dist /srv/farmer
