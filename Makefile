IMAGE_NAME := teamind-claude
CLAUDE_DIR := $(HOME)/.claude
CLAUDE_JSON := $(HOME)/.claude.json
GITCONFIG := $(HOME)/.gitconfig
WORKSPACE := $(shell pwd)

DOCKER_RUN := docker run --rm -it \
	-v "$(CLAUDE_DIR):/home/claude/.claude" \
	-v "$(CLAUDE_JSON):/home/claude/.claude.json:ro" \
	-v "$(WORKSPACE):/workspace" \
	-v "$(GITCONFIG):/home/claude/.gitconfig:ro" \
	$(IMAGE_NAME)

CLAUDE_FLAGS := --dangerously-skip-permissions \
	--channels plugin:telegram@claude-plugins-official

.PHONY: build run run-task shell clean

## Build the Docker image
build:
	docker build -t $(IMAGE_NAME) .

## Run Claude Code interactively with channels + skip-permissions
run: build
	$(DOCKER_RUN) $(CLAUDE_FLAGS)

## Run Claude Code with a specific task prompt
## Usage: make run-task TASK="implement T001 from specs/001-teamind-mvp/tasks.md"
run-task: build
	$(DOCKER_RUN) $(CLAUDE_FLAGS) --print "$(TASK)"

## Open a shell inside the container for debugging
shell: build
	docker run --rm -it \
		-v "$(CLAUDE_DIR):/home/claude/.claude" \
		-v "$(CLAUDE_JSON):/home/claude/.claude.json:ro" \
		-v "$(WORKSPACE):/workspace" \
		-v "$(GITCONFIG):/home/claude/.gitconfig:ro" \
		--entrypoint bash \
		$(IMAGE_NAME)

## Remove the Docker image
clean:
	docker rmi $(IMAGE_NAME) 2>/dev/null || true
