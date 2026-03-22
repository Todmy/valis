IMAGE_NAME := teamind-claude
CONTAINER_NAME := teamind-worker
CLAUDE_DIR := $(HOME)/.claude
CLAUDE_JSON := $(HOME)/.claude.json
GITCONFIG := $(HOME)/.gitconfig
WORKSPACE := $(shell pwd)

VOLUMES := \
	-v "$(CLAUDE_DIR):/home/claude/.claude" \
	-v "$(CLAUDE_JSON):/home/claude/.claude.json:ro" \
	-v "$(WORKSPACE):/workspace" \
	-v "$(GITCONFIG):/home/claude/.gitconfig:ro"

CLAUDE_CMD := claude --dangerously-skip-permissions \
	--channels plugin:telegram@claude-plugins-official

.PHONY: build start shell stop clean status

## Build the Docker image
build:
	docker build -t $(IMAGE_NAME) .

## Start container in background (singleton — only one instance)
start: build
	@if docker ps -q -f name=^$(CONTAINER_NAME)$$ 2>/dev/null | grep -q .; then \
		echo "Already running. Use: make shell"; \
	else \
		docker rm $(CONTAINER_NAME) 2>/dev/null; \
		docker run -d --name $(CONTAINER_NAME) $(VOLUMES) \
			--entrypoint sleep $(IMAGE_NAME) infinity \
			> /dev/null && echo "Started. Use: make shell"; \
	fi

## Attach to the running container (detach with Ctrl+D)
shell:
	@if docker ps -q -f name=^$(CONTAINER_NAME)$$ 2>/dev/null | grep -q .; then \
		docker exec -it $(CONTAINER_NAME) bash; \
	else \
		echo "Not running. Use: make start"; \
	fi

## Stop the container
stop:
	docker stop $(CONTAINER_NAME) 2>/dev/null; docker rm $(CONTAINER_NAME) 2>/dev/null; echo "Stopped"

## Run claude with full flags inside the container
claude:
	@if docker ps -q -f name=^$(CONTAINER_NAME)$$ 2>/dev/null | grep -q .; then \
		docker exec -it $(CONTAINER_NAME) $(CLAUDE_CMD); \
	else \
		echo "Not running. Use: make start"; \
	fi

## Show container status
status:
	@docker ps -f name=^$(CONTAINER_NAME)$$ --format "{{.Status}}" 2>/dev/null || echo "Not running"

## Remove the Docker image
clean: stop
	docker rmi $(IMAGE_NAME) 2>/dev/null || true
