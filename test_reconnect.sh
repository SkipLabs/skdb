#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --manifest-path ./sql/Skargo.toml --profile $SKARGO_PROFILE -- "

rm -f /tmp/data

$SKDB --init /tmp/data

echo "create table t1 (a INTEGER);" | $SKDB --data /tmp/data
echo "create view v1 as select * from t1;" | $SKDB --data /tmp/data

for i in {1..100}; do echo "insert into t1 values($i);" | $SKDB --data /tmp/data; done

nc -l -p 2345 > /dev/null &

rm -f /tmp/out /tmp/err

$SKDB --data /tmp/data --connect /v1/ --cmd "nc -q 0 localhost 2345"

for i in {1..10}; do echo "insert into t1 values($i);" | $SKDB --data /tmp/data; done

nc -l -p 2345 > /tmp/server_out&

$SKDB --reconnect 210 --data /tmp/data

$SKDB --sessions --data /tmp/data
