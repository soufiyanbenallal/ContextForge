const path = require("node:path");
const Mocha = require("mocha");
const fs = require("node:fs");

exports.run = function run() {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 30000 });
  for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs"))) {
    mocha.addFile(path.join(__dirname, f));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
};
