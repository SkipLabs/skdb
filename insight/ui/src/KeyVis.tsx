import * as d3dag from "d3-dag";
import { useLayoutEffect, useRef, useState, ReactNode } from "react";
import "./KeyVis.css";

import data from "../../../gds/log/insight.json?raw";
import { createDagVis } from "./dag";
import { SkipDatum, SkipLambda } from "./SkipData";

import { Resizable } from "re-resizable";

interface Row {
  type: "row";
  row: (string | number)[];
  key: string;
}

interface UnknownObj {
  type: "unknown";
  key: string;
}

type Key = Row | UnknownObj;

interface Contribution {
  tick: number;
  writer: string;
  files: Key[];
  source?: Source;
  mapfns: string[];
  reads: Source[];
}

interface Source {
  dir: string;
  key: Key;
  dir_is_input: boolean;
  contributions: Contribution[];
}

interface DirNode {
  dir: string;
  keys: Source[];
  id: string;
  parentIds: string[];
}

interface Vis {
  update: () => void;
  clearViewing: () => void;
}

function DetailSection({
  children,
  title,
  startOpen = false,
}: {
  children: ReactNode;
  title: string;
  startOpen?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!startOpen);
  return (
    <div className="section">
      <h1
        onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: "pointer" }}
      >
        {collapsed ? "\u25B8" : "\u25BE"} {title}
      </h1>
      {collapsed ? <></> : children}
    </div>
  );
}

function ContributionDetail({
  source,
  contribution,
  dismiss,
}: {
  source?: Source;
  contribution?: Contribution;
  dismiss: () => void;
}) {
  if (contribution === undefined || source === undefined) {
    return <div className="contributionDetail" />;
  }

  return (
    <Resizable
      defaultSize={{ width: "100%", height: "50%" }}
      enable={{
        top: true,
        right: false,
        bottom: false,
        left: false,
        topRight: false,
        bottomRight: false,
        bottomLeft: false,
        topLeft: false,
      }}
    >
      <div className="contributionDetail showing">
        <div className="header">
          <h1>Detail</h1>
          <button onClick={() => dismiss()}>&times;</button>
        </div>
        <DetailSection title={source.dir_is_input ? "Key" : "Output Key"}>
          <pre>
            <code>{pprint(source.key)}</code>
          </pre>
        </DetailSection>
        <DetailSection title={source.dir_is_input ? "Files" : "Output Files"}>
          {contribution.files.map((f, i) => (
            <pre key={i}>
              <code>{pprint(f)}</code>
            </pre>
          ))}
        </DetailSection>
        {source.dir_is_input ? (
          <></>
        ) : (
          <>
            <DetailSection title="Input Dir">
              <pre>
                <code>{contribution.source?.dir}</code>
              </pre>
            </DetailSection>
            <DetailSection title="Input Key">
              <pre>
                <code>{pprint(contribution.source?.key)}</code>
              </pre>
            </DetailSection>
            <DetailSection title="Input Files">
              {contribution.source?.contributions
                .flatMap((c) => c.files)
                .map((f, i) => (
                  <pre key={i}>
                    <code>{pprint(f)}</code>
                  </pre>
                ))}
            </DetailSection>
          </>
        )}
        <DetailSection title="Input -> Output mapping function">
          {source.dir_is_input ? (
            <pre>
              This is an input directory. It is not defined by a function.
            </pre>
          ) : (
            contribution.mapfns.map((fn, i) => (
              <SkipDatum value={JSON.parse(fn) as SkipLambda} key={i} />
            ))
          )}
        </DetailSection>
        <DetailSection title="Reads made by mapping function">
          <table className="reads">
            <thead>
              <tr>
                <th>Dir</th>
                <th>Key</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {contribution.reads.map((r, i) => (
                <tr key={i}>
                  <td>
                    <pre>
                      <code>{r?.dir}</code>
                    </pre>
                  </td>
                  <td>
                    <pre>
                      <code>{pprint(r?.key)}</code>
                    </pre>
                  </td>
                  <td>
                    {r?.contributions
                      .flatMap((c) => c.files)
                      .map((f, i) => (
                        <pre key={i}>
                          <code>{pprint(f)}</code>
                        </pre>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DetailSection>
        <DetailSection title="Write Metadata">
          At:
          <pre>
            <code>Tick {contribution.tick}</code>
          </pre>
          By:
          <pre>
            <code>{contribution.writer}</code>
          </pre>
        </DetailSection>
      </div>
    </Resizable>
  );
}

export function KeyVisualisation() {
  const svgRef = useRef<SVGSVGElement>(null);

  const [detail, setDetail] = useState<
    { source: Source; contrib: Contribution } | undefined
  >(undefined);

  const [vis, setVis] = useState<Vis | undefined>(undefined);

  useLayoutEffect(() => {
    const dag = buildDataModel(getData());
    const vis = createKeyVis(svgRef.current!!, dag, (s, c) =>
      setDetail({ source: s, contrib: c }),
    );
    setVis(vis);
  }, []);

  return (
    <div id="keyvis">
      <svg width="100%" height="100%" ref={svgRef}></svg>
      <ContributionDetail
        source={detail?.source}
        contribution={detail?.contrib}
        dismiss={() => {
          setDetail(undefined);
          vis?.clearViewing();
          vis?.update();
        }}
      />
    </div>
  );
}

function pprint(k: Key | undefined) {
  if (k === undefined) {
    return "";
  }
  switch (k.type) {
    case "row":
    case "unknown":
      return k.key;
  }
}

function summarise(k: Key | undefined) {
  if (k === undefined) {
    return "";
  }
  switch (k.type) {
    case "row":
      return JSON.stringify(k.row);
    case "unknown":
      return k.key;
  }
}

function getData(): Source {
  return JSON.parse(data);
}

function buildDataModel(src: Source): d3dag.Graph<DirNode, undefined> {
  const nodes: DirNode[] = [];
  const nodeIdx = new Map();

  function walk(src: Source) {
    const id = src.dir;

    let idx = nodeIdx.get(id);

    const getContributingDirs = (c: Contribution) => {
      const depDirs = c.reads.map((d) => d.dir);
      if (c.source) {
        return [c.source.dir, ...depDirs];
      }
      return depDirs;
    };

    if (idx === undefined) {
      idx = nodes.length;
      nodeIdx.set(id, idx);
      const node = {
        dir: src.dir,
        keys: [src],
        id: id,
        parentIds: src.contributions.flatMap(getContributingDirs),
      };
      nodes.push(node);
    } else {
      const node = nodes[idx];

      if (
        !node.keys.find((k) => k.dir === src.dir && k.key.key === src.key.key)
      ) {
        node.keys.push(src);

        if (!src.dir_is_input) {
          src.contributions
            .flatMap(getContributingDirs)
            .forEach((x) => node.parentIds.push(x));
        }
      }
    }

    for (const c of src.contributions ?? []) {
      if (!src.dir_is_input) {
        walk(c.source!);
      }
      for (const depSrc of c.reads) {
        walk(depSrc);
      }
    }
  }

  walk(src);

  // dedup parents before we stratify otherwise the graph layout
  // algorithm has a meltdown
  for (const node of nodes) {
    node.parentIds = [...new Set(node.parentIds)];
  }

  return d3dag.graphStratify()(nodes);
}

function createKeyVis(
  svgElem: SVGSVGElement,
  dag: d3dag.Graph<DirNode, undefined>,
  viewDetailsFor: (src: Source, c: Contribution) => void,
): Vis {
  const highlightedDirs = new Set<string>();
  const highlightedSources = new Map<string, Set<string>>();
  let viewing: Contribution | undefined = undefined;

  const highlight = (src?: Source | null) => {
    // undefined is we couldn't find a src
    if (src === undefined) {
      return;
    }

    // null is an explicit sentinel for clearing
    if (src === null) {
      highlightedDirs.clear();
      highlightedSources.clear();
      return;
    }

    highlightedDirs.add(src.dir);
    const { dir, key } = src;
    const keys = highlightedSources.get(dir) || new Set();
    keys.add(key.key);
    highlightedSources.set(dir, keys);
    src.contributions.forEach((c) => {
      highlight(c.source);
      for (const readSrc of c.reads) {
        highlight(readSrc);
      }
    });
  };

  const isHighlighted = (dir: string, key: string): boolean => {
    return highlightedSources.get(dir)?.has(key) || false;
  };

  const updateVis = createDagVis<DirNode, undefined>(
    svgElem,
    dag,
    // node enter
    (div) => {
      div.classed("highlighted", (d) => highlightedDirs.has(d.data.id));
      div
        .append("div")
        .classed("dir-title", true)
        .append("pre")
        .text("Dir: ")
        .attr("class", "dir")
        .append("code")
        .text((d) => d.data.dir);

      const keys = div.append("div").classed("keys", true);
      keys.append("span").text("Keys").attr("class", "heading");

      keys
        .selectAll("div")
        .data((d) => d.data.keys)
        .join((enter) => {
          const div = enter.append("div");

          div
            .append("pre")
            .attr("class", "key")
            .append("code")
            .text((d) => summarise(d.key));

          const contributions = div
            .append("div")
            .attr("class", "contributions")
            .classed("highlighted", (d) => isHighlighted(d.dir, d.key.key));

          contributions.append("span").text("Files").attr("class", "heading");

          contributions
            .selectAll("div")
            .data((d) =>
              d.contributions.map((c) => ({ source: d, contrib: c })),
            )
            .join((enter) => {
              const div = enter.append("div").attr("class", "contribution");

              div.on("mouseout", () => {
                highlight(null);
                highlight(viewing?.source ?? null);
                for (const readSrc of viewing?.reads ?? []) {
                  highlight(readSrc);
                }
                updateVis();
              });
              div.on("mouseover", (_e, { contrib }) => {
                highlight(null);
                highlight(contrib.source);
                for (const readSrc of contrib.reads) {
                  highlight(readSrc);
                }
                updateVis();
              });

              div
                .append("div")
                .selectAll("pre")
                .data(({ contrib }) => contrib.files)
                .join((enter) => {
                  return enter
                    .append("pre")
                    .attr("class", "file")
                    .append("code");
                })
                .text((d) => summarise(d));

              div
                .append("pre")
                .attr("class", "tick")
                .append("code")
                .text(({ contrib }) => "Tick: " + contrib.tick);

              div
                .append("pre")
                .attr("class", "codelink")
                .append("code")
                .append("a")
                .text(() => "Detail")
                .attr("href", "#")
                .on("click", (_e, { source, contrib }) => {
                  viewing = contrib;
                  viewDetailsFor(source, contrib);
                });

              return div;
            });

          return div;
        });
    },
    // node update
    (div) => {
      div.classed("highlighted", (d) => highlightedDirs.has(d.data.id));
      div
        .selectAll(".keys")
        .selectAll("div")
        .selectAll(".contributions")
        //@ts-ignore
        .classed("highlighted", (d) => isHighlighted(d.dir, d.key.key));
    },
    // link enter
    (d) => {
      d.attr("marker-end", (d) =>
        highlightedDirs.has(d.source.data.id)
          ? "url(#arrow-highlighted)"
          : "url(#arrow)",
      );
    },
    // link update
    (d) => {
      d.attr("marker-end", (d) =>
        highlightedDirs.has(d.source.data.id)
          ? "url(#arrow-highlighted)"
          : "url(#arrow)",
      ).classed("highlighted", (d) => highlightedDirs.has(d.source.data.id));
    },
  );

  return {
    update: updateVis,
    clearViewing: () => {
      viewing = undefined;
      highlight(null);
    },
  };
}
