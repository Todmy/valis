FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Non-root user (--dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash claude

# Alias
RUN echo 'alias cc="claude --dangerously-skip-permissions --yes"' >> /home/claude/.bashrc

USER claude

WORKDIR /workspace

ENTRYPOINT ["bash"]
