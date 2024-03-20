#!/bin/bash

pass() { printf "%-40s OK\n" "$1:"; }
fail() { printf "%-40s FAILED\n" "$1:"; }

db=$(mktemp)
db_copy=$(mktemp)
rm -f $db $db_copy
tailfile=$(mktemp)
out1=$(mktemp)
out2=$(mktemp)


if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_BIN="skargo run -q --profile $SKARGO_PROFILE -- "

$SKDB_BIN --init $db
$SKDB_BIN --init $db_copy
skdb="$SKDB_BIN --data $db"
skdb_copy="$SKDB_BIN --data $db_copy"

echo "create table t1 (a INTEGER);" | $skdb
echo "create table t1 (a INTEGER);" | $skdb_copy

sessionID=`$skdb subscribe t1 --connect`

echo '{"t1": {"filterExpr": "a > @bound", "filterParams": { "bound": 500 }}}' \
| $skdb tail $sessionID --follow --read-spec > $tailfile &
tailerID=$!

for i in {1..1000}; do
    echo "insert into t1 values($i);"
done | $skdb

sleep 1

cat $tailfile | $skdb_copy write-csv > /dev/null

echo "select * from t1 where a > 500;" | $skdb > $out1
echo "select * from t1;" | $skdb_copy > $out2

diff -q $out1 $out2
if [ $? -eq 0 ]; then
    pass "TAIL FILTER PARAM TEST"
else
    fail "TAIL FILTER PARAM TEST"
fi
