(function () {
    if (window.top !== window) {
        return;
    }

    if (!location.href.toLowerCase().includes("newtab.html")) {
        return;
    }

    const banner = document.createElement("div");
    banner.id = "catcatch-newtab-test";
    banner.textContent = "CATCATCH — INJECTION OK";
    banner.style.position = "fixed";
    banner.style.top = "12px";
    banner.style.left = "12px";
    banner.style.zIndex = "2147483647";
    banner.style.padding = "12px 16px";
    banner.style.border = "2px solid #ff4040";
    banner.style.background = "#170000";
    banner.style.color = "#ff6666";
    banner.style.fontFamily = "Arial, sans-serif";
    banner.style.fontSize = "16px";
    banner.style.fontWeight = "700";
    banner.style.letterSpacing = "0.08em";
    banner.style.boxShadow = "0 0 18px rgba(255,64,64,.45)";
    document.body.appendChild(banner);

    const vidaexo = document.createElement("a");
    vidaexo.textContent = "VIDAEXO";
    vidaexo.href = "vidaexo://catalog/start";
    vidaexo.style.display = "inline-block";
    vidaexo.style.marginLeft = "14px";
    vidaexo.style.color = "#ffffff";
    vidaexo.style.textDecoration = "underline";
    banner.appendChild(vidaexo);
})();