"use script";

const $ = document.querySelector.bind(document);
const changeEvent = debounce(editorChanged, 500);

const editor = new Quill("#editor div", {theme: 'bubble'});
const quill = editor;

const DEFAULT_NOTE = `## Welcome to Noted

An Open Source note taking application, works offline and syncs via PouchDB, can be installed on Desktop and Mobile by PWA supporting browsers.

**Please don't depend on this service for important data, it is a side project that may disappear at any time**

[Source on Github](https://github.com/daleharvey/noted)
[Get in touch](dale@arandomurl.com)`;

let db = null;
let user = null;
let currentNote = null;
let writtenRevs = new Map();

(async function() {

  log('Initialising ...');
  await initDB();
  await initUI();
  await hashChanged();

  await loadUser();

  if (user) {
    await initSync(user);
  }

  const params = new URLSearchParams(window.location.search);
  if (!user && params.has("token")) {
    await validate(params.get("token"));
    return;
  }

})();

async function log() {
  console.log.apply(null, arguments);
}

async function loadUser() {
  try {
    let result = await db.get("_local/user");
    log(`Found ${result.email}, validating`);
    let testDB = new PouchDB(result.dbUrl);
    // Make a test request to the database, if this is successful
    // then the user has access.
    await db.info();
    log(`${result.email} logged in`);
    user = result;
  } catch(err) {
    if (!(err.status && err.name === "not_found")) {
      // If there was an error validating the user session data then
      // delete it.
      log(`Error logging in`);
      console.error(err);
      try {
        await db.remove(await db.get("_local/user"));
      } catch(e) {}
    }
  }

  if (user) {
    $("#notes footer").classList.toggle("logged-in", true);
    $("#notes footer span").innerText = user.email;
  } else {
    $("#notes footer").classList.toggle("sign-in", true);
  }
}

async function initDB() {
  db = new PouchDB("notes");
  db.changes({
    since: 'now',
    live: true,
    include_docs: true
  }).on("change", dbUpdated);
}

async function initSync(details) {
  log(`Initialising sync with ${details.dbUrl}`);
  let remote = new PouchDB(details.dbUrl, {
    fetch: function (url, opts) {
      opts.headers.set('X-Auth-Token', details.passphrase);
      return PouchDB.fetch(url, opts);
    }
  });

  // If the user hasnt made any changes, delete the
  // initial blank note and sync to a fresh db.
  let info = await db.info();
  if (info.update_seq <= 1) {
    await db.destroy();
    await initDB();
  }

  db.sync(remote, {
    live: true,
    retry: true,
  }).on("error", error => {
    console.error("Error Syncing", error);
  }).on("paused", err => {
    $("#logged-in").dataset.syncStatus = err ? "error" : "syncing";
    log("Syncing paused");
  }).on("active", () => {
    log("Syncing active");
  });
}

async function validate(token) {
  let result = await fetch('/api/authenticate', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({token})
  });
  let json = await result.json();
  if (json.ok) {
    json._id = "_local/user";
    await db.post(json);
    document.location.href = "/";
  } else {
    console.error(json);
  }
}

async function selectNote(note) {
  editor.off("text-change", changeEvent);
  currentNote = note;
  if ("delta" in note) {
    editor.setContents(note.delta);
  } else if ("note" in note) {
    editor.setText(note.note);
  }
  editor.on("text-change", changeEvent);
  document.body.classList.remove("shownotes")
}

async function createNote(note = "") {
  let result = await db.post({
    updated: Date.now(),
    type: "post",
    note
  });
  document.location = "#" + result.id;
}

async function signIn(e) {
  e.preventDefault();
  let email = $("#email").value
  $("#sign-in-dialog").style.display = "none";
  let result = await fetch('/api/sign-in', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({email})
  });
  alert("Go check your email");
}

async function deleteNote() {
  if (!confirm("Are you sure you want to delete?")) {
    return;
  }
  await db.remove(currentNote._id, currentNote._rev);
  currentNote = null;
  document.location = '#';
}

async function toggleNotes() {
  document.body.classList.toggle("shownotes")
}

async function hashChanged() {
  let id = document.location.hash.slice(1);
  try {
    let note = await db.get(id);
    selectNote(note);
    await drawNotes();
  } catch (e) { }

  if (!currentNote) {
    let notes = await db.allDocs({include_docs: true});
    if (notes.total_rows) {
      notes.rows.sort((a, b) => b.doc.updated - a.doc.updated);
      document.location = "#" + notes.rows[0].id;
    } else {
      createNote(DEFAULT_NOTE);
    }
  }
}

async function editorChanged() {
  currentNote.delta = editor.getContents();
  currentNote.updated = Date.now();
  // Storing the full html to get search working for now.
  currentNote.html = editor.root.innerText;
  currentNote.title = createTitle(currentNote.html.split("\n")[0]);
  let update = await db.put(currentNote);
  currentNote._rev = update.rev;
  writtenRevs.set(update.rev, true);
}

function createTitle(str) {
  return str.trim().replace(/[^a-z\-A-Z ]/g, "");
}

async function drawNotes() {

  let notes = (await db.allDocs({include_docs: true})).rows;
  let search = $("#search").value;

  if (search) {
    notes = notes.filter((value) => {
      // Only do full text filter right now
      return value.doc.html && value.doc.html.includes(search);
    });
  }

  if (!notes.length && search) {
    $("#notes-list").innerHTML = "<li class=error>No results found</li>";
    return;
  }

  notes.sort((a, b) => b.doc.updated - a.doc.updated);
  let titles = notes.map(note => {
    let data = note.doc.note || "";
    let title = note.doc.title || "New Note";
    let selected = "";
    if (currentNote && note.doc._id == currentNote._id) {
      selected = 'class="selected"';
    }
    return `<li><a ${selected} href="#${note.doc._id}">${title}</a></li>`;
  });

  $("#notes-list").innerHTML = titles.join("");
}

function showDialog(id) {
  return function() {
    $(id).style.display = "flex";
    $(".cancel-btn").addEventListener("click", hide(id));
    $("#sign-in-form").addEventListener("submit", signIn);
  }
}

function hide(id) {
  return function() { $(id).style.display = "none"; }
}

async function logout() {
  let doc = await db.get("_local/user");
  await db.remove(doc);
  document.location = "/";
}

async function dbUpdated(change) {
  await drawNotes();

  // Ignore any changes we made ourselves
  // TODO: We should probably handle multiple changes here, also
  // should be deleting the key from writtenRevs (memleak) but
  // need to investigate why the change event is called twice
  // for the same rev.
  if (writtenRevs.has(change.doc._rev)) {
    log(`Ignoring rev ${change.doc._rev}, we made the change`);
    return;
  }

  if (currentNote && change.id === currentNote._id) {
    selectNote(change.doc, false);
  }
}

async function editorClicked(event) {
  // Centering the editor gives blank margins at the edges, its
  // hard to tell when the editor is so forward clicks in those
  // margins to focus the editor.
  if (event.target.id === "note" && !editor.hasFocus()) {
    editor.focus();
  }
}

async function initUI() {
  $("#create-note").addEventListener("click", createNote.bind(this, ""));
  $("#delete-note").addEventListener("click", deleteNote);
  $("#show-notes").addEventListener("click", toggleNotes);
  $("#cover").addEventListener("click", toggleNotes);
  $("#logout").addEventListener("click", logout);
  $("#sign-in").addEventListener("click",
    showDialog("#sign-in-dialog"));
  $("body").addEventListener("click",
    editorClicked);

  window.addEventListener('hashchange', hashChanged, false);

  db.changes({since: 'now', live: true, include_docs: true})
    .on("change", dbUpdated);

  $("#search")
    .addEventListener("input", debounce(drawNotes, 500));
}

function debounce(func, wait, immediate) {
	var timeout;
	return function() {
		var context = this, args = arguments;
		var later = function() {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		var callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
};

// Found the code below @ https://github.com/quilljs/quill/issues/109
// Put the below somewhere with access to Quill
const urlPatterns = [/https?:\/\/[^\s]+/, /www\.[^\s]+/];

// Typing space after a URL matching these formats will turn it into a link
for (const baseUrlPattern of urlPatterns) {
  const urlPattern = new RegExp(`${baseUrlPattern.source}$`);
  quill.keyboard.addBinding({
    collapsed: true,
    key: ' ',
    prefix: urlPattern,
    handler: createUrlKeyboardHandler(urlPattern, quill),
  });
}

// Pasting URLs adds a link
quill.clipboard.addMatcher(Node.TEXT_NODE, (node, delta) => {
  const combinedPattern = urlPatterns
     .map(pattern => `(${pattern.source})`)
     .join('|');
  const combinedRegexp = new RegExp(combinedPattern, 'g');

  const ops = [];
  const str = node.data;
  let lastMatchEndIndex = 0;
  let match = combinedRegexp.exec(str);
  while (match !== null) {
    if (match.index > lastMatchEndIndex) {
      ops.push({ insert: str.slice(lastMatchEndIndex, match.index) });
    }
    ops.push({ insert: match[0], attributes: { link: match[0] } });
    lastMatchEndIndex = match.index + match[0].length;
    match = combinedRegexp.exec(str);
  }

  if (lastMatchEndIndex < str.length) {
    ops.push({ insert: str.slice(lastMatchEndIndex) });
  }

  delta.ops = ops;
  return delta;
 });

 function createUrlKeyboardHandler(urlRegexp, quill) {
  return (range, context) => {
    const prefixMatch = context.prefix.match(urlRegexp);
    if (prefixMatch === null) return true;
    const prefixLength = prefixMatch[0].length;
    const prefixStart = range.index - prefixLength;
    const url = quill.getText(prefixStart, prefixLength);
    quill.formatText(prefixStart, prefixLength, { link: url }, 'user');
    return true;
  };
}
