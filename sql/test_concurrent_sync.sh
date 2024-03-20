#!/bin/bash

pass() { printf "%-20s OK\n" "$1:"; }
fail() { printf "%-20s FAILED\n" "$1:"; }

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "

# Test that launches a bunch of unix process that insert numbers in a table
# concurrently. We check at the end that the sum of the numbers is correct.

rm -f /tmp/test_data
$SKDB --init /tmp/test_data

echo 'create table t1(a INTEGER);' | $SKDB --data /tmp/test_data

for i in {0..100}
do
    command="/tmp/cmd$i.sql"
    rm -f $command
    for j in $(seq $(($i * 100)) $((($i+1) * 100)))
    do
        echo "INSERT INTO t1 VALUES($j);" >> "/tmp/cmd$i.sql"
    done
#    UNCOMMENT THIS IF YOU WANT A CORE DUMP
#    ulimit -c unlimited
    cat $command | $SKDB --data /tmp/test_data &
#    if [[ $? -eq 139 ]]; then
#       gdb -q $SKDB core -x /tmp/backtrace
#    fi
done
wait

echo "SELECT * FROM t1;" | $SKDB --data /tmp/test_data  > /tmp/test_result
sum=`cat /tmp/test_result | egrep '^[0-9]+$' | awk '{x += $1} END {print x}'`

if [[ sum -eq 51515050 ]]
then
  pass "CONCURRENT SYNC"
else
  fail "CONCURRENT SYNC"
fi
