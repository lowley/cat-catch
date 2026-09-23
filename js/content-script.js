(function () {
    var _videoObj = [];
    var _videoSrc = [];
    var _key = new Set();
    var m3u8Text = new Map();

    const nasMedia = new Map();
    let nasFabHost = null;
    let nasFabButton = null;
    let nasFabBadge = null;
    let nasPanel = null;
    let nasPresenceStatus = "unknown";
    let nasPresenceCheckedUrl = null;
    let nasPresenceCheckInProgress = false;
    const nasVideos = new Map();
    const nasIsTopFrame = window.top === window;
    const nasIsStatusPage =
        location.hostname === "10.0.0.1" &&
        location.port === "9876" &&
        location.pathname.startsWith("/status");
    const nasIsHotMoviesDescriptionPage =
        nasIsTopFrame &&
        location.hostname === "www.hotmovies.com" &&
        /^\/\d+\/[^/]+\.html$/i.test(location.pathname) &&
        new URL(location.href).searchParams.get("viewpart") !== "videoplayer";

    const catCatchIsLocalNewTab =
        nasIsTopFrame &&
        /(?:^|\/)newtab\.html$/i.test(location.pathname);

    if (catCatchIsLocalNewTab) {
        initializeCatCatchLocalNewTab();
        return;
    }

    function initializeCatCatchLocalNewTab() {
        const run = function () {
            document.title = "CatCatch";

            document.head.insertAdjacentHTML(
                "beforeend",
                `<style>
                    :root { color-scheme: dark; }
                    * { box-sizing: border-box; }
                    body {
                        margin: 0;
                        min-height: 100vh;
                        background:
                            linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
                            #0b0f12;
                        background-size: 28px 28px;
                        color: #e9f1f4;
                        font-family: Arial, Helvetica, sans-serif;
                    }
                    .cc-home {
                        width: min(1180px, calc(100% - 32px));
                        margin: 0 auto;
                        padding: 22px 0 48px;
                    }
                    .cc-actions {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                        flex-wrap: wrap;
                        margin-bottom: 26px;
                    }
                    .cc-tech {
                        border: 1px solid #4d6973;
                        border-radius: 4px;
                        padding: 10px 15px;
                        background: linear-gradient(180deg, #1c2b31, #11191d);
                        color: #dffaff;
                        font-family: "Bank Gothic", "Eurostile", "Microgramma", "Arial Narrow", sans-serif;
                        font-size: 13px;
                        font-weight: 700;
                        letter-spacing: .12em;
                        text-transform: uppercase;
                        text-decoration: none;
                        cursor: pointer;
                    }
                    .cc-tech:hover {
                        border-color: #66dce7;
                        color: white;
                        box-shadow: 0 0 16px rgba(102,220,231,.13);
                    }
                    .cc-status {
                        color: #8ea2ab;
                        font-size: 12px;
                    }
                    .cc-section {
                        border-top: 1px solid #26323a;
                        padding-top: 20px;
                    }
                    .cc-title {
                        margin: 0 0 4px;
                        font-family: "Bank Gothic", "Eurostile", "Microgramma", "Arial Narrow", sans-serif;
                        font-size: 28px;
                        letter-spacing: .09em;
                        text-transform: uppercase;
                    }
                    .cc-subtitle {
                        margin: 0 0 18px;
                        color: #8ea2ab;
                        font-size: 13px;
                    }
                    .cc-group {
                        margin-bottom: 18px;
                        padding: 14px;
                        border: 1px solid #26323a;
                        border-radius: 10px;
                        background: rgba(18,24,29,.88);
                    }
                    .cc-group-title {
                        margin: 0 0 11px;
                        color: #66dce7;
                        font-size: 13px;
                        letter-spacing: .08em;
                        text-transform: uppercase;
                    }
                    .cc-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
                        gap: 9px;
                    }
                    .cc-link {
                        display: block;
                        min-width: 0;
                        padding: 11px 12px;
                        border: 1px solid #253139;
                        border-radius: 7px;
                        background: #182129;
                        color: #e9f1f4;
                        text-decoration: none;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .cc-link:hover {
                        border-color: #3f6971;
                        background: #1c2930;
                    }
                    .cc-empty {
                        color: #8ea2ab;
                        padding: 20px 0;
                    }
                    @media (max-width: 640px) {
                        .cc-home { width: calc(100% - 20px); padding-top: 14px; }
                        .cc-tech { font-size: 12px; padding: 9px 11px; }
                        .cc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                    }
                </style>`
            );

            document.body.innerHTML = `
                <main class="cc-home">
                    <section class="cc-actions">
                        <button id="cc-download" class="cc-tech" type="button">Télécharger CatCatch</button>
                        <a id="cc-vidaexo" class="cc-tech" href="vidaexo://catalog/start">Vidaexo</a>
                        <span id="cc-status" class="cc-status"></span>
                    </section>
                    <section class="cc-section">
                        <h1 class="cc-title">Favoris</h1>
                        <p class="cc-subtitle">Accueil CatCatch</p>
                        <div id="cc-bookmarks"></div>
                    </section>
                </main>
            `;

            const status = document.getElementById("cc-status");
            const bookmarks = document.getElementById("cc-bookmarks");

            document.getElementById("cc-download").addEventListener("click", function () {
                status.textContent = "Téléchargement…";

                chrome.runtime.sendMessage(
                    { Message: "newTabDownloadCrx" },
                    function (response) {
                        if (chrome.runtime.lastError || !response?.ok) {
                            status.textContent = "Téléchargement impossible.";
                            return;
                        }

                        status.textContent = "Téléchargement lancé.";
                    }
                );
            });

            chrome.runtime.sendMessage(
                { Message: "newTabGetBookmarks" },
                function (response) {
                    if (chrome.runtime.lastError || !response?.ok || !Array.isArray(response.tree)) {
                        bookmarks.innerHTML = '<div class="cc-empty">Impossible de lire les favoris.</div>';
                        return;
                    }

                    renderCatCatchBookmarks(bookmarks, response.tree);
                }
            );
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", run, { once: true });
        } else {
            run();
        }
    }

    function renderCatCatchBookmarks(container, tree) {
        const groups = [];

        function collect(node, path) {
            if (!node?.children) {
                return;
            }

            const direct = node.children.filter(function (child) {
                return Boolean(child.url);
            });

            if (direct.length > 0) {
                groups.push({
                    title: path.length > 0 ? path.join(" / ") : "Favoris",
                    entries: direct
                });
            }

            node.children.forEach(function (child) {
                if (!child.url && child.children) {
                    const title = String(child.title || "").trim();
                    collect(child, title ? path.concat(title) : path);
                }
            });
        }

        if (tree[0]) {
            collect(tree[0], []);
        }

        container.innerHTML = "";

        if (groups.length === 0) {
            container.innerHTML = '<div class="cc-empty">Aucun favori à afficher.</div>';
            return;
        }

        groups.forEach(function (group) {
            const section = document.createElement("section");
            section.className = "cc-group";

            const heading = document.createElement("h2");
            heading.className = "cc-group-title";
            heading.textContent = group.title;

            const grid = document.createElement("div");
            grid.className = "cc-grid";

            group.entries.forEach(function (entry) {
                const link = document.createElement("a");
                link.className = "cc-link";
                link.href = entry.url;
                link.textContent = entry.title || entry.url;
                link.title = entry.title || entry.url;
                grid.appendChild(link);
            });

            section.appendChild(heading);
            section.appendChild(grid);
            container.appendChild(section);
        });
    }

    function nasLoadHotMoviesPlayerInBackground() {
        if (!nasIsTopFrame) {
            return;
        }

        const url = new URL(location.href);

        if (url.hostname !== "www.hotmovies.com") {
            return;
        }

        // Ne rien faire si nous sommes déjà sur la page du lecteur
        if (url.searchParams.get("viewpart") === "videoplayer") {
            return;
        }

        // Seulement les pages vidéo du type /1234567/nom-video.html
        if (!/^\/\d+\/[^/]+\.html$/i.test(url.pathname)) {
            return;
        }

        // Évite de créer l'iframe plusieurs fois
        if (document.getElementById("catcatch-hotmovies-player")) {
            return;
        }

        const playerUrl = new URL(url.href);
        playerUrl.searchParams.set("viewpart", "videoplayer");

        const iframe = document.createElement("iframe");
        iframe.id = "catcatch-hotmovies-player";
        iframe.src = playerUrl.href;

        iframe.style.position = "fixed";
        iframe.style.width = "1px";
        iframe.style.height = "1px";
        iframe.style.left = "-10000px";
        iframe.style.top = "-10000px";
        iframe.style.opacity = "0";
        iframe.style.pointerEvents = "none";
        iframe.style.border = "0";

        document.documentElement.appendChild(iframe);
    }

    function createNasStatusBackButton() {
        if (document.getElementById("catcatch-nas-status-back")) {
            return;
        }

        const button = document.createElement("button");
        button.id = "catcatch-nas-status-back";
        button.textContent = "←";
        button.title = "Retour à la page vidéo";

        Object.assign(button.style, {
            position: "fixed",
            top: "14px",
            right: "14px",
            width: "46px",
            height: "46px",
            border: "0",
            borderRadius: "50%",
            background: "#222",
            color: "white",
            fontSize: "28px",
            lineHeight: "46px",
            textAlign: "center",
            zIndex: "2147483647",
            boxShadow: "0 3px 12px rgba(0,0,0,.45)",
            cursor: "pointer"
        });

        button.addEventListener("click", function () {
            chrome.runtime.sendMessage({
                Message: "nasCloseStatus"
            });
        });

        document.documentElement.appendChild(button);
    }

    if (nasIsTopFrame) {
        if (nasIsStatusPage) {
            createNasStatusBackButton();
        } else {
            prepareNasFab();
            nasLoadHotMoviesPlayerInBackground();
        }
    }

    function toggleNasPanel() {
        if (nasPanel) {
            nasPanel.remove();
            nasPanel = null;
            return;
        }

        nasPanel = document.createElement("div");
        nasPanel.style.position = "fixed";
        nasPanel.style.left = "12px";
        nasPanel.style.right = "12px";
        nasPanel.style.bottom = "150px";
        nasPanel.style.maxHeight = "65vh";
        nasPanel.style.overflowY = "auto";
        nasPanel.style.background = "#111";
        nasPanel.style.color = "white";
        nasPanel.style.borderRadius = "16px";
        nasPanel.style.zIndex = "2147483647";
        nasPanel.style.fontFamily = "sans-serif";
        nasPanel.style.boxShadow = "0 4px 24px rgba(0,0,0,.55)";

        document.documentElement.appendChild(nasPanel);

        renderNasPanel();
    }

    function nasExtractHotMoviesCoverUrl() {
        const selectors = [
            'meta[property="og:image:secure_url"]',
            'meta[property="og:image"]',
            'meta[name="twitter:image"]',
            'meta[name="twitter:image:src"]',
            'link[rel="image_src"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const raw = element?.getAttribute("content") || element?.getAttribute("href") || "";
            if (!raw.trim()) {
                continue;
            }

            try {
                const absolute = new URL(raw.trim(), location.href);
                if (absolute.protocol === "https:" || absolute.protocol === "http:") {
                    return absolute.href;
                }
            } catch (_) {
                // Ignore malformed candidates and continue with the next selector.
            }
        }

        const imageCandidates = Array.from(document.images)
            .map(function (image) {
                const src = image.currentSrc || image.src || "";
                const width = Number(image.naturalWidth || image.width || 0);
                const height = Number(image.naturalHeight || image.height || 0);
                return { src, area: width * height };
            })
            .filter(function (candidate) {
                return candidate.src && /^https?:/i.test(candidate.src);
            })
            .sort(function (a, b) {
                return b.area - a.area;
            });

        return imageCandidates[0]?.src || null;
    }

    async function nasDownloadCoverBase64(url) {
        if (!url) {
            return null;
        }

        try {
            const response = await fetch(url, {
                method: "GET",
                credentials: "include",
                cache: "force-cache"
            });

            if (!response.ok) {
                return null;
            }

            const blob = await response.blob();
            if (!blob.type.startsWith("image/")) {
                return null;
            }

            return await new Promise(function (resolve) {
                const reader = new FileReader();
                reader.onload = function () {
                    const dataUrl = String(reader.result || "");
                    const comma = dataUrl.indexOf(",");
                    resolve(comma >= 0 ? dataUrl.substring(comma + 1) : null);
                };
                reader.onerror = function () { resolve(null); };
                reader.readAsDataURL(blob);
            });
        } catch (_) {
            return null;
        }
    }

    function getNasSourceUrl() {
        const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
        const ogUrl = document.querySelector('meta[property="og:url"]')?.content || "";
        return String(canonical || ogUrl || location.href).trim();
    }

    function updateNasPresenceLamp() {
        if (!nasPanel) return;

        const lamp = nasPanel.querySelector("[data-nas-presence-lamp]");
        if (!lamp) return;

        if (nasPresenceStatus === "present") {
            lamp.style.opacity = "1";
            lamp.style.filter = "none";
            lamp.style.textShadow = "0 0 8px rgba(255, 220, 80, .9)";
            lamp.title = "Cette vidéo est déjà présente dans Vidaexo.";
            return;
        }

        lamp.style.opacity = nasPresenceStatus === "checking" ? ".45" : ".22";
        lamp.style.filter = "grayscale(1)";
        lamp.style.textShadow = "none";
        lamp.title = nasPresenceStatus === "error"
            ? "Impossible de vérifier la présence dans Vidaexo."
            : nasPresenceStatus === "checking"
                ? "Vérification dans Vidaexo…"
                : "Cette vidéo n’est pas présente dans Vidaexo.";
    }

    function checkNasVideoPresence() {
        if (!nasIsTopFrame || nasPresenceCheckInProgress) return;

        const sourceUrl = getNasSourceUrl();
        if (nasPresenceCheckedUrl === sourceUrl && nasPresenceStatus !== "unknown") {
            updateNasPresenceLamp();
            return;
        }

        nasPresenceCheckedUrl = sourceUrl;
        nasPresenceCheckInProgress = true;
        nasPresenceStatus = "checking";
        updateNasPresenceLamp();

        chrome.runtime.sendMessage(
            {
                Message: "vidaexoVideoPresence",
                sourceUrl: sourceUrl
            },
            function (response) {
                nasPresenceCheckInProgress = false;

                if (chrome.runtime.lastError || !response?.ok) {
                    nasPresenceStatus = "error";
                    updateNasPresenceLamp();
                    return;
                }

                nasPresenceStatus = response?.data?.present === true
                    ? "present"
                    : "absent";
                updateNasPresenceLamp();
            }
        );
    }

    function getNasSelectedCount() {
        let count = 0;

        for (const video of nasVideos.values()) {
            if (video.selected >= 0 && video.variants[video.selected]) {
                count++;
            }
        }

        return count;
    }

    function renderNasPanel() {
        if (!nasPanel) {
            return;
        }

        nasPanel.innerHTML = "";

        const header = document.createElement("div");
        header.style.position = "sticky";
        header.style.top = "0";
        header.style.zIndex = "2";
        header.style.background = "#111";
        header.style.padding = "12px";
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";

        const headingGroup = document.createElement("div");
        headingGroup.style.display = "flex";
        headingGroup.style.alignItems = "center";
        headingGroup.style.gap = "8px";

        const heading = document.createElement("div");
        heading.textContent = "Vidéos détectées";
        heading.style.fontSize = "18px";
        heading.style.fontWeight = "bold";

        const presenceLamp = document.createElement("span");
        presenceLamp.textContent = "💡";
        presenceLamp.setAttribute("data-nas-presence-lamp", "true");
        presenceLamp.setAttribute("aria-label", "Présence dans Vidaexo");
        presenceLamp.style.fontSize = "20px";
        presenceLamp.style.lineHeight = "1";
        presenceLamp.style.transition = "opacity .15s ease, filter .15s ease, text-shadow .15s ease";
        headingGroup.append(heading, presenceLamp);

        const send = document.createElement("button");
        send.textContent = "SEND " + getNasSelectedCount() + "/" + nasVideos.size;
        send.style.border = "0";
        send.style.borderRadius = "10px";
        send.style.padding = "9px 14px";
        send.style.fontWeight = "bold";
        send.style.fontSize = "14px";
        send.style.cursor = "pointer";

        updateNasPresenceLamp();
        checkNasVideoPresence();

        send.addEventListener("click", async function () {
            if (send.disabled) {
                return;
            }

            send.disabled = true;
            send.textContent = "ENVOI…";

            let success = 0;
            let errors = 0;
            let firstError = null;

            const coverUrl = nasExtractHotMoviesCoverUrl();
            const coverBase64 = await nasDownloadCoverBase64(coverUrl);
            const promises = [];

            for (const video of nasVideos.values()) {
                const variant = video.variants[video.selected];

                if (!variant) {
                    continue;
                }

                promises.push(
                    new Promise(function (resolve) {
                        const baseName = String(video.title || document.title || "video").trim() || "video";
                        const initialName = /\.[A-Za-z0-9]{2,5}$/.test(baseName)
                            ? baseName
                            : baseName + ".mp4";

                        chrome.runtime.sendMessage(
                            {
                                Message: "nasSendToServer",
                                data: {
                                    url: variant.url,
                                    referer: video.referer || "",
                                    cookie: video.cookie || "",
                                    userAgent: navigator.userAgent,
                                    title: video.title || "Vidéo",
                                    filename: initialName,
                                    duration: video.duration || null,
                                },
                                namingRequest: {
                                    html: document.documentElement.outerHTML,
                                    initialName: initialName,
                                    sourceUrl: getNasSourceUrl(),
                                    coverUrl: coverUrl,
                                    coverBase64: coverBase64
                                }
                            },
                            function (response) {
                                if (chrome.runtime.lastError || !response?.ok) {
                                    errors++;

                                    if (!firstError) {
                                        if (chrome.runtime.lastError) {
                                            firstError = {
                                                stage: "EXTENSION",
                                                status: 0,
                                                error: chrome.runtime.lastError.message || "NO_RESPONSE"
                                            };
                                        } else {
                                            firstError = {
                                                stage: response?.stage || "UNKNOWN",
                                                status: response?.status ?? 0,
                                                error: response?.error || "UNKNOWN_ERROR"
                                            };
                                        }
                                    }
                                } else {
                                    success++;
                                }

                                resolve();
                            }
                        );
                    })
                );
            }

            await Promise.all(promises);

            if (errors === 0 && success > 0) {
                send.textContent = "✓ ENVOYÉ " + success;

                setTimeout(function () {
                    if (nasPanel) {
                        nasPanel.remove();
                        nasPanel = null;
                    }
                }, 500);

            } else if (success > 0) {
                send.textContent = "✓ " + success + " / ✕ " + errors;
                send.disabled = false;

            } else {
                const stage = String(firstError?.stage || "ERREUR");
                const status = Number(firstError?.status || 0);
                const detail = String(firstError?.error || "").trim();

                const compactDetail = detail
                    .replace(/^TypeError:\s*/i, "")
                    .replace(/^Error:\s*/i, "")
                    .slice(0, 80);

                send.textContent =
                    "✕ " + stage +
                    (status ? " " + status : "") +
                    (compactDetail ? " — " + compactDetail : "");
                send.title = detail;
                send.style.maxWidth = "320px";
                send.style.whiteSpace = "normal";
                send.disabled = false;
            }
        });

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.alignItems = "center";

        const favorite = document.createElement("button");
        favorite.textContent = "★ FAVORI";
        favorite.style.border = "1px solid #555";
        favorite.style.borderRadius = "10px";
        favorite.style.padding = "9px 12px";
        favorite.style.background = "#1b1b1b";
        favorite.style.color = "white";
        favorite.style.fontWeight = "bold";
        favorite.style.fontSize = "13px";
        favorite.style.cursor = "pointer";

        favorite.addEventListener("click", function () {
            favorite.disabled = true;
            favorite.textContent = "OUVERTURE…";

            chrome.runtime.sendMessage(
                {
                    Message: "newTabAddFavorite",
                    url: location.href,
                    title: document.title || location.href
                },
                function (response) {
                    if (chrome.runtime.lastError || !response?.ok) {
                        favorite.textContent = "✕ ERREUR";
                        favorite.disabled = false;
                        return;
                    }

                    favorite.textContent = "✓ FAVORI";
                    setTimeout(function () {
                        favorite.textContent = "★ FAVORI";
                        favorite.disabled = false;
                    }, 1200);
                }
            );
        });

        actions.appendChild(favorite);
        actions.appendChild(send);

        header.appendChild(headingGroup);
        header.appendChild(actions);
        nasPanel.appendChild(header);

        for (const [key, video] of nasVideos) {
            nasPanel.appendChild(createNasVideoCard(key, video));
        }
    }

    function nasFormatDuration(seconds) {
        if (!seconds) return "";

        seconds = Math.round(seconds);

        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        if (h > 0) {
            return String(h).padStart(2, "0") + ":" +
                String(m).padStart(2, "0") + ":" +
                String(s).padStart(2, "0");
        }

        return String(m).padStart(2, "0") + ":" +
            String(s).padStart(2, "0");
    }

    function nasFormatSize(bytes) {
        if (!bytes) return "";

        if (bytes >= 1073741824) {
            return (bytes / 1073741824).toFixed(1) + " Go";
        }

        if (bytes >= 1048576) {
            return Math.round(bytes / 1048576) + " Mo";
        }

        return Math.round(bytes / 1024) + " Ko";
    }

    function applyNasDefaultSelections() {
        if (nasVideos.size !== 1) {
            for (const video of nasVideos.values()) {
                video.selected = -1;
            }
            return;
        }

        const video = nasVideos.values().next().value;

        const index360 = video.variants.findIndex(function (variant) {
            const resolution = String(variant.resolution || "");
            const match = resolution.match(/x(\d+)$/);
            return match && Number(match[1]) === 360;
        });

        video.selected = index360 >= 0 ? index360 : -1;
    }

    function createNasVideoCard(key, video) {
        const card = document.createElement("div");
        card.style.margin = "0 12px 12px";
        card.style.padding = "12px";
        card.style.background = "#222";
        card.style.borderRadius = "12px";

        const titleLine = document.createElement("div");
        titleLine.style.display = "flex";
        titleLine.style.alignItems = "center";
        titleLine.style.gap = "8px";
        titleLine.style.marginBottom = "5px";

        const title = document.createElement("div");
        title.textContent = video.title + (video.duration ? "   •   " + nasFormatDuration(video.duration) : "");
        title.style.fontWeight = "bold";
        title.style.flex = "1";

        const badge = document.createElement("span");
        badge.textContent = video.type;
        badge.style.fontSize = "11px";
        badge.style.padding = "3px 7px";
        badge.style.borderRadius = "8px";
        badge.style.background = "#444";

        titleLine.appendChild(title);
        titleLine.appendChild(badge);
        card.appendChild(titleLine);

        const noDownloadLabel = document.createElement("label");
        noDownloadLabel.style.display = "flex";
        noDownloadLabel.style.alignItems = "center";
        noDownloadLabel.style.gap = "6px";
        noDownloadLabel.style.padding = "3px 2px";
        noDownloadLabel.style.color = "white";

        const noDownloadRadio = document.createElement("input");
        noDownloadRadio.type = "radio";
        noDownloadRadio.name = "nas-video-" + key;
        noDownloadRadio.checked = video.selected === -1;
        noDownloadRadio.style.margin = "0";

        noDownloadRadio.addEventListener("change", function () {
            video.selected = -1;
            renderNasPanel();
        });

        const noDownloadText = document.createElement("span");
        noDownloadText.textContent = "Ne pas télécharger";
        noDownloadText.style.fontSize = "14px";

        noDownloadLabel.appendChild(noDownloadRadio);
        noDownloadLabel.appendChild(noDownloadText);
        card.appendChild(noDownloadLabel);

        video.variants.forEach((variant, index) => {
            const label = document.createElement("label");
            label.style.display = "flex";
            label.style.alignItems = "center";
            label.style.gap = "6px";
            label.style.padding = "3px 2px";
            label.style.color = "white";
            label.style.lineHeight = "1.2";

            const radio = document.createElement("input");
            radio.style.margin = "0";
            radio.type = "radio";
            radio.name = "nas-video-" + key;
            radio.checked = video.selected === index;

            radio.addEventListener("change", function () {
                video.selected = index;
                renderNasPanel();
            });

            const resolution = document.createElement("span");
            resolution.style.color = "white";
            resolution.style.fontSize = "14px";

            let text = variant.resolution || "?";

            if (variant.resolution && variant.resolution.includes("x")) {
                text = variant.resolution.split("x")[1] + "p";
            }

            if (variant.estimatedSize) {
                text += "  •  ~" + nasFormatSize(variant.estimatedSize);
            }

            resolution.textContent = text;

            label.appendChild(radio);
            label.appendChild(resolution);
            card.appendChild(label);
        });

        return card;
    }

    function createNasFab() {
        if (nasFabHost) return;

        nasFabHost = document.createElement("div");
        nasFabHost.id = "catcatch-nas-fab-host";

        Object.assign(nasFabHost.style, {
            position: "fixed",
            right: "18px",
            bottom: "90px",
            zIndex: "2147483647",
            display: "none"
        });

        const shadow = nasFabHost.attachShadow({ mode: "open" });

        shadow.innerHTML = `
            <style>
                .fab-wrap {
                    position: relative;
                    width: 58px;
                    height: 58px;
                }

                button {
                    all: initial;
                    box-sizing: border-box;
                    width: 58px;
                    height: 58px;
                    border-radius: 50%;
                    background: #222;
                    color: white;
                    font-family: system-ui, sans-serif;
                    font-size: 27px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    box-shadow: 0 3px 12px rgba(0,0,0,.45);
                    position: relative;
                    user-select: none;
                    -webkit-user-select: none;
                    -webkit-touch-callout: none;
                    touch-action: none;
                }

                button:active {
                    transform: scale(.94);
                }

                .gesture-layer {
                    position: absolute;
                    inset: 0;
                    z-index: 10;
                    border-radius: 50%;
                    background: transparent;
                    touch-action: none;
                    -webkit-user-select: none;
                    user-select: none;
                    -webkit-touch-callout: none;
                }

                .badge {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    min-width: 20px;
                    height: 20px;
                    padding: 0 4px;
                    border-radius: 10px;
                    background: #d32f2f;
                    color: white;
                    font-size: 12px;
                    font-family: system-ui, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
            </style>

            <div class="fab-wrap">
                <button type="button" title="Vidéos détectées">
                    🎬
                    <span class="badge">1</span>
                </button>
                <div class="gesture-layer" aria-hidden="true"></div>
            </div>
        `;

        nasFabButton = shadow.querySelector("button");
        nasFabBadge = shadow.querySelector(".badge");
        const nasFabGestureLayer = shadow.querySelector(".gesture-layer");

        let nasLongPressTimer = null;
        let nasLongPressTriggered = false;
        let nasTouchActive = false;

        function nasStopGestureEvent(event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }

        function nasStartLongPress() {
            nasLongPressTriggered = false;
            clearTimeout(nasLongPressTimer);

            nasLongPressTimer = setTimeout(function () {
                nasLongPressTriggered = true;

                chrome.runtime.sendMessage({
                    Message: "nasOpenStatus"
                });
            }, 700);
        }

        function nasEndLongPress() {
            clearTimeout(nasLongPressTimer);
            nasLongPressTimer = null;
        }

        nasFabGestureLayer.addEventListener("touchstart", function (event) {
            nasStopGestureEvent(event);
            nasTouchActive = true;
            nasStartLongPress();
        }, { capture: true, passive: false });

        nasFabGestureLayer.addEventListener("touchend", function (event) {
            nasStopGestureEvent(event);
            nasEndLongPress();
            const wasLongPress = nasLongPressTriggered;
            nasLongPressTriggered = false;
            nasTouchActive = false;
            if (!wasLongPress) toggleNasPanel();
        }, { capture: true, passive: false });

        nasFabGestureLayer.addEventListener("touchcancel", function (event) {
            nasStopGestureEvent(event);
            nasEndLongPress();
            nasLongPressTriggered = false;
            nasTouchActive = false;
        }, { capture: true, passive: false });

        nasFabGestureLayer.addEventListener("pointerdown", function (event) {
            if (event.pointerType === "touch" || nasTouchActive) return;
            nasStopGestureEvent(event);
            nasStartLongPress();
            try { nasFabGestureLayer.setPointerCapture(event.pointerId); } catch (_) {}
        });

        nasFabGestureLayer.addEventListener("pointerup", function (event) {
            if (event.pointerType === "touch" || nasTouchActive) return;
            nasStopGestureEvent(event);
            nasEndLongPress();
            const wasLongPress = nasLongPressTriggered;
            nasLongPressTriggered = false;
            try {
                if (nasFabGestureLayer.hasPointerCapture(event.pointerId)) {
                    nasFabGestureLayer.releasePointerCapture(event.pointerId);
                }
            } catch (_) {}
            if (!wasLongPress) toggleNasPanel();
        });

        nasFabGestureLayer.addEventListener("pointercancel", function (event) {
            if (event.pointerType === "touch" || nasTouchActive) return;
            nasStopGestureEvent(event);
            nasEndLongPress();
            nasLongPressTriggered = false;
        });

        nasFabGestureLayer.addEventListener("contextmenu", function (event) {
            nasStopGestureEvent(event);
        }, { capture: true });

        nasFabGestureLayer.addEventListener("click", function (event) {
            nasStopGestureEvent(event);
        }, { capture: true });

        document.documentElement.appendChild(nasFabHost);
    }

    function prepareNasFab() {
        if (document.documentElement) {
            createNasFab();
            return;
        }

        const observer = new MutationObserver(() => {
            if (!document.documentElement) return;
            observer.disconnect();
            createNasFab();
        });

        observer.observe(document, {
            childList: true,
            subtree: true
        });
    }

    function resetNasPage() {
        nasMedia.clear();
        nasVideos.clear();

        if (nasPanel) {
            nasPanel.remove();
            nasPanel = null;
        }

        if (nasFabHost) {
            nasFabHost.style.display = "none";
        }

        if (nasFabBadge) {
            nasFabBadge.textContent = "0";
        }
    }

    function showNasFab(media) {
        createNasFab();

        const key = media.requestId || media.url;
        nasMedia.set(key, media);

        nasFabBadge.textContent = nasMedia.size;
        nasFabHost.style.display = "block";
    }

    chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
        if (chrome.runtime.lastError) { return; }

        if (Message.Message === "nasVideoDetected") {
            if (nasIsTopFrame) {

                // Sur la page descriptive HotMovies,
                // ignorer les médias provenant directement de la page principale.
                if (nasIsHotMoviesDescriptionPage && Message.sourceFrameId === 0) {
                    sendResponse("ignored");
                    return true;
                }

                showNasFab(Message.media);
            }

            sendResponse("ok");
            return true;
        }

        if (Message.Message === "nasResetPage") {
            if (nasIsTopFrame) {
                resetNasPage();
            }

            sendResponse("ok");
            return true;
        }

        // 获取页面视频对象
        if (Message.Message == "getVideoState") {
            let videoObj = [];
            let videoSrc = [];
            document.querySelectorAll("video, audio").forEach(function (video) {
                if (video.currentSrc != "" && video.currentSrc != undefined) {
                    videoObj.push(video);
                    videoSrc.push(video.currentSrc);
                }
            });
            const iframe = document.querySelectorAll("iframe");
            if (iframe.length > 0) {
                iframe.forEach(function (iframe) {
                    if (iframe.contentDocument == null) { return true; }
                    iframe.contentDocument.querySelectorAll("video, audio").forEach(function (video) {
                        if (video.currentSrc != "" && video.currentSrc != undefined) {
                            videoObj.push(video);
                            videoSrc.push(video.currentSrc);
                        }
                    });
                });
            }
            if (videoObj.length > 0) {
                if (videoObj.length !== _videoObj.length || videoSrc.toString() !== _videoSrc.toString()) {
                    _videoSrc = videoSrc;
                    _videoObj = videoObj;
                }
                Message.index = Message.index == -1 ? 0 : Message.index;
                const video = videoObj[Message.index];
                const timePCT = video.currentTime / video.duration * 100;
                sendResponse({
                    time: timePCT,
                    currentTime: video.currentTime,
                    duration: video.duration,
                    volume: video.volume,
                    count: _videoObj.length,
                    src: _videoSrc,
                    paused: video.paused,
                    loop: video.loop,
                    speed: video.playbackRate,
                    muted: video.muted,
                    type: video.tagName.toLowerCase(),
                    videoStatus: videoObj.map(v => v.paused ? 1 : 0)
                });
                return true;
            }
            sendResponse({ count: 0 });
            return true;
        }

        if (Message.Message === "nasHlsVariants") {
            if (nasIsHotMoviesDescriptionPage && Message.sourceFrameId === 0) {
                sendResponse("ignored");
                return true;
            }

            nasVideos.set(Message.masterUrl, {
                title: Message.title || "Vidéo",
                type: "HLS",
                masterUrl: Message.masterUrl,
                variants: Message.variants || [],
                duration: Message.duration || null,
                selected: -1,
                referer: Message.referer || "",
                cookie: Message.cookie || "",
            });

            applyNasDefaultSelections();
            updateNasFabCount();

            if (nasPanel) {
                renderNasPanel();
            }

            sendResponse("ok");
            return true;
        }

        function updateNasFabCount() {
            const count = nasVideos.size || nasMedia.size;

            if (nasFabBadge) {
                nasFabBadge.textContent = count;
            }
        }

        // 速度控制
        if (Message.Message == "speed") {
            if (_videoObj[Message.index]?.playbackRate !== undefined) {
                _videoObj[Message.index].playbackRate = Message.speed;
            }
            return true;
        }
        // 画中画
        if (Message.Message == "pip") {
            if (document.pictureInPictureElement) {
                try { document.exitPictureInPicture(); } catch (e) { return true; }
                sendResponse({ state: false });
                return true;
            }
            try { _videoObj[Message.index].requestPictureInPicture(); } catch (e) { return true; }
            sendResponse({ state: true });
            return true;
        }
        // 全屏
        if (Message.Message == "fullScreen") {
            if (document.fullscreenElement) {
                try { document.exitFullscreen(); } catch (e) { return true; }
                sendResponse({ state: false });
                return true;
            }
            setTimeout(function () {
                try { _videoObj[Message.index].requestFullscreen(); } catch (e) { return true; }
            }, 500);
            sendResponse({ state: true });
            return true;
        }
        // 播放
        if (Message.Message == "play") {
            _videoObj[Message.index]?.play();
            return true;
        }
        // 暂停
        if (Message.Message == "pause") {
            _videoObj[Message.index]?.pause();
            return true;
        }
        // 循环播放
        if (Message.Message == "loop") {
            if (_videoObj[Message.index]?.loop !== undefined) {
                _videoObj[Message.index].loop = Message.action;
            }
            return true;
        }
        // 设置音量
        if (Message.Message == "setVolume") {
            if (_videoObj[Message.index]?.volume !== undefined) {
                _videoObj[Message.index].volume = Message.volume;
            }
            sendResponse("ok");
            return true;
        }
        // 静音
        if (Message.Message == "muted") {
            if (_videoObj[Message.index]?.muted !== undefined) {
                _videoObj[Message.index].muted = Message.action;
            }
            return true;
        }
        // 设置视频进度
        if (Message.Message == "setTime") {
            if (_videoObj[Message.index]?.currentTime !== undefined && _videoObj[Message.index]?.duration !== undefined) {
                _videoObj[Message.index].currentTime = Message.time * _videoObj[Message.index].duration / 100;
            }
            sendResponse("ok");
            return true;
        }
        // 截图视频图片
        if (Message.Message == "screenshot") {
            try {
                let video = _videoObj[Message.index];
                let canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
                let link = document.createElement("a");
                link.href = canvas.toDataURL("image/jpeg");
                link.download = `${location.hostname}-${secToTime(video.currentTime)}.jpg`;
                link.click();
                canvas = null;
                link = null;
                sendResponse("ok");
                return true;
            } catch (e) { console.log(e); return true; }
        }
        if (Message.Message == "getKey") {
            sendResponse(Array.from(_key));
            return true;
        }
        if (Message.Message == "ffmpeg") {
            if (!Message.files) {
                window.postMessage(Message);
                sendResponse("ok");
                return true;
            }
            Message.quantity ??= Message.files.length;
            for (let item of Message.files) {
                const data = { ...Message, ...item };
                data.type = item.type ?? "video";
                if (data.data instanceof Blob) {
                    window.postMessage(data);
                } else {
                    fetch(data.data)
                        .then(response => response.blob())
                        .then(blob => {
                            data.data = blob;
                            window.postMessage(data);
                        });
                }
            }
            sendResponse("ok");
            return true;
        }

        if (Message.Message == "getPage") {
            if (Message.find) {
                const DOM = document.querySelector(Message.find);
                DOM ? sendResponse(DOM.innerHTML) : sendResponse("");
                return true;
            }
            sendResponse(document.documentElement.outerHTML);
            return true;
        }

        if (Message.Message == "getM3u8Text") {
            if (Message.url && m3u8Text.has(Message.url)) {
                sendResponse(m3u8Text.get(Message.url));
                return true;
            }
            sendResponse("");
            return true;
        }

        if (Message.Message == "getM3u8Cache") {
            fetch(Message.url, { method: "GET", cache: "force-cache" })
                .then(response => response.text())
                .then(text => sendResponse({ success: true, data: text }))
                .catch(() => sendResponse({ success: false, error: "Failed to fetch" }));
            return true;
        }
    });

    // Heart Beat
    var Port;
    function connect() {
        Port = chrome.runtime.connect(chrome.runtime.id, { name: "HeartBeat" });
        Port.postMessage("HeartBeat");
        Port.onMessage.addListener(function (message, Port) { return true; });
        Port.onDisconnect.addListener(connect);
    }
    connect();

    function secToTime(sec) {
        let time = "";
        let hour = Math.floor(sec / 3600);
        let min = Math.floor((sec % 3600) / 60);
        sec = Math.floor(sec % 60);
        if (hour > 0) { time = hour + "'"; }
        if (min < 10) { time += "0"; }
        time += min + "'";
        if (sec < 10) { time += "0"; }
        time += sec;
        return time;
    }
    const isFirefox = navigator.userAgent.includes('Firefox');
    const sendAddMedia = (data) => {
        chrome.runtime.sendMessage({
            Message: "addMedia",
            url: data.url,
            href: data.href ?? location.href,
            extraExt: data.ext,
            mime: data.mime,
            requestHeaders: { referer: data.referer },
            requestId: data.requestId
        });
    };
    window.addEventListener("message", (event) => {
        const action = ["catCatchAddMedia", "catCatchAddKey", "catCatchFFmpeg", "catCatchFFmpegResult", "catCatchCloseScript"];
        if (!event.data || !event.data.action || event.origin !== window.location.origin || !action.includes(event.data.action)) { return; }
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.data.action == "catCatchAddMedia") {
            if (!event.data.url) { return; }

            /*
             * firefox 不允许直接下载跨域blob内容
             * fetch获取文本内容并缓存到m3u8Text中，供 m3u8.html调用获取。
             */
            if (event.data.url.startsWith("blob:") && isFirefox) {
                fetch(event.data.url)
                    .then(response => response.text())
                    .then(text => {
                        m3u8Text.set(event.data.url, text);
                        sendAddMedia(event.data);
                    });
                return;
            }
            sendAddMedia(event.data);
        }
        if (event.data.action == "catCatchAddKey") {
            let key = event.data.key;
            if (key instanceof ArrayBuffer || key instanceof Array) {
                key = ArrayToBase64(key);
            }
            if (_key.has(key)) { return; }
            _key.add(key);
            chrome.runtime.sendMessage({
                Message: "send2local",
                action: "addKey",
                data: key,
            });
            chrome.runtime.sendMessage({
                Message: "popupAddKey",
                data: key,
                url: event.data.url,
            });
        }
        if (event.data.action == "catCatchFFmpeg") {
            if (!event.data.use ||
                !event.data.files ||
                !event.data.files instanceof Array ||
                event.data.files.length == 0
            ) { return; }
            event.data.title = event.data.title ?? document.title ?? new Date().getTime().toString();
            event.data.title = event.data.title.replaceAll('"', "").replaceAll("'", "").replaceAll(" ", "");
            let data = {
                Message: event.data.action,
                action: event.data.use,
                files: event.data.files,
                url: event.data.href ?? event.source.location.href,
            };
            data = { ...event.data, ...data };
            chrome.runtime.sendMessage(data);
        }
        if (event.data.action == "catCatchFFmpegResult") {
            if (!event.data.state || !event.data.tabId) { return; }
            chrome.runtime.sendMessage({ Message: "catCatchFFmpegResult", ...event.data });
        }
        if (event.data.action == "catCatchCloseScript") {
            if (!event.data.script || !event.isTrusted) { return; }
            chrome.runtime.sendMessage({ Message: "closeScript", ...event.data });
        }

    }, { capture: true });

    function ArrayToBase64(data) {
        try {
            let bytes = new Uint8Array(data);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            if (typeof _btoa == "function") {
                return _btoa(binary);
            }
            return btoa(binary);
        } catch (e) {
            return false;
        }
    }
})();