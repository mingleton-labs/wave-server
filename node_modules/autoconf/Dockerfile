FROM node:12-alpine
RUN mkdir /app 
WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm install
COPY . /app/

VOLUME /db
EXPOSE 1883 8883

CMD ["node", "index.js"]