#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "

rm -f /tmp/test.db

$SKDB --init /tmp/test.db

echo "create table t1 (a INTEGER);" | $SKDB --data /tmp/test.db

(echo "begin transaction;"; for i in {1..2000}; do echo "insert into t1 values ($i);"; done; echo "commit;") | $SKDB --data /tmp/test.db

size1=$($SKDB size --data /tmp/test.db)

$SKDB compact --data /tmp/test.db

size2=$($SKDB size --data /tmp/test.db)

echo "delete from t1 where a > 0;" | $SKDB --data /tmp/test.db

$SKDB compact --data /tmp/test.db

size3=$($SKDB size --data /tmp/test.db)

if (( size2 > size1 ));
then
    echo "TEST CHECKING IF SIZE WENT DOWN AFTER COMPACTION FAILED ($size2 > $size1)"
else
    echo "Compaction: OK ($size2 <= $size1)"
fi


if (( size3 > size2 ));
then
    echo "TEST CHECKING IF SIZE WENT DOWN AFTER DELETE FAILED ($size3 > $size2)"
else
    echo "Delete:     OK ($size3 <= $size2)"
fi
