#!/bin/bash
# Check if coldwallet plugin differs from source

SOURCE="../toughlok-portal/views/plug-ins/coldwallet"
TARGET="./views/plug-ins/coldwallet"

if [ ! -d "$SOURCE" ]; then
    echo "⚠️  Warning: Source plugin not found at $SOURCE"
    exit 1
fi

if [ ! -d "$TARGET" ]; then
    echo "⚠️  Warning: Target plugin not found at $TARGET"
    exit 1
fi

# Compare directories, excluding the first line of coldwallet.ejs (layout reference)
echo "🔍 Checking for plugin differences..."

# Temporarily create comparison files
cp "$SOURCE/coldwallet.ejs" /tmp/source-coldwallet.ejs 2>/dev/null
cp "$TARGET/coldwallet.ejs" /tmp/target-coldwallet.ejs 2>/dev/null

# Remove first line from both (layout reference differs intentionally)
tail -n +2 /tmp/source-coldwallet.ejs > /tmp/source-coldwallet-stripped.ejs 2>/dev/null
tail -n +2 /tmp/target-coldwallet.ejs > /tmp/target-coldwallet-stripped.ejs 2>/dev/null

# Compare other files
DIFF_FOUND=0

# Check coldwallet.ejs (excluding first line)
if ! diff -q /tmp/source-coldwallet-stripped.ejs /tmp/target-coldwallet-stripped.ejs > /dev/null 2>&1; then
    echo "⚠️  coldwallet.ejs differs from source"
    DIFF_FOUND=1
fi

# Check other files
for file in coldwallet.js plugin.json; do
    if [ -f "$SOURCE/$file" ] && [ -f "$TARGET/$file" ]; then
        if ! diff -q "$SOURCE/$file" "$TARGET/$file" > /dev/null 2>&1; then
            echo "⚠️  $file differs from source"
            DIFF_FOUND=1
        fi
    fi
done

# Check assets directory
if [ -d "$SOURCE/assets" ] && [ -d "$TARGET/assets" ]; then
    if ! diff -qr "$SOURCE/assets" "$TARGET/assets" > /dev/null 2>&1; then
        echo "⚠️  assets/ directory differs from source"
        DIFF_FOUND=1
    fi
fi

# Cleanup
rm -f /tmp/source-coldwallet*.ejs /tmp/target-coldwallet*.ejs 2>/dev/null

if [ $DIFF_FOUND -eq 1 ]; then
    echo ""
    echo "⚠️  Plugin is out of sync with source!"
    echo "💡 Run 'npm run update-plugin' to sync from source"
    exit 1
else
    echo "✅ Plugin is in sync with source"
    exit 0
fi
