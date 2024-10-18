import { ReactNode, useState, useEffect } from "react";

export type SkipType =
  | SkipLambda
  | SkipObject
  | SkipString
  | SkipVector<SkipType>
  | SkipCall
  | SkipLiteral
  | SkipMap;

export interface SkipString {
  type: "string";
  value: string;
}

export interface SkipCall {
  type: "call";
  name: string;
  value: SkipType[];
}

export interface SkipLiteral {
  type: "literal";
  value: string;
}

export interface SkipMap {
  type: "map";
  name: "Map";
  value: SkipType[]; // k0, v0, k1, v1, ...
}

export interface SkipVector<T extends SkipType> {
  type: "vector";
  name: "Array" | "List";
  value: T[];
}

export interface SkipObject {
  type: "object";
  name: string;
  value: { [key: string]: SkipType };
}

export interface SkipLambda {
  type: "object";
  name: "Lambda";
  value: {
    source: SkipString;
    captured: {
      name: "captured";
      type: "object";
      value: { [key: string]: SkipType };
    };
  };
}

function TitledBlock({
  children,
  title,
}: {
  children?: ReactNode;
  title: string;
}) {
  return (
    <div className="skipValueContainer">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function DataBlock({ children }: { children: ReactNode }) {
  return <pre>{children}</pre>;
}

function DataSpan({ children }: { children: ReactNode }) {
  return <code>{children}</code>;
}

function SkipDataList({ values }: { values: SkipType[] }) {
  return (
    <ul>
      {values.map((v, i) => (
        <li key={i}>
          <SkipDatum value={v} />
        </li>
      ))}
    </ul>
  );
}

function SkipDataTableRow({ k, v }: { k: string | SkipType; v: SkipType }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <tr>
      <td
        onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: "pointer" }}
      >
        {typeof k === "string" ? (
          <DataBlock>{k}</DataBlock>
        ) : (
          <SkipDatum value={k} />
        )}
      </td>
      <td>
        {collapsed ? (
          <div>
            <i>*collapsed*</i>
          </div>
        ) : (
          <SkipDatum value={v} />
        )}
      </td>
    </tr>
  );
}

function SkipDataTable({
  entries,
  header = ["Variable", "Value"],
}: {
  entries: [string | SkipType, SkipType][];
  header?: [string, string];
}) {
  if (entries.length < 1) {
    return <></>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>{header[0]}</th>
          <th>{header[1]}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, v], i) => (
          <SkipDataTableRow key={i} k={k} v={v} />
        ))}
      </tbody>
    </table>
  );
}

function SkipDatumSpan({ value }: { value: SkipLiteral | SkipString }) {
  switch (value.type) {
    case "literal":
      return <DataSpan>{value.value}</DataSpan>;
    case "string":
      return <DataSpan>"{value.value}"</DataSpan>;
    default:
      throw new Error("Unsupported value type.");
  }
}

export function SkipDatum({ value }: { value: SkipType }) {
  switch (value.type) {
    case "literal":
      return <DataBlock>{value.value}</DataBlock>;
    case "string":
      return <DataBlock>"{value.value}"</DataBlock>;
    case "call": {
      if (value.value.length < 1) {
        return <DataBlock>{value.name}()</DataBlock>;
      }

      if (value.value.every((v) => ["string", "literal"].includes(v.type))) {
        const vals = value.value as (SkipLiteral | SkipString)[];
        return (
          <DataBlock>
            {value.name}(
            {vals.map((v, i) => (
              <span key={i}>
                <SkipDatumSpan value={v} />
                {i < vals.length - 1 ? "," : ""}
              </span>
            ))}
            )
          </DataBlock>
        );
      }

      // tuple
      if (value.name.trim() === "") {
        return (
          <TitledBlock title="Tuple">
            <SkipDataList values={value.value} />
          </TitledBlock>
        );
      }

      return (
        <TitledBlock title={value.name}>
          <SkipDataTable
            entries={value.value.map((x, i) => [i.toString(), x])}
            header={["Arg", "Value"]}
          />
        </TitledBlock>
      );
    }
    case "object":
      if (value.name === "Lambda") {
        const fn = value as SkipLambda;
        const closure = Object.entries(fn.value.captured.value);
        return (
          <div>
            <TitledBlock
              title={
                closure.length < 1 ? "Lambda with empty closure" : "Lambda"
              }
            >
              <SkipCode uri={fn.value.source.value} />
            </TitledBlock>
            {closure.length < 1 ? (
              <></>
            ) : (
              <TitledBlock title="Closes over">
                <SkipDataTable entries={closure} />
              </TitledBlock>
            )}
          </div>
        );
      } else {
        return (
          <TitledBlock title={value.name}>
            <SkipDataTable
              entries={Object.entries(value.value)}
              header={["Attribute", "Value"]}
            />
          </TitledBlock>
        );
      }
    case "vector":
      if (value.value.length < 1) {
        if (value.name === "Array") {
          return <DataBlock>{value.name}[]</DataBlock>;
        }
        return <DataBlock>{value.name}()</DataBlock>;
      }
      return (
        <TitledBlock title={`${value.name} of`}>
          <SkipDataTable
            entries={value.value.map((x, i) => [i.toString(), x])}
            header={["Index", "Value"]}
          />
        </TitledBlock>
      );
    case "map":
      if (value.value.length < 1) {
        return <DataBlock>{value.name}()</DataBlock>;
      }
      return (
        <TitledBlock title={`${value.name} of`}>
          <SkipDataTable
            entries={value.value
              .filter((_x, i) => i % 2 == 0)
              .map((key, i) => [key, value.value[i * 2 + 1]])}
            header={["Key", "Value"]}
          />
        </TitledBlock>
      );
    default:
      return <DataBlock>{JSON.stringify(value)}</DataBlock>;
  }
}

function parseUri(uri: string) {
  const uriRe =
    /^\s*(?<pkg>\w+):(?<relpath>.*?)\((?<sln>\d+), *(?<scol>\d+)\)-\((?<eln>\d+), *(?<ecol>\d+)\)\s*$/;
  const match = uri.match(uriRe);
  if (!match) {
    throw new Error("Could not parse code URI");
  }
  if (match.groups == undefined) {
    throw new Error("Could not parse code URI");
  }
  return {
    pkg: match.groups?.pkg,
    relpath: match.groups?.relpath?.split("/"), // skdb only runs on unix-like OSs so this should be fairly safe for now
    start: { line: match.groups?.sln, col: match.groups?.scol },
    end: { line: match.groups?.eln, col: match.groups?.ecol },
  };
}

const pkgDirHandles = new Map<string, FileSystemDirectoryHandle>();

function SkipCode({ uri }: { uri: string }) {
  const {
    pkg,
    relpath,
    start: { line: sline },
    end: { line: eline },
  } = parseUri(uri);

  const [content, setContent] = useState("");

  const loadContent = async () => {
    let dir: FileSystemDirectoryHandle =
      pkgDirHandles.get(pkg) ??
      // @ts-ignore
      (await window.showDirectoryPicker({ mode: "read" }));

    pkgDirHandles.set(pkg, dir);

    for (const component of relpath.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(component);
    }

    for (const file of relpath.slice(-1)) {
      const fileHandle = await dir.getFileHandle(file);
      const f = await fileHandle.getFile();
      const content = await f.text();
      const lines = content.split("\n");
      const slice = lines.slice(parseInt(sline) - 1, parseInt(eline));
      // strip off leading whitespace. assumes spaces as used by skfmt.
      const wsMargin = slice.reduce((acc, line) => {
        const match = line.match(/^( +)/);
        return Math.min(acc, match ? match[0].length : 0);
      }, Number.MAX_SAFE_INTEGER);
      setContent(slice.map(x => x.slice(wsMargin)).join("\n"));
    }
  };

  useEffect(() => {
    if (pkgDirHandles.get(pkg)) {
      loadContent();
    }
  }, [uri]);

  return (
    <div className="codeRender">
      <DataBlock>
        <a
          href="#"
          onClick={async (_e) => {
            if (content) {
              setContent("");
              return;
            }

            try {
              loadContent();
            } catch {
              pkgDirHandles.delete(pkg);
              alert(
                `Could not find ${relpath.join(
                  "/",
                )}. Please locate the source for the ${pkg} directory.}`,
              );
            }
          }}
        >
          {uri}
        </a>
      </DataBlock>
      {content ? <DataBlock>{content}</DataBlock> : <></>}
    </div>
  );
}
