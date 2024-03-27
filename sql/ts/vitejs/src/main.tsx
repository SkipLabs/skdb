import { createSkdb } from "skdb";

createSkdb({ asWorker: true })
  .then((skdb) => {
    skdb
      .schema(
        "CREATE TABLE example (id TEXT PRIMARY KEY, intCol INTEGER NOT NULL, floatCol FLOAT NOT NULL, skdb_access TEXT NOT NULL);",
      )
      .then((_r) => {
        fetch("/api/succeed")
          .then((res) => res.text())
          .then((text) => (document.getElementById("root")!.innerHTML = text));
      })
      .catch((_err) => {
        fetch("/api/creationfailed")
          .then((res) => res.text())
          .then((text) => (document.getElementById("root")!.innerHTML = text));
      });
  })
  .catch((_err) =>
    fetch("/api/loadfailed")
      .then((res) => res.text())
      .then((text) => (document.getElementById("root")!.innerHTML = text)),
  );
