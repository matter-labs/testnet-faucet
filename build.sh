. ./env.sh

cd front && yarn && yarn build && cd ..

yarn tsc

envsubst < Dockerfile | docker build . -f -
