IMAGE_NAME := teamind-claude
CLAUDE_DIR := $(HOME)/.claude
CLAUDE_JSON := $(HOME)/.claude.json
GITCONFIG := $(HOME)/.gitconfig
WORKSPACE := $(shell pwd)

CONTAINER_NAME := teamind-worker
VOLUMES := \
	-v "$(CLAUDE_DIR):/home/claude/.claude" \
	-v "$(CLAUDE_JSON):/home/claude/.claude.json:ro" \
	-v "$(WORKSPACE):/workspace" \
	-v "$(GITCONFIG):/home/claude/.gitconfig:ro"

CLAUDE_FLAGS := --dangerously-skip-permissions \
	--channels plugin:telegram@claude-plugins-official

.PHONY: build run run-bg run-task stop logs attach shell clean

## Build the Docker image
build:
	docker build -t $(IMAGE_NAME) .

## Run Claude Code interactively (foreground, TTY)
run: build
	docker run --rm -it $(VOLUMES) $(IMAGE_NAME) $(CLAUDE_FLAGS)

## Run Claude Code in background with a task
## Usage: make run-bg TASK="implement T001 from specs/001-teamind-mvp/tasks.md"
run-bg: build
	docker run -d --name $(CONTAINER_NAME) $(VOLUMES) \
		$(IMAGE_NAME) $(CLAUDE_FLAGS) --print "$(TASK)" \
		> /dev/null && echo "Started container: $(CONTAINER_NAME)" && echo "Use 'make logs' to follow output, 'make stop' to stop"

## Run Claude Code with a task (foreground, shows output)
## Usage: make run-task TASK="implement T001 from specs/001-teamind-mvp/tasks.md"
run-task: build
	docker run --rm -it $(VOLUMES) $(IMAGE_NAME) $(CLAUDE_FLAGS) --print "$(TASK)"

## Stop the background container
stop:
	docker stop $(CONTAINER_NAME) 2>/dev/null; docker rm $(CONTAINER_NAME) 2>/dev/null; echo "Stopped"

## Follow logs of background container
logs:
	docker logs -f $(CONTAINER_NAME)

## Attach to running background container
attach:
	docker attach $(CONTAINER_NAME)

## Open a shell inside a new container for debugging
shell: build
	docker run --rm -it $(VOLUMES) --entrypoint bash $(IMAGE_NAME)

## Remove the Docker image
clean:
	docker rmi $(IMAGE_NAME) 2>/dev/null || true
