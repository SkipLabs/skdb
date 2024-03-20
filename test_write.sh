#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --manifest-path ./sql/Skargo.toml --profile $SKARGO_PROFILE -- "

rm -f /tmp/data
rm -f /tmp/data2
rm -f /tmp/test.out
rm -f /tmp/inter.out

$SKDB --init /tmp/data

# creates a "/tmp/" directory in the database
$SKDB --test createDir --data /tmp/data

$SKDB --init /tmp/data2
$SKDB --test createDir --data /tmp/data2

# Connnects the directory /tmp/mapped from data2 to /tmp/ from data1
$SKDB --data /tmp/data2 --connect /tmp/mapped/ --cmd "$SKDB --data /tmp/data --write /tmp/"

$SKDB --data /tmp/data2 --connect /tmp/mapped/ --cmd "cat >> /tmp/inter.out"

# Connnects the directory /tmp/mapped from data to a file
$SKDB --data /tmp/data --connect /tmp/mapped/ --cmd "cat >> /tmp/test.out"

echo -e "key1\tvalue1" | $SKDB --data /tmp/data2 --write /tmp/
echo -e "key2\tvalue2\nkey2\tvalue23" | $SKDB --data /tmp/data2 --write /tmp/
echo -e "key2\n" | $SKDB --data /tmp/data2 --write /tmp/
echo -e "key2\tvalue2\nkey2\tvalue23" | $SKDB --data /tmp/data2 --write /tmp/

echo -e "key1\tvalue1\nkey1\nkey1\tvalue23" | $SKDB --data /tmp/data --write /tmp/

#for i in {1..10}; do echo -e "$i\t$i\n"; done | $SKDB --data /tmp/data2 --write /tmp/

cat /tmp/inter.out
