#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_BIN="skargo run -q --profile $SKARGO_PROFILE -- "
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

SERVER_DB=/tmp/server.db
LOCAL_DB=/tmp/local.db
UPDATES=/tmp/updates
SESSION=/tmp/session
WRITE_OUTPUT=/tmp/write-out
LOCAL2_DB=/tmp/local2.db
UPDATES2=/tmp/updates2
SESSION2=/tmp/session2

setup_server() {
    db=$SERVER_DB
    rm -f "$db" "$WRITE_OUTPUT"

    SKDB="$SKDB_BIN --data $db"
    $SKDB_BIN --init "$db"

    $SKDB < "$SCRIPT_DIR/privacy/init.sql"

    echo "INSERT INTO skdb_users VALUES('test_user', 'test');" | $SKDB
    echo "INSERT INTO skdb_users VALUES('test_user2', 'test');" | $SKDB

    echo "CREATE TABLE test_with_pk (id INTEGER PRIMARY KEY, note TEXT, skdb_access TEXT);" | $SKDB
    # out of first position and a string
    echo "CREATE TABLE test_pk_alt (x INTEGER, id TEXT PRIMARY KEY, skdb_access TEXT);" | $SKDB
}

setup_local() {
    table=$1
    db=$LOCAL_DB
    rm -f "$db" "$UPDATES"

    SKDB="$SKDB_BIN --data $db"
    $SKDB_BIN --init "$db"

    awk '/^INSERT/{exit} {print $0}' "$SCRIPT_DIR/privacy/init.sql" | $SKDB

    echo "CREATE TABLE test_with_pk (id INTEGER PRIMARY KEY, note TEXT, skdb_access TEXT);" | $SKDB
    echo "CREATE TABLE test_pk_alt (x INTEGER, id TEXT PRIMARY KEY, skdb_access TEXT);" | $SKDB

    $SKDB_BIN subscribe --data $LOCAL_DB --connect --format=csv --updates $UPDATES --ignore-source 9999 "$table" skdb_groups skdb_group_permissions skdb_users skdb_user_permissions > $SESSION
}

replicate_to_local() {
    table=$1
    user=$2
    sub=$($SKDB_BIN --data $SERVER_DB subscribe --connect --ignore-source 1234 "$table" skdb_groups skdb_group_permissions skdb_users skdb_user_permissions)
    $SKDB_BIN --data $SERVER_DB tail --user $user --format=csv --since 0 "$sub" |
	$SKDB_BIN write-csv --data $LOCAL_DB --source 9999 > $WRITE_OUTPUT
}

replicate_to_server() {
    user=$1
    cat $UPDATES | $SKDB_BIN write-csv --data $SERVER_DB --source 1234 --user $user > $WRITE_OUTPUT
}

replicate_diff_to_server() {
    table=$1
    since=$2
    $SKDB_BIN --data $LOCAL_DB diff --format=csv --since "$since" "$(cat $SESSION)" |
	$SKDB_BIN write-csv --data $SERVER_DB --source 1234 --user test_user > $WRITE_OUTPUT
}

setup_local2() {
    table=$1
    db=$LOCAL2_DB
    rm -f "$db" "$UPDATES2"

    SKDB="$SKDB_BIN --data $db"
    $SKDB_BIN --init "$db"

    awk '/^INSERT/{exit} {print $0}' "$SCRIPT_DIR/privacy/init.sql" | $SKDB

    echo "CREATE TABLE test_with_pk (id INTEGER PRIMARY KEY, note TEXT, skdb_access TEXT);" | $SKDB

    $SKDB_BIN subscribe --data $LOCAL2_DB --connect --format=csv --updates $UPDATES2 --ignore-source 7777 "$table" skdb_groups skdb_group_permissions skdb_users skdb_user_permissions > $SESSION2
}

replicate_to_local2() {
    table=$1
    user=$2
    sub=$($SKDB_BIN --data $SERVER_DB subscribe --connect --ignore-source 5678 "$table"  skdb_groups skdb_group_permissions skdb_users skdb_user_permissions)
    $SKDB_BIN --data $SERVER_DB tail --user $user --format=csv --since 0 "$sub" |
	$SKDB_BIN write-csv --data $LOCAL2_DB --source 7777 > $WRITE_OUTPUT
}

replicate_local2_to_server() {
    user=$1
    cat $UPDATES2 | $SKDB_BIN write-csv --data $SERVER_DB --source 5678 --user $user > $WRITE_OUTPUT
}

run_test() {
    printf '%-80s ' "$1"
    eval "$1"
    echo "PASS"
}
debug() {
    echo
    echo --------------------------------------
    echo "$1"

    echo current updates state:
    cat $UPDATES

    echo current updates2 state:
    cat $UPDATES2

    echo last write-csv response:
    cat $WRITE_OUTPUT

    echo local state:
    $SKDB_BIN --data $LOCAL_DB <<< "select * from test_with_pk;"

    echo server state:
    $SKDB_BIN --data $SERVER_DB <<< "select * from test_with_pk;"
    echo --------------------------------------
}

fail() {
    echo FAIL
    exit 1
}

assert_line_count() {
    file=$1
    pattern=$2
    expected_cnt=$3
    cnt=$(grep -Ec "$pattern" "$file")
    if [[ ! $cnt -eq "$expected_cnt" ]]
    then
        echo -e "FAIL\nlooking for $pattern. Wanted $expected_cnt but got $cnt:"
        cat "$file"
        exit 1
    fi
}

assert_server_rows_has() {
    expected=$1
    pattern=$2
    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" "$pattern" "$expected"
    rm -f "$output"
}

################################################################################
# basic replication scenarios
################################################################################

test_basic_replication_unique_rows() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(1,'bar','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(2,'baz','read-write');"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_basic_replication_unique_rows_replayed() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(1,'bar','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(2,'baz','read-write');"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"

    # simulate a reconnect - resend everything
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_basic_replication_unique_rows_server_state_different() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    output=$(mktemp)
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"

    replicate_to_server test_user

    # different writers so they combine
    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

test_basic_replication_null_string() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note = NULL WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)

    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_with_pk WHERE note is NULL;" > "$output"
    assert_line_count "$output" 1 1
    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_with_pk WHERE note = '';" > "$output"
    assert_line_count "$output" 0 1

    session=$($SKDB_BIN --data $SERVER_DB subscribe test_with_pk --connect)
    $SKDB_BIN tail --user test_user --data $SERVER_DB --format=csv "$session" --since 0 > "$output"
    # we want the output to contain a null representation
    assert_line_count "$output" "1	0,,\"read-write\"$" 1
    rm -f "$output"
}

test_basic_replication_empty_string() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note = '' WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)

    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_with_pk WHERE note is NULL;" > "$output"
    assert_line_count "$output" 0 1
    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_with_pk WHERE note = '';" > "$output"
    assert_line_count "$output" 1 1

    session=$($SKDB_BIN --data $SERVER_DB subscribe test_with_pk --connect)
    $SKDB_BIN tail --user test_user --data $SERVER_DB --format=csv "$session" --since 0 > "$output"
    # we want the output to contain an empty string
    assert_line_count "$output" '""' 1
    rm -f "$output"
}

test_basic_replication_escaped_string() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note = 'what''s up?' WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)

    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_with_pk WHERE note = 'what''s up?';" > "$output"
    assert_line_count "$output" 1 1

    session=$($SKDB_BIN --data $SERVER_DB subscribe test_with_pk --connect)
    $SKDB_BIN tail --user test_user --data $SERVER_DB --format=csv "$session" --since 0 > "$output"
    assert_line_count "$output" "what's up?" 1
    rm -f "$output"
}

test_basic_replication_escaped_string_alt() {
    setup_server
    setup_local test_pk_alt

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_pk_alt VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_pk_alt SET id = 'what''s up?' WHERE x = 0;"

    replicate_to_server test_user

    output=$(mktemp)

    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_pk_alt WHERE id = 'what''s up?';" > "$output"
    assert_line_count "$output" 1 1

    session=$($SKDB_BIN --data $SERVER_DB subscribe test_pk_alt --connect)
    $SKDB_BIN tail --user test_user --data $SERVER_DB --format=csv "$session" --since 0 > "$output"
    assert_line_count "$output" "what's up?" 1
    rm -f "$output"
}

test_basic_replication_string_with_unicode() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note = 'what''s up?™' WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)

    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_with_pk WHERE note = 'what''s up?™';" > "$output"
    assert_line_count "$output" 1 1

    session=$($SKDB_BIN --data $SERVER_DB subscribe test_with_pk --connect)
    $SKDB_BIN tail --user test_user --data $SERVER_DB --format=csv "$session" --since 0 > "$output"
    assert_line_count "$output" "what's up?" 1
    rm -f "$output"
}

test_basic_replication_with_deletes() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_server test_user
    assert_server_rows_has 1 foo

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    replicate_to_server test_user
    assert_server_rows_has 0 foo

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    replicate_to_server test_user
    assert_server_rows_has 0 foo

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_server test_user
    assert_server_rows_has 1 foo
}

test_basic_replication_with_deletes_server_state_different() {
    setup_server
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    setup_local test_with_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    replicate_to_server test_user

    # we still have the record as this was concurrently written
    assert_server_rows_has 1 foo
}

################################################################################
# these tests replicate data around first so we build some notion of
# the vector clock and test concurrency
################################################################################

test_seen_insert_deleted() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    rm -f "$output"
}

test_unseen_insert_not_deleted() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

test_unseen_insert_added_to() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

test_seen_insert_clobbered() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    rm -f "$output"
}

test_seen_insert_clobbered_alt() {
    setup_server
    setup_local test_pk_alt

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_pk_alt VALUES(0,'foo','read-write');"

    replicate_to_local test_pk_alt test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_pk_alt SET id='bar' WHERE x = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_pk_alt;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    rm -f "$output"
}

test_unseen_insert_not_updated() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 0
    rm -f "$output"
}

test_unseen_update_is_updated() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_unseen_update_is_not_updated() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_unseen_insert_is_updated() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 0
    rm -f "$output"
}

test_unseen_delete_gets_clobbered() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_server test_user

    # the client now asserts there should be two rows. our concurrency
    # model is that inserts always beat deletes and need to be
    # resolved.
    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

test_unseen_delete_does_not_affect_delete() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"

    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    rm -f "$output"
}

test_concurrent_clients_updating_winner_gets_there_first() {
    setup_server
    setup_local test_with_pk
    setup_local2 test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user
    replicate_to_local2 test_with_pk test_user

    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    $SKDB_BIN --data $LOCAL2_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"

    # baz should win and gets there first:
    replicate_local2_to_server test_user
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1

    # and now check everything converges:

    replicate_to_local test_with_pk test_user
    replicate_to_local2 test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1

    $SKDB_BIN --data $LOCAL2_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1

    rm -f "$output"
}

test_concurrent_clients_updating_winner_gets_there_second() {
    setup_server
    setup_local test_with_pk
    setup_local2 test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user
    replicate_to_local2 test_with_pk test_user

    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    $SKDB_BIN --data $LOCAL2_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"

    # baz should win and gets there second:
    replicate_to_server test_user
    replicate_local2_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1

    # and now check everything converges:

    replicate_to_local test_with_pk test_user
    replicate_to_local2 test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1

    $SKDB_BIN --data $LOCAL2_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1

    rm -f "$output"
}

# AA - idempotentency
test_reconnect_replayed() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_server test_user
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

# AA - idempotentency
test_reconnect_replayed_with_update() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"

    replicate_to_server test_user
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    rm -f "$output"
}

# AB - commutativity
test_replayed_with_more_local_data() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_server test_user

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

# AB - commutativity
test_replayed_with_further_updates() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    replicate_to_server test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1
    rm -f "$output"
}

# AB - commutativity
test_replayed_with_further_updates_lesser_row_value() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    replicate_to_server test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # we honour the causal order of the client, so bar wins
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 0
    rm -f "$output"
}

# AB - commutativity
test_reconnect_replayed_with_more_local_data() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_server test_user

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    # this is a reconnect, we figure out the diff
    replicate_diff_to_server test_with_pk 0

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

# AB - commutativity
test_reconnect_replayed_with_further_updates() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    replicate_to_server test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    # this is a reconnect, we figure out the diff
    replicate_diff_to_server test_with_pk 0

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1
    rm -f "$output"
}

# AB - commutativity
test_reconnect_replayed_with_further_updates_lesser_row_value() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"

    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    replicate_to_server test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    # this is a reconnect, we figure out the diff
    replicate_diff_to_server test_with_pk 0

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # we honour the causal order of the client, so bar wins
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 0
    rm -f "$output"
}

# BA - commutativity
test_old_diff_replayed() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_server test_user

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
    rm -f "$save"
}

# BA - commutativity
test_reconnect_old_diff_replayed() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_with_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_diff_to_server test_with_pk 0

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
    rm -f "$save"
}

# BA - commutativity
test_old_diff_replayed_with_update() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    replicate_to_server test_user

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1
    rm -f "$output"
    rm -f "$save"
}

# BA - commutativity
test_reconnect_old_diff_replayed_with_update() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    replicate_diff_to_server test_with_pk 0

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 0
    assert_line_count "$output" baz 1
    rm -f "$output"
    rm -f "$save"
}

# BA - commutativity
test_old_diff_replayed_with_update_lesser_row_value() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    replicate_to_server test_user

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # we honour the causal order of the client, so bar wins
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 0
    rm -f "$output"
    rm -f "$save"
}

# BA - commutativity
test_reconnect_old_diff_replayed_with_update_lesser_row_value() {
    setup_server
    setup_local test_with_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_with_pk VALUES(0,'foo','read-write');"
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='baz' WHERE id = 0;"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_with_pk SET note='bar' WHERE id = 0;"
    replicate_diff_to_server test_with_pk 0

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_user

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_with_pk;' > "$output"
    # we honour the causal order of the client, so bar wins
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 0
    rm -f "$output"
    rm -f "$save"
}

test_user_privacy_control() {
    setup_server
    setup_local test_with_pk
    setup_local2 test_with_pk

    replicate_to_local skdb_groups test_user
    replicate_to_local skdb_group_permissions test_user

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO skdb_groups VALUES('new_group', 'test_user', 'test_user','read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO skdb_group_permissions VALUES('new_group', 'test_user', skdb_permission('rw'), 'read-write');"
    replicate_to_server test_user

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_with_pk VALUES (42, 'foo', 'new_group');"

    replicate_to_server test_user
    replicate_to_local2 test_with_pk test_user2

    server_output=$(mktemp)
    local_output=$(mktemp)
    local2_output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'select * from test_with_pk;' > "$server_output"
    $SKDB_BIN --data $LOCAL_DB <<< 'select * from test_with_pk;' > "$local_output"
    $SKDB_BIN --data $LOCAL2_DB <<< 'select * from test_with_pk;' > "$local2_output"
    assert_line_count "$server_output" foo 1
    assert_line_count "$local_output" foo 1
    assert_line_count "$local2_output" foo 0

    $SKDB_BIN --data $LOCAL2_DB <<< "INSERT INTO test_with_pk VALUES (43, 'bar', 'new_group');"
    replicate_local2_to_server test_user2 2>/dev/null
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $SERVER_DB <<< 'select * from test_with_pk;' > "$server_output"
    $SKDB_BIN --data $LOCAL_DB <<< 'select * from test_with_pk;' > "$local_output"
    $SKDB_BIN --data $LOCAL2_DB <<< 'select * from test_with_pk;' > "$local2_output"
    assert_line_count "$server_output" bar 0
    assert_line_count "$local_output" bar 0
    assert_line_count "$local2_output" bar 1

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO skdb_group_permissions VALUES('new_group', 'test_user2', skdb_permission('rw'), 'read-write');"
    replicate_to_server test_user
    replicate_to_local2 test_with_pk test_user2

    $SKDB_BIN --data $LOCAL2_DB <<< "INSERT INTO test_with_pk VALUES (44, 'baz', 'new_group');"

    $SKDB_BIN --data $LOCAL2_DB diff --format=csv --since 31 $(cat $SESSION2) | $SKDB_BIN write-csv --data $SERVER_DB --source 3333 --user test_user2 > $WRITE_OUTPUT
    replicate_to_local test_with_pk test_user

    $SKDB_BIN --data $SERVER_DB <<< 'select * from test_with_pk;' > "$server_output"
    $SKDB_BIN --data $LOCAL_DB <<< 'select * from test_with_pk;' > "$local_output"
    $SKDB_BIN --data $LOCAL2_DB <<< 'select * from test_with_pk;' > "$local2_output"
    assert_line_count "$server_output" bar 0
    assert_line_count "$local_output" bar 0
    assert_line_count "$server_output" baz 1
    assert_line_count "$local_output" baz 1
    assert_line_count "$local2_output" baz 1
}

# tests:
run_test test_basic_replication_unique_rows
run_test test_basic_replication_unique_rows_replayed

run_test test_basic_replication_unique_rows_server_state_different

run_test test_basic_replication_null_string
run_test test_basic_replication_empty_string
run_test test_basic_replication_escaped_string
run_test test_basic_replication_escaped_string_alt
run_test test_basic_replication_string_with_unicode

run_test test_basic_replication_with_deletes
run_test test_basic_replication_with_deletes_server_state_different

# local updates
run_test test_seen_insert_deleted
run_test test_unseen_insert_not_deleted
run_test test_unseen_insert_added_to
run_test test_seen_insert_clobbered
run_test test_seen_insert_clobbered_alt
run_test test_unseen_insert_not_updated
run_test test_unseen_update_is_updated
run_test test_unseen_update_is_not_updated
run_test test_unseen_insert_is_updated
run_test test_unseen_delete_gets_clobbered
run_test test_unseen_delete_does_not_affect_delete
run_test test_concurrent_clients_updating_winner_gets_there_first
run_test test_concurrent_clients_updating_winner_gets_there_second
run_test test_user_privacy_control

# still have idempotence and commutativity
run_test test_reconnect_replayed
run_test test_reconnect_replayed_with_update
run_test test_replayed_with_more_local_data
run_test test_replayed_with_further_updates
run_test test_replayed_with_further_updates_lesser_row_value
run_test test_reconnect_replayed_with_more_local_data
run_test test_reconnect_replayed_with_further_updates
run_test test_reconnect_replayed_with_further_updates_lesser_row_value
run_test test_old_diff_replayed
run_test test_reconnect_old_diff_replayed
run_test test_old_diff_replayed_with_update
run_test test_reconnect_old_diff_replayed_with_update
run_test test_old_diff_replayed_with_update_lesser_row_value
run_test test_reconnect_old_diff_replayed_with_update_lesser_row_value
