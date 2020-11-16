/* eslint-disable */

const PLUGIN_NAME = "spawn-server-webpack-plugin";

global.__HMR_CHECK__ = hash => {
  if (module.hot.status() !== "idle") {
    return;
  }

  module.hot
    .check(true)
    .then(updated => {
      if (!updated) {
        exit();
      } else if (hash === __webpack_hash__) {
        __HMR_CHECK__(hash);
      } else {
        success();
      }
    })
    .catch(err => {
      switch (module.hot.status()) {
        case "abort":
        case "fail":
          exit();
          break;
        default:
          console.error(err);
          break;
      }
    });
};

function exit() {
  process.send({ event: `${PLUGIN_NAME}:hmr-done`, status: "exit" });
}

function success() {
  process.send({ event: `${PLUGIN_NAME}:hmr-done`, status: "success" });
}