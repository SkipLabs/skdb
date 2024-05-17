CREATE TABLE t1 (x INTEGER, y INTEGER, id INTEGER PRIMARY KEY);
CREATE TABLE t2 (a INTEGER, b INTEGER);

INSERT INTO t1 (x, y, id) VALUES (5, 10, 15), (20, 30, 40);
INSERT INTO t2 (a, b) VALUES (1, 2), (3, 4);

CREATE REACTIVE VIEW vv AS SELECT a, y FROM t1 INNER JOIN t2 on (a * 10) = x;

BEGIN TRANSACTION;
      CREATE TABLE t1_x AS SELECT id, x, true AS __skdb_is_original FROM t1;
      ALTER TABLE t1 DROP COLUMN x;
COMMIT;


INSERT INTO t1 VALUES (10, 11);

SELECT t1_x.x, t1_x.__skdb_is_original, t1.y, t1.id FROM t1 INNER JOIN t1_x on t1.id = t1_x.id;
SELECT * FROM vv;
