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

# ENV WEB3_URL="${WEB3_URL}"
# ENV WS_API_ADDR="${WS_API_ADDR}"
# ENV MNEMONIC="${MNEMONIC}"

COPY env.sh ./
RUN ./env.sh

CMD [ "node", "build/app.js" ]
