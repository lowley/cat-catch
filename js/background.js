/**
 * chrome 使用v3 background.service_worker 加载模式
 * firefox 使用v2 background.scripts 加载模式
 * firefox 在 manifest 文件中已经加载以下脚本，如果已经加载 G 变量存在，不再加载。
 */
if (typeof G === 'undefined') {
    importScripts("/js/polyfill.js", "/js/function.js", "/js/templates.js", "/js/init.js");
}

// Service Worker 5分钟后会强制终止扩展
// https://bugs.chromium.org/p/chromium/issues/detail?id=1271154
// https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension/70003493#70003493
chrome.webNavigation.onBeforeNavigate.addListener(function () {
    return;
});

chrome.webNavigation.onHistoryStateUpdated.addListener(function (details) {
    if (details.frameId !== 0 || details.tabId <= 0) {
        return;
    }

    chrome.tabs.sendMessage(
        details.tabId,
        {
            Message: "nasResetPage"
        },
        { frameId: 0 },
        () => {
            void chrome.runtime.lastError;
        }
    );
});

chrome.runtime.onConnect.addListener(function (Port) {
    Port.onDisconnect = undefined;
    if (chrome.runtime.lastError || Port.name !== "HeartBeat") return;
    Port.postMessage("HeartBeat");
    Port.onMessage.addListener(function (message, Port) {
        return;
    });
    const interval = setInterval(function () {
        clearInterval(interval);
        Port.disconnect();
    }, 250000);
    Port.onDisconnect.addListener(function () {
        interval && clearInterval(interval);
        if (chrome.runtime.lastError) {
            return;
        }
    });
});
setInterval(chrome.runtime.getPlatformInfo, 25 * 1000);

// 全局变量
let debounce = undefined;
let debounceCount = 0;
let debounceTime = 0;
const reFilename = /filename="?([^"]+)"?/;

G.deepSearchTemporarilyClose = null; // 深度搜索临时变量
G.urlMap = new Map();   // url查重map
G.requestHeaders = new Map();   // 临时储存请求头
G.blackList = new Set();    // 正则屏蔽资源列表

/**
 *  定时任务
 *  nowClear clear 清理冗余数据
 *  save 保存数据
 */
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === "nowClear" || alarm.name === "clear") {
        clearRedundant();
        return;
    }
    if (alarm.name === "save") {
        (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
        return;
    }
    if (alarm.name === NAS_COMPLETION_ALARM) {
        pollNasCompletion();
        return;
    }
});

async function nasParseMaster(info) {
    try {
        const headers = {};

        if (info.requestHeaders) {
            for (const [key, value] of Object.entries(info.requestHeaders)) {
                if (value != null) {
                    headers[key] = value;
                }
            }
        }

        const response = await fetch(info.url, {
            method: "GET",
            headers: headers,
            credentials: "include"
        });

        if (!response.ok) {
            return;
        }

        const text = await response.text();
        const lines = text.split(/\r?\n/);

        const variants = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (!line.startsWith("#EXT-X-STREAM-INF:")) {
                continue;
            }

            const resolution = line.match(/RESOLUTION=(\d+x\d+)/i)?.[1] || "?";
            const bandwidth = line.match(/BANDWIDTH=(\d+)/i)?.[1];
            const averageBandwidth = line.match(/AVERAGE-BANDWIDTH=(\d+)/i)?.[1];

            let url = "";

            for (let j = i + 1; j < lines.length; j++) {
                const candidate = lines[j].trim();

                if (!candidate || candidate.startsWith("#")) {
                    continue;
                }

                url = new URL(candidate, info.url).href;
                break;
            }

            if (url) {
                variants.push({
                    resolution: resolution,
                    bandwidth: bandwidth ? Number(bandwidth) : null,
                    averageBandwidth: averageBandwidth ? Number(averageBandwidth) : null,
                    url: url
                });
            }
        }

        let duration = null;

        if (variants.length > 0) {
            try {
                const variantResponse = await fetch(variants[0].url, {
                    method: "GET",
                    headers: headers,
                    credentials: "include"
                });

                if (variantResponse.ok) {
                    const variantText = await variantResponse.text();

                    duration = 0;

                    for (const match of variantText.matchAll(/#EXTINF:([\d.]+)/g)) {
                        duration += Number(match[1]);
                    }

                    if (!duration) {
                        duration = null;
                    }
                }
            } catch (e) {
                duration = null;
            }
        }

        if (duration) {
            for (const variant of variants) {
                const bitrate = variant.averageBandwidth || variant.bandwidth;

                if (bitrate) {
                    variant.estimatedSize = duration * bitrate / 8;
                }
            }
        }

        chrome.tabs.sendMessage(
            info.tabId,
            {
                Message: "nasHlsVariants",
                sourceFrameId: info.frameId ?? 0,
                title: info.title,
                masterUrl: info.url,
                variants: variants,
                duration: duration,
                referer: info.requestHeaders?.referer || info.initiator || info.webUrl || "",
                cookie: info.cookie || "",
            },
            { frameId: 0 },
            () => {
                void chrome.runtime.lastError;
            }
        );

    } catch (e) {
        console.log("NAS master parse error", e);
    }
}

// onBeforeRequest 浏览器发送请求之前使用正则匹配发送请求的URL
// chrome.webRequest.onBeforeRequest.addListener(
//     function (data) {
//         try { findMedia(data, true); } catch (e) { console.log(e); }
//     }, { urls: ["<all_urls>"] }, ["requestBody"]
// );
// 保存requestHeaders
chrome.webRequest.onSendHeaders.addListener(
    function (data) {
        if (G && G.initSyncComplete && !G.enable) {
            return;
        }
        if (data.requestHeaders) {
            G.requestHeaders.set(data.requestId, data.requestHeaders);
            data.allRequestHeaders = data.requestHeaders;
        }
        try {
            findMedia(data, true);
        } catch (e) {
            console.log(e);
        }
    }, {urls: ["<all_urls>"]}, ['requestHeaders',
        chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS].filter(Boolean)
);
// onResponseStarted 浏览器接收到第一个字节触发，保证有更多信息判断资源类型
chrome.webRequest.onResponseStarted.addListener(
    function (data) {
        try {
            data.allRequestHeaders = G.requestHeaders.get(data.requestId);
            if (data.allRequestHeaders) {
                G.requestHeaders.delete(data.requestId);
            }
            findMedia(data);
        } catch (e) {
            console.log(e, data);
        }
    }, {urls: ["<all_urls>"]}, ["responseHeaders"]
);
// 删除失败的requestHeadersData
chrome.webRequest.onErrorOccurred.addListener(
    function (data) {
        G.requestHeaders.delete(data.requestId);
        G.blackList.delete(data.requestId);
    }, {urls: ["<all_urls>"]}
);

function findMedia(data, isRegex = false, filter = false, timer = false) {
    // Service Worker被强行杀死之后重新自我唤醒，等待全局变量初始化完成。
    if (!G || !G.initSyncComplete || !G.initLocalComplete || G.tabId == undefined || cacheData.init) {
        if (timer) {
            return;
        }
        setTimeout(() => {
            findMedia(data, isRegex, filter, true);
        }, 500);
        return;
    }

    if (G.damn && G.damnUrlSet.has(data.tabId)) {
        return;
    }

    /**
     * 以下情况不处理
     * 是否全局启用
     * 当前标签是否在屏蔽列表中
     * OPTIONS 请求不处理
     */
    const blockUrlFlag = data.tabId && data.tabId > 0 && G.blockUrlSet.has(data.tabId);
    if (!G.enable || (G.blockUrlWhite ? !blockUrlFlag : blockUrlFlag) || data?.method == "OPTIONS") {
        return;
    }

    data.getTime = Date.now();

    if (!isRegex && G.blackList.has(data.requestId)) {
        G.blackList.delete(data.requestId);
        return;
    }
    // 屏蔽特殊页面发起的资源
    if (data.initiator != "null" &&
        data.initiator != undefined &&
        isSpecialPage(data.initiator)) {
        return;
    }
    if (G.isFirefox &&
        data.originUrl &&
        isSpecialPage(data.originUrl)) {
        return;
    }
    // 屏蔽特殊页面的资源
    if (isSpecialPage(data.url)) {
        return;
    }
    const urlParsing = new URL(data.url);
    let [name, ext] = fileNameParse(urlParsing.pathname);

    //正则匹配
    if (isRegex && !filter) {
        for (let key in G.Regex) {
            if (!G.Regex[key].state) {
                continue;
            }
            G.Regex[key].regex.lastIndex = 0;
            let result = G.Regex[key].regex.exec(data.url);
            if (result == null) {
                continue;
            }
            if (G.Regex[key].blackList) {
                G.blackList.add(data.requestId);
                return;
            }
            data.extraExt = G.Regex[key].ext ? G.Regex[key].ext : undefined;
            if (result.length == 1) {
                findMedia(data, true, true);
                return;
            }
            result.shift();
            result = result.map(str => decodeURIComponent(str));
            if (!result[0].startsWith('https://') && !result[0].startsWith('http://')) {
                result[0] = urlParsing.protocol + "//" + data.url;
            }
            data.url = result.join("");
            findMedia(data, true, true);
            return;
        }
        return;
    }

    // 非正则匹配
    if (!isRegex) {
        // 获取头部信息
        data.header = getResponseHeadersValue(data);
        //检查后缀
        if (!filter && ext != undefined) {
            filter = CheckExtension(ext, data.header?.size);
            if (filter == "break") {
                return;
            }
        }
        //检查类型
        if (!filter && data.header?.type != undefined) {
            filter = CheckType(data.header.type, data.header?.size);
            if (filter == "break") {
                return;
            }
        }
        //查找附件
        if (!filter && data.header?.attachment != undefined) {
            const res = data.header.attachment.match(reFilename);
            if (res && res[1]) {
                [name, ext] = fileNameParse(decodeURIComponent(res[1]));
                filter = CheckExtension(ext, 0);
                if (filter == "break") {
                    return;
                }
            }
        }
        //放过类型为media的资源
        if (data.type == "media") {
            filter = true;
        }
    }

    if (!filter) {
        return;
    }

    // 谜之原因 获取得资源 tabId可能为 -1 firefox中则正常
    // 检查是 -1 使用当前激活标签得tabID
    data.tabId = data.tabId == -1 ? G.tabId : data.tabId;

    cacheData[data.tabId] ??= [];
    cacheData[G.tabId] ??= [];

    // 缓存数据大于9999条 清空缓存 避免内存占用过多
    if (cacheData[data.tabId].length > G.maxLength) {
        cacheData[data.tabId] = [];
        (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
        return;
    }

    // 查重 避免CPU占用 大于500 强制关闭查重
    // if (G.checkDuplicates && cacheData[data.tabId].length <= 500) {
    //     for (let item of cacheData[data.tabId]) {
    //         if (item.url.length == data.url.length &&
    //             item.cacheURL.pathname == urlParsing.pathname &&
    //             item.cacheURL.host == urlParsing.host &&
    //             item.cacheURL.search == urlParsing.search) { return; }
    //     }
    // }

    if (G.checkDuplicates && cacheData[data.tabId].length <= 500) {
        const tabFingerprints = G.urlMap.get(data.tabId) || new Set();
        if (tabFingerprints.has(data.url)) {
            return; // 找到重复，直接返回
        }
        tabFingerprints.add(data.url);
        G.urlMap.set(data.tabId, tabFingerprints);
        if (tabFingerprints.size >= 500) {
            tabFingerprints.clear();
        }
    }

    chrome.tabs.get(data.tabId, async function (webInfo) {
        if (chrome.runtime.lastError) {
            return;
        }
        data.requestHeaders = getRequestHeaders(data);
        // requestHeaders 中cookie 单独列出来
        if (data.requestHeaders?.cookie) {
            data.cookie = data.requestHeaders.cookie;
            data.requestHeaders.cookie = undefined;
        }
        const info = {
            name: name,
            url: data.url,
            size: data.header?.size,
            ext: ext,
            type: data.mime ?? data.header?.type,
            tabId: data.tabId,
            frameId: data.frameId ?? 0,
            isRegex: isRegex,
            requestId: data.requestId ?? Date.now().toString(),
            initiator: data.initiator,
            requestHeaders: data.requestHeaders,
            cookie: data.cookie,
            // cacheURL: { host: urlParsing.host, search: urlParsing.search, pathname: urlParsing.pathname },
            getTime: data.getTime
        };

        // 不存在扩展使用类型
        if (info.ext === undefined && info.type !== undefined) {
            info.ext = info.type.split("/")[1];
        }
        // 正则匹配的备注扩展
        if (data.extraExt) {
            info.ext = data.extraExt;
        }
        // 不存在 initiator 和 referer 使用web url代替initiator
        if (info.initiator == undefined || info.initiator == "null") {
            info.initiator = info.requestHeaders?.referer ?? webInfo?.url;
        }
        // 装载页面信息
        info.title = webInfo?.title ?? "NULL";
        info.favIconUrl = webInfo?.favIconUrl;
        info.webUrl = webInfo?.url;
        // 屏蔽资源

        if (!isRegex && G.blackList.has(data.requestId)) {
            G.blackList.delete(data.requestId);
            return;
        }

        const nasExt = String(info.ext ?? "").toLowerCase();
        const nasType = String(info.type ?? "").toLowerCase();
        const nasUrl = String(info.url ?? "").toLowerCase();

        const nasIsVideo =
            nasExt === "mp4" ||
            nasExt === "m3u8" ||
            nasExt === "m3u" ||
            nasExt.includes("mpegurl") ||
            nasType === "video/mp4" ||
            nasType.includes("mpegurl") ||
            /\.mp4(?:$|[?#])/.test(nasUrl) ||
            /\.m3u8?(?:$|[?#])/.test(nasUrl);

        if (nasIsVideo) {
            const result = chrome.tabs.sendMessage(
                info.tabId,
                {
                    Message: "nasVideoDetected",
                    sourceFrameId: info.frameId,
                    media: {
                        requestId: info.requestId,
                        url: info.url,
                        ext: String(info.ext ?? "").toLowerCase(),
                        type: info.type,
                        title: info.title,
                        size: info.size
                    }
                },
                {frameId: 0},
                () => {
                    void chrome.runtime.lastError;
                }
            );

            if (nasUrl.includes("master.m3u8")) {
                nasParseMaster(info);
            }
        }

        // 发送到popup 并检查自动下载
        chrome.runtime.sendMessage({Message: "popupAddData", data: info}, function () {
            if (G.featAutoDownTabId.size > 0 && G.featAutoDownTabId.has(info.tabId) && chrome.downloads?.State) {
                try {
                    const downDir = info.title == "NULL" ? "CatCatch/" : stringModify(info.title) + "/";
                    let fileName = isEmpty(info.name) ? stringModify(info.title) + '.' + info.ext : decodeURIComponent(stringModify(info.name));
                    if (G.TitleName) {
                        fileName = filterFileName(templates(G.downFileName, info));
                    } else {
                        fileName = downDir + fileName;
                    }
                    chrome.downloads.download({
                        url: info.url,
                        filename: fileName
                    });
                } catch (e) {
                    return;
                }
            }
            if (chrome.runtime.lastError) {
                return;
            }
        });

        // 数据发送
        if (G.send2local) {
            try {
                send2local("catch", {...info, requestHeaders: data.allRequestHeaders}, info.tabId);
            } catch (e) {
                console.log(e);
            }
        }

        // 储存数据
        cacheData[info.tabId] ??= [];
        cacheData[info.tabId].push(info);

        // 当前标签媒体数量大于100 开启防抖 等待5秒储存 或 积累10个资源储存一次。
        if (cacheData[info.tabId].length >= 100 && debounceCount <= 10) {
            debounceCount++;
            clearTimeout(debounce);
            debounce = setTimeout(function () {
                save(info.tabId);
            }, 5000);
            return;
        }
        // 时间间隔小于500毫秒 等待2秒储存
        if (Date.now() - debounceTime <= 500) {
            clearTimeout(debounce);
            debounceTime = Date.now();
            debounce = setTimeout(function () {
                save(info.tabId);
            }, 2000);
            return;
        }
        save(info.tabId);
    });
}

// cacheData数据 储存到 chrome.storage.local
function save(tabId) {
    clearTimeout(debounce);
    debounceTime = Date.now();
    debounceCount = 0;
    if (cacheData[tabId]) {
        // 单个标签数据超过99条 不再保存到storage
        if (cacheData[tabId]?.length <= 99) {
            (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData}, function () {
                chrome.runtime.lastError && console.log(chrome.runtime.lastError);
            });
        }
        SetIcon({number: cacheData[tabId].length, tabId: tabId});
    }
}

/**
 * 监听 扩展 message 事件
 */
const VIDAEXO_BASE_URL = "http://127.0.0.1:8765";
const NAS_BASE_URL = "http://10.0.0.1:9876";
const NAS_COMPLETION_ALARM = "vidaexoNasCompletionWatch";
const NAS_PENDING_JOBS_KEY = "vidaexoNasPendingJobs";

async function loadNasPendingJobs() {
    const data = await chrome.storage.session.get(NAS_PENDING_JOBS_KEY);
    return data[NAS_PENDING_JOBS_KEY] || {};
}

async function saveNasPendingJobs(entries) {
    await chrome.storage.session.set({
        [NAS_PENDING_JOBS_KEY]: entries
    });
}

async function scheduleNasCompletionWatch() {
    chrome.alarms.create(NAS_COMPLETION_ALARM, {
        when: Date.now() + 5000
    });
}

async function rememberNasPendingJob(jobId, pendingId) {
    const entries = await loadNasPendingJobs();
    entries[jobId] = { pendingId };
    await saveNasPendingJobs(entries);
    await scheduleNasCompletionWatch();
}

async function pollNasCompletion() {
    const entries = await loadNasPendingJobs();
    const jobIds = Object.keys(entries);

    if (jobIds.length === 0) {
        chrome.alarms.clear(NAS_COMPLETION_ALARM);
        return;
    }

    try {
        const response = await fetch(NAS_BASE_URL + "/api/status", {
            cache: "no-store"
        });

        if (!response.ok) {
            await scheduleNasCompletionWatch();
            return;
        }

        const payload = await response.json();
        const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
        let changed = false;

        for (const jobId of jobIds) {
            const tracked = entries[jobId];
            const job = jobs.find(item => item?.id === jobId);

            if (!job) {
                continue;
            }

            if (job.status === "done") {
                const completed = await vidaexoRequest("/videos/complete", {
                    method: "POST",
                    body: JSON.stringify({
                        pendingId: tracked.pendingId,
                        nasPath: job.output || "",
                        currentFilename: job.file || ""
                    })
                });

                if (completed.ok) {
                    delete entries[jobId];
                    changed = true;
                }
            } else if (job.status === "error") {
                await vidaexoRequest("/videos/pending/cancel", {
                    method: "POST",
                    body: JSON.stringify({
                        pendingId: tracked.pendingId
                    })
                });

                delete entries[jobId];
                changed = true;
            }
        }

        if (changed) {
            await saveNasPendingJobs(entries);
        }
    } catch (_) {
        // Le prochain réveil réessaiera.
    }

    if (Object.keys(await loadNasPendingJobs()).length > 0) {
        await scheduleNasCompletionWatch();
    }
}

async function vidaexoRequest(path, options = {}) {
    try {
        const response = await fetch(VIDAEXO_BASE_URL + path, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }

        return {
            ok: response.ok,
            status: response.status,
            data: data
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            error: String(error)
        };
    }
}

async function ensureVidaexoStarted() {
    const health = await vidaexoRequest("/health");

    if (health.ok) {
        return {
            ok: true,
            alreadyRunning: true,
            health: health
        };
    }

    return {
        ok: false,
        requiresLaunch: true,
        error: "VIDAEXO_NOT_RESPONDING"
    };
}

chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
    if (chrome.runtime.lastError) {
        return;
    }

    if (Message.Message === "vidaexoEnsureStarted") {
        ensureVidaexoStarted().then(sendResponse);
        return true;
    }

    if (Message.Message === "vidaexoHealth") {
        vidaexoRequest("/health").then(sendResponse);
        return true;
    }

    if (Message.Message === "vidaexoGetCorrectionState") {
        vidaexoRequest("/catalog/state").then(sendResponse);
        return true;
    }

    if (Message.Message === "vidaexoGetCatalogStatus") {
        vidaexoRequest("/catalog/status").then(sendResponse);
        return true;
    }

    if (Message.Message === "newTabGetBookmarks") {
        chrome.bookmarks.getTree().then(
            tree => sendResponse({ ok: true, tree }),
            error => sendResponse({ ok: false, error: String(error) })
        );
        return true;
    }

    if (Message.Message === "newTabDownloadCrx") {
        chrome.storage.local.get("newTabCrxUrl").then(settings => {
            const url = settings.newTabCrxUrl || "http://10.0.0.1:9876/catcatch-nas.bin";

            return chrome.downloads.download({
                url,
                filename: "catcatch-nas.crx",
                saveAs: false
            });
        }).then(
            downloadId => sendResponse({ ok: true, downloadId }),
            error => sendResponse({ ok: false, error: String(error) })
        );

        return true;
    }

    if (Message.Message === "newTabAddFavorite") {
        chrome.storage.local.get("newTabHomeUrl").then(settings => {
            const homeUrl = settings.newTabHomeUrl || "http://127.0.0.1:8080/newtab.html";
            const url = new URL(homeUrl);
            url.searchParams.set("addUrl", Message.url || "");
            url.searchParams.set("addTitle", Message.title || Message.url || "");
            return chrome.tabs.create({ url: url.href, active: true });
        }).then(
            tab => sendResponse({ ok: true, tabId: tab?.id ?? null }),
            error => sendResponse({ ok: false, error: String(error) })
        );

        return true;
    }

    if (Message.Message === "vidaexoStartCatalog") {
        (async () => {
            const started = await ensureVidaexoStarted();
            if (!started.ok) {
                sendResponse(started);
                return;
            }

            const configured = started.health?.data?.configured === true;

            if (!configured && !Message.actressesFolderId && !Message.subjectsFolderId) {
                sendResponse({
                    ok: false,
                    requiresConfiguration: true,
                    error: "CATALOG_FOLDERS_NOT_CONFIGURED"
                });
                return;
            }

            const payload = {};
            if (Message.actressesFolderId) {
                payload.actressesFolderId = Message.actressesFolderId;
            }
            if (Message.subjectsFolderId) {
                payload.subjectsFolderId = Message.subjectsFolderId;
            }

            const result = await vidaexoRequest("/catalog/start", {
                method: "POST",
                body: JSON.stringify(payload)
            });

            sendResponse(result);
        })();

        return true;
    }

    if (Message.Message === "vidaexoCorrectActress") {
        vidaexoRequest("/catalog/correct/actress", {
            method: "POST",
            body: JSON.stringify({
                directoryId: Message.directoryId,
                correctedName: Message.correctedName
            })
        }).then(sendResponse);
        return true;
    }

    if (Message.Message === "vidaexoCorrectSubject") {
        vidaexoRequest("/catalog/correct/subject", {
            method: "POST",
            body: JSON.stringify({
                directoryId: Message.directoryId,
                correctedName: Message.correctedName
            })
        }).then(sendResponse);
        return true;
    }

    if (Message.Message === "vidaexoDeleteInvalid") {
        vidaexoRequest("/catalog/delete", {
            method: "POST",
            body: JSON.stringify({
                directoryId: Message.directoryId,
                kind: Message.kind
            })
        }).then(sendResponse);
        return true;
    }

    if (Message.Message === "vidaexoRegisterVideo") {
        vidaexoRequest("/videos/register", {
            method: "POST",
            body: JSON.stringify(Message.videoRecord || {})
        }).then(sendResponse);
        return true;
    }
    if (!G.initLocalComplete || !G.initSyncComplete) {
        sendResponse("error");
        return true;
    }
    // 以下检查是否有 tabId 不存在使用当前标签
    Message.tabId = Message.tabId ?? G.tabId;

    if (Message.Message === "nasSendToServer") {
        (async () => {
            let pendingId = null;
            let pendingVideo = Message.pendingVideo || null;

            if (Message.namingRequest) {
                const naming = await vidaexoRequest("/videos/naming", {
                    method: "POST",
                    body: JSON.stringify({
                        html: Message.namingRequest.html || "",
                        initialName: Message.namingRequest.initialName || ""
                    })
                });

                if (!naming.ok || !naming.data?.targetName) {
                    sendResponse({
                        ok: false,
                        nasOk: false,
                        namingOk: false,
                        vidaexo: naming
                    });
                    return;
                }

                Message.data.filename = naming.data.targetName;

                pendingVideo = {
                    sourceUrl: Message.namingRequest.sourceUrl || null,
                    originalFilename: Message.namingRequest.initialName,
                    targetName: naming.data.targetName,
                    catalogEntities: naming.data.catalogEntities || []
                };
            }

            if (pendingVideo) {
                const pending = await vidaexoRequest("/videos/pending", {
                    method: "POST",
                    body: JSON.stringify(pendingVideo)
                });

                if (!pending.ok || !pending.data?.id) {
                    sendResponse({
                        ok: false,
                        nasOk: false,
                        pendingSaved: false,
                        vidaexo: pending
                    });
                    return;
                }

                pendingId = pending.data.id;
            }

            try {
                const response = await fetch(NAS_BASE_URL + "/download", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(Message.data)
                });

                const text = await response.text();
                let nasPayload = null;

                try {
                    nasPayload = JSON.parse(text);
                } catch (_) {
                    nasPayload = null;
                }

                if (!response.ok) {
                    if (pendingId) {
                        await vidaexoRequest("/videos/pending/cancel", {
                            method: "POST",
                            body: JSON.stringify({ pendingId })
                        });
                    }

                    sendResponse({
                        ok: false,
                        nasOk: false,
                        pendingSaved: Boolean(pendingId),
                        status: response.status,
                        text
                    });
                    return;
                }

                if (pendingId && nasPayload?.job) {
                    await rememberNasPendingJob(nasPayload.job, pendingId);
                }

                sendResponse({
                    ok: true,
                    nasOk: true,
                    pendingSaved: Boolean(pendingId),
                    pendingId,
                    job: nasPayload?.job || null,
                    status: response.status,
                    text
                });
            } catch (error) {
                if (pendingId) {
                    await vidaexoRequest("/videos/pending/cancel", {
                        method: "POST",
                        body: JSON.stringify({ pendingId })
                    });
                }

                sendResponse({
                    ok: false,
                    nasOk: false,
                    pendingSaved: false,
                    error: String(error)
                });
            }
        })();

        return true;
    }

    if (Message.Message === "nasOpenStatus") {
        const originTabId = sender.tab?.id;
        const originUrl = sender.tab?.url || "";

        chrome.tabs.create({
            url: "http://10.0.0.1:9876/status",
            active: true,
            openerTabId: originTabId
        }, function (statusTab) {
            if (statusTab?.id && originTabId) {
                const key = "nasStatusOrigin_" + statusTab.id;

                chrome.storage.session.set({
                    [key]: {
                        tabId: originTabId,
                        url: originUrl
                    }
                });
            }
        });

        sendResponse("ok");
        return true;
    }

    if (Message.Message === "nasCloseStatus") {
        const statusTabId = sender.tab?.id;

        if (!statusTabId) {
            sendResponse("error");
            return true;
        }

        const key = "nasStatusOrigin_" + statusTabId;

        chrome.storage.session.get(key, function (data) {
            const origin = data[key];

            if (!origin) {
                chrome.tabs.remove(statusTabId);
                return;
            }

            chrome.tabs.get(origin.tabId, function (tab) {
                if (!chrome.runtime.lastError && tab) {
                    chrome.tabs.update(origin.tabId, { active: true });

                    if (tab.windowId !== undefined) {
                        chrome.windows.update(tab.windowId, { focused: true });
                    }

                    chrome.tabs.remove(statusTabId);
                    chrome.storage.session.remove(key);
                    return;
                }

                if (origin.url) {
                    chrome.tabs.create({
                        url: origin.url,
                        active: true
                    }, function () {
                        chrome.tabs.remove(statusTabId);
                        chrome.storage.session.remove(key);
                    });
                } else {
                    chrome.tabs.remove(statusTabId);
                    chrome.storage.session.remove(key);
                }
            });
        });

        sendResponse("ok");
        return true;
    }

    // 从缓存中保存数据到本地
    if (Message.Message == "pushData") {
        (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
        sendResponse("ok");
        return true;
    }
    // 获取所有数据
    if (Message.Message == "getAllData") {
        sendResponse(cacheData);
        return true;
    }
    /**
     * 设置扩展图标数字
     * 提供 type 删除标签为 tabId 的数字
     * 不提供type 删除所有标签的数字
     */
    if (Message.Message == "ClearIcon") {
        Message.type ? SetIcon({tabId: Message.tabId}) : SetIcon();
        sendResponse("ok");
        return true;
    }
    // 启用/禁用扩展
    if (Message.Message == "enable") {
        G.enable = !G.enable;
        chrome.storage.sync.set({enable: G.enable});
        chrome.action.setIcon({path: G.enable ? "/img/icon.png" : "/img/icon-disable.png"});
        sendResponse(G.enable);
        return true;
    }
    /**
     * 提供requestId数组 获取指定的数据
     */
    if (Message.Message == "getData" && Message.requestId) {
        // 判断Message.requestId是否数组
        if (!Array.isArray(Message.requestId)) {
            Message.requestId = [Message.requestId];
        }
        const response = [];
        if (Message.requestId.length) {
            for (let item in cacheData) {
                for (let data of cacheData[item]) {
                    if (Message.requestId.includes(data.requestId)) {
                        response.push(data);
                    }
                }
            }
        }
        sendResponse(response.length ? response : "error");
        return true;
    }
    /**
     * 提供 tabId 获取该标签数据
     */
    if (Message.Message == "getData") {
        sendResponse(cacheData[Message.tabId]);
        return true;
    }
    /**
     * 获取各按钮状态
     * 模拟手机 自动下载 启用 以及各种脚本状态
     */
    if (Message.Message == "getButtonState") {
        let state = {
            MobileUserAgent: G.featMobileTabId.has(Message.tabId),
            AutoDown: G.featAutoDownTabId.has(Message.tabId),
            enable: G.enable,
        }
        G.scriptList.forEach(function (item, key) {
            state[item.key] = item.tabId.has(Message.tabId);
        });
        sendResponse(state);
        return true;
    }
    // 对tabId的标签 进行模拟手机操作
    if (Message.Message == "mobileUserAgent") {
        mobileUserAgent(Message.tabId, !G.featMobileTabId.has(Message.tabId));
        chrome.tabs.reload(Message.tabId, {bypassCache: true});
        sendResponse("ok");
        return true;
    }
    // 对tabId的标签 开启 关闭 自动下载
    if (Message.Message == "autoDown") {
        if (G.featAutoDownTabId.has(Message.tabId)) {
            G.featAutoDownTabId.delete(Message.tabId);
        } else {
            G.featAutoDownTabId.add(Message.tabId);
        }
        (chrome.storage.session ?? chrome.storage.local).set({featAutoDownTabId: Array.from(G.featAutoDownTabId)});
        sendResponse("ok");
        return true;
    }
    // 对tabId的标签 脚本注入或删除
    if (Message.Message == "script") {
        if (G.damn && G.damnUrlSet.has(Message.tabId)) {
            return;
        }
        if (!G.scriptList.has(Message.script)) {
            sendResponse("error no exists");
            return false;
        }
        const script = G.scriptList.get(Message.script);
        const scriptTabid = script.tabId;
        const refresh = Message.refresh ?? script.refresh;
        if (scriptTabid.has(Message.tabId)) {
            scriptTabid.delete(Message.tabId);
            if (Message.script == "search.js") {
                G.deepSearchTemporarilyClose = Message.tabId;
            }
            refresh && chrome.tabs.reload(Message.tabId, {bypassCache: true});
            sendResponse("ok");
            return true;
        }
        scriptTabid.add(Message.tabId);
        if (refresh) {
            chrome.tabs.reload(Message.tabId, {bypassCache: true});
        } else {
            const files = [`catch-script/${Message.script}`];
            script.i18n && files.unshift("catch-script/i18n.js");
            chrome.scripting.executeScript({
                target: {tabId: Message.tabId, allFrames: script.allFrames},
                files: files,
                injectImmediately: true,
                world: script.world
            });
        }
        sendResponse("ok");
        return true;
    }
    // 脚本注入 脚本申请多语言文件
    if (Message.Message == "scriptI18n") {
        chrome.scripting.executeScript({
            target: {tabId: Message.tabId, allFrames: true},
            files: ["catch-script/i18n.js"],
            injectImmediately: true,
            world: "MAIN"
        });
        sendResponse("ok");
        return true;
    }
    // Heart Beat
    if (Message.Message == "HeartBeat") {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                G.tabId = tabs[0].id;
            }
        });
        sendResponse("HeartBeat OK");
        return true;
    }
    // 清理数据
    if (Message.Message == "clearData") {
        // 当前标签
        if (Message.type) {
            delete cacheData[Message.tabId];
            (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
            clearRedundant();
            sendResponse("OK");
            return true;
        }
        // 其他标签
        for (let item in cacheData) {
            if (item == Message.tabId) {
                continue;
            }
            delete cacheData[item];
        }
        (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
        clearRedundant();
        sendResponse("OK");
        return true;
    }
    // 清理冗余数据
    if (Message.Message == "clearRedundant") {
        clearRedundant();
        sendResponse("OK");
        return true;
    }
    // 从 content-script 或 catch-script 传来的媒体url
    if (Message.Message == "addMedia") {
        chrome.tabs.query({}, function (tabs) {
            for (let item of tabs) {
                if (item.url == Message.href) {
                    findMedia({
                        url: Message.url,
                        tabId: item.id,
                        extraExt: Message.extraExt,
                        mime: Message.mime,
                        requestId: Message.requestId,
                        requestHeaders: Message.requestHeaders
                    }, true, true);
                    return true;
                }
            }
            findMedia({
                url: Message.url,
                tabId: -1,
                extraExt: Message.extraExt,
                mime: Message.mime,
                requestId: Message.requestId,
                initiator: Message.href,
                requestHeaders: Message.requestHeaders
            }, true, true);
        });
        sendResponse("ok");
        return true;
    }
    // ffmpeg网页通信
    if (Message.Message == "catCatchFFmpeg") {
        const data = {
            ...Message,
            Message: "ffmpeg",
            tabId: Message.tabId ?? sender.tab.id,
            version: G.ffmpegConfig.version
        };
        chrome.tabs.query({url: G.ffmpegConfig.url + "*"}, function (tabs) {
            if (chrome.runtime.lastError || !tabs.length) {
                chrome.tabs.create({url: G.ffmpegConfig.url, active: Message.active ?? true}, function (tab) {
                    if (chrome.runtime.lastError) {
                        return;
                    }
                    G.ffmpegConfig.tab = tab.id;
                    G.ffmpegConfig.cacheData.push(data);
                });
                return true;
            }
            if (tabs[0].status == "complete") {
                chrome.tabs.sendMessage(tabs[0].id, data);
            } else {
                G.ffmpegConfig.tab = tabs[0].id;
                G.ffmpegConfig.cacheData.push(data);
            }
        });
        sendResponse("ok");
        return true;
    }
    // 发送数据到本地
    if (Message.Message == "send2local" && G.send2local) {
        try {
            send2local(Message.action, Message.data, Message.tabId);
        } catch (e) {
            console.log(e);
        }
        sendResponse("ok");
        return true;
    }
    if (Message.Message == "damnUrlHas") {
        sendResponse(G.damnUrlSet.has(Message.tabId));
        return true;
    }
    if (Message.Message == "closeScript") {
        if (!Message.script || !G.scriptList.has(Message.script)) {
            sendResponse("error");
            return false;
        }
        const script = G.scriptList.get(Message.script);
        const scriptTabid = script.tabId;
        if (scriptTabid.has(Message.tabId)) {
            scriptTabid.delete(Message.tabId);
        }
        sendResponse("ok");
        return true;
    }
});

/**
 * 监听 外部扩展 message 事件
 */
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    if (request.action === "getData") {
        if (request.tabId) {
            sendResponse(cacheData[request.tabId] ?? null);
            return true;
        }
        sendResponse(cacheData);
        return true;
    } else if (request.action === "getCurrentTabData") {
        const tabId = request.tabId ?? G.tabId;
        sendResponse(cacheData[tabId] ?? null);
        return true;
    }
});

// 选定标签 更新G.tabId
// chrome.tabs.onHighlighted.addListener(function (activeInfo) {
//     if (activeInfo.windowId == -1 || !activeInfo.tabIds || !activeInfo.tabIds.length) { return; }
//     G.tabId = activeInfo.tabIds[0];
// });

/**
 * 监听 切换标签
 * 更新全局变量 G.tabId 为当前标签
 */
chrome.tabs.onActivated.addListener(function (activeInfo) {
    G.tabId = activeInfo.tabId;
    if (cacheData[G.tabId] !== undefined) {
        SetIcon({number: cacheData[G.tabId].length, tabId: G.tabId});
        return;
    }
    SetIcon({tabId: G.tabId});
});

// 切换窗口，更新全局变量G.tabId
chrome.windows.onFocusChanged.addListener(function (activeInfo) {
    if (activeInfo == -1) {
        return;
    }
    chrome.tabs.query({active: true, windowId: activeInfo}, function (tabs) {
        if (tabs[0] && tabs[0].id) {
            G.tabId = tabs[0].id;
        } else {
            G.tabId = -1;
        }
    });
});

/**
 * 监听 标签页面更新
 * 检查 清理数据
 * 检查 是否在屏蔽列表中
 */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (isSpecialPage(tab.url) || tabId <= 0 || !G.initSyncComplete) {
        return;
    }
    // console.log('onUpdated', tabId, changeInfo, tab);
    if (changeInfo.status && changeInfo.status == "loading" && G.autoClearMode == 2) {
        G.urlMap.delete(tabId);
        chrome.alarms.get("save", function (alarm) {
            if (!alarm) {
                delete cacheData[tabId];
                SetIcon({tabId: tabId});
                chrome.alarms.create("save", {when: Date.now() + 1000});
            }
        });
    }
    // 检查当前标签是否在屏蔽列表中
    if (changeInfo.url && tabId > 0) {
        if (G.blockUrl.length) {
            G.blockUrlSet.delete(tabId);
            if (isLockUrl(changeInfo.url)) {
                G.blockUrlSet.add(tabId);
            }
        }

        G.damnUrlSet.delete(tabId);
        if (isDamnUrl(changeInfo.url)) {
            G.damnUrlSet.add(tabId);
        }
    }
    chrome.sidePanel.setOptions({
        tabId,
        path: "popup.html?tabId=" + tabId
    });
});

/**
 * 监听 frame 正在载入
 * 检查 是否在屏蔽列表中 (frameId == 0 为主框架)
 * 检查 自动清理 (frameId == 0 为主框架)
 * 检查 注入脚本
 */
chrome.webNavigation.onCommitted.addListener(function (details) {
    if (isSpecialPage(details.url) || details.tabId <= 0 || !G.initSyncComplete) {
        return;
    }
    // console.log('onCommitted', details);

    // 刷新页面 检查是否在屏蔽列表中
    if (details.frameId == 0) {
        G.blockUrlSet.delete(details.tabId);
        if (isLockUrl(details.url)) {
            G.blockUrlSet.add(details.tabId);
        }

        G.damnUrlSet.delete(details.tabId);
        if (isDamnUrl(details.url)) {
            G.damnUrlSet.add(details.tabId);
        }
    }

    // 刷新清理角标数
    if (details.frameId == 0 && (!['auto_subframe', 'manual_subframe', 'form_submit'].includes(details.transitionType)) && G.autoClearMode == 1) {
        delete cacheData[details.tabId];
        G.urlMap.delete(details.tabId);
        (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
        SetIcon({tabId: details.tabId});
    }

    // chrome内核版本 102 以下不支持 chrome.scripting.executeScript API
    if (G.version < 102) {
        return;
    }

    if (!G.blockUrlSet.has(details.tabId) && G.deepSearch && G.deepSearchTemporarilyClose != details.tabId) {
        G.scriptList.get("search.js").tabId.add(details.tabId);
        G.deepSearchTemporarilyClose = null;
    }

    // catch-script 脚本
    G.scriptList.forEach(function (item, script) {
        if (!item.tabId.has(details.tabId) || !item.allFrames) {
            return true;
        }

        const files = [`catch-script/${script}`];
        item.i18n && files.unshift("catch-script/i18n.js");
        chrome.scripting.executeScript({
            target: {tabId: details.tabId, frameIds: [details.frameId]},
            files: files,
            injectImmediately: true,
            world: item.world
        });
    });

    // 模拟手机
    if (G.initLocalComplete && G.featMobileTabId.size > 0 && G.featMobileTabId.has(details.tabId)) {
        chrome.scripting.executeScript({
            args: [G.MobileUserAgent.toString()],
            target: {tabId: details.tabId, frameIds: [details.frameId]},
            func: function () {
                Object.defineProperty(navigator, 'userAgent', {value: arguments[0], writable: false});
            },
            injectImmediately: true,
            world: "MAIN"
        });
    }
});

/**
 * 监听 标签关闭 清理数据
 */
chrome.tabs.onRemoved.addListener(function (tabId) {
    // 清理缓存数据
    chrome.alarms.get("nowClear", function (alarm) {
        !alarm && chrome.alarms.create("nowClear", {when: Date.now() + 1000});
    });
    if (G.initSyncComplete) {
        G.blockUrlSet.has(tabId) && G.blockUrlSet.delete(tabId);
        G.damnUrlSet.has(tabId) && G.damnUrlSet.delete(tabId);
    }
});

// 右键菜单 和 快捷键 复用函数
const runCommands = (command, data) => {
    if (command == "auto_down") {
        if (G.featAutoDownTabId.has(G.tabId)) {
            G.featAutoDownTabId.delete(G.tabId);
        } else {
            G.featAutoDownTabId.add(G.tabId);
        }
        (chrome.storage.session ?? chrome.storage.local).set({featAutoDownTabId: Array.from(G.featAutoDownTabId)});
    } else if (command == "catch") {
        const scriptTabid = G.scriptList.get("catch.js").tabId;
        scriptTabid.has(G.tabId) ? scriptTabid.delete(G.tabId) : scriptTabid.add(G.tabId);
        chrome.tabs.reload(G.tabId, {bypassCache: true});
    } else if (command == "m3u8") {
        chrome.tabs.create({url: "m3u8.html"});
    } else if (command == "clear") {
        delete cacheData[G.tabId];
        (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
        clearRedundant();
        SetIcon({tabId: G.tabId});
    } else if (command == "enable") {
        G.enable = !G.enable;
        chrome.storage.sync.set({enable: G.enable});
        chrome.action.setIcon({path: G.enable ? "/img/icon.png" : "/img/icon-disable.png"});
    } else if (command == "reboot") {
        chrome.runtime.reload();
    } else if (command == "deepSearch") {
        const script = G.scriptList.get("search.js");
        const scriptTabid = script.tabId;
        if (scriptTabid.has(G.tabId)) {
            scriptTabid.delete(G.tabId);
            G.deepSearchTemporarilyClose = G.tabId;
            chrome.tabs.reload(G.tabId, {bypassCache: true});
            return;
        }
        scriptTabid.add(G.tabId);
        chrome.tabs.reload(G.tabId, {bypassCache: true});
    } else if (command == "preview") {
        chrome.tabs.create({url: `preview.html?tabId=${G.tabId}`});
    } else if (command == "image-save") {
        chrome.downloads.download({
            url: data.srcUrl,
            saveAs: G.saveAs
        }, () => {
            chrome.runtime.lastError && console.error(chrome.runtime.lastError);
            G.downDataImageSave = data;
        });
    }
}
chrome.downloads.onChanged.addListener(function (item) {
    if (G.catDownload) {
        delete G.downDataImageSave;
        return;
    }
    const errorList = ["SERVER_BAD_CONTENT", "SERVER_UNAUTHORIZED", "SERVER_FORBIDDEN", "SERVER_UNREACHABLE", "SERVER_CROSS_ORIGIN_REDIRECT", "SERVER_FAILED", "NETWORK_FAILED"];
    if (item.error && errorList.includes(item.error.current) && G.downDataImageSave) {
        const data = {
            requestHeaders: {referer: G.downDataImageSave.pageUrl},
            requestId: G.tabId,
            url: G.downDataImageSave.srcUrl
        };
        chrome.tabs.create({url: `downloader.html?JSON=${JSON.stringify(data)}&autoClose=true`, active: false});
        delete G.downDataImageSave;
    }
});

/**
 * 浏览器 扩展快捷键
 */
chrome.commands.onCommand.addListener(function (command) {
    runCommands(command);
});

/**
 * 监听 右键菜单事件
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
    runCommands(info.menuItemId, info);
});

/**
 * 监听 页面完全加载完成 判断是否在线ffmpeg页面
 * 如果是在线ffmpeg 则发送数据
 */
chrome.webNavigation.onCompleted.addListener(function (details) {
    if (G.ffmpegConfig.tab && details.tabId == G.ffmpegConfig.tab) {
        setTimeout(() => {
            G.ffmpegConfig.cacheData.forEach(data => {
                chrome.tabs.sendMessage(details.tabId, data);
            });
            G.ffmpegConfig.cacheData = [];
            G.ffmpegConfig.tab = 0;
        }, 500);
    }
});

// 操作符检查
function operatorCheck(size, Obj) {
    const unitNumber = {
        "B": 1,
        "BYTE": 1,
        "KB": 1024,
        "MB": 1048576,
        "GB": 1073741824
    };
    const unit = (Obj.unit || "B");
    const targetSize = Obj.size * (unitNumber[unit] || 1);
    switch (Obj.operator) {
        case "=":
            return size == targetSize;
        case "<":
            return size < targetSize;
        case ">":
            return size > targetSize;
        case "<=":
            return size <= targetSize;
        case ">=":
            return size >= targetSize;
        case "!=":
            return size != targetSize;
        case "~":
            return (Obj.min ? size >= Obj.min * (unitNumber[unit] || 1) : true) && (Obj.max ? size <= Obj.max * (unitNumber[unit] || 1) : true);
        default:
            return size <= targetSize;
    }
}

/**
 * 检查扩展名和大小
 * @param {String} ext
 * @param {Number} size
 * @returns {Boolean|String}
 */
function CheckExtension(ext, size) {
    const Ext = G.Ext.get(ext);
    if (!Ext) {
        return false;
    }
    if (!Ext.state) {
        return "break";
    }
    if (Ext.size != 0 && size != undefined && !operatorCheck(size, Ext)) {
        return "break";
    }
    return true;
}

/**
 * 检查类型和大小
 * @param {String} dataType
 * @param {Number} dataSize
 * @returns {Boolean|String}
 */
function CheckType(dataType, dataSize) {
    const typeInfo = G.Type.get(dataType.split("/")[0] + "/*") || G.Type.get(dataType);
    if (!typeInfo) {
        return false;
    }
    if (!typeInfo.state) {
        return "break";
    }
    if (typeInfo.size != 0 && dataSize != undefined && !operatorCheck(dataSize, typeInfo)) {
        return "break";
    }
    return true;
}

/**
 * 获取文件名及扩展名
 * @param {String} pathname
 * @returns {Array}
 */
function fileNameParse(pathname) {
    let fileName = decodeURI(pathname.split("/").pop());
    let ext = fileName.split(".");
    ext = ext.length == 1 ? undefined : ext.pop().toLowerCase();
    return [fileName, ext ? ext : undefined];
}

/**
 * 获取响应头信息
 * @param {Object} data
 * @returns {Object}
 */
function getResponseHeadersValue(data) {
    const header = {};
    if (data.responseHeaders == undefined || data.responseHeaders.length == 0) {
        return header;
    }
    for (let item of data.responseHeaders) {
        item.name = item.name.toLowerCase();
        if (item.name == "content-length") {
            header.size ??= parseInt(item.value);
        } else if (item.name == "content-type") {
            header.type = item.value.split(";")[0].toLowerCase();
        } else if (item.name == "content-disposition") {
            header.attachment = item.value;
        } else if (item.name == "content-range") {
            let size = item.value.split('/')[1];
            if (size !== '*') {
                header.size = parseInt(size);
            }
        }
    }
    return header;
}

/**
 * 获取请求头
 * @param {Object} data
 * @returns {Object|Boolean}
 */
const DIRECT_INCLUDE_HEADERS = new Set([
    "referer",
    "origin",
    "cookie",
    "authorization",
    "auth",
    "token",
    "key",
    "access-token",
    "api-key",
    "app-token",
    "authtoken",
    "session-id"
]);
const X_AUTH_KEYWORD_REG = /(auth|token|sign|key|ticket|session)/;

function getRequestHeaders(data) {
    if (!data?.allRequestHeaders?.length) {
        return false;
    }
    const header = {};
    for (let item of data.allRequestHeaders) {
        if (!item.name || !item.value) continue;
        const lowerName = item.name.toLowerCase();
        if (DIRECT_INCLUDE_HEADERS.has(lowerName)) {
            header[lowerName] = item.value;
            continue;
        }
        if (lowerName.startsWith("x-") && X_AUTH_KEYWORD_REG.test(lowerName)) {
            header[lowerName] = item.value;
        }
    }
    return Object.keys(header).length > 0 ? header : false;
}

//设置扩展图标
function SetIcon(obj) {
    if (obj?.number == 0 || obj?.number == undefined) {
        chrome.action.setBadgeText({text: "", tabId: obj?.tabId ?? G.tabId}, function () {
            if (chrome.runtime.lastError) {
                return;
            }
        });
        // chrome.action.setTitle({ title: "还没闻到味儿~", tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    } else if (G.badgeNumber) {
        obj.number = obj.number > 999 ? "999+" : obj.number.toString();
        chrome.action.setBadgeText({text: obj.number, tabId: obj.tabId}, function () {
            if (chrome.runtime.lastError) {
                return;
            }
        });
        // chrome.action.setTitle({ title: "抓到 " + obj.number + " 条鱼", tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    }
}

// 模拟手机端
function mobileUserAgent(tabId, change = false) {
    if (change) {
        G.featMobileTabId.add(tabId);
        (chrome.storage.session ?? chrome.storage.local).set({featMobileTabId: Array.from(G.featMobileTabId)});
        chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [tabId],
            addRules: [{
                "id": tabId,
                "action": {
                    "type": "modifyHeaders",
                    "requestHeaders": [{
                        "header": "User-Agent",
                        "operation": "set",
                        "value": G.MobileUserAgent
                    }]
                },
                "condition": {
                    "tabIds": [tabId],
                    "resourceTypes": Object.values(chrome.declarativeNetRequest.ResourceType)
                }
            }]
        });
        return true;
    }
    G.featMobileTabId.delete(tabId) && (chrome.storage.session ?? chrome.storage.local).set({featMobileTabId: Array.from(G.featMobileTabId)});
    chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [tabId]
    });
}

// 判断特殊页面
function isSpecialPage(url) {
    if (!url || url == "null") {
        return true;
    }
    return !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:"));
}

/**
 * 清理冗余数据
 */
function clearRedundant() {
    chrome.tabs.query({}, function (tabs) {
        const allTabId = new Set(tabs.map(tab => tab.id));

        if (!cacheData.init) {
            // 清理 缓存数据
            let cacheDataFlag = false;
            for (let key in cacheData) {
                if (!allTabId.has(Number(key))) {
                    cacheDataFlag = true;
                    delete cacheData[key];
                }
            }
            cacheDataFlag && (chrome.storage.session ?? chrome.storage.local).set({MediaData: cacheData});
        }

        // 清理
        G.urlMap.forEach((_, key) => {
            !allTabId.has(key) && G.urlMap.delete(key);
        });

        // 清理脚本
        G.scriptList.forEach(function (scriptList) {
            scriptList.tabId.forEach(function (tabId) {
                if (!allTabId.has(tabId)) {
                    scriptList.tabId.delete(tabId);
                }
            });
        });

        if (!G.initLocalComplete) {
            return;
        }

        // 清理 declarativeNetRequest 模拟手机
        chrome.declarativeNetRequest.getSessionRules(function (rules) {
            let mobileFlag = false;
            for (let item of rules) {
                if (item.condition.tabIds) {
                    // 如果tabIds列表都不存在 则删除该条规则
                    if (!item.condition.tabIds.some(id => allTabId.has(id))) {
                        mobileFlag = true;
                        item.condition.tabIds.forEach(id => G.featMobileTabId.delete(id));
                        chrome.declarativeNetRequest.updateSessionRules({
                            removeRuleIds: [item.id]
                        });
                    }
                } else if (item.id == 1) {
                    // 清理预览视频增加的请求头
                    chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [1]});
                }
            }
            mobileFlag && (chrome.storage.session ?? chrome.storage.local).set({featMobileTabId: Array.from(G.featMobileTabId)});
        });
        // 清理自动下载
        let autoDownFlag = false;
        G.featAutoDownTabId.forEach(function (tabId) {
            if (!allTabId.has(tabId)) {
                autoDownFlag = true;
                G.featAutoDownTabId.delete(tabId);
            }
        });
        autoDownFlag && (chrome.storage.session ?? chrome.storage.local).set({featAutoDownTabId: Array.from(G.featAutoDownTabId)});

        G.blockUrlSet = new Set([...G.blockUrlSet].filter(x => allTabId.has(x)));
        G.damnUrlSet = new Set([...G.damnUrlSet].filter(x => allTabId.has(x)));

        if (G.requestHeaders.size >= 10240) {
            G.requestHeaders.clear();
        }
    });
}

// 扩展升级，清空本地储存
chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason == "update") {
        chrome.storage.local.clear(function () {
            if (chrome.storage.session) {
                chrome.storage.session.clear(InitOptions);
            } else {
                InitOptions();
            }
        });
        chrome.alarms.create("nowClear", {when: Date.now() + 3000});
    }
    if (details.reason == "install") {
        chrome.tabs.create({url: "install.html"});
    }
});

// 测试
// chrome.storage.local.get(function (data) { console.log("storageLocal", data.MediaData) });
// chrome.storage.session.get(function (data) { console.log("storageSession", data.MediaData) });
// chrome.declarativeNetRequest.getSessionRules(function (rules) { console.log("sessionRules", rules); });
// chrome.tabs.query({}, function (tabs) { for (let item of tabs) { console.log("tabId", item.id); } });