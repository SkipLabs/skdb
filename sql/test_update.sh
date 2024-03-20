#!/bin/bash

trap "trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT

db=$(mktemp /tmp/db.XXXXXX)
tailfile2=$(mktemp /tmp/tail.XXXXXX)
tailfile3=$(mktemp /tmp/tail.XXXXXX)
tailfile4=$(mktemp /tmp/tail.XXXXXX)
tailfile5=$(mktemp /tmp/tail.XXXXXX)
tailfile6=$(mktemp /tmp/tail.XXXXXX)
tailfile7=$(mktemp /tmp/tail.XXXXXX)
tailfile8=$(mktemp /tmp/tail.XXXXXX)
tailfile9=$(mktemp /tmp/tail.XXXXXX)
tailfile10=$(mktemp /tmp/tail.XXXXXX)
file1=$(mktemp /tmp/file.XXXXXX)
file2=$(mktemp /tmp/file.XXXXXX)
file3=$(mktemp /tmp/file.XXXXXX)
file4=$(mktemp /tmp/file.XXXXXX)
file5=$(mktemp /tmp/file.XXXXXX)
file6=$(mktemp /tmp/file.XXXXXX)
file7=$(mktemp /tmp/file.XXXXXX)
file8=$(mktemp /tmp/file.XXXXXX)
file9=$(mktemp /tmp/file.XXXXXX)
file10=$(mktemp /tmp/file.XXXXXX)


rm -Rf $db $tailfile2 $tailfile3 $tailfile4 $tailfile5 $tailfile6 $tailfile7 $tailfile8 $tailfile9 $tailfile10 $file1 $file2 $file3 $file4 $file5 $file6 $file7 $file8 $file9 $file10

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_CMD="skargo run -q --profile $SKARGO_PROFILE -- "

$SKDB_BIN --init $db
skdb="$SKDB_BIN --data $db"

cat privacy/init.sql | $skdb
echo "create table t1 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t2 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t3 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t4 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t5 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t6 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t7 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t8 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t9 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb
echo "create table t10 (a INTEGER PRIMARY KEY, b INTEGER);" | $skdb

sessionID=`$skdb subscribe t1 --connect`

# Staring the tailer2
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile2&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile3&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile4&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile5&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile6&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile7&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile8&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile9&
tail -f /dev/null | $skdb tail --format=csv $sessionID --follow > $tailfile10&
tailerID=$!

for i in {1..10}; do
    echo "insert into t1 values ($i, $i);";
done | $skdb

for i in {1..10}; do
    for j in {1..1000}; do 
        echo "update t1 set b=b+1 where a=$i;"
     done | $skdb
done


echo "insert into t1 values(-1, -1)" | $skdb

while ! cat $tailfile2 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile3 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile4 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile5 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile6 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile7 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile8 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile9 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

while ! cat $tailfile10 | tr '\t' 'Y' | egrep '[-]1' -q > /dev/null; do
    sleep 1
done

cat $tailfile2 | $skdb write-csv > /dev/null
cat $tailfile3 | $skdb write-csv > /dev/null
cat $tailfile4 | $skdb write-csv > /dev/null
cat $tailfile5 | $skdb write-csv > /dev/null
cat $tailfile6 | $skdb write-csv > /dev/null
cat $tailfile7 | $skdb write-csv > /dev/null
cat $tailfile8 | $skdb write-csv > /dev/null
cat $tailfile9 | $skdb write-csv > /dev/null
cat $tailfile10 | $skdb write-csv > /dev/null

echo "select * from t1;" | $skdb > $file1
echo "select * from t2;" | $skdb > $file2
echo "select * from t3;" | $skdb > $file3
echo "select * from t4;" | $skdb > $file4
echo "select * from t5;" | $skdb > $file5
echo "select * from t6;" | $skdb > $file6
echo "select * from t7;" | $skdb > $file7
echo "select * from t8;" | $skdb > $file8
echo "select * from t9;" | $skdb > $file9
echo "select * from t10;" | $skdb > $file10


diff $file1 $file2 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST1: OK"
else
    echo "UPDATE TEST1: FAILED"
fi

diff $file1 $file3 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST2: OK"
else
    echo "UPDATE TEST2: FAILED"
fi

diff $file1 $file4 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST3: OK"
else
    echo "UPDATE TEST3: FAILED"
fi

diff $file1 $file5 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST4: OK"
else
    echo "UPDATE TEST4: FAILED"
fi

diff $file1 $file6 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST5: OK"
else
    echo "UPDATE TEST5: FAILED"
fi

diff $file1 $file7 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST6: OK"
else
    echo "UPDATE TEST6: FAILED"
fi

diff $file1 $file8 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST7: OK"
else
    echo "UPDATE TEST7: FAILED"
fi

diff $file1 $file9 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST8: OK"
else
    echo "UPDATE TEST8: FAILED"
fi

diff $file1 $file10 > /dev/null
if [ $? -eq 0 ]; then
    echo "UPDATE TEST9: OK"
else
    echo "UPDATE TEST9: FAILED"
fi

kill $(jobs -rp)
wait $(jobs -rp) 2>/dev/null

rm -Rf $db $tailfile2 $tailfile3 $tailfile4 $tailfile5 $tailfile6 $tailfile7 $tailfile8 $tailfile9 $tailfile10 $file1 $file2 $file3 $file4 $file5 $file6 $file7 $file8 $file9 $file10
