FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# bun (needed by Telegram channel plugin)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Supabase CLI (via npx at runtime — global install not supported)
# Use: npx supabase <command>

# Non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash claude

# Move bun to claude user
RUN cp -r /root/.bun /home/claude/.bun && chown -R claude:claude /home/claude/.bun

# Aliases and PATH for claude user
RUN echo 'export PATH="/home/claude/.bun/bin:$PATH"' >> /home/claude/.bashrc && \
    echo 'alias cc="claude --dangerously-skip-permissions --channels plugin:telegram@claude-plugins-official"' \
    >> /home/claude/.bashrc

# Setup script — rebuilds plugin deps for Linux (run once after first start)
COPY docker/setup.sh /usr/local/bin/setup
RUN chmod +x /usr/local/bin/setup

USER claude

WORKDIR /workspace

ENTRYPOINT ["claude"]
