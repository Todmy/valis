FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Claude Code (native installer puts binary in ~/.claude/bin/)
RUN curl -fsSL https://claude.ai/install.sh | bash
# Symlink to global path so all users can run it
RUN ln -s /root/.claude/bin/claude /usr/local/bin/claude

# Non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash claude

# Alias
RUN echo 'alias cc="claude --dangerously-skip-permissions"' >> /home/claude/.bashrc

USER claude

WORKDIR /workspace

ENTRYPOINT ["bash"]
