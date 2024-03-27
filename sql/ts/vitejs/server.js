import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as mime from "mime-types";
import chalk from "chalk";

console.time("server ready");

const post = (response, file, errorFile, contentType) => {
  fs.readFile(file, function (error, content) {
    if (error) {
      if (error.code == "ENOENT") {
        fs.readFile(errorFile, function (error, content) {
          if (error) {
            if (error.code == "ENOENT") {
              response.writeHead(404);
              response.end("Not found\n\n");
            }
          } else {
            response.writeHead(200, { "Content-Type": contentType });
            response.end(content, "utf-8");
          }
        });
      } else {
        response.writeHead(500);
        response.end("Internal error: " + error.code + " ..\n\n");
      }
    } else {
      response.writeHead(200, { "Content-Type": contentType });
      response.end(content, "utf-8");
    }
  });
};

const port = 5154;

const distPath = "./dist";

const requestHandler = (request, response) => {
  const error = path.join(distPath, "404.html");
  if (request.url == "/api/succeed") {
    let message = chalk.green("[OK]") + " Bundled SKDB successfully started.";
    response.setHeader("Content-Type", "text/plain");
    console.log(message);
    response.end("[OK] Bundled SKDB successfully started.");
    // @ts-ignore
    process.exit();
  } else if (request.url == "/api/loadfailed") {
    let message = chalk.red("[FAILED]") + " Unable to load Bundled SKDB.";
    response.setHeader("Content-Type", "text/plain");
    console.log(message);
    response.end("[FAILED] Unable to load Bundled SKDB.");
    // @ts-ignore
    process.exit();
  } else if (request.url == "/api/succeed") {
    let message = chalk.red("[FAILED]") + " Unable to use Bundled SKDB.";
    response.setHeader("Content-Type", "text/plain");
    console.log(message);
    response.end("[FAILED] Unable to use Bundled SKDB.");
    // @ts-ignore
    process.exit();
  } else {
    let page;
    if (request.url?.endsWith("/")) {
      page = path.join(distPath + request.url, "index.html");
    } else {
      page = distPath + request.url;
    }
    post(response, page, error, mime.lookup(page));
  }
};

const server = http.createServer(requestHandler);

server.listen(port, () => {
  console.timeEnd("server ready");
  console.log("➜  Local:   http://localhost:" + port + "/");
  console.log(chalk.blue("Open the link in browser to continue the chek."));
});
