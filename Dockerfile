FROM node:20-alpine

WORKDIR /app

# Install only production dependencies (tsx + ws are in dependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy only the server source
COPY server/ ./server/

EXPOSE 8080

CMD ["npm", "start"]
