FROM node:12

# Create app directory
WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./
COPY tsconfig.json ./
COPY state.json ./
COPY app ./app

RUN yarn

EXPOSE 2880

CMD [ "yarn", "start" ]
