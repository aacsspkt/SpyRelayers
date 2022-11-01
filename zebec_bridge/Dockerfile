FROM node:latest

RUN mkdir -p /app
WORKDIR /app

COPY . .

RUN npm ci && \
    npm run build

EXPOSE 4202
EXPOSE 8084

CMD [ "npm", "start"]