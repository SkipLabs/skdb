CREATE TABLE t1 (x INTEGER, y INTEGER PRIMARY KEY);
CREATE TABLE t2 (a INTEGER, b INTEGER);

INSERT INTO t1 (x, y) VALUES (1, 1), (3, 3);
INSERT INTO t2 (a, b) VALUES (1, 2), (3, 4);

CREATE REACTIVE VIEW vv AS SELECT a, y FROM t1 LEFT JOIN t2 on a = x;
SELECT 'BEFORE ALTERING';
SELECT * FROM vv;

ALTER TABLE t1 ADD COLUMN z INTEGER NOT NULL DEFAULT 0;

INSERT INTO t1 (x, y) VALUES (10,10);
INSERT INTO t1 (x, y, z) VALUES (3,5,8);

SELECT 'AFTER ALTERING';

SELECT 'x|y|z (t1)';
select * from t1;
SELECT 'a|b (t2)';
select * from t2;
SELECT 'v: select a,y from t1 left join t2 where a = x';
SELECT * FROM vv;
