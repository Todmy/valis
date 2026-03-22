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

# Supabase CLI (via npx at runtime — global install not supported)
# Use: npx supabase <command>

# Non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash claude

# Alias for running claude with full flags
RUN echo 'alias cc="claude --dangerously-skip-permissions --channels plugin:telegram@claude-plugins-official"' \
    >> /home/claude/.bashrc

USER claude

WORKDIR /workspace

ENTRYPOINT ["claude"]
