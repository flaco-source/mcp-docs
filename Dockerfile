FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled build
COPY build/ ./build/

# Server uses stdio transport by default.
# For remote/HTTP use, update src/index.ts to use StreamableHttpServerTransport
# and uncomment EXPOSE below.
# EXPOSE 3000

CMD ["node", "build/index.js"]
