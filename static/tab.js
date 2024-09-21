class Tab {
    constructor(browser, background = false) {
        this.browser = browser;

        this.tabEl = this.browser.chromeTabs.addTab({}, { background: true });
        this.browser.tabs.set(this.tabEl, this);

        this.iframe = document.createElement("iframe");
        this.iframe.title = "Tab Contents";
        this.iframe.classList.add("browserTabContents");
        this.iframe.style.setProperty("display", "none");
        this.browser.iFrameContainer.appendChild(this.iframe);

        this.currentUrl = '';
        this.currentTitle = '';
        this.currentFavi = '';
        this.isActive = false;
        this.isDevToolsActive = false;
        this.handleUnload();

        if (!background) this.browser.chromeTabs.setCurrentTab(this.tabEl);
    }

    reinjectTheme() {
        this.browser.extensions.injectThemeIntoFrame(this.currentUrl, this.iframe);
    }

    // Needed because you can't listen for DOMContentLoaded from an iframe across navigations
    handleUnload() {
        var self = this;
        setTimeout(() => {
            if (!self.iframe || !self.iframe.contentWindow) return;
            self.iframe.contentWindow.addEventListener("DOMContentLoaded", () => {
                self.handleOnload();
            });
            self.iframe.contentWindow.addEventListener("load", () => { self.browser.extensions.injectLoaded(self.currentUrl, self.iframe) });
            self.iframe.contentWindow.addEventListener("pagehide", () => { self.handleUnload() }); // s/unload/pagehide/
        }, 0);
    }

    handleOnload() {
        var url = this.iframe.contentWindow.location.toString();
        let urlEncoded = url;
        if (url == "about:blank") {
            return;
        }

        if (url.startsWith(this.browser.resourcesPrefix)) {
            url = url.replace(this.browser.resourcesPrefix, '');
            url = url.substring(0, url.length - 5);
            url = this.browser.resourcesProtocol + url;
        } else {
            url = url.replace(window.location.origin + baseUrlFor(this.browser.settings.getSetting("currentProxyId")), '')
            url = decodeUrl(url, this.browser.settings.getSetting("currentProxyId"));
            if (!url.startsWith("http") && !url.startsWith("https")) {
                this.handleHistoryBack();
                top.anura.dialog.confirm(`This website wants to open ${url}`).then((res) => {
                    if (res === true) {
                        top.anura.uri.handle(url);
                    }
                })
            }
        }
        this.currentUrl = url;

        this.browser.extensions.injectDOMContentLoaded(this.currentUrl, this.iframe);

        // get title of iframe
        var title = this.iframe.contentWindow.document.title;
        if (title == "") {
            title = url;
        }
        title = title.replace(decodeURIComponent(urlEncoded.split('/').slice(-1)), url);
        this.currentTitle = title;

        this.iframe.contentWindow.document.querySelectorAll("a").forEach((e) => {
            e.removeAttribute("target");
        });

        if (this.isActive) this.setBrowserAttributes();

        var self = this;
        (async (url) => {
            // get favicon of iframe
            var favi = null;
            if (url.startsWith(this.browser.resourcesProtocol)) {
                favi = getIconNoFallback(self.iframe.contentWindow.document);
            } else if (url != "") {
                var faviUrl = getIcon(self.iframe.contentWindow.document, new URL(url));
                console.debug(`checking for icon at "${window.location.origin + baseUrlFor("UV") + encodeUrl(faviUrl, "UV")}"`)
                var blob = await this.browser.bareClient.fetch(faviUrl).then((r) => r.blob())
                if (
                    blob != null &&
                    /* for sites that 200 and send some other non-image data instead of 404ing
                       LOOKING AT YOU, mercurywork.shop! seriously, what server does this??? */
                    blob.type.includes("image")
                ) {
                    favi = await blobToDataUrl(blob);
                }
            }

            console.debug("got favi: ", favi);

            if (favi == null) {
                console.debug("falling back to default icon");
                favi = this.browser.resourcesPrefix + "darkfavi.png";
            }

            if (url != this.browser.settings.getSetting("startUrl")) this.browser.history.push(url, title, favi);
            this.currentFavi = favi;

            // update tab
            self.browser.chromeTabs.updateTab(self.tabEl, {
                favicon: favi,
                title: title
            });
        })(url);
    }

    handleSwitchAway() {
        this.iframe.style.setProperty("display", "none");
        this.isActive = false;
    }

    handleSwitchTo() {
        this.isActive = true;
        this.browser.activeTab = this;
        this.iframe.style.removeProperty("display");
        this.setBrowserAttributes();
    }

    handleHistoryBack() {
        this.iframe.contentWindow.history.back();
    }

    handleHistoryForward() {
        this.iframe.contentWindow.history.forward();
    }

    handleReload() {
        this.iframe.contentWindow.location.reload();
    }

    handleClose() {
        this.iframe.remove();
    }
    async handleDevTools() {
        const iframeWindow = this.iframe.contentWindow;
        let state = this.isDevToolsActive;
        if (!iframeWindow.eruda) {
            iframeWindow.eval(await (await fetch('/libs/eruda.js')).text())
            this.isDevToolsActive = true;
            state = true;
        }

        if (!iframeWindow.eruda._isInit) iframeWindow.eruda.init();

        const btnBk = iframeWindow.eruda._entryBtn._$el[0].cloneNode(true);
        btnBk.style.display = "none";
        iframeWindow.eruda._entryBtn._$el[0].parentElement.replaceChild(
            btnBk,
            iframeWindow.eruda._entryBtn._$el[0]
        );
        btnBk.onclick = () => {
            btnBk.style.display = "none";
            iframeWindow.eruda.hide();
        };
        iframeWindow.eruda._entryBtn._$el[0] = btnBk;
        btnBk.setAttribute("style", "display: flex; position: fixed; bottom: 0; right: 0; margin-right: 20px; margin-bottom: 20px;")

        if (state) {
            btnBk.style.display = "flex";
            iframeWindow.eruda.show();
        } else {
            if (
                state !== undefined ||
                iframeWindow.eruda._shadowRoot.querySelector(".eruda-dev-tools").style
                    .display !== "none"
            ) {
                this.isDevToolsActive = false;
                btnBk.style.display = "none";
                iframeWindow.eruda.hide();
            } else {
                btnBk.style.display = "flex";
                iframeWindow.eruda.show();
            }
        }
    }


    setBrowserAttributes() {
        this.browser.addressBar.value = this.currentUrl;
        this.browser.browserTitle = this.currentTitle + this.browser.titleSuffix;
        document.title = this.browser.browserTitle;
    }

    navigateTo(url, callback) {
        var self = this;
        // TODO: allow registering custom protocols and clean this up
        if (url == "" || url.startsWith(this.browser.resourcesProtocol)) {
            if (url == "") {
                url = this.browser.resourcesPrefix + "blank.html";
            } else if (url.startsWith(this.browser.resourcesProtocol)) {
                url = url.replace(this.browser.resourcesProtocol, this.browser.resourcesPrefix);
                url = url + ".html"
            }
            this.iframe.src = url;
            if (callback) callback();
        } else if (url.startsWith("javascript:")) {
            let el = this.iframe.contentWindow.document.createElement("script");
            el.textContent = url;
            this.iframe.contentWindow.document.querySelector("head").appendChild(el);
            this.setBrowserAttributes();
        } else if (isUrl(url)) {
            if (hasHttps(url)) {
                proxyUsing(url, this.browser.settings.getSetting("currentProxyId"), (url) => {
                    self.iframe.src = url;
                    if (callback) callback();
                });
            } else {
                proxyUsing('https://' + url, this.browser.settings.getSetting("currentProxyId"), (url) => {
                    self.iframe.src = url;
                    if (callback) callback();
                })
            }
            return;
        } else {
            proxyUsing(this.browser.settings.getSetting("searchEngineUrl") + url, this.browser.settings.getSetting("currentProxyId"), (url) => {
                self.iframe.src = url;
                if (callback) callback();
            });
        }
    }
}

