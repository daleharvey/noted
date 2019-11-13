"use script";

const $ = document.querySelector.bind(document);
const changeEvent = debounce(editorChanged, 500);

const editor = new EasyMDE({
  autoDownloadFontAwesome: false,
  toolbar: false,
  status: false,
  element: $("#note textarea")
});

let db = null;
let user = null;
let currentNote = null;

(async function() {

  await initDB();
  await loadUser();

  if (user) {
    await initSync(user);
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has("token")) {
    await validate(params.get("token"));
    return;
  }

  await initUI();
  await hashChanged();

})();

async function loadUser() {
  try {
    user = await db.get("_local/user");
  } catch(e) {}
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
  $("#notes footer").classList.toggle("logged-in", true);
  $("#notes footer span").innerText = details.email;
  let url = `${document.location.origin}/db/${details.database}`;
  let remote = new PouchDB(url, {
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
    live: true
  }).on("error", error => {
    console.error("Error Syncing", error);
  }).on("paused", () => {
    console.log("Syncing paused");
  }).on("active", () => {
    console.log("Syncing active");
  });
}

async function validate(token) {
  let result = await fetch('/authenticate', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({token})
  });
  let json = await result.json();
  if (json.ok) {
    json._id = "_local/user";
    await db.post(json);
    document.location = "/";
  } else {
    console.error(json);
  }
}

async function selectNote(note) {
  editor.codemirror.off("change", changeEvent);
  currentNote = note;
  editor.value(note.note);
  editor.codemirror.on("change", changeEvent);
  document.body.classList.remove("shownotes")
}

async function createNote() {
  let result = await db.post({
    updated: Date.now(),
    type: "post",
    note: ""
  });
  document.location = "#" + result.id;
}

async function signIn(e) {
  e.preventDefault();
  let email = $("#email").value
  $("#sign-in-dialog").style.display = "none";
  let result = await fetch('/sign-in', {
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
      createNote();
    }
  }
}

async function editorChanged() {
  let data = editor.value();
  currentNote.note = data;
  currentNote.updated = Date.now();
  let update = await db.put(currentNote);
  currentNote._rev = update.rev;
}

async function drawNotes() {

  let notes = (await db.allDocs({include_docs: true})).rows;
  let search = $("#search").value;

  if (search) {
    notes = notes.filter((value) => {
      // Only do full text filter right now
      return value.doc.note.includes(search);
    });
  }

  if (!notes.length && search) {
    $("#notes-list").innerHTML = "Nothing matched the search";
    return;
  }

  notes.sort((a, b) => b.doc.updated - a.doc.updated);
  let titles = notes.map(note => {
    let data = note.doc.note || "";
    let title = data.split("\n")[0].trim() || "New Note";
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
    $(id).style.display = "block";
    $("#cancel-btn").addEventListener("click", hide(id));
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

  // This is possible racey if you are type something
  // between the change event firing and this being run.
  if (currentNote && change.id === currentNote._id &&
      change.doc.note !== editor.value()) {
    selectNote(change.doc, false);
  }
}

async function initUI() {
  $("#create-note").addEventListener("click", createNote);
  $("#delete-note").addEventListener("click", deleteNote);
  $("#show-notes").addEventListener("click", toggleNotes);
  $("#cover").addEventListener("click", toggleNotes);
  $("#logout").addEventListener("click", logout);
  $("#sign-in").addEventListener("click",
    showDialog("#sign-in-dialog"));

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
