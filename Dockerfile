# Production image (untested in this environment: Docker is not installed on the dev machine).
# Build: docker build -t ses-web .   Run web: docker run -e DATABASE_URL=… -e APP_URL=… -e APP_ENCRYPTION_KEY=… -e WORKER_MODE=external -p 3000:3000 ses-web
# Run worker from the same image: docker run … ses-web npm run worker
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production SIMULATORS_ENABLED=false
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app ./
USER app
EXPOSE 3000
CMD ["npm", "start"]
