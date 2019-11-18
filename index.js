"use strict";

const DB_PATH = process.env.DB_PATH || __dirname + "/data/";
const SECRET = process.env.SECRET || "kittens";

const crypto = require("crypto");
const fs = require("fs");

const express = require("express");
const bodyParser = require('body-parser');

const PouchDB = require("pouchdb").defaults({
  prefix: DB_PATH
});
PouchDB.plugin(require("pouchdb-find"));

const nanoid = require("nanoid");
const nodemailer = require("nodemailer");

if (!fs.existsSync(DB_PATH)){
  fs.mkdirSync(DB_PATH);
}


// Should probably not be creating this index every time
const tokens = new PouchDB("tokens");
tokens.createIndex({ index: { fields: ["token"] } });


const app = express();

app.use(bodyParser.json());
app.use(express.static("www"));

// Authentication entry point, takes an email address,
// creates a token, stores the details and sends the
// user an email with their token.
app.post("/api/sign-in", async (req, res, next) => {
  try {
    await signIn(req.body.email);
    res.status(201).json({ok: true});
  } catch(e) {
    console.error("/sign-in/ request failed", e);
    res.status(500);
  }
});

// Once the user has received their token, validate it
// here. This currently isnt doing anything important
// but makes sure I can change the token format at least.
app.post("/api/authenticate", async (req, res, next) => {
  try {
    let result = await authenticate(req.body.token);
    res.status(201).json(result);
  } catch (e) {
    console.error("/authenticate/ request failed", e);
    res.status(500);
  }
});

// Here we intercept all database requests and validate
// them to ensure the user has sent the appropriate
// x-auth-token code need to access that data.
app.use("/db/", async (req, res, next) => {
  // We dont need to validate requests to the database root
  // they are used for generating replication checkpoints
  if (req.path === "/") {
    return next();
  }

  try {
      await checkRequest(req.path, req.headers["x-auth-token"]);
      next();
  } catch(e) {
    console.error("/db/ request failed", e);
    res.status(403).json({
      ok: false,
      message: "Denied"
    });
  }
});

// Ok we have passed authentication, pass along
// requests to the database now.
app.use("/db", require("pouchdb-express-router")(PouchDB));

app.listen(process.env.PORT || 3000);


async function sendEmail(to, token) {
  let url = `${process.env.HOST}/?token=${token}`;
  let transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  let info = await transporter.sendMail({
    from: "Dale Harvey <dale@arandomurl.com>",
    to,
    subject: "Sync your Noted account",
    text: url
  });

  console.log(`Emailed: ${url} to ${to}, messageId=${info.messageId}`);
}

// Sign in a user, the database name is a hash of the users email
// If this is the first time the user signs in we generate a
// passphrase that is needed to access the database. Then we generate
// a one time token that is emailed to the user, once the user
// visits the url we email they are given the passphrase and the
// token expires.
async function signIn(email) {
  console.log(`Signing in: ${email}`);
  let db = crypto.createHash("md5").update(email).digest("hex");
  // Default document, if there is an existing one then
  // the existing passphrase will be used.
  let doc = {
    _id: db,
    email,
    passphrase: nanoid()
  };
  try {
    doc = await tokens.get(db);
  } catch (e) { }

  // Create a new one time use token
  doc.token = nanoid();
  console.log(`Created new token: ${doc.token}`);

  await tokens.put(doc);
  await sendEmail(email, doc.token);
}

// Authenticate a user, takes the one time token user was emailed
// and returns the passphrase for the database.
async function authenticate(token) {
  console.log(`Authenticating: ${token}`);

  let result = await tokens.find({selector: {token}});
  if (!result.docs.length) {
    throw "Token not found";
  }

  let doc = result.docs[0];
  // Expire the token, it can only be used once
  doc.token = false;
  await tokens.put(doc);

  return {
    ok: true,
    email: doc.email,
    dbUrl: `${process.env.HOST}/db/${doc._id}/`,
    passphrase: doc.passphrase
  };
}

// Ensure database requests have a valid passphrase
async function checkRequest(path, token) {
  let db = path.split("/")[1];
  // Reading directly from the database on every request
  // is probably expensive, if we need to optimise
  // this would be an easy / quick win.
  let result = await tokens.get(db);

  if (token && token == result.passphrase) {
    return true;
  }
  throw "Denied";
}

function denied(res, message = "Denied") {
  res.status(403).json({ ok: false, message });
}
