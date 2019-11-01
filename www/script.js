"use script";

let db = new PouchDB("notes");
let editor = new SimpleMDE({
  autoDownloadFontAwesome: false,
  toolbar: false,
  status: false,
  element: document.querySelector("#note textarea")
});

let changeEvent = debounce(editorChanged, 500);
let currentNote;

(async function() {
  await initUI();
  await drawNotes();
  await hashChanged();
  if (!currentNote) {
    let notes = await db.allDocs({include_docs: true});
    if (notes.total_rows) {
      selectNote(notes.rows[0].doc);
    } else {
      createNote();
    }
  }
})();

async function selectNote(note) {
  editor.codemirror.off("change", changeEvent);
  currentNote = note;
  editor.value(note.note);
  editor.codemirror.on("change", changeEvent);
}

async function createNote() {
  let result = await db.post({
    updated: Date.now(),
    type: "post",
    note: ""
  });
  document.location = "#" + result.id;
}

async function hashChanged() {
  let id = document.location.hash.slice(1);
  try {
    let note = await db.get(id);
    selectNote(note);
  } catch (e) {
    console.error(e)
  }
}

async function searchChanged() {
  drawNotes([search]);
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
  let search = document.querySelector("#search").value;

  if (search) {
    notes = notes.filter((value) => {
      // Only do full text filter right now
      return value.doc.note.includes(search);
    });
  }

  if (!notes.length) {
    document.querySelector("#notes-list").innerHTML =
      "Nothing matched the search";
    return;
  }

  notes.sort((a, b) => b.doc.updated - a.doc.updated);
  let titles = notes.map(note => {
    let data = note.doc.note || "";
    let title = data.split("\n")[0].trim() ||
      "New Note";
    return `<li><a href="#${note.doc._id}">${title}</a></li>`;
  });

  document.querySelector("#notes-list").innerHTML =
    titles.join("");
}

async function initUI() {
  document.querySelector("#create-note")
    .addEventListener("click", createNote);

  window.addEventListener('hashchange', hashChanged, false);

  db.changes({since: 'now', live: true})
    .on("change", drawNotes);

  document.querySelector("#search")
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
