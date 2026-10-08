# Сборка backend + статика фронтенда в один образ.
# Этап 1: сборка фронтенда
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Этап 2: сборка backend
FROM node:22-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
# Собрать backend и скопировать dist фронтенда в папку, куда смотрит server.ts
RUN npm run build

# Этап 3: runtime
FROM node:22-alpine
WORKDIR /app
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/backend
CMD ["node", "dist/server.js"]