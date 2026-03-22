IMAGE_NAME := teamind-claude
CLAUDE_DIR := $(HOME)/.claude
CLAUDE_JSON := $(HOME)/.claude.json
GITCONFIG := $(HOME)/.gitconfig
WORKSPACE := $(shell pwd)

VOLUMES := \
	-v "$(CLAUDE_DIR):/home/claude/.claude" \
	-v "$(CLAUDE_JSON):/home/claude/.claude.json:ro" \
	-v "$(WORKSPACE):/workspace" \
	-v "$(GITCONFIG):/home/claude/.gitconfig:ro"

CLAUDE_FLAGS := --dangerously-skip-permissions \
	--channels plugin:telegram@claude-plugins-official

.PHONY: build start stop clean

## Build the Docker image
build:
	docker build -t $(IMAGE_NAME) .

## Start container with bash — run claude manually inside
## Usage: make start → then inside: claude --dangerously-skip-permissions ...
start: build
	@echo "Starting container. Run claude inside:"
	@echo "  claude $(CLAUDE_FLAGS)"
	@echo ""
	docker run --rm -it $(VOLUMES) --entrypoint bash $(IMAGE_NAME)

## Stop all teamind containers
stop:
	docker ps -q --filter ancestor=$(IMAGE_NAME) | xargs -r docker stop

## Remove the Docker image
clean:
	docker rmi $(IMAGE_NAME) 2>/dev/null || true
