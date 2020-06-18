FROM node:10

# Create app directory
WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./

RUN yarn

COPY build ./build
COPY front/dist ./front/dist
COPY state.json .
EXPOSE 2880

CMD [ "node", "build/app.js" ]
