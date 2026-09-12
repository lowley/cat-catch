(function () {
    if (window.top !== window) {
        return;
    }

    if (!location.href.toLowerCase().includes("newtab.html")) {
        return;
    }

    const style = document.createElement("style");
    style.textContent = `
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
    `;

    document.head.appendChild(style);
    document.title = "CatCatch";

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
                <div id="cc-bookmarks"><div class="cc-empty">Chargement…</div></div>
            </section>
        </main>
    `;

    const status = document.getElementById("cc-status");
    const bookmarks = document.getElementById("cc-bookmarks");

    document.getElementById("cc-download").addEventListener("click", function () {
        status.textContent = "Téléchargement…";
        chrome.runtime.sendMessage({ Message: "newTabDownloadCrx" }, function (response) {
            if (chrome.runtime.lastError || !response || !response.ok) {
                status.textContent = "Téléchargement impossible.";
                return;
            }
            status.textContent = "Téléchargement lancé.";
        });
    });

    chrome.runtime.sendMessage({ Message: "newTabGetBookmarks" }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok || !Array.isArray(response.tree)) {
            bookmarks.innerHTML = '<div class="cc-empty">Impossible de lire les favoris.</div>';
            return;
        }

        const groups = [];

        function collect(node, path) {
            if (!node || !node.children) {
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

        if (response.tree[0]) {
            collect(response.tree[0], []);
        }

        bookmarks.innerHTML = "";

        if (groups.length === 0) {
            bookmarks.innerHTML = '<div class="cc-empty">Aucun favori à afficher.</div>';
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
            bookmarks.appendChild(section);
        });
    });
})();
