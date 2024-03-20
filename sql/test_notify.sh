#!/bin/bash

pass() { printf "%-36s OK\n" "TEST $1:"; }
fail() { printf "%-36s FAILED\n" "TEST $1:"; }

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "

rm -f /tmp/test.db

$SKDB --init /tmp/test.db

echo "create table t1 (a INTEGER);" | $SKDB --data /tmp/test.db

rm -f /tmp/nn

echo "create reactive view v1 as select * from t1;" | $SKDB --data /tmp/test.db

$SKDB subscribe v1 --connect --notify /tmp/nn --data /tmp/test.db > /dev/null

n1=`cat /tmp/nn`

echo "insert into t1 values(22);" | $SKDB --data /tmp/test.db

n2=`cat /tmp/nn`

echo "insert into t1 values(23);" | $SKDB --data /tmp/test.db

n3=`cat /tmp/nn`

if (( n1 < n2 ))
then
    pass "NOTIFY1"
else
    fail "NOTIFY1"
fi

if (( n2 < n3 ))
then
    pass "NOTIFY2"
else
    fail "NOTIFY2"
fi
