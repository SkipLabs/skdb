#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "

rm -f /tmp/nation_count

###############################################################################
# BUILD DB
###############################################################################

START=$SECONDS
./makeSqliveDb.sh
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 1800 ));
then
    echo -e "BUILD TPC-H:\tFAILED ($TOTAL)"
else
    echo -e "BUILD TPC-H:\tOK ($TOTAL)"
fi

###############################################################################
# NATION_COUNT VIEW
###############################################################################

echo "create reactive view nation_count as select c_nationkey, count(*) from customer group by c_nationkey;" | $SKDB --data /tmp/test.db
$SKDB subscribe nation_count --connect --data /tmp/test.db --updates /tmp/nation_count > /dev/null

###############################################################################
# JOIN VIEW
###############################################################################

START=$SECONDS
cat view1.sql | $SKDB --data /tmp/test.db
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 120 ));
then
    echo -e "BUILD VIEW1:\tFAILED ($TOTAL)"
else
    echo -e "BUILD VIEW1:\tOK ($TOTAL)"
fi

###############################################################################
# INDEX
###############################################################################

START=$SECONDS
echo "create index view1_o_orderdate on view1(o_orderdate);" | $SKDB --data /tmp/test.db
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 10 ));
then
    echo -e "BUILD INDEX view1_o_orderdate:\tFAILED ($TOTAL)"
else
    echo -e "BUILD INDEX view1_o_orderdate:\tOK ($TOTAL)"
fi

###############################################################################
# Query 1
###############################################################################

rm -f /tmp/query1

START=$SECONDS
cat query1.sql | $SKDB --data /tmp/test.db
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 3 ));
then
    echo -e "BUILD query1 REACTIVE VIEW:\tFAILED ($TOTAL)"
else
    echo -e "BUILD query1 REACTIVE VIEW:\tOK ($TOTAL)"
fi

$SKDB subscribe query1 --connect --data /tmp/test.db --updates /tmp/query1 > /dev/null

###############################################################################
# Query 2
###############################################################################

rm -f /tmp/query2

START=$SECONDS
cat query2.sql | $SKDB --data /tmp/test.db
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 20 ));
then
    echo -e "BUILD query2 REACTIVE VIEW:\tFAILED ($TOTAL)"
else
    echo -e "BUILD query2 REACTIVE VIEW:\tOK ($TOTAL)"
fi

$SKDB subscribe query2 --connect --data /tmp/test.db --updates /tmp/query2 > /dev/null

###############################################################################
# Query 3
###############################################################################

rm -f /tmp/query3

START=$SECONDS
cat query3.sql | $SKDB --data /tmp/test.db
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 30 ));
then
    echo -e "BUILD query3 REACTIVE VIEW:\tFAILED ($TOTAL)"
else
    echo -e "BUILD query3 REACTIVE VIEW:\tOK ($TOTAL)"
fi

$SKDB subscribe query3 --connect --data /tmp/test.db --updates /tmp/query3 > /dev/null

###############################################################################
# DUMP AND CHECK SIZE
###############################################################################

# rm -f /tmp/test2.db
# $SKDB --init /tmp/test2.db
# $SKDB dump --data /tmp/test.db | $SKDB --data /tmp/test2.db
# $SKDB compact --data /tmp/test2.db

# mv /tmp/test2.db /tmp/test.db

###############################################################################
# MASS DELETE
###############################################################################

START=$SECONDS
echo "delete from customer where c_custkey <= 10000;" | $SKDB --data /tmp/test.db
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 50 ));
then
    echo -e "RUN DELETE:\tFAILED ($TOTAL)"
else
    echo -e "RUN DELETE:\tOK ($TOTAL)"
fi

###############################################################################
# SMALL DELETE
###############################################################################

START=$SECONDS
echo "delete from lineitem where l_orderkey < 10;" | $SKDB --data /tmp/test.db
TOTAL=$(($SECONDS - $START))
if (( TOTAL > 5 ));
then
    echo -e "RUN DELETE2:\tFAILED ($TOTAL)"
else
    echo -e "RUN DELETE2:\tOK ($TOTAL)"
fi
