#! /bin/bash

#
# create and setup a database
#

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <db-name> <b64-encrypted-root-psk>"
    exit 1
fi

DB_NAME=$1
ROOT_KEY=$2

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

if [ -z "$DB_PREFIX" ]; then
    DB_PREFIX=/var/db/
fi
DB_SUFFIX=.db

DB_FILE=$DB_PREFIX$DB_NAME$DB_SUFFIX

mkdir -p $DB_PREFIX

if [[ -e $DB_FILE ]]
then
    echo "Error: $DB_FILE exists." >&2
    exit 1
fi

SKDB_BIN="skargo run -q --release --manifest-path sql/Skargo.toml --"
SKDB="$SKDB_BIN --data $DB_FILE"

$SKDB_BIN --init "$DB_FILE"

# setup the base tables used for access-control
$SKDB < "$SCRIPT_DIR/../../privacy/init.sql"

echo "INSERT INTO skdb_users VALUES ('root', '$ROOT_KEY')" | $SKDB
