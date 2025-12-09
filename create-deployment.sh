#!/bin/bash

echo ""
echo "================================================"
echo "  Cold Wallet Standalone Deployment Builder"
echo "================================================"
echo ""

# Detect platform
PLATFORM=$(uname -s)
if [ "$PLATFORM" = "Linux" ]; then
    EXE_NAME="coldwallet-linux"
elif [ "$PLATFORM" = "Darwin" ]; then
    EXE_NAME="coldwallet-mac"
else
    echo "ERROR: Unsupported platform: $PLATFORM"
    exit 1
fi

# Clean and create deployment directory
if [ -d "deployment" ]; then
    echo "Cleaning old deployment..."
    rm -rf deployment
fi

mkdir -p deployment/data
mkdir -p deployment/node_modules/sqlite3/build/Release

echo "[1/3] Copying executable..."
if [ ! -f "dist/$EXE_NAME" ]; then
    echo "ERROR: Executable not found. Run 'npm run build:linux' or 'npm run build:mac' first."
    exit 1
fi
cp "dist/$EXE_NAME" deployment/
chmod +x "deployment/$EXE_NAME"

echo "[2/3] Copying sqlite3 native binary..."
if [ ! -f "node_modules/sqlite3/build/Release/node_sqlite3.node" ]; then
    echo "ERROR: sqlite3 native binary not found. Run 'npm install' first."
    exit 1
fi
cp node_modules/sqlite3/build/Release/node_sqlite3.node deployment/node_modules/sqlite3/build/Release/

echo "[3/3] Creating configuration file..."
if [ -f ".env" ]; then
    cp .env deployment/.env
    echo "   - Copied existing .env file"
else
    cp .env.example deployment/.env
    echo "   - Created .env from .env.example"
fi

echo ""
echo "================================================"
echo "  ✓ Deployment package created successfully!"
echo "================================================"
echo ""
echo "Location: $(pwd)/deployment"
echo "Size: ~60MB (exe) + ~400KB (native binary)"
echo ""
echo "Contents:"
echo "  - $EXE_NAME (main application)"
echo "  - node_modules/sqlite3/build/Release/node_sqlite3.node"
echo "  - data/ (database folder)"
echo "  - .env (configuration)"
echo ""
echo "To run the application:"
echo "  1. cd deployment"
echo "  2. ./$EXE_NAME"
echo ""
echo "The deployment folder is now portable - you can:"
echo "  - Tar/zip it and distribute"
echo "  - Copy to any $PLATFORM machine"
echo "  - Move it to any location"
echo ""
