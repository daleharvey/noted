"use strict"

const fs = require("fs");
const glob = require("glob-promise");
const nanoid = require("nanoid/generate");

const PREFIX = "./www";

(async () => {

  const template = fs.readFileSync("./lib/service-worker.tpl.js", "utf8");
  let files = await glob(PREFIX + "/**");
  files = files.filter(f => !fs.lstatSync(f).isDirectory());
  files = files.map(file => "  \"" + file.slice(PREFIX.length) + "\",");

  // I put a string around "%FILES%" so the template file would still
  // be valid JS (easier to edit)
  let worker = template.replace("\"%FILES%\"", files.join("\n"));
  // Dont need to do anything fancy
  worker = worker.replace("%NAME%", nanoid("1234567890abcdef", 10));

  fs.writeFileSync("./www/service-worker.js", worker);

})();
