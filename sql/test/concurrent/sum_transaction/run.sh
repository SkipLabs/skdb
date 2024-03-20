#!/bin/bash

pass() { printf "%-20s OK\n" "$1:"; }
fail() { printf "%-20s FAILED\n" "$1:"; }

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "

rm -f /tmp/test.db

$SKDB --init /tmp/test.db

cat create.sql | $SKDB --data /tmp/test.db

for i in {1..100}
do
    cat inserts.sql | $SKDB --data /tmp/test.db &
done
wait

echo "SELECT * FROM t1;" | $SKDB --data /tmp/test.db  > /tmp/test_result
sum=`cat /tmp/test_result | egrep '^[0-9]+$' | awk '{x += $1} END {print x}'`

if [[ sum -eq 2054 ]]
then
  pass "CONCURRENT SUM"
else
  fail "CONCURRENT SUM"
fi
