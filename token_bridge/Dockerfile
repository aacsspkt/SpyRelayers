FROM node:latest

RUN mkdir -p /app
WORKDIR /app

COPY . .

RUN npm ci && \
    npm run build

EXPOSE 4201
EXPOSE 8083

CMD [ "npm", "start" ]