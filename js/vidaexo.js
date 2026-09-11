const state = {
  actresses: [],
  subjects: [],
  activeTab: "actresses"
};

const statusText = document.getElementById("statusText");
const retryButton = document.getElementById("retryButton");
const configurationNotice = document.getElementById("configurationNotice");
const errorNotice = document.getElementById("errorNotice");
const correctionArea = document.getElementById("correctionArea");
const completeArea = document.getElementById("completeArea");

const actressesTab = document.getElementById("actressesTab");
const subjectsTab = document.getElementById("subjectsTab");
const actressesCount = document.getElementById("actressesCount");
const subjectsCount = document.getElementById("subjectsCount");
const actressesPanel = document.getElementById("actressesPanel");
const subjectsPanel = document.getElementById("subjectsPanel");

function runtimeMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(chrome.runtime.id, message, response => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }
      resolve(response ?? { ok: false, error: "NO_RESPONSE" });
    });
  });
}

function setActiveTab(tab) {
  state.activeTab = tab;

  const actressesActive = tab === "actresses";
  actressesTab.classList.toggle("active", actressesActive);
  actressesTab.setAttribute("aria-selected", String(actressesActive));
  actressesPanel.classList.toggle("active", actressesActive);

  subjectsTab.classList.toggle("active", !actressesActive);
  subjectsTab.setAttribute("aria-selected", String(!actressesActive));
  subjectsPanel.classList.toggle("active", !actressesActive);
}

function showError(message) {
  errorNotice.textContent = message;
  errorNotice.classList.remove("hidden");
}

function clearError() {
  errorNotice.textContent = "";
  errorNotice.classList.add("hidden");
}

function showConfigurationRequired() {
  configurationNotice.classList.remove("hidden");
  correctionArea.classList.add("hidden");
  completeArea.classList.add("hidden");
  statusText.textContent = "Configuration initiale nécessaire dans Vidaexo.";
}

function renderState(catalogState) {
  configurationNotice.classList.add("hidden");
  clearError();

  state.actresses = Array.isArray(catalogState?.actresses) ? catalogState.actresses : [];
  state.subjects = Array.isArray(catalogState?.subjects) ? catalogState.subjects : [];

  actressesCount.textContent = String(state.actresses.length);
  subjectsCount.textContent = String(state.subjects.length);

  if (catalogState?.complete === true) {
    correctionArea.classList.add("hidden");
    completeArea.classList.remove("hidden");
    statusText.textContent = "Aucune correction restante.";
    return;
  }

  completeArea.classList.add("hidden");
  correctionArea.classList.remove("hidden");

  renderPanel(actressesPanel, state.actresses, "actress");
  renderPanel(subjectsPanel, state.subjects, "subject");

  if (state.activeTab === "actresses" && state.actresses.length === 0 && state.subjects.length > 0) {
    setActiveTab("subjects");
  } else if (state.activeTab === "subjects" && state.subjects.length === 0 && state.actresses.length > 0) {
    setActiveTab("actresses");
  } else {
    setActiveTab(state.activeTab);
  }

  const total = state.actresses.length + state.subjects.length;
  statusText.textContent = total === 1
    ? "1 dossier à corriger."
    : `${total} dossiers à corriger.`;
}

function renderPanel(container, items, kind) {
  container.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-panel";
    empty.textContent = "Aucune entrée invalide dans cette catégorie.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    container.appendChild(createInvalidRow(item, kind));
  }
}

function createInvalidRow(item, kind) {
  const row = document.createElement("div");
  row.className = "invalid-row";

  const current = document.createElement("div");
  current.className = "current-name";

  const label = document.createElement("span");
  label.className = "current-name-label";
  label.textContent = "Nom actuel du dossier";

  const value = document.createElement("span");
  value.className = "current-name-value";
  value.textContent = item.currentName ?? "";

  current.append(label, value);

  const editor = document.createElement("div");
  editor.className = "editor";

  const input = document.createElement("input");
  input.type = "text";
  input.value = item.currentName ?? "";
  input.setAttribute("aria-label", "Nom corrigé du dossier");

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "clear-button";
  clearButton.title = "Effacer le champ";
  clearButton.setAttribute("aria-label", "Effacer le champ");
  clearButton.textContent = "×";

  clearButton.addEventListener("click", () => {
    input.value = "";
    input.focus();
  });

  editor.append(input, clearButton);

  const validateButton = document.createElement("button");
  validateButton.type = "button";
  validateButton.className = "validate-button";
  validateButton.textContent = "Valider";

  const rowError = document.createElement("div");
  rowError.className = "row-error hidden";

  async function validate() {
    const correctedName = input.value.trim();

    rowError.classList.add("hidden");
    rowError.textContent = "";

    if (!correctedName) {
      rowError.textContent = "Le nouveau nom ne peut pas être vide.";
      rowError.classList.remove("hidden");
      input.focus();
      return;
    }

    input.disabled = true;
    clearButton.disabled = true;
    validateButton.disabled = true;
    validateButton.textContent = "…";

    const messageName =
      kind === "actress" ? "vidaexoCorrectActress" : "vidaexoCorrectSubject";

    const response = await runtimeMessage({
      Message: messageName,
      directoryId: item.directoryId,
      correctedName
    });

    if (response?.ok && response?.data?.state) {
      renderState(response.data.state);
      return;
    }

    input.disabled = false;
    clearButton.disabled = false;
    validateButton.disabled = false;
    validateButton.textContent = "Valider";

    rowError.textContent =
      response?.data?.error ||
      response?.error ||
      "La correction n’a pas pu être appliquée.";
    rowError.classList.remove("hidden");
  }

  validateButton.addEventListener("click", validate);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      validate();
    }
  });

  row.append(current, editor, validateButton, rowError);
  return row;
}

async function startCatalog() {
  retryButton.disabled = true;
  configurationNotice.classList.add("hidden");
  clearError();
  statusText.textContent = "Démarrage de Vidaexo et catalogage…";

  const response = await runtimeMessage({
    Message: "vidaexoStartCatalog"
  });

  retryButton.disabled = false;

  if (response?.requiresConfiguration) {
    showConfigurationRequired();
    return;
  }

  if (!response?.ok) {
    correctionArea.classList.add("hidden");
    completeArea.classList.add("hidden");
    statusText.textContent = "Impossible de lancer le catalogage.";
    showError(
      response?.data?.error ||
      response?.error ||
      "Vidaexo ne répond pas."
    );
    return;
  }

  const catalogState = response?.data?.state;
  if (!catalogState) {
    statusText.textContent = "Réponse Vidaexo incomplète.";
    showError("Vidaexo n’a pas renvoyé l’état du catalogue.");
    return;
  }

  renderState(catalogState);
}

actressesTab.addEventListener("click", () => setActiveTab("actresses"));
subjectsTab.addEventListener("click", () => setActiveTab("subjects"));
retryButton.addEventListener("click", startCatalog);

startCatalog();
