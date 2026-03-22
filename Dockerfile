FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Claude Code (native installer for full feature support)
RUN curl -fsSL https://claude.ai/install.sh | sh

# Non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash claude
ENV PATH="/home/claude/.claude/bin:${PATH}"

# Alias
RUN echo 'alias cc="claude --dangerously-skip-permissions"' >> /home/claude/.bashrc

USER claude

WORKDIR /workspace

ENTRYPOINT ["bash"]
