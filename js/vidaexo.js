const state = {
  actresses: [],
  subjects: [],
  activeTab: "actresses",
  pollTimer: null,
  resumeCheckInProgress: false
};

const statusText = document.getElementById("statusText");
const retryButton = document.getElementById("retryButton");
const launchNotice = document.getElementById("launchNotice");
const configurationNotice = document.getElementById("configurationNotice");
const errorNotice = document.getElementById("errorNotice");
const correctionArea = document.getElementById("correctionArea");
const completeArea = document.getElementById("completeArea");

const serviceState = document.getElementById("serviceState");
const catalogState = document.getElementById("catalogState");
const lastStep = document.getElementById("lastStep");
const progressState = document.getElementById("progressState");
const lastError = document.getElementById("lastError");

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

function phaseLabel(phase) {
  switch (phase) {
    case "IDLE":
      return "En attente";
    case "STARTING":
      return "Préparation";
    case "SCANNING_ACTRESSES":
      return "Lecture de FILLES";
    case "SCANNING_SUBJECTS":
      return "Lecture de SUJETS";
    case "COMPLETE":
      return "Terminé";
    case "WAITING_CONFIGURATION":
      return "Configuration nécessaire";
    case "ERROR":
      return "Erreur";
    default:
      return phase || "Inconnu";
  }
}

function renderDebugStatus(status, serviceAvailable = true) {
  if (!serviceAvailable) {
    serviceState.textContent = "Non joignable";
    catalogState.textContent = "Non disponible";
    return;
  }

  serviceState.textContent = status?.serviceStarted ? "Démarré" : "En cours de démarrage…";
  catalogState.textContent = phaseLabel(status?.phase);
  lastStep.textContent = status?.lastStep || "—";

  const actressesScanned = Number(status?.actressesScanned || 0);
  const actressesTotal = Number(status?.actressesTotal || 0);
  const subjectsScanned = Number(status?.subjectsScanned || 0);
  const subjectsTotal = Number(status?.subjectsTotal || 0);
  const actressesInvalid = Number(status?.actressesInvalid || 0);
  const subjectsInvalid = Number(status?.subjectsInvalid || 0);
  const currentDirectoryName = status?.currentDirectoryName || "";

  const actressesProgress = actressesTotal > 0
    ? `${actressesScanned}/${actressesTotal}`
    : String(actressesScanned);

  const subjectsProgress = subjectsTotal > 0
    ? `${subjectsScanned}/${subjectsTotal}`
    : String(subjectsScanned);

  progressState.textContent =
    `FILLES ${actressesProgress} (${actressesInvalid} invalides) / SUJETS ${subjectsProgress} (${subjectsInvalid} invalides)` +
    (currentDirectoryName ? ` — ${currentDirectoryName}` : "");

  lastError.textContent = status?.lastError || "Aucune";
}

function showLaunchRequired() {
  launchNotice.classList.remove("hidden");
  configurationNotice.classList.add("hidden");
  correctionArea.classList.add("hidden");
  completeArea.classList.add("hidden");
  serviceState.textContent = "Non démarré";
  catalogState.textContent = "Non disponible";
  statusText.textContent = "Vidaexo doit être ouvert avant de lancer le catalogage.";
}

function showConfigurationRequired() {
  launchNotice.classList.add("hidden");
  configurationNotice.classList.remove("hidden");
  correctionArea.classList.add("hidden");
  completeArea.classList.add("hidden");
  statusText.textContent = "Configuration initiale nécessaire dans Vidaexo.";
}

async function refreshAfterReturn() {
  if (state.resumeCheckInProgress || document.visibilityState !== "visible") {
    return;
  }

  state.resumeCheckInProgress = true;

  try {
    const health = await runtimeMessage({
      Message: "vidaexoHealth"
    });

    if (!health?.ok) {
      return;
    }

    launchNotice.classList.add("hidden");

    renderDebugStatus(health?.data?.status || {
      serviceStarted: true,
      phase: "IDLE"
    });

    statusText.textContent = "Vidaexo est démarré.";

    if (health?.data?.configured === false) {
      showConfigurationRequired();
      return;
    }

    await startCatalog();
  } finally {
    state.resumeCheckInProgress = false;
  }
}

function renderState(catalogStateData) {
  launchNotice.classList.add("hidden");
  configurationNotice.classList.add("hidden");
  clearError();

  state.actresses = Array.isArray(catalogStateData?.actresses)
    ? catalogStateData.actresses
    : [];

  state.subjects = Array.isArray(catalogStateData?.subjects)
    ? catalogStateData.subjects
    : [];

  actressesCount.textContent = String(state.actresses.length);
  subjectsCount.textContent = String(state.subjects.length);

  if (catalogStateData?.status) {
    renderDebugStatus(catalogStateData.status);
  }

  if (catalogStateData?.complete === true) {
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

    if (response?.ok) {
      if (response?.data?.status) {
        renderDebugStatus(response.data.status);
      }

      if (response?.data?.status?.cataloging) {
        beginPolling();
        return;
      }

      if (response?.data?.state) {
        renderState(response.data.state);
        return;
      }
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

async function loadFinalState() {
  const response = await runtimeMessage({
    Message: "vidaexoGetCorrectionState"
  });

  if (!response?.ok || !response?.data) {
    showError(response?.error || "Impossible de récupérer l’état final du catalogue.");
    return;
  }

  renderState(response.data);
}

async function pollStatusOnce() {
  const response = await runtimeMessage({
    Message: "vidaexoGetCatalogStatus"
  });

  if (!response?.ok || !response?.data) {
    renderDebugStatus(null, false);
    return false;
  }

  const status = response.data;
  renderDebugStatus(status);

  if (status.phase === "ERROR") {
    clearPolling();
    statusText.textContent = "Le catalogage a échoué.";
    showError(status.lastError || "Erreur inconnue.");
    retryButton.disabled = false;
    return false;
  }

  if (status.phase === "WAITING_CONFIGURATION") {
    clearPolling();
    showConfigurationRequired();
    retryButton.disabled = false;
    return false;
  }

  if (!status.cataloging && status.phase === "COMPLETE") {
    clearPolling();
    retryButton.disabled = false;
    await loadFinalState();
    return false;
  }

  return true;
}

function clearPolling() {
  if (state.pollTimer !== null) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

async function pollLoop() {
  const keepGoing = await pollStatusOnce();

  if (keepGoing) {
    state.pollTimer = setTimeout(pollLoop, 500);
  }
}

function beginPolling() {
  clearPolling();
  pollLoop();
}

async function startCatalog() {
  clearPolling();
  retryButton.disabled = true;
  configurationNotice.classList.add("hidden");
  correctionArea.classList.add("hidden");
  completeArea.classList.add("hidden");
  clearError();

  statusText.textContent = "Vérification de Vidaexo…";
  serviceState.textContent = "Vérification…";
  catalogState.textContent = "En attente";

  const health = await runtimeMessage({
    Message: "vidaexoHealth"
  });

  if (health?.ok) {
    renderDebugStatus(health?.data?.status || {
      serviceStarted: true,
      phase: "IDLE"
    });
    statusText.textContent = "Vidaexo est démarré. Lancement du catalogage…";
  } else {
    renderDebugStatus(null, false);
    serviceState.textContent = "Démarrage en cours…";
    statusText.textContent = "Vidaexo n’est pas joignable. Démarrage de l’application…";
  }

  const response = await runtimeMessage({
    Message: "vidaexoStartCatalog"
  });

  if (response?.requiresConfiguration) {
    retryButton.disabled = false;
    showConfigurationRequired();
    return;
  }

  if (!response?.ok) {
    retryButton.disabled = false;

    if (response?.requiresLaunch || response?.error === "VIDAEXO_NOT_RESPONDING") {
      showLaunchRequired();
      return;
    }

    statusText.textContent = "Impossible de lancer le catalogage.";

    const detailedError =
      response?.data?.message ||
      response?.data?.status?.lastError ||
      response?.data?.error ||
      response?.error ||
      "Erreur inconnue.";

    showError(detailedError);

    if (response?.data?.status) {
      renderDebugStatus(response.data.status);
    }

    return;
  }

  renderDebugStatus(response?.data?.status || {
    serviceStarted: true,
    phase: "STARTING",
    cataloging: true
  });

  statusText.textContent = "Vidaexo est démarré. Catalogage en cours…";
  beginPolling();
}

actressesTab.addEventListener("click", () => setActiveTab("actresses"));
subjectsTab.addEventListener("click", () => setActiveTab("subjects"));
retryButton.addEventListener("click", startCatalog);

window.addEventListener("beforeunload", clearPolling);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshAfterReturn();
  }
});

window.addEventListener("focus", refreshAfterReturn);

startCatalog();
