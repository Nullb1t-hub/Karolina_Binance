FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app
ENV DATA_DIR=/app/data
USER node
EXPOSE 3000
CMD ["npm","start"]
