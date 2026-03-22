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

# Supabase CLI
RUN curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.deb -o /tmp/supabase.deb \
    && dpkg -i /tmp/supabase.deb \
    && rm /tmp/supabase.deb

WORKDIR /workspace

ENTRYPOINT ["claude"]
