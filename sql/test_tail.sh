#!/bin/bash

trap "trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT

db=$(mktemp /tmp/db.XXXXXX)
tailfile=$(mktemp /tmp/tail.XXXXXX)
file1=$(mktemp /tmp/file.XXXXXX)
file2=$(mktemp /tmp/file.XXXXXX)

rm -Rf $db $tailfile $file1 $file2

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_CMD="skargo run -q --profile $SKARGO_PROFILE -- "

$SKDB_BIN --init $db
skdb="$SKDB_BIN --data $db"

cat privacy/init.sql | $skdb
echo "create table t1 (a INTEGER PRIMARY KEY);" | $skdb
echo "create table t2 (a INTEGER);" | $skdb

sessionID=`$skdb subscribe t1 --connect`

# Staring the tailer
tail -f /dev/null | $skdb tail $sessionID --follow > $tailfile&
tailerID=$!

# First let's insert something

echo "insert into t1 values(0);" | $skdb

# And make sure that the tailer picked it up

while ! grep "0" $tailfile -q > /dev/null; do
    sleep 1
done

# Next, let's put the tailer to sleep

kill -TSTP $tailerID

# Now let's insert/remove a lot of data to force a purge

for i in {1..1000}; do
    echo "insert into t1 values($i);"
done | $skdb

for i in {0..900}; do
    echo "delete from t1 where a = $i;"
done | $skdb


# Now, let's wake up the process

kill -CONT $tailerID

# Let's make sure a purge actually occurred.

while ! cat $tailfile | tr '\t' 'Y' | grep 'YY' -q > /dev/null; do
    sleep 1
done

cat $tailfile | $skdb write-csv > /dev/null

echo "select * from t1;" | $skdb > $file1
echo "select * from t2;" | $skdb > $file2

diff $file1 $file2 > /dev/null
if [ $? -eq 0 ]; then
    echo "PURGE TEST: OK"
else
    echo "PURGE TEST: FAILED"
fi

rm -Rf $db $tailfile $tailfile2 $file1 $file2

kill $(jobs -rp)
wait $(jobs -rp) 2>/dev/null
