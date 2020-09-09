// eslint-disable-next-line @typescript-eslint/no-var-requires
require("http")
  .createServer(function (req, res) {
    res.end("hi");
  })
  .listen(3000);
