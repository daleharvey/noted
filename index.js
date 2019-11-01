const serve = require("koa-static");
const Koa = require("koa");
const app = new Koa();

app.use(serve("www"));

app.listen(process.env.PORT || 3000);
