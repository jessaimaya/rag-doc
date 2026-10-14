# Use Node.js LTS version with IPv6 support
FROM node:20-slim

# Install necessary dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for tsx)
# This allows running ingestion scripts on Railway
RUN npm ci

# Copy application files
COPY . .

# Set dummy env vars for build (won't be used, just needed for build to complete)
ENV DB_CONNECTION="postgresql://build:build@localhost:5432/build" \
    ANTHROPIC_API_KEY="build" \
    VOYAGE_API_KEY="build" \
    MASTRA_API_KEY="build"

# Build during Docker build to save memory at runtime
RUN NODE_OPTIONS='--max-old-space-size=2048' npm run build

# Remove dummy vars (Railway will inject real ones at runtime)
ENV DB_CONNECTION="" \
    ANTHROPIC_API_KEY="" \
    VOYAGE_API_KEY="" \
    MASTRA_API_KEY=""

# Expose port (Railway will set PORT env variable)
EXPOSE 3000

# Start the application directly (already built)
CMD ["npm", "run", "start-only"]
