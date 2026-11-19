/**
 * Adaptador SCORM 1.2 compatible con Moodle y modo local MOCK_SCORM.
 * Busca recursivamente window.API en la jerarquía de ventanas (window, parent, opener).
 */
(function (global) {
    "use strict";

    var MAX_API_SEARCH_DEPTH = 100;
    var apiHandle = null;

    var initialState = {
        initialized: false,
        finished: false,
        mock: false,
        lastError: "0",
        cmi: {
            "cmi.core.lesson_status": "incomplete",
            "cmi.core.score.min": "0",
            "cmi.core.score.max": "100",
            "cmi.core.score.raw": ""
        },
        lastReport: null,
        history: []
    };

    global.__SCORM_STATE__ = initialState;

    function recordHistory(action, key, value) {
        global.__SCORM_STATE__.history.push({
            timestamp: new Date().toISOString(),
            action: action,
            key: key !== undefined ? key : null,
            value: value !== undefined ? value : null,
            mock: Boolean(global.MOCK_SCORM)
        });
    }

    /**
     * Búsqueda recursiva de la API SCORM 1.2 (window.API) recorriendo parent y opener.
     * @param {Window} win
     * @param {number} [depth]
     * @param {Array<Window>} [visited]
     * @returns {Object|null}
     */
    function findAPI(win, depth, visited) {
        var currentDepth = typeof depth === "number" ? depth : 0;
        var seen = Array.isArray(visited) ? visited : [];

        if (!win || currentDepth > MAX_API_SEARCH_DEPTH) {
            return null;
        }

        try {
            if (seen.indexOf(win) !== -1) {
                return null;
            }
            seen.push(win);
        } catch (err) {
            return null;
        }

        try {
            if (win.API !== undefined && win.API !== null) {
                return win.API;
            }
        } catch (err) {
            return null;
        }

        try {
            if (win.parent && win.parent !== win) {
                var parentApi = findAPI(win.parent, currentDepth + 1, seen);
                if (parentApi) {
                    return parentApi;
                }
            }
        } catch (err) {
            // Origen externo en parent; se continúa intentando con opener si existe.
        }

        try {
            if (win.opener && win.opener !== win) {
                var openerApi = findAPI(win.opener, currentDepth + 1, seen);
                if (openerApi) {
                    return openerApi;
                }
            }
        } catch (err) {
            // Origen externo en opener; sin acceso permitido.
        }

        return null;
    }

    function refreshAPIDiscovery() {
        apiHandle = findAPI(global);
        global.MOCK_SCORM = !apiHandle;
        global.__SCORM_STATE__.mock = global.MOCK_SCORM;
        return apiHandle;
    }

    function isScormTruthy(result) {
        return result === true || result === "true";
    }

    function scormInit() {
        var state = global.__SCORM_STATE__;
        if (state.initialized && !state.finished) {
            return true;
        }

        if (!apiHandle) {
            refreshAPIDiscovery();
        }

        if (!global.MOCK_SCORM && apiHandle) {
            try {
                var res = apiHandle.LMSInitialize("");
                var ok = isScormTruthy(res);
                state.initialized = ok;
                state.finished = false;
                if (typeof apiHandle.LMSGetLastError === "function") {
                    state.lastError = String(apiHandle.LMSGetLastError());
                }
                if (ok) {
                    var currentStatus = "";
                    try {
                        currentStatus = String(apiHandle.LMSGetValue("cmi.core.lesson_status") || "");
                    } catch (err) {
                        currentStatus = "";
                    }
                    if (!currentStatus || currentStatus === "not attempted") {
                        apiHandle.LMSSetValue("cmi.core.lesson_status", "incomplete");
                        state.cmi["cmi.core.lesson_status"] = "incomplete";
                    } else {
                        state.cmi["cmi.core.lesson_status"] = currentStatus;
                    }
                }
                recordHistory("LMSInitialize", "", String(ok));
                return ok;
            } catch (err) {
                state.lastError = "101";
                return false;
            }
        }

        global.MOCK_SCORM = true;
        state.mock = true;
        state.initialized = true;
        state.finished = false;
        if (!state.cmi["cmi.core.lesson_status"]) {
            state.cmi["cmi.core.lesson_status"] = "incomplete";
        }
        recordHistory("LMSInitialize", "", "true");
        console.info("[SCORM MOCK] LMSInitialize(\"\") -> \"true\"", {
            cmi: state.cmi
        });
        return true;
    }

    function scormSetValue(key, val) {
        var state = global.__SCORM_STATE__;
        if (!state.initialized && !state.finished) {
            scormInit();
        }

        var strKey = String(key);
        var strVal = val === undefined || val === null ? "" : String(val);
        state.cmi[strKey] = strVal;

        if (!global.MOCK_SCORM && apiHandle) {
            try {
                var res = apiHandle.LMSSetValue(strKey, strVal);
                var ok = isScormTruthy(res);
                if (typeof apiHandle.LMSGetLastError === "function") {
                    state.lastError = String(apiHandle.LMSGetLastError());
                }
                recordHistory("LMSSetValue", strKey, strVal);
                return ok;
            } catch (err) {
                state.lastError = "351";
                return false;
            }
        }

        recordHistory("LMSSetValue", strKey, strVal);
        console.info("[SCORM MOCK] LMSSetValue", strKey, "=", strVal);
        return true;
    }

    function scormGetValue(key) {
        var state = global.__SCORM_STATE__;
        if (!state.initialized && !state.finished) {
            scormInit();
        }

        var strKey = String(key);
        if (!global.MOCK_SCORM && apiHandle) {
            try {
                var rawVal = apiHandle.LMSGetValue(strKey);
                var strVal = rawVal === undefined || rawVal === null ? "" : String(rawVal);
                state.cmi[strKey] = strVal;
                if (typeof apiHandle.LMSGetLastError === "function") {
                    state.lastError = String(apiHandle.LMSGetLastError());
                }
                recordHistory("LMSGetValue", strKey, strVal);
                return strVal;
            } catch (err) {
                state.lastError = "301";
                return "";
            }
        }

        var mockVal = Object.prototype.hasOwnProperty.call(state.cmi, strKey)
            ? state.cmi[strKey]
            : "";
        recordHistory("LMSGetValue", strKey, mockVal);
        console.info("[SCORM MOCK] LMSGetValue", strKey, "->", mockVal);
        return mockVal;
    }

    function scormCommit() {
        var state = global.__SCORM_STATE__;
        if (!state.initialized && !state.finished) {
            scormInit();
        }

        if (!global.MOCK_SCORM && apiHandle) {
            try {
                var res = apiHandle.LMSCommit("");
                var ok = isScormTruthy(res);
                if (typeof apiHandle.LMSGetLastError === "function") {
                    state.lastError = String(apiHandle.LMSGetLastError());
                }
                recordHistory("LMSCommit", "", String(ok));
                return ok;
            } catch (err) {
                state.lastError = "101";
                return false;
            }
        }

        recordHistory("LMSCommit", "", "true");
        console.info("[SCORM MOCK] LMSCommit(\"\") -> \"true\"", {
            cmi: Object.assign({}, state.cmi)
        });
        return true;
    }

    function scormFinish() {
        var state = global.__SCORM_STATE__;
        if (state.finished) {
            return true;
        }
        if (!state.initialized) {
            return false;
        }

        if (!global.MOCK_SCORM && apiHandle) {
            try {
                apiHandle.LMSCommit("");
                var res = apiHandle.LMSFinish("");
                var ok = isScormTruthy(res);
                if (ok) {
                    state.finished = true;
                }
                if (typeof apiHandle.LMSGetLastError === "function") {
                    state.lastError = String(apiHandle.LMSGetLastError());
                }
                recordHistory("LMSFinish", "", String(ok));
                return ok;
            } catch (err) {
                state.lastError = "101";
                return false;
            }
        }

        state.finished = true;
        recordHistory("LMSFinish", "", "true");
        console.info("[SCORM MOCK] LMSFinish(\"\") -> \"true\"", {
            cmi: Object.assign({}, state.cmi)
        });
        return true;
    }

    /**
     * Reporta la calificación final (0-100) al LMS bajo SCORM 1.2.
     * @param {number} puntaje
     * @returns {{ score: number, status: string, mock: boolean }}
     */
    function reportarCalificacionSCORM(puntaje) {
        var numeric = Number(puntaje);
        if (!Number.isFinite(numeric)) {
            numeric = 0;
        }
        var score = Math.max(0, Math.min(100, Math.round(numeric)));
        var status = score >= 70 ? "passed" : "failed";

        scormSetValue("cmi.core.score.min", "0");
        scormSetValue("cmi.core.score.max", "100");
        scormSetValue("cmi.core.score.raw", String(score));
        scormSetValue("cmi.core.lesson_status", status);
        scormCommit();

        var report = {
            score: score,
            status: status,
            mock: Boolean(global.MOCK_SCORM)
        };
        global.__SCORM_STATE__.lastReport = report;

        if (global.MOCK_SCORM) {
            console.info("[SCORM MOCK] reportarCalificacionSCORM", report);
        }

        return report;
    }

    refreshAPIDiscovery();

    global.findAPI = findAPI;
    global.scormInit = scormInit;
    global.scormSetValue = scormSetValue;
    global.scormGetValue = scormGetValue;
    global.scormCommit = scormCommit;
    global.scormFinish = scormFinish;
    global.reportarCalificacionSCORM = reportarCalificacionSCORM;

    if (typeof global.addEventListener === "function") {
        global.addEventListener("beforeunload", function () {
            if (global.__SCORM_STATE__.initialized && !global.__SCORM_STATE__.finished) {
                scormFinish();
            }
        });
    }
})(window);
