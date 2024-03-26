#!/bin/bash

pass() { printf "%-32s OK\n" "TEST $1:"; }
fail() { printf "%-32s FAILED\n" "TEST $1:"; }

DBFILE=/tmp/test.db
DBCOPYFILE=/tmp/test_copy.db

rm -f $DBFILE $DBCOPYFILE

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

SKDB_CMD="skargo run --profile $SKARGO_PROFILE -- "

$SKDB_CMD --init $DBFILE
$SKDB_CMD --init $DBCOPYFILE

SKDB="$SKDB_CMD --data $DBFILE"
SKDB_COPY="$SKDB_CMD --data $DBCOPYFILE"

cat privacy/init.sql | $SKDB
cat privacy/init.sql | $SKDB_COPY

echo "create table t1 (id INTEGER primary key, skdb_access TEXT);" | $SKDB
echo "create table t1 (id INTEGER primary key, skdb_access TEXT);" | $SKDB_COPY
subt1=`$SKDB subscribe t1`

echo "create table t2 (id INTEGER primary key, skdb_access TEXT);" | $SKDB
echo "create reactive view v1 as select id, id as skdb_access from t1 ;" | $SKDB

###############################################################################
# Creating the users
###############################################################################

for i in {1..10}; do
    echo "insert into skdb_users values('ID$i', 'pass');"
done | $SKDB

###############################################################################
# USER PERMISSIONS
###############################################################################

# We need a group that doesn't restrict anyone.
echo "insert into skdb_groups values('myGroup', NULL, 'root', 'root');" | $SKDB
echo "insert into skdb_group_permissions values ('myGroup', NULL, skdb_permission('rid'), 'root');" | $SKDB

# Let's check that user permissions are respected
# This should turn every user into "readonly"
echo "insert into skdb_user_permissions values (NULL, skdb_permission('r'), 'root');" | $SKDB

if echo -e "^t2\n1\t235,\"myGroup\"\n:1" | $SKDB write-csv --user ID1 2>&1 | grep -q Error; then
    pass "USER PERMISSIONS"
else
    fail "USER PERMISSIONS"
fi

# Let's check that user permissions are respected for a specific user
echo "insert into skdb_user_permissions values ('ID1', skdb_permission('ri'), 'root');" | $SKDB

if echo -e "^t2\n1\t235,\"myGroup\"\n:1" | $SKDB write-csv --user ID1 2>&1 | grep -q Error; then
    fail "USER PERMISSIONS2"
else
    pass "USER PERMISSIONS2"
fi

# Let's check that permissions can also be specified as query parameters
echo -e "{ \"perm\": \"rw\" }\ninsert into skdb_user_permissions values ('ID4', skdb_permission(@perm), 'root');" \
    | $SKDB --expect-query-params

if echo -e "^t2\n1\t236,\"myGroup\"\n:1" | $SKDB write-csv --user ID4 2>&1 | grep -q Error; then
    fail "USER PERMISSIONS3"
else
    pass "USER PERMISSIONS3"
fi

###############################################################################
# GROUP PERMISSIONS
###############################################################################

# Let's create a group
# user1 can write, all the others can only read
echo "insert into skdb_groups values('ID22', NULL, 'root', 'root');" | $SKDB
echo "insert into skdb_group_permissions values ('ID22', 'ID1', skdb_permission('rw'), 'root');" | $SKDB
echo "insert into skdb_group_permissions values ('ID22', 'ID2', skdb_permission('r'), 'root');" | $SKDB
echo "insert into skdb_group_permissions values ('ID22', 'ID3', skdb_permission('r'), 'root');" | $SKDB

# Let's check user1 can write
if echo -e "^t1\n1\t238,\"ID22\"\n:1" | $SKDB write-csv --user ID1 2>&1 | grep -q Error; then
    fail "GROUP PERMISSIONS"
else
    pass "GROUP PERMISSIONS"
fi

# Let's check user2 cannot write
if echo -e "^t1\n1\t239,\"ID22\"\n:1" | $SKDB write-csv --user ID2 2>&1 | grep -q Error; then
    pass "GROUP PERMISSIONS2"
else
    fail "GROUP PERMISSIONS2"
fi

# Let's check user3 cannot write
if echo -e "^t1\n1\t239,\"ID22\"\n:1" | $SKDB write-csv --user ID3 2>&1 | grep -q Error; then
    pass "GROUP PERMISSIONS3"
else
    fail "GROUP PERMISSIONS3"
fi

# Let's check that user2 can read
if $SKDB tail $subt1 --user ID2 2>&1 | grep -q "238|\"ID22\""; then
    pass "GROUP PERMISSIONS4"
else
    fail "GROUP PERMISSIONS4"
fi

# Let's change the user permissions and see what happens
echo "insert into skdb_user_permissions values ('ID2', skdb_permission(''), 'root')" | $SKDB

# Let's check that user2 cannot read
if $SKDB tail $subt1 --user ID2 2>&1 | grep -q "238|\"ID22\""; then
    fail "GROUP PERMISSIONS6"
else
    pass "GROUP PERMISSIONS6"
fi

echo "delete from skdb_user_permissions where userID='ID2';" | $SKDB

# Let's check that user2 can read again
if $SKDB tail $subt1 --user ID2 2>&1 | grep -q "238|\"ID22\""; then
    pass "GROUP PERMISSIONS7"
else
    fail "GROUP PERMISSIONS7"
fi

# Let's kick user2 out of the group
echo "delete from skdb_group_permissions where groupID='ID22' and userID='ID2';" | $SKDB

# Let's check that user2 cannot read (after being kicked out)
if $SKDB tail $subt1 --user ID2 2>&1 | grep -q "238|\"ID22\""; then
    fail "GROUP PERMISSIONS8"
else
    pass "GROUP PERMISSIONS8"
fi

###############################################################################
# BLOCKLIST PERMISSIONS
###############################################################################

# Let's create a block list
# Everybody can read/insert/delete, except for user1 who can only read
echo "insert into skdb_groups values('ID23', NULL, 'root', 'root');" | $SKDB
echo "insert into skdb_group_permissions values ('ID23', 'ID1', skdb_permission('r'), 'root');" | $SKDB
echo "insert into skdb_group_permissions values ('ID23', NULL, skdb_permission('rw'), 'root');" | $SKDB
echo "insert into skdb_user_permissions values ('ID2', skdb_permission('ri'), 'root');" | $SKDB

# Let's check user2 can write
if echo -e "^t1\n1\t240,\"ID23\"\n:1" | $SKDB write-csv --user ID2 2>&1 | grep -q Error; then
    fail "GROUP PERMISSIONS9"
else
    pass "GROUP PERMISSIONS9"
fi

# Let's check user1 cannot write
if echo -e "^t1\n1\t241,\"ID23\"\n:1" | $SKDB write-csv --user ID1 2>&1 | grep -q Error; then
    pass "GROUP PERMISSIONS10"
else
    fail "GROUP PERMISSIONS10"
fi

# Let's check that user1 can read
if $SKDB tail $subt1 --user ID1 2>&1 | grep -q "240|\"ID23\""; then
    pass "GROUP PERMISSIONS11"
else
    fail "GROUP PERMISSIONS11"
fi

###############################################################################
# SKDB_AUTHOR CHECK
###############################################################################

echo "create table t4 (id INTEGER, skdb_author TEXT);" | $SKDB
if echo -e "^t4\n1\t240,\"ID23\"\n:1" | $SKDB write-csv --user ID3 2>&1 | grep -q Error
then pass "AUTHOR"
else fail "AUTHOR"
fi
if echo -e "^t4\n1\t240,\"ID3\"\n:1" | $SKDB write-csv --user ID3 2>&1 | grep -q Error
then pass "AUTHOR2"
else fail "AUTHOR2"
fi

###############################################################################
# Checking that we can encode a group ownership transfer.
###############################################################################

echo "DELETE FROM skdb_user_permissions WHERE userID IS NULL" | $SKDB

# We want to make sure that we can create a group that we can later
# transfer to someone else. The machinery is a little bit awkward.

# We first create a normal group, created by a user and controlled by
# a user, and then we transfer ownership to the group itself. This
# way, the only people who will be able to control the group (outside
# of the root of course), are the members of the group themselves. In
# this scenario, transfering ownership just consists in added a new
# member and removing the another.

echo "insert into skdb_users VALUES ('julienv', 'pass');" | $SKDB
echo "insert into skdb_users VALUES ('daniell', 'pass');" | $SKDB

# Prepare a group with only one member, julienv
echo -e "^skdb_groups\n1\t\"myAdminGroup\", \"julienv\",\"julienv\", \"julienv\"\n:1" |
  $SKDB write-csv --user julienv --source 1234 > /dev/null
echo -e "^skdb_group_permissions\n1\t\"myAdminGroup\", \"julienv\",7, \"julienv\"\n:2" |
  $SKDB write-csv --user julienv --source 1234 > /dev/null

# Past this point, julienv can do anything in the group myAdminGroup

# Add an entry so that julienv would also be admin if the admins of
# myAdminGroup were to change to myAdminGroup (itself).  This entry is
# not active because myAdminGroup is still pointing at julienv as an
# admin, but the moment we switch, that will not longer be the case.

(echo -e "^skdb_group_permissions";
 echo -e "0\t\"myAdminGroup\", \"julienv\",7, \"julienv\"";
 echo -e "1\t\"myAdminGroup\", \"julienv\",7, \"myAdminGroup\"\n:3") |
  $SKDB write-csv --user julienv --source 1234 > /dev/null

# Now let's make the switch! Let's make myAdminGroup use myAdminGroup
# (itself) as an admin. Note that the delete and the insert have to
# happen in the same transaction, otherwise we would lose access after
# the delete.
(echo -e "^skdb_groups";
 echo -e "0\t\"myAdminGroup\", \"julienv\",\"julienv\", \"julienv\"";
 echo -e "1\t\"myAdminGroup\", \"julienv\",\"myAdminGroup\", \"myAdminGroup\"\n:4") |
  $SKDB write-csv --user julienv --source 1234 > /dev/null

# We have successfully create a group that is controlled by
# itself. And that contains one member, julienv.
# Let's try to transfer ownership to another user.

# First by adding the new user to the group

echo -e "^skdb_group_permissions\n1\t\"myAdminGroup\", \"daniell\",7, \"myAdminGroup\"\n:6" |
  $SKDB write-csv --user julienv --source 1234 > /dev/null

# And then by removing the original user

echo -e "^skdb_group_permissions\n0\t\"myAdminGroup\", \"julienv\",7, \"myAdminGroup\"\n:7" |
  $SKDB write-csv --user julienv --source 1234 > /dev/null

# That's it! daniell is in control now. Let's see if julienv can still
# modify the permissions (it should not be the case).

echo -e "^skdb_group_permissions\n0\t\"myAdminGroup\", \"daniell\",7, \"myAdminGroup\"\n:8" |
  $SKDB write-csv --user julienv --source 1234 2>&1 |
  grep -q 'Error'

if [ "$?" -eq "0" ]; then
  pass "CHANGE OWNERSHIP"
else
  fail "CHANGE OWNERSHIP"
fi

# Let's check if daniell can indeed modify the permissions of the group

echo -e "^skdb_group_permissions\n1\t\"myAdminGroup\", \"julienv\",7, \"myAdminGroup\"\n:1" |
  $SKDB write-csv --user daniell --source 1235 2>&1 |
  grep -q 'Error'

if [ "$?" -eq "0" ]; then
  fail "CHANGE OWNERSHIP2"
else
  pass "CHANGE OWNERSHIP2"
fi

###############################################################################
# PERMISSION CHANGES WHILE TAILING
###############################################################################

$SKDB tail $subt1 --format=csv --user ID3 --follow |
  $SKDB_COPY write-csv --enable-rebuilds > /dev/null &

# Just leaving enough time for the tailer to fill up with data. The
# test is less interesting if it doesn't.

sleep 1

# let's kick ID3 out of the group 22
echo "delete from skdb_group_permissions where groupID='ID22' and userID='ID3';" | $SKDB

# As long as the row (238,22) is still there, the update did not kick in
while echo "select * from t1" | $SKDB_COPY | grep -q "238"; do
    sleep 1
done

# The reset was successful
pass "GROUP PERMISSION UPDATE"

# let's block the ID3 all together
echo "insert into skdb_user_permissions values('ID3', skdb_permission(''), 'root');" | $SKDB

# As long as the row (240,22) is still there, the update did not kick in
while echo "select * from t1" | $SKDB_COPY | grep -q "240"; do
    echo "select * from t1" | $SKDB_COPY | grep -q "240"
    sleep 1
done

# The reset was successful
pass "GROUP PERMISSION UPDATE2"

# let's reset all the permissions and make sure all the data is back

# let's kick ID3 out of the group 22
(echo "begin transaction;";
 echo "insert into skdb_group_permissions values('ID22', 'ID3', skdb_permission('rw'), 'root');";
 echo "delete from skdb_user_permissions where userID='ID3';"
 echo "commit;"
)| $SKDB

# restart tail. it will have exited after sending a rebuild
$SKDB tail $subt1 --format=csv --user ID3 --follow |
  $SKDB_COPY write-csv --enable-rebuilds > /dev/null &
tailerID=$!

sleep 1

# wait for the data to arrive
until echo "select * from t1" | $SKDB_COPY | grep -q "240"; do
    sleep 1
done

until echo "select * from t1" | $SKDB_COPY | grep -q "238"; do
    sleep 1
done

# The reset was successful
pass "GROUP PERMISSION UPDATE3"

kill "$tailerID"
wait
