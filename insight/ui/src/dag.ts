import * as d3 from "d3";
import * as d3dag from "d3-dag";

// NOTE: immature abstraction. almost certainly not how the interface
// should look. but carves a separation early to avoid a nightmare
// later. the gamble is that we'll likely want to have several
// different dag UIs.

// takes care of providing a DAG UI where the user can specialise how
// nodes and edges are rendered. this provides layout, link rendering,
// moving nodes, panning and zooming.
export function createDagVis<Node, Edge>(
  svgElem: SVGSVGElement, // root container
  dag: d3dag.Graph<Node, undefined>, // use d3dag.graphStratify
  nodeEnter: (
    div: d3.Selection<HTMLDivElement, d3dag.GraphNode<Node, Edge>, any, any>,
  ) => void,
  nodeUpdate: (
    div: d3.Selection<HTMLDivElement, d3dag.GraphNode<Node, Edge>, any, any>,
  ) => void,
  linkEnter: (
    div: d3.Selection<SVGPathElement, d3dag.GraphLink<Node, Edge>, any, any>,
  ) => void,
  linkUpdate: (
    div: d3.Selection<SVGPathElement, d3dag.GraphLink<Node, Edge>, any, any>,
  ) => void,
) {
  const svg = d3.select(svgElem);
  const nodes = svg.append("g").attr("id", "nodes");
  const links = svg.append("g").attr("id", "links");

  const [nodeW, nodeH] = [900, 600];
  const layout = d3dag.sugiyama().nodeSize([nodeW, nodeH]).gap([50, 200]);
  layout(dag);

  const defs = svg.append("defs");

  defs
    .append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 5)
    .attr("refY", 0)
    .attr("markerWidth", 4)
    .attr("markerHeight", 4)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("class", "arrowHead");

  defs
    .append("marker")
    .attr("id", "arrow-highlighted")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 5)
    .attr("refY", 0)
    .attr("markerWidth", 4)
    .attr("markerHeight", 4)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("class", "arrowHeadHighlighted");

  const line = d3.line().curve(d3.curveBumpY);

  let tf = d3.zoomIdentity;

  const updateVis = () => {
    nodes
      .selectAll("foreignObject")
      //@ts-ignore
      .data(dag.nodes(), (n) => n.data.id)
      .join(
        (enter) => {
          const div = enter
            .append("foreignObject")
            .attr("width", nodeW)
            .attr("height", nodeH)
            .append("xhtml:div")
            .attr("class", "node");

          const move = (e: any, d: any) => {
            d.x += e.dx / tf.k;
            d.y += e.dy / tf.k;
            // update position for any links
            for (const link of dag.links()) {
              link.points[0] = [
                link.source.x + nodeW / 2,
                link.source.y + nodeH,
              ];
              link.points[1] = [link.target.x + nodeW / 2, link.target.y];
            }
          };

          div
            .on("mouseover", (e) => {
              if (div.nodes().includes(e.target)) {
                d3.select(e.target).style("cursor", "move");
              }
            })
            .on("mouseout", (e) => {
              if (div.nodes().includes(e.target)) {
                d3.select(e.target).style("cursor", "auto");
              }
            });

          div.call(
            //@ts-ignore
            d3
              .drag()
              //@ts-ignore
              .container(div)
              .filter(
                (e) =>
                  !e.ctrlKey && !e.button && div.nodes().includes(e.target),
              )
              .on("drag", move)
              .on("start.render drag.render end.render", updateVis),
          );

          //@ts-ignore
          div.call(nodeEnter);

          return div;
        },
        (update) => {
          update
            .select("div.node")
            //@ts-ignore
            .call(nodeUpdate);

          return update;
        },
        (exit) => exit.remove(),
      )
      .attr("x", ({ x }) => x)
      .attr("y", ({ y }) => y);

    links
      .selectAll("path")
      .data(dag.links())
      .join(
        (enter) => {
          return (
            enter
              .append("path")
              .attr("d", (link) => {
                const [[x0, y0], [x1, y1]] = link.points;
                const points: [number, number][] = [
                  [x0 + nodeW / 2, y0 + nodeH],
                  [x1 + nodeW / 2, y1],
                ];
                link.points = points;
                return line(points);
              })
              //@ts-ignore
              .call(linkEnter)
          );
        },
        (update) => {
          return (
            update
              .attr("d", (link) => line(link.points))
              //@ts-ignore
              .call(linkUpdate)
          );
        },
        (exit) => exit.remove(),
      );
  };

  const zoom = d3
    .zoom()
    .filter(
      (e) =>
        (!e.ctrlKey || e.type === "wheel") &&
        !e.button &&
        e.target === svg.node(),
    )
    .on("zoom", (e) => {
      tf = e.transform;
      svg.selectAll("g").attr("transform", e.transform);
    });

  //@ts-ignore
  svg.call(zoom);

  svg
    .on("mouseover", (e) => {
      if (svg.node() === e.target) {
        d3.select(e.target).style("cursor", "move");
      }
    })
    .on("mouseout", (e) => {
      if (svg.node() === e.target) {
        d3.select(e.target).style("cursor", "auto");
      }
    });

  updateVis();
  updateVis();

  const leafNode = dag.leaves().next().value;
  const leafMid = [-(leafNode.x + nodeW / 2), -(leafNode.y + nodeH / 2)];
  const width = parseInt(svg.style("width").replace("px", ""));
  const height = parseInt(svg.style("height").replace("px", ""));
  //@ts-ignore
  zoom.translateTo(svg, -width / 2, -height / 2, leafMid);

  return updateVis;
}
