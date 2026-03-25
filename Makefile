IMAGE_NAME := valis-claude
CONTAINER_NAME := valis-worker
CLAUDE_DIR := $(HOME)/.claude
CLAUDE_JSON := $(HOME)/.claude.json
GITCONFIG := $(HOME)/.gitconfig
WORKSPACE := $(shell pwd)

VOLUMES := \
	-v "$(WORKSPACE):/workspace" \
	-v "$(GITCONFIG):/home/claude/.gitconfig:ro"

.PHONY: build start shell stop clean status claude

## Build the Docker image
build:
	docker build -t $(IMAGE_NAME) .

## Start container in background (singleton, copies config from host)
start: build
	@if docker ps -q -f name=^$(CONTAINER_NAME)$$ 2>/dev/null | grep -q .; then \
		echo "Already running. Use: make shell"; \
	else \
		docker rm $(CONTAINER_NAME) 2>/dev/null; \
		docker run -d --name $(CONTAINER_NAME) $(VOLUMES) \
			--entrypoint sleep $(IMAGE_NAME) infinity \
			> /dev/null && \
		docker cp "$(CLAUDE_JSON)" $(CONTAINER_NAME):/home/claude/.claude.json && \
		docker cp "$(CLAUDE_DIR)/." $(CONTAINER_NAME):/home/claude/.claude/ && \
		echo "Ready. Use: make shell → cc"; \
	fi

## Attach to the running container
shell:
	@if docker ps -q -f name=^$(CONTAINER_NAME)$$ 2>/dev/null | grep -q .; then \
		docker exec -it $(CONTAINER_NAME) bash; \
	else \
		echo "Not running. Use: make start"; \
	fi

## Run claude --dangerously-skip-permissions inside the container
claude:
	@if docker ps -q -f name=^$(CONTAINER_NAME)$$ 2>/dev/null | grep -q .; then \
		docker exec -it $(CONTAINER_NAME) claude --dangerously-skip-permissions; \
	else \
		echo "Not running. Use: make start"; \
	fi

## Stop the container
stop:
	docker stop $(CONTAINER_NAME) 2>/dev/null; docker rm $(CONTAINER_NAME) 2>/dev/null; echo "Stopped"

## Show container status
status:
	@docker ps -f name=^$(CONTAINER_NAME)$$ --format "{{.Status}}" 2>/dev/null || echo "Not running"

## Remove the Docker image
clean: stop
	docker rmi $(IMAGE_NAME) 2>/dev/null || true
