export DOCKER_IMAGE ?=matterlabs/faucet

image:
	@cd front && yarn && yarn build && cd ..
	@yarn tsc
	envsubst < Dockerfile | docker build . -t "${DOCKER_IMAGE}" -f -

push-image: image
	docker push "${DOCKER_IMAGE}"

deploy:
	envsubst < deployment.yaml | kubectl apply -f -
	kubectl patch deployment "${DEPLOYMENT_NAME}" -n faucet -p "{\"spec\":{\"template\":{\"metadata\":{\"labels\":{\"date\":\"$(shell date +%s)\"}}}}}"

start:
	kubectl -n faucet scale deployments/${DEPLOYMENT_NAME} --replicas=1

stop:
	kubectl -n faucet scale deployments/${DEPLOYMENT_NAME} --replicas=0
