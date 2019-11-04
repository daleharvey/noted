"use script";

let $ = document.querySelector.bind(document);

let db = new PouchDB("notes");
let editor = new SimpleMDE({
  autoDownloadFontAwesome: false,
  toolbar: false,
  status: false,
  element: $("#note textarea")
});

let changeEvent = debounce(editorChanged, 500);
let currentNote;

(async function() {
  await initUI();
  await hashChanged();
})();

async function selectNote(note) {
  editor.codemirror.off("change", changeEvent);
  currentNote = note;
  editor.value(note.note);
  editor.codemirror.focus();
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

async function deleteNote() {
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
    drawNotes();
  } catch (e) { }
  if (!currentNote) {
    let notes = await db.allDocs({include_docs: true});
    if (notes.total_rows) {
      document.location = "#" + notes.rows[0].id;
    } else {
      createNote();
    }
  }
}

async function searchChanged() {
  drawNotes();
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

  if (!notes.length) {
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

async function initUI() {
  $("#create-note").addEventListener("click", createNote);
  $("#delete-note").addEventListener("click", deleteNote);
  $("#show-notes").addEventListener("click", toggleNotes);
  $("#cover").addEventListener("click", toggleNotes);

  window.addEventListener('hashchange', hashChanged, false);

  db.changes({since: 'now', live: true})
    .on("change", drawNotes);

  $("#search")
    .addEventListener("input", debounce(searchChanged, 500));
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
