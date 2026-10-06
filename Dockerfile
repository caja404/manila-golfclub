FROM node:22-slim
WORKDIR /app
ENV TZ=Asia/Manila
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build
ENV PORT=3000 DB_FILE=/data/mgc.db NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
