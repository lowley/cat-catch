const DEFAULT_CRX_URL = "http://10.0.0.1:9876/catcatch-nas.bin";

const bookmarksRoot = document.getElementById("bookmarksRoot");
const bookmarksEmpty = document.getElementById("bookmarksEmpty");
const downloadCrxButton = document.getElementById("downloadCrxButton");
const vidaexoButton = document.getElementById("vidaexoButton");
const actionStatus = document.getElementById("actionStatus");

function setStatus(message) {
  actionStatus.textContent = message || "";
}

function createBookmarkLink(node) {
  const link = document.createElement("a");
  link.className = "bookmark-link";
  link.href = node.url;
  link.textContent = node.title || node.url;
  link.title = node.title || node.url;
  return link;
}

function collectGroups(node, path = []) {
  const groups = [];

  if (!node.children || node.children.length === 0) {
    return groups;
  }

  const directBookmarks = node.children.filter(child => child.url);

  if (directBookmarks.length > 0) {
    groups.push({
      title: path.length > 0 ? path.join(" / ") : "Favoris",
      bookmarks: directBookmarks
    });
  }

  for (const child of node.children) {
    if (!child.url && child.children) {
      const childTitle = child.title?.trim();
      groups.push(
        ...collectGroups(
          child,
          childTitle ? [...path, childTitle] : path
        )
      );
    }
  }

  return groups;
}

function renderBookmarks(tree) {
  bookmarksRoot.replaceChildren();

  const root = Array.isArray(tree) && tree.length > 0 ? tree[0] : null;
  const groups = root ? collectGroups(root) : [];

  if (groups.length === 0) {
    bookmarksEmpty.classList.remove("hidden");
    return;
  }

  bookmarksEmpty.classList.add("hidden");

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "bookmark-group";

    const heading = document.createElement("h2");
    heading.className = "bookmark-group-title";
    heading.textContent = group.title;

    const grid = document.createElement("div");
    grid.className = "bookmark-grid";

    for (const bookmark of group.bookmarks) {
      grid.appendChild(createBookmarkLink(bookmark));
    }

    section.append(heading, grid);
    bookmarksRoot.appendChild(section);
  }
}

async function loadBookmarks() {
  try {
    const tree = await chrome.bookmarks.getTree();
    renderBookmarks(tree);
  } catch (error) {
    bookmarksEmpty.textContent = "Impossible de lire les favoris.";
    bookmarksEmpty.classList.remove("hidden");
    console.error("CatCatch newtab bookmarks:", error);
  }
}

async function getCrxUrl() {
  const stored = await chrome.storage.local.get("newTabCrxUrl");
  return stored.newTabCrxUrl || DEFAULT_CRX_URL;
}

downloadCrxButton.addEventListener("click", async () => {
  setStatus("Téléchargement du CRX…");

  try {
    const url = await getCrxUrl();

    await chrome.downloads.download({
      url,
      filename: "catcatch-nas.crx",
      saveAs: false
    });

    setStatus("Téléchargement lancé.");
  } catch (error) {
    setStatus("Téléchargement impossible.");
    console.error("CatCatch CRX download:", error);
  }
});

vidaexoButton.addEventListener("click", () => {
  setStatus("Ouverture de Vidaexo…");
  window.location.href = "vidaexo://catalog/start";
});

loadBookmarks();
