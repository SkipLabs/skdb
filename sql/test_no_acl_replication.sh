#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_BIN="skargo run -q --profile $SKARGO_PROFILE -- "

SERVER_DB=/tmp/server.db
LOCAL_DB=/tmp/local.db
UPDATES=/tmp/updates

setup_server() {
    db=$SERVER_DB
    rm -f "$db"

    SKDB="$SKDB_BIN --data $db"
    $SKDB_BIN --init "$db"

    $SKDB < privacy/init.sql

    echo "INSERT INTO skdb_users VALUES('test_user', 'pass');" | $SKDB
    echo "CREATE TABLE test (id INTEGER PRIMARY KEY, note TEXT, skdb_access TEXT);" | $SKDB
}

setup_local() {
    db=$LOCAL_DB
    rm -f "$db" "$UPDATES"

    SKDB="$SKDB_BIN --data $db"
    $SKDB_BIN --init "$db"

    echo "CREATE TABLE test (id INTEGER PRIMARY KEY, note TEXT, skdb_access TEXT);" | $SKDB

    $SKDB_BIN subscribe --format=csv --data $LOCAL_DB --connect --updates $UPDATES test > /dev/null
}

replicate_to_server() {
    $SKDB_BIN write-csv --data $SERVER_DB --user test_user < $UPDATES > /dev/null
}

assert_line_count() {
    file=$1
    pattern=$2
    expected_cnt=$3
    cnt=$(grep -Ec "$pattern" "$file")
    if [[ ! $cnt -eq "$expected_cnt" ]]; then
        echo -e "FAIL\nlooking for $pattern. Wanted $expected_cnt but got $cnt:"
        cat "$file"
        exit 1
    fi
}

run_test() {
    printf '%-80s ' "$1"
    eval "$1"
    echo "PASS"
}

test_server_accepts_write_no_access_no_author_cols() {
    setup_server
    setup_local

    # write in to local
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test VALUES(0,'hello','read-write');"

    replicate_to_server

    # expect data at server
    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test;' > "$output"
    assert_line_count "$output" hello 1
    rm -f "$output"
}

test_server_tails_no_access_no_author_cols() {
    setup_server
    setup_local

    # write in to local
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test VALUES(0,'hello','read-write');"

    replicate_to_server
    # assume data is there

    # tail
    session=$($SKDB_BIN --data $SERVER_DB subscribe --connect test)
    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB tail --user test_user --format=csv "$session" > "$output"
    assert_line_count "$output" hello 1

    rm -f "$output"
}

run_test test_server_accepts_write_no_access_no_author_cols
run_test test_server_tails_no_access_no_author_cols
