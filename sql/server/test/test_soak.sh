#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

SQL_PATH=$(realpath $SCRIPT_DIR/../..)

SKDB_BIN="skargo run -q --release --manifest-path $SQL_PATH/Skargo.toml --"

if [ -f ~/.skdb/config.prop ];then
  file=$(realpath ~/.skdb/config.prop)
  while IFS='=' read -r key value
  do
    eval ${key}="\${value}"
  done < "$file"
  if [[ $# -gt 0 ]]; then
    server_args="$* --config $file"
  else
    server_args="--config $file"
  fi
fi

if [ -z "$skdb_port" ]; then
    skdb_port=3586
fi

if [ -z "$skdb_databases" ]; then
    skdb_databases=/var/db/
fi
SERVER_PID_FILE=$(mktemp)
SERVER_DB="$skdb_databases"soak.db
SOAK_SERVER_LOG=/tmp/soak-server-log
SERVER_LOG=/tmp/server.log

SKDB="$SKDB_BIN --data $SERVER_DB"

handle_term() {
    kill "$(cat "$SERVER_PID_FILE")"
    kill "$client1"
    kill "$client2"
    rm -f "$SERVER_PID_FILE"
}
trap 'handle_term' EXIT

run_server() {
    rm -f "$SERVER_DB"

    DB_PREFIX=$skdb_databases "$SCRIPT_DIR"/../deploy/create_db.sh soak abcdef

    (echo "BEGIN TRANSACTION;";
     echo "INSERT INTO skdb_users VALUES('test_user1', 'test');"
     echo "INSERT INTO skdb_users VALUES('test_user2', 'test');"
     echo "COMMIT;"
    ) | $SKDB

    # for coordinating expectation checking
    echo "CREATE TABLE checkpoints (checkpoint_id TEXT PRIMARY KEY, latest_id INTEGER, client INTEGER, skdb_access TEXT NOT NULL);" | $SKDB

    # these tables are for inserts only. there should be no conflict
    echo "CREATE TABLE no_pk_inserts (id INTEGER, client INTEGER, value INTEGER, skdb_access TEXT NOT NULL);" | $SKDB
    echo "CREATE TABLE pk_inserts (id INTEGER PRIMARY KEY, client INTEGER, value INTEGER, skdb_access TEXT NOT NULL);" | $SKDB

    # these tables have two clients fighting over a single row
    echo "CREATE TABLE no_pk_single_row (id INTEGER, client INTEGER, value INTEGER, skdb_access TEXT NOT NULL);" | $SKDB
    echo "INSERT INTO no_pk_single_row VALUES (0,0,0, 'read-write');" | $SKDB
    echo "CREATE TABLE pk_single_row (id INTEGER PRIMARY KEY, client INTEGER, value INTEGER, skdb_access TEXT NOT NULL);" | $SKDB
    echo "INSERT INTO pk_single_row VALUES (0,0,0, 'read-write');" | $SKDB

    # these are filtered - the clients do intersect over some rows, but also have some rows disjoint
    echo "CREATE TABLE no_pk_filtered (id INTEGER, client INTEGER, value INTEGER, skdb_access TEXT NOT NULL);" | $SKDB
    echo "CREATE TABLE pk_filtered (id INTEGER PRIMARY KEY, client INTEGER, value INTEGER, skdb_access TEXT NOT NULL);" | $SKDB

    # for checking privacy updates propagate
    echo "CREATE TABLE pk_privacy_ro (client INTEGER PRIMARY KEY, skdb_access TEXT NOT NULL);" | $SKDB
    echo "CREATE TABLE pk_privacy_rw (client INTEGER PRIMARY KEY, updater INTEGER, skdb_access TEXT NOT NULL);" | $SKDB

    "$SCRIPT_DIR"/../deploy/chaos.sh 90 > $SOAK_SERVER_LOG &

    echo $! > "$SERVER_PID_FILE"
}

echo "Starting server..."
run_server

# TODO: should wait on some signal from the server
sleep 10

echo "Starting clients..."

client1_out=/tmp/client1.out
client2_out=/tmp/client2.out

/usr/bin/env node $SCRIPT_DIR/soak_client.mjs 1 $skdb_port > $client1_out 2>&1 &
client1=$!

/usr/bin/env node $SCRIPT_DIR/soak_client.mjs 2 $skdb_port > $client2_out 2>&1 &
client2=$!

monitor() {
    kill -USR1 "$(cat "$SERVER_PID_FILE")"
    kill -USR1 $client1
    kill -USR1 $client2

    echo "Dumping current status at" $(date) ":"

    echo "********************************************************************************"
    echo "Chaos log:" $SOAK_SERVER_LOG
    echo "----------"
    cat $SOAK_SERVER_LOG

    echo "********************************************************************************"
    echo "Server log:" $SERVER_LOG
    echo "-----------"
    cat $SERVER_LOG

    echo "********************************************************************************"
    echo "Server state:"
    echo "-------------"

    echo "> no_pk_inserts - do all rows have two entries? These ones do not (a jagged edge is ok)."
    $SKDB <<< "select * from no_pk_inserts where id in (select id from (select id, count(*) as n from no_pk_inserts group by id) where n <> 2);"
    echo "> no_pk_inserts - most recent 20:"
    $SKDB <<< "select * from no_pk_inserts order by id desc limit 20;"
    echo "> pk_inserts - do all rows have one entry? These do not:"
    $SKDB <<< "select * from pk_inserts where id in (select id from (select id, count(*) as n from pk_inserts group by id) where n <> 1);"
    echo "> pk_inserts - most recent 20:"
    $SKDB <<< "select * from pk_inserts order by id desc limit 20;"

    echo "> no_pk_single_row - are we converging? This is the count of rows:"
    $SKDB <<< "select count(*) from no_pk_single_row";
    echo "> this is the select * limit 10:"
    $SKDB <<< "select * from no_pk_single_row limit 20";
    echo "> pk_single_row - are we converging? This is the current row:"
    $SKDB <<< "select * from pk_single_row";

    echo "> no_pk_filtered - most recent 20:"
    $SKDB <<< "select * from no_pk_filtered order by id desc limit 20;"
    echo "> pk_filtered - most recent 20:"
    $SKDB <<< "select * from pk_filtered order by id desc limit 20;"

    echo "********************************************************************************"
    echo "Client 1 log:" $client1_out
    echo "-------------"
    cat $client1_out|tr -d '\0'
    truncate -s 0 $client1_out

    echo "********************************************************************************"
    echo "Client 2 log:" $client2_out
    echo "-------------"
    cat $client2_out|tr -d '\0'
    truncate -s 0 $client2_out

    wait -n $client1 $client2
}
trap 'monitor' SIGUSR1

echo "To monitor progress send SIGUSR1 to $$."
echo 'Or: kill -USR1 $(pgrep test_soak.sh)'

wait -n $client1 $client2

kill "$(cat "$SERVER_PID_FILE")"

echo "===============================================================================>"
echo "Something failed. Logs are at: $SERVER_LOG $client1_out $client2_out"
echo "<==============================================================================="
exit 1
