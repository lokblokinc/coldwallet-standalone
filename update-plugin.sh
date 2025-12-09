#!/bin/bash
# Update coldwallet plugin from source

SOURCE="../toughlok-portal/views/plug-ins/coldwallet"
TARGET="./views/plug-ins/coldwallet"

echo "🔄 Updating plugin from source..."

if [ ! -d "$SOURCE" ]; then
    echo "❌ Error: Source plugin not found at $SOURCE"
    exit 1
fi

# Backup current plugin
if [ -d "$TARGET" ]; then
    echo "📦 Backing up current plugin..."
    cp -r "$TARGET" "${TARGET}.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Copy fresh plugin
echo "📥 Copying plugin from source..."
rm -rf "$TARGET"
cp -r "$SOURCE" "$TARGET"

# Apply layout modification
echo "✏️  Modifying layout reference..."
sed -i "1s/layout('layout')/layout('layout-minimal')/" "$TARGET/coldwallet.ejs"

echo "✅ Plugin updated successfully"
echo "💡 Old version backed up with timestamp"
