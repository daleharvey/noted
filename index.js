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
PouchDB.plugin(require('pouchdb-find'));

const nanoid = require('nanoid');
const nodemailer = require('nodemailer');

if (!fs.existsSync(DB_PATH)){
  fs.mkdirSync(DB_PATH);
}

const app = express();
const tokens = new PouchDB("tokens");

tokens.createIndex({
  index: {fields: ["token"]}
});

async function sendEmail(to, url) {
  let transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  let info = await transporter.sendMail({
    from: 'Dale Harvey <dale@arandomurl.com>',
    to,
    subject: "Sync your Noted account",
    text: url
  });

  console.log(`Emailed: ${url} to ${to}, messageId=${info.messageId}`);
}

async function signIn(email) {
  console.log(`Signing in: ${email}`);
  let dbName = crypto.createHash('md5')
    .update(email).digest('hex');
  // Default document, if there is an existing one then
  // the existing passphrase will be used.
  let doc = {
    _id: dbName,
    email,
    passphrase: nanoid()
  };
  try {
    doc = await tokens.get(dbName);
  } catch (e) { }
  // Create a new one time use token
  doc.token = nanoid();
  console.log(`Created new token: ${doc.token}`);
  await tokens.put(doc);
  let url = `${process.env.HOST}/?token=${doc.token}`;
  await sendEmail(email, url);
}

app.use(bodyParser.json());
app.use(express.static("www"));

// Authentication entry point, takes an email address,
// creates a token, stores the details and sends the
// user an email with their token.
app.post("/sign-in", async (req, res, next) => {
  try {
    await signIn(req.body.email);
    res.status(201).json({ok: true});
  } catch(e) {
    res.status(500);
  }
});

function denied(res, message = "Denied") {
  res.status(403).json({ ok: false, message });
}

// Once the user has received their token, validate it
// here. This currently isnt doing anything important
// but makes sure I can change the token format at least.
app.post("/authenticate", async (req, res, next) => {
  console.log(`Authenticating: ${req.body.token}`);

  let token = req.body.token;
  let result = await tokens.find({selector: {token}});

  if (!result.docs.length) {
    return denied(res);
  }

  let doc = result.docs[0];
  doc.token = false;
  await tokens.put(doc);

  res.json({
    ok: true,
    email: doc.email,
    dbUrl: `${process.env.HOST}/db/${doc._id}/`,
    passphrase: doc.passphrase
  });
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
    let dbName = req.path.split("/")[1];
    // Reading directly from the database on every request
    // is probably expensive, if we need to optimise
    // this would be an easy / quick win.
    let result = await tokens.get(dbName);
    let token = req.headers["x-auth-token"] || null;
    if (token && token == result.passphrase) {
      return next();
    }
    throw "Denied";
  } catch(e) {
    res.status(403).json({
      ok: false,
      message: "Denied"
    });
  }
});

// Ok we have passed authentication, pass along
// requests to the database now.
app.use('/db', require('pouchdb-express-router')(PouchDB));

app.listen(process.env.PORT || 3000);
