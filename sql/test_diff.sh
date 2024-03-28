#!/bin/bash

DB=/tmp/test.db

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_CMD="skargo run --profile $SKARGO_PROFILE -- "
SKDB="$SKDB_CMD --always-allow-joins --data $DB"

pass() { printf "%-50s OK\n" "$1:"; }
fail() { printf "%-50s FAILED\n" "$1:"; }

run_diff () {
    rm -f /tmp/kk1 /tmp/kk2 /tmp/kk3 $DB

    nviews=`cat $2 | grep VIEW | sed 's/CREATE REACTIVE VIEW V//' | sed 's/ .*//' | sort -n -r | head -n 1`

    $SKDB_CMD --init $DB
    cat $1 $2 | $SKDB

    for i in $(seq 0 $((nviews))); do
        rm -f /tmp/V$i
        $SKDB subscribe "V$i" --connect --updates "/tmp/V$i" > /dev/null &
    done

    wait

    cat $3 $4 $5 | $SKDB

    rm -f /tmp/selects.sql

    for i in $(seq 0 $((nviews))); do
        echo "select * from V$i;"
    done > /tmp/selects.sql;

    rm -f /tmp/replays

    wait

    for i in $(seq 0 $((nviews))); do
        cat "/tmp/V$i" | $SKDB_CMD replay >> /tmp/replays
    done;

    cat /tmp/selects.sql | $SKDB | sort -n > /tmp/kk1

    cat $2 | sed 's/CREATE REACTIVE VIEW V[0-9]* AS //' > /tmp/selects2.sql

    cat $1 $3 $4 $5 /tmp/selects2.sql | sqlite3 | sort -n > /tmp/kk2

    diff /tmp/kk1 /tmp/kk2
    diff /tmp/kk1 /tmp/kk2 > /dev/null
    if [ $? -eq 0 ]; then
        pass "$2 (part-1)"
    else
        fail "$2 (part-1)"
    fi

    cat /tmp/replays | sort -n > /tmp/kk3

    diff /tmp/kk1 /tmp/kk3 > /dev/null
    if [ $? -eq 0 ]; then
        pass "$2 (part-2)"
    else
        fail "$2 (part-2)"
    fi

}

run_diff_no_sqlite () {
    rm -f /tmp/kk1 /tmp/kk2 /tmp/kk3 $DB

    nviews=`cat $2 | grep VIEW | sed 's/CREATE REACTIVE VIEW V//' | sed 's/ .*//' | sort -n -r | head -n 1`

    $SKDB_CMD --init $DB
    cat $1 $2 | $SKDB

    for i in $(seq 0 $((nviews))); do
        rm -f /tmp/V$i
        $SKDB subscribe "V$i" --connect --updates "/tmp/V$i" > /dev/null &
    done

    wait

    cat $3 $4 $5 | $SKDB

    rm -f /tmp/selects.sql

    for i in $(seq 0 $((nviews))); do
        echo "select * from V$i;"
    done > /tmp/selects.sql;

    rm -f /tmp/replays

    wait

    for i in $(seq 0 $((nviews))); do
        cat "/tmp/V$i" | $SKDB_CMD replay >> /tmp/replays
    done;

    cat /tmp/selects.sql | $SKDB | sort -n > /tmp/kk1

    cat /tmp/replays | sort -n > /tmp/kk3

    diff /tmp/kk1 /tmp/kk3 > /dev/null
    if [ $? -eq 0 ]; then
        pass "$2 (part-2)"
    else
        fail "$2 (part-2)"
    fi

}

run_diff 'test/diff/select2_create.sql' 'test/diff/select2_min_views.sql' 'test/diff/select2_inserts.sql'
run_diff 'test/diff/select2_create.sql' 'test/diff/select2_min_views.sql' 'test/diff/select2_inserts.sql' 'test/diff/select2_deletes.sql'
run_diff 'test/diff/select2_create.sql' 'test/diff/select2_min_views.sql' 'test/diff/select2_inserts.sql' 'test/diff/select2_deletes.sql' 'test/diff/select2_inserts.sql'
run_diff 'test/diff/select1_create.sql' 'test/diff/select1_views.sql' 'test/diff/select1_inserts.sql'
run_diff 'test/diff/select1_float_create.sql' 'test/diff/select1_float_views.sql' 'test/diff/select1_float_inserts.sql'
run_diff 'test/diff/select2_create.sql' 'test/diff/select2_views.sql' 'test/diff/select2_inserts.sql'
run_diff 'test/diff/select3_create.sql' 'test/diff/select3_views.sql' 'test/diff/select3_inserts.sql'
run_diff 'test/diff/select3_create.sql' 'test/diff/select3_views.sql' 'test/diff/select3_inserts.sql' 'test/diff/select3_partial_delete.sql'
run_diff 'test/diff/select4.1-create.sql' 'test/diff/select4.1-views.sql' 'test/diff/select4.1-inserts.sql'
run_diff 'test/diff/select5.1-create.sql' 'test/diff/select5.1-views.sql' 'test/diff/select5.1-inserts.sql'
run_diff 'test/diff/groupby_create.sql' 'test/diff/groupby_views.sql' 'test/diff/groupby_inserts.sql'
run_diff 'test/diff/groupby_create.sql' 'test/diff/groupby_views.sql' 'test/diff/groupby_inserts.sql' 'test/diff/groupby_delete.sql'
run_diff 'test/diff/slt_good_0_create.sql' 'test/diff/slt_good_0_views.sql' 'test/diff/slt_good_0_inserts.sql'

# Same tests, but with a limit of 1

run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_min_views_limit1.sql' 'test/diff/select2_inserts.sql'
run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_min_views_limit1.sql' 'test/diff/select2_inserts.sql' 'test/diff/select2_deletes.sql'
run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_min_views_limit1.sql' 'test/diff/select2_inserts.sql' 'test/diff/select2_deletes.sql' 'test/diff/select2_inserts.sql'
run_diff_no_sqlite 'test/diff/select1_create.sql' 'test/diff/select1_views_limit1.sql' 'test/diff/select1_inserts.sql'
run_diff_no_sqlite 'test/diff/select1_float_create.sql' 'test/diff/select1_float_views_limit1.sql' 'test/diff/select1_float_inserts.sql'
run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_views_limit1.sql' 'test/diff/select2_inserts.sql'
run_diff_no_sqlite 'test/diff/select3_create.sql' 'test/diff/select3_views_limit1.sql' 'test/diff/select3_inserts.sql'
run_diff_no_sqlite 'test/diff/select3_create.sql' 'test/diff/select3_views_limit1.sql' 'test/diff/select3_inserts.sql' 'test/diff/select3_partial_delete.sql'
run_diff_no_sqlite 'test/diff/select4.1-create.sql' 'test/diff/select4.1-views_limit1.sql' 'test/diff/select4.1-inserts.sql'
run_diff_no_sqlite 'test/diff/select5.1-create.sql' 'test/diff/select5.1-views_limit1.sql' 'test/diff/select5.1-inserts.sql'
run_diff_no_sqlite 'test/diff/groupby_create.sql' 'test/diff/groupby_views_limit1.sql' 'test/diff/groupby_inserts.sql'
run_diff_no_sqlite 'test/diff/groupby_create.sql' 'test/diff/groupby_views_limit1.sql' 'test/diff/groupby_inserts.sql' 'test/diff/groupby_delete.sql'
run_diff_no_sqlite 'test/diff/slt_good_0_create.sql' 'test/diff/slt_good_0_views_limit1.sql' 'test/diff/slt_good_0_inserts.sql'

# Same tests, but with a limit of 5

run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_min_views_limit5.sql' 'test/diff/select2_inserts.sql'
run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_min_views_limit5.sql' 'test/diff/select2_inserts.sql' 'test/diff/select2_deletes.sql'
run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_min_views_limit5.sql' 'test/diff/select2_inserts.sql' 'test/diff/select2_deletes.sql' 'test/diff/select2_inserts.sql'
run_diff_no_sqlite 'test/diff/select1_create.sql' 'test/diff/select1_views_limit5.sql' 'test/diff/select1_inserts.sql'
run_diff_no_sqlite 'test/diff/select1_float_create.sql' 'test/diff/select1_float_views_limit5.sql' 'test/diff/select1_float_inserts.sql'
run_diff_no_sqlite 'test/diff/select2_create.sql' 'test/diff/select2_views_limit5.sql' 'test/diff/select2_inserts.sql'
run_diff_no_sqlite 'test/diff/select3_create.sql' 'test/diff/select3_views_limit5.sql' 'test/diff/select3_inserts.sql'
run_diff_no_sqlite 'test/diff/select3_create.sql' 'test/diff/select3_views_limit5.sql' 'test/diff/select3_inserts.sql' 'test/diff/select3_partial_delete.sql'
run_diff_no_sqlite 'test/diff/select4.1-create.sql' 'test/diff/select4.1-views_limit5.sql' 'test/diff/select4.1-inserts.sql'
run_diff_no_sqlite 'test/diff/select5.1-create.sql' 'test/diff/select5.1-views_limit5.sql' 'test/diff/select5.1-inserts.sql'
run_diff_no_sqlite 'test/diff/groupby_create.sql' 'test/diff/groupby_views_limit5.sql' 'test/diff/groupby_inserts.sql'
run_diff_no_sqlite 'test/diff/groupby_create.sql' 'test/diff/groupby_views_limit5.sql' 'test/diff/groupby_inserts.sql' 'test/diff/groupby_delete.sql'
run_diff_no_sqlite 'test/diff/slt_good_0_create.sql' 'test/diff/slt_good_0_views_limit5.sql' 'test/diff/slt_good_0_inserts.sql'
