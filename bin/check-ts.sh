#!/bin/bash

# Script to run the type-checker in all directories in the npm workspaces list

set -e

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
REPO="$SCRIPT_DIR/.."

cd "$REPO"
DIRS=$( jq --raw-output ".workspaces[]" package.json )

for dir in $DIRS
do
    "$SCRIPT_DIR"/cd_sh "$dir" "[ ! -f eslint.config.js ] || npx tsc"
done
