import { createSkdb } from "skdb";
import chalk from "chalk";

let asWorker = true;

if (process.argv.length > 2) {
  asWorker = process.argv[2] == "true";
}

let suffix = asWorker ? " in Worker" : "";

const isObject = (object) => {
  return object != null && typeof object === "object";
};

const isDeepEqual = (object1, object2) => {
  const objKeys1 = Object.keys(object1);
  const objKeys2 = Object.keys(object2);

  if (objKeys1.length !== objKeys2.length) return false;

  for (var key of objKeys1) {
    const value1 = object1[key];
    const value2 = object2[key];

    const isObjects = isObject(value1) && isObject(value2);

    if (
      (isObjects && !isDeepEqual(value1, value2)) ||
      (!isObjects && value1 !== value2)
    ) {
      return false;
    }
  }
  return true;
};

createSkdb({ asWorker: true })
  .then(async (skdb) => {
    try {
      await skdb.exec("CREATE TABLE t1 (a BOOLEAN, b BOOLEAN);");
      await skdb.exec("INSERT into t1 values(TRUE, FALSE);");
      let res = await skdb.exec("SELECT TRUE, FALSE, a, b FROM t1;");
      if (isDeepEqual(res, [{ a: 1, b: 0, "col<0>": 1, "col<1>": 0 }])) {
        console.log(
          chalk.green("[OK]") +
            " SKDB" +
            suffix +
            " successfully started with bun.",
        );
        process.exit(0);
      } else {
        console.log(
          chalk.red("[FAILED]") +
            " SKDB" +
            suffix +
            " invalid result with bun.",
        );
        process.exit(2);
      }
    } catch (err) {
      console.error(err);
      console.log(
        chalk.red("[FAILED]") + " Unable to use SKDB" + suffix + " with bun.",
      );
      process.exit(2);
    }
  })
  .catch((err) => {
    console.error(err);
    console.log(
      chalk.red("[FAILED]") + " Unable to load SKDB" + suffix + " with bun.",
    );
    process.exit(2);
  });
