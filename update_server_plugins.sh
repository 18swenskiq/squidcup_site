#!/bin/bash

# MetaMod Source & Squidcup Plugin Update Script
# This script downloads MetaMod Source and the Squidcup plugin bundle

set -e  # Exit on any error

# Configuration
INSTALL_PATH="/apps/cs2/game/csgo"
MMS_DOWNLOAD_URL="https://mms.alliedmods.net/mmsdrop/2.0/mmsource-2.0.0-git1361-linux.tar.gz"
SQUIDCUP_DOWNLOAD_URL="https://github.com/18swenskiq/Squidcup_Plugin/releases/download/0.9.0/Squidcup-0.9.0-with-cssharp-linux.zip"
TEMP_DIR="/tmp/cs2_addons_update"
BACKUP_DIR="/tmp/cs2_addons_backup_$(date +%Y%m%d_%H%M%S)"

# Directories to preserve entirely
PRESERVE_DIRS=(
    "addons/counterstrikesharp/configs"
    "addons/counterstrikesharp/shared"
    "cfg/custom"
)

# Individual files to preserve
PRESERVE_FILES=(
    "cfg/Squidcup/database.json"
)

echo "Starting MetaMod Source & Squidcup Plugin update..."

# Create temporary directories
mkdir -p "$TEMP_DIR"
mkdir -p "$BACKUP_DIR"

# Create install directory if it doesn't exist
mkdir -p "$INSTALL_PATH"

echo "Downloading MetaMod Source..."
cd "$TEMP_DIR"
wget -O mmsource.tar.gz "$MMS_DOWNLOAD_URL"

echo "Downloading Squidcup Plugin bundle..."
wget -O squidcup-bundle.zip "$SQUIDCUP_DOWNLOAD_URL"

echo "Extracting MetaMod Source..."
mkdir -p mms_extract
cd mms_extract
tar -xzf ../mmsource.tar.gz
cd ..

echo "Extracting Squidcup Plugin bundle..."
mkdir -p squidcup_extract
cd squidcup_extract
unzip -q ../squidcup-bundle.zip
cd ..

# Find the extracted directories
MMS_EXTRACTED_DIR=$(find "$TEMP_DIR/mms_extract" -name "addons" -type d | head -1)

if [ -z "$MMS_EXTRACTED_DIR" ]; then
    echo "Error: Could not find extracted MetaMod Source addons directory"
    exit 1
fi

# Validate Squidcup extraction
if [ ! -d "$TEMP_DIR/squidcup_extract/addons" ]; then
    echo "Error: Could not find extracted Squidcup addons directory"
    exit 1
fi

if [ ! -d "$TEMP_DIR/squidcup_extract/cfg" ]; then
    echo "Error: Could not find extracted Squidcup cfg directory"
    exit 1
fi

echo "Backing up directories to preserve..."
# Backup entire directories we want to preserve
for dir in "${PRESERVE_DIRS[@]}"; do
    if [ -d "$INSTALL_PATH/$dir" ]; then
        echo "✓ Backing up directory: $dir"
        mkdir -p "$BACKUP_DIR/$(dirname "$dir")"
        cp -r "$INSTALL_PATH/$dir" "$BACKUP_DIR/$dir"
    else
        echo "✗ Directory not found for backup: $dir"
    fi
done

echo "Backing up individual files to preserve..."
# Backup specific files we want to preserve
for file in "${PRESERVE_FILES[@]}"; do
    if [ -f "$INSTALL_PATH/$file" ]; then
        echo "✓ Backing up file: $file"
        mkdir -p "$BACKUP_DIR/$(dirname "$file")"
        cp "$INSTALL_PATH/$file" "$BACKUP_DIR/$file"
    else
        echo "✗ File not found for backup: $file"
    fi
done

echo "Updating MetaMod Source files..."
# Copy MetaMod Source files first (this provides the metamod framework)
cp -r "$MMS_EXTRACTED_DIR"/* "$INSTALL_PATH/"

echo "Updating Squidcup Plugin files..."
# Copy Squidcup plugin files (this provides CounterStrikeSharp + your plugin)
cp -r "$TEMP_DIR/squidcup_extract/addons"/* "$INSTALL_PATH/addons/"
cp -r "$TEMP_DIR/squidcup_extract/cfg"/* "$INSTALL_PATH/cfg/"

echo "Restoring preserved directories..."
# Restore preserved directories
for dir in "${PRESERVE_DIRS[@]}"; do
    if [ -d "$BACKUP_DIR/$dir" ]; then
        echo "✓ Restoring directory: $dir"
        # Remove the new directory first, then restore the backup
        rm -rf "$INSTALL_PATH/$dir"
        mkdir -p "$INSTALL_PATH/$(dirname "$dir")"
        cp -r "$BACKUP_DIR/$dir" "$INSTALL_PATH/$dir"
    else
        echo "✗ Backup not found for directory: $dir"
    fi
done

echo "Restoring preserved files..."
# Restore individual files
for file in "${PRESERVE_FILES[@]}"; do
    if [ -f "$BACKUP_DIR/$file" ]; then
        echo "✓ Restoring file: $file"
        mkdir -p "$INSTALL_PATH/$(dirname "$file")"
        cp "$BACKUP_DIR/$file" "$INSTALL_PATH/$file"
    else
        echo "✗ Backup not found for file: $file"
    fi
done

# List what's now in the plugins directory
echo "Plugins now installed:"
if [ -d "$INSTALL_PATH/addons/counterstrikesharp/plugins" ]; then
    ls -la "$INSTALL_PATH/addons/counterstrikesharp/plugins/" | grep ^d | awk '{print "  - " $9}' | grep -v "^\s*-\s*\.$\|^\s*-\s*\.\.$"
else
    echo "  No plugins directory found"
fi

# Set proper permissions
echo "Setting permissions..."
chown -R 1000:1000 "$INSTALL_PATH"  # Adjust UID/GID as needed for your container
chmod -R 755 "$INSTALL_PATH"

echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"
rm -rf "$BACKUP_DIR"

echo "MetaMod Source & Squidcup Plugin update completed successfully!"
echo "Updated files are now in: $INSTALL_PATH"
echo ""
echo "Summary of what was updated:"
echo "- MetaMod Source (core addon framework)"
echo "- Squidcup Plugin with CounterStrikeSharp (C# plugin framework + your plugin)"
echo "- Configuration files in cfg/ (except preserved database.json)"
echo ""
echo "Preserved configurations:"
echo "- Custom plugin configs in addons/counterstrikesharp/configs/"
echo "- Custom shared libraries in addons/counterstrikesharp/shared/"
echo "- Custom cfg files in cfg/custom/"
echo "- Database configuration: cfg/Squidcup/database.json"
echo ""
echo "Note: All plugins have been replaced with those from the Squidcup bundle"