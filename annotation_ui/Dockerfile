# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# nginx proxies /api/ to the backend (see nginx.conf); keep these in sync.
ARG API_URL=/api
ENV API_URL=$API_URL
RUN npm run build

# Runtime stage — nginx serves static files and proxies API calls to backend
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3721
CMD ["nginx", "-g", "daemon off;"]
