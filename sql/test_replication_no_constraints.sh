#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_BIN="skargo run --profile $SKARGO_PROFILE -- "

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

SERVER_DB=/tmp/server.db
LOCAL_DB=/tmp/local.db
UPDATES=/tmp/updates
WRITE_OUTPUT=/tmp/write-out
SESSION=/tmp/session

setup_server() {
    db=$SERVER_DB
    rm -f "$db" "$WRITE_OUTPUT"

    SKDB="$SKDB_BIN --data $db"
    $SKDB_BIN --init "$db"

    $SKDB < "$SCRIPT_DIR/privacy/init.sql"

    echo "INSERT INTO skdb_users VALUES('test_user', 'test');" | $SKDB
    echo "CREATE TABLE test_without_pk (id INTEGER, note TEXT, skdb_access TEXT);" | $SKDB
}

setup_local() {
    table=$1
    db=$LOCAL_DB
    rm -f "$db" "$UPDATES"

    SKDB="$SKDB_BIN --data $db"
    $SKDB_BIN --init "$db"

    echo "CREATE TABLE test_without_pk (id INTEGER, note TEXT, skdb_access TEXT);" | $SKDB

    $SKDB_BIN subscribe --data $LOCAL_DB --connect --format=csv --updates $UPDATES --ignore-source 9999 "$table" > $SESSION
}

replicate_to_local() {
    table=$1
    sub=$($SKDB_BIN --data $SERVER_DB subscribe --connect --ignore-source 1234 "$table")
    $SKDB_BIN --data $SERVER_DB tail --format=csv --since 0 "$sub" --user test_user |
        $SKDB_BIN write-csv --data $LOCAL_DB --source 9999 > $WRITE_OUTPUT
}

replicate_to_server() {
    table=$1
    cat $UPDATES | $SKDB_BIN write-csv --data $SERVER_DB --source 1234 --user test_user > $WRITE_OUTPUT
}

replicate_diff_to_server() {
    table=$1
    since=$2
    $SKDB_BIN --data $LOCAL_DB diff --format=csv --since "$since" "$(cat $SESSION)" |
        $SKDB_BIN write-csv --data $SERVER_DB --source 1234 --user test_user > $WRITE_OUTPUT
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

    echo last write-csv response:
    cat $WRITE_OUTPUT

    echo local state:
    $SKDB_BIN --data $LOCAL_DB <<< "select * from test_without_pk;"

    echo server state:
    $SKDB_BIN --data $SERVER_DB <<< "select * from test_without_pk;"
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
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" "$pattern" "$expected"
    rm -f "$output"
}

assert_equal() {
    actual=$1
    expected=$2
    if [[ ! $actual -eq $expected ]]
    then
        echo -e "FAIL\nexpected $expected but got $actual"
        exit 1
    fi
}

assert_gt() {
    actual=$1
    expected=$2
    if [[ ! $actual -gt $expected ]]
    then
        echo -e "FAIL\nexpected $actual > $expected but it isn't"
        exit 1
    fi
}

################################################################################
# basic replication scenarios
################################################################################

test_basic_replication_unique_rows() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(2,'baz', 'read-write');"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_basic_replication_unique_rows_replayed() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(2,'baz', 'read-write');"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"

    # simulate a reconnect - resend everything
    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_basic_replication_null_string() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_without_pk SET note = NULL WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)

    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_without_pk WHERE note is NULL;" > "$output"
    assert_line_count "$output" 1 1
    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_without_pk WHERE note = '';" > "$output"
    assert_line_count "$output" 0 1

    session=$($SKDB_BIN --data $SERVER_DB subscribe test_without_pk --connect)
    $SKDB_BIN tail --data $SERVER_DB --format=csv "$session" --since 0 --user test_user > "$output"
    # we want the output to contain a null representation
    assert_line_count "$output" "1	0,,\"read-write\"$" 1
    rm -f "$output"
}

test_basic_replication_empty_string() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_without_pk SET note = '' WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)

    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_without_pk WHERE note is NULL;" > "$output"
    assert_line_count "$output" 0 1
    $SKDB_BIN --data $SERVER_DB <<< "SELECT COUNT(*) FROM test_without_pk WHERE note = '';" > "$output"
    assert_line_count "$output" 1 1

    session=$($SKDB_BIN --data $SERVER_DB subscribe test_without_pk --connect)
    $SKDB_BIN tail --data $SERVER_DB --format=csv "$session" --since 0 --user test_user > "$output"
    # we want the output to contain an empty string
    assert_line_count "$output" '""' 1
    rm -f "$output"
}

test_basic_replication_dup_rows() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    output=$(mktemp)
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"
}

test_basic_replication_dup_rows_in_txn() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');"
    (
        echo "BEGIN TRANSACTION;";
        echo "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');";
        echo "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');";
        echo "COMMIT;";
    ) | $SKDB_BIN --data $LOCAL_DB

    output=$(mktemp)
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" bar 3
    rm -f "$output"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" bar 3
    rm -f "$output"
}

test_basic_replication_dup_rows_replayed() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"

    # simulate a reconnect - resend everything
    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"
}

test_basic_replication_dup_rows_diff_full_replay_using_diff() {
    # scenario: we write a bunch of times, which do succeed, but we
    # fail to receive the acks, then re-establish from time zero

    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    output=$(mktemp)
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"

    # simulate reconnect using diff. this is different than just
    # replaying the original updates file. it just outputs a single
    # txn
    $SKDB_BIN --data $LOCAL_DB diff --format=csv --since 0 "$(cat $SESSION)" > $UPDATES
    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"
}

test_basic_replication_dup_rows_server_state_different() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    output=$(mktemp)
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    rm -f "$output"

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"

    replicate_to_server test_without_pk

    # different writers so they combine
    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"
}

test_basic_replication_with_deletes() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_server test_without_pk
    assert_server_rows_has 1 foo

    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"
    replicate_to_server test_without_pk
    assert_server_rows_has 0 foo

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"
    replicate_to_server test_without_pk
    assert_server_rows_has 0 foo

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"
    replicate_to_server test_without_pk
    assert_server_rows_has 0 foo

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_server test_without_pk
    assert_server_rows_has 1 foo
}

test_basic_replication_with_deletes_server_state_different() {
    setup_server
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"
    replicate_to_server test_without_pk

    # we still have the record as this was concurrently written
    assert_server_rows_has 1 foo
}

test_replication_with_a_row_that_has_a_higher_than_two_repeat_count() {
    # quite a specific test. this is to ensure that write-csv can find
    # rows that have a repeat count other than 1 or 0.

    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo','read-write');"

    # ensure that the row is written to the server with a repeat of 2
    $SKDB_BIN write-csv --data $SERVER_DB --source 1234 > $WRITE_OUTPUT <<EOF
^test_without_pk
2	0,"foo","read-write"
:1
EOF

    output=$(mktemp)
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    rm -f "$output"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

test_replication_with_a_row_that_has_a_higher_than_two_repeat_count_dups() {
    # this time with multiple inserts

    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    # ensure that the row is written to the server with a repeat of 2
    $SKDB_BIN write-csv --data $SERVER_DB --source 1234 > $WRITE_OUTPUT <<EOF
^test_without_pk
2	0,"foo","read-write"
:1
EOF

    output=$(mktemp)
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    rm -f "$output"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"
}

test_tailing_dups_uses_repeat() {
    # this test is important. not only is repeat an optimisation
    # (think sending thousands of duplicate rows over the network) but
    # it also guarantees correctness when the JS client applies a diff.

    # the JS client does not have a running write-csv process to
    # stream data in to. it spins up write-csv and passes a chunk of
    # input, ensuring the chunk ends on a line boundary. the only
    # guaranteed unit is a single line. as each line carries
    # assignment semantics, we need the repeat count to be correct as
    # we cannot rely on all repeating lines being provided together.
    # if they're not provided together, they will clobber each other.

    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(1,'bar', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    assert_line_count "$output" bar 1
    rm -f "$output"

    output=$(mktemp)
    session=$($SKDB_BIN --data $SERVER_DB subscribe test_without_pk --connect)
    $SKDB_BIN tail --data $SERVER_DB --format=csv "$session" --since 0 --user test_user > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    grep -q '2	0,"foo"' "$output" || fail
    rm -f "$output"
}

test_replication_privacy_rejection_and_feedback() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO skdb_group_permissions VALUES ('read-write', 'test_user', 4, 'root');"

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(37, 'good', 'test_user');"
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(42, 'bad', 'read-write');"
    $SKDB_BIN --data $LOCAL_DB <<< "CREATE TABLE test_without_pk__skdb_mirror_feedback (id INTEGER, note TEXT, skdb_access TEXT);"

    cat $UPDATES \
	| $SKDB_BIN write-csv --data $SERVER_DB --source 1234 --user test_user 2>/dev/null \
	| $SKDB_BIN write-csv --data $LOCAL_DB --source 9999 >/dev/null

    server_rows=$(mktemp)
    local_rows=$(mktemp)
    local_feedback_rows=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$server_rows"
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk;' > "$local_rows"
    $SKDB_BIN --data $LOCAL_DB <<< 'SELECT * FROM test_without_pk__skdb_mirror_feedback;' > "$local_feedback_rows"

    # server should reject privacy-violating 'bad' row, and client should write the rejected row to corresponding feedback table
    assert_line_count "$server_rows" good 1
    assert_line_count "$server_rows" bad 0

    assert_line_count "$local_rows" good 1
    assert_line_count "$local_rows" bad 1

    assert_line_count "$local_feedback_rows" good 0
    assert_line_count "$local_feedback_rows" bad 1

    #test_user can't manage permissions in read-write since they're not an admin
    perms_stderr=$(mktemp)
    perms_stdout=$(mktemp)
    $SKDB_BIN write-csv --data $SERVER_DB --source 1234 --user test_user >"$perms_stdout" 2>"$perms_stderr" <<EOF
^skdb_group_permissions
1	"read-write","test_user",7,"test_user"
:1
EOF
    assert_line_count "$perms_stderr" "cannot manage permissions for group read-write" 1
    assert_line_count "$perms_stdout" "skdb_group_permissions__skdb_mirror_feedback" 1
}

test_rebuild_behaviour_with_rebuilds_disabled() {
    setup_server
    setup_local test_without_pk

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_equal "$watermark" 0

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0, 'foo', 'test_user');"
    replicate_to_local test_without_pk

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_gt "$watermark" 0

    row_count=$($SKDB_BIN --data $LOCAL_DB <<< "select * from test_without_pk"|wc -l)
    assert_gt "$row_count" 0

    $SKDB_BIN write-csv --data $LOCAL_DB --source 9999 > $WRITE_OUTPUT 2>&1 <<EOF
^test_without_pk
!rebuild
:400
EOF
    assert_line_count "$WRITE_OUTPUT" "Invariant violation" 2

    # crucially: the data is still there
    row_count=$($SKDB_BIN --data $LOCAL_DB <<< "select * from test_without_pk"|wc -l)
    assert_gt "$row_count" 0

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_gt "$watermark" 0
}

test_rebuild_watermark_behaviour_with_rebuilds_enabled() {
    setup_server
    setup_local test_without_pk

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_equal "$watermark" 0

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0, 'foo', 'test_user');"
    replicate_to_local test_without_pk

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_gt "$watermark" 0

    row_count=$($SKDB_BIN --data $LOCAL_DB <<< "select * from test_without_pk"|wc -l)
    assert_gt "$row_count" 0

    $SKDB_BIN write-csv --data $LOCAL_DB --source 9999 --enable-rebuilds > $WRITE_OUTPUT <<EOF
^test_without_pk
!rebuild
:400
EOF

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_equal "$watermark" 0

    row_count=$($SKDB_BIN --data $LOCAL_DB <<< "select * from test_without_pk"|wc -l)
    assert_equal "$row_count" 0

    replicate_to_local test_without_pk

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_gt "$watermark" 0

    row_count=$($SKDB_BIN --data $LOCAL_DB <<< "select * from test_without_pk"|wc -l)
    assert_gt "$row_count" 0

    # and just check once more

    $SKDB_BIN write-csv --data $LOCAL_DB --source 9999 --enable-rebuilds > $WRITE_OUTPUT <<EOF
^test_without_pk 100
!rebuild
:400
EOF

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_equal "$watermark" 0

    replicate_to_local test_without_pk

    watermark=$($SKDB_BIN --data $LOCAL_DB watermark --source 9999 test_without_pk)
    assert_gt "$watermark" 0
}

################################################################################
# these tests replicate data around first so we build some notion of
# the vector clock and test concurrency
################################################################################

test_seen_insert_deleted() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 0
    rm -f "$output"
}

test_unseen_insert_not_deleted() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    rm -f "$output"
}

test_unseen_insert_added_to() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"
}

test_seen_insert_clobbered() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_without_pk SET note='bar' WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    rm -f "$output"
}

test_unseen_insert_not_updated() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_without_pk SET note='bar' WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 1
    assert_line_count "$output" bar 1
    rm -f "$output"
}

test_unseen_update_is_not_updated() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "UPDATE test_without_pk SET note='bar' WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_without_pk SET note='baz' WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_unseen_update_is_not_updated_reversed() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "UPDATE test_without_pk SET note='baz' WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "UPDATE test_without_pk SET note='bar' WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    # tiebreak the concurrency: foo wins because the foo row > bar row
    assert_line_count "$output" foo 0
    assert_line_count "$output" bar 1
    assert_line_count "$output" baz 1
    rm -f "$output"
}

test_unseen_delete_gets_clobbered() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_server test_without_pk

    # the client now asserts there should be two rows. our concurrency
    # model is that inserts always beat deletes and need to be
    # resolved.
    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    rm -f "$output"
}

test_unseen_delete_does_not_affect_delete() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    # local has seen up to 0,'foo'
    # but not this
    $SKDB_BIN --data $SERVER_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"
    # concurrently:
    $SKDB_BIN --data $LOCAL_DB <<< "DELETE FROM test_without_pk WHERE id = 0;"

    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 0
    rm -f "$output"
}

# AA - idempotentency
test_reconnect_replayed() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_server test_without_pk
    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 2
    rm -f "$output"
}

# AB - commutativity
test_replayed_with_more_local_data() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_server test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"
}

# AB - commutativity
test_reconnect_replayed_with_more_local_data() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"

    replicate_to_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_server test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    # this is a reconnect, we figure out the diff
    replicate_diff_to_server test_without_pk 0

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"
}

# BA - commutativity
test_old_diff_replayed() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_server test_without_pk

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"
    rm -f "$save"
}

# BA - commutativity
test_reconnect_old_diff_replayed() {
    setup_server
    setup_local test_without_pk

    $SKDB_BIN --data $SERVER_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_to_local test_without_pk

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    # stash what would have been sent up
    save=$(mktemp)
    cp $UPDATES "$save"

    $SKDB_BIN --data $LOCAL_DB <<< "INSERT INTO test_without_pk VALUES(0,'foo', 'read-write');"
    replicate_diff_to_server test_without_pk 0

    # restore and replay
    mv "$save" $UPDATES
    replicate_to_server test_without_pk

    output=$(mktemp)
    $SKDB_BIN --data $SERVER_DB <<< 'SELECT * FROM test_without_pk;' > "$output"
    assert_line_count "$output" foo 3
    rm -f "$output"
    rm -f "$save"
}


# tests:
run_test test_basic_replication_unique_rows
run_test test_basic_replication_unique_rows_replayed

run_test test_basic_replication_null_string
run_test test_basic_replication_empty_string

run_test test_basic_replication_dup_rows
run_test test_basic_replication_dup_rows_in_txn
run_test test_basic_replication_dup_rows_replayed
run_test test_basic_replication_dup_rows_diff_full_replay_using_diff

run_test test_basic_replication_dup_rows_server_state_different

run_test test_basic_replication_with_deletes
run_test test_basic_replication_with_deletes_server_state_different

run_test test_replication_with_a_row_that_has_a_higher_than_two_repeat_count
run_test test_replication_with_a_row_that_has_a_higher_than_two_repeat_count_dups

run_test test_tailing_dups_uses_repeat

run_test test_replication_privacy_rejection_and_feedback

run_test test_rebuild_behaviour_with_rebuilds_disabled
run_test test_rebuild_watermark_behaviour_with_rebuilds_enabled

# local updates
run_test test_seen_insert_deleted
run_test test_unseen_insert_not_deleted
run_test test_unseen_insert_added_to
run_test test_seen_insert_clobbered
run_test test_unseen_insert_not_updated
run_test test_unseen_update_is_not_updated
run_test test_unseen_update_is_not_updated_reversed
run_test test_unseen_delete_gets_clobbered
run_test test_unseen_delete_does_not_affect_delete

# still have idempotence and commutativity
run_test test_reconnect_replayed
run_test test_replayed_with_more_local_data
run_test test_reconnect_replayed_with_more_local_data
run_test test_old_diff_replayed
run_test test_reconnect_old_diff_replayed
