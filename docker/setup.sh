#!/bin/bash
# Rebuild plugin dependencies for Linux (run once after first 'make start')
# Host plugins are macOS binaries — this reinstalls for Linux

set -e

PLUGINS_DIR="$HOME/.claude/plugins/cache"

if [ ! -d "$PLUGINS_DIR" ]; then
    echo "No plugins found at $PLUGINS_DIR"
    echo "Mount ~/.claude from host first (make start)"
    exit 1
fi

echo "Rebuilding plugin dependencies for Linux..."

for plugin_dir in "$PLUGINS_DIR"/*/; do
    if [ -f "$plugin_dir/package.json" ]; then
        name=$(basename "$plugin_dir")
        echo "  → $name"
        cd "$plugin_dir"
        # Try bun first (channel plugins use bun), fall back to npm
        if command -v bun &> /dev/null && grep -q '"bun"' package.json 2>/dev/null; then
            bun install --no-save 2>/dev/null || npm install --no-save 2>/dev/null || true
        else
            npm install --no-save 2>/dev/null || true
        fi
    fi
done

# Also rebuild any nested plugin directories (marketplace structure)
for plugin_dir in "$PLUGINS_DIR"/*/*/; do
    if [ -f "$plugin_dir/package.json" ]; then
        name=$(basename "$(dirname "$plugin_dir")")/$(basename "$plugin_dir")
        echo "  → $name"
        cd "$plugin_dir"
        if command -v bun &> /dev/null; then
            bun install --no-save 2>/dev/null || npm install --no-save 2>/dev/null || true
        else
            npm install --no-save 2>/dev/null || true
        fi
    fi
done

echo "Done. Plugins rebuilt for Linux."
echo ""
echo "Now run: cc"
