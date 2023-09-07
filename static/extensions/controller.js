class ExtensionsController {
  constructor(browser) {
    this.browser = browser;
    this.extensions = {}; //id: Extension
    this.internalThemeId = "bdddhkcpnpcaggeblinmcffckoihfdia";
  }

  async #exists(path) {
    try{
      await this.resources.fs.stat(path);
    }catch(e){return false};
    return true;
  }

  async setup() {
    // i realize that now i could have just done this for ExtensionResources but it's fine
    this.resources = await ExtensionResources.new();
    let disabledExtensions = JSON.parse(this.browser.settings.getSetting("disabledExtensions"));
    let installedExtensions = JSON.parse(this.browser.settings.getSetting("installedExtensions"));
    let enabledThemeId = this.browser.settings.getSetting("themeId");

    if(installedExtensions.includes(this.internalThemeId) && await !this.#exists(`/${this.internalThemeId}`)) installedExtensions.splice(installedExtensions.indexOf(this.internalThemeId), 1);
    if(!installedExtensions.includes(this.internalThemeId) && await this.#exists(`/${this.internalThemeId}`)) {
      await ((new this.resources.regularFs.Shell()).promises).rm(`/${this.internalThemeId}`, {recursive:true})
    }
    if(!installedExtensions.includes(this.internalThemeId)) await this.installFromUnpackedZipBlob(await fetch("/themes/chrome_dark.zip").then(r=>r.blob()), "aboutproxy-bad-theme");

    for (const id of installedExtensions) {
      let ext = new Extension(this);
      await ext.readFromFilerFs(id);
      ext.init();
      this.extensions[id] = ext;
      if(ext.type === "theme") {
        if(id !== enabledThemeId) ext.enabled = false;
        continue;
      }
      if(disabledExtensions.includes(id)) ext.enabled = false;
    }
    Extension.internalThemeExtension = this.extensions[this.internalThemeId];
    this.extensionsReady = true;
  }

  async installFromCrxBlob(blob) {
    let ext = new Extension(this);
    const id = await ext.readFromCrxBlob(blob);
    ext.init();
    this.extensions[id] = ext;

    let installedArray = JSON.parse(this.browser.settings.getSetting("installedExtensions"));
    installedArray.push(id);
    this.browser.settings.setSetting("installedExtensions", JSON.stringify(installedArray));
    if(ext.type === "theme") this.setExtensionEnabled(id, false);
  }

  async installFromUnpackedZipBlob(blob, name) {
    let ext = new Extension(this);
    const id = await ext.readFromUnpackedZipBlob(blob, name);
    ext.init();
    this.extensions[id] = ext;

    let installedArray = JSON.parse(this.browser.settings.getSetting("installedExtensions"));
    installedArray.push(id);
    this.browser.settings.setSetting("installedExtensions", JSON.stringify(installedArray));
    if(ext.type === "theme") this.setExtensionEnabled(id, false);
  }

  setExtensionEnabled(id, enabled) {
    if(!enabled && this.extensions[id].enabled) {
      let disabledExtensions = JSON.parse(this.browser.settings.getSetting("disabledExtensions"));
      disabledExtensions.push(id);
      this.browser.settings.setSetting("disabledExtensions", JSON.stringify(disabledExtensions));
    } else if(enabled && !this.extensions[id].enabled) {
      let disabledExtensions = JSON.parse(this.browser.settings.getSetting("disabledExtensions"));
      disabledExtensions.splice(disabledExtensions.indexOf(id), 1);
      this.browser.settings.setSetting("disabledExtensions", JSON.stringify(disabledExtensions));
    }
    this.extensions[id].enabled = enabled;
  }

  async ensureExtensionsAreReady() {
    var start = Date.now();
    let self = this;
    return new Promise(wait);

    function wait(resolve, reject) {
      if (self.extensionsReady)
        resolve();
      else
        setTimeout(wait.bind(this, resolve, reject), 100);
    }
  }

  async uninstallExtension(id) {
    if(this.browser.settings.getSetting("themeId") === id) this.setCurrentTheme(Extension.internalThemeExtension.id);
    await (new this.resources.regularFs.Shell()).promises.rm("/"+id, {recursive:true});
    if(!this.extensions[id].enabled) {
      let disabledExtensions = JSON.parse(this.browser.settings.getSetting("disabledExtensions"));
      disabledExtensions.splice(disabledExtensions.indexOf(id), 1);
      this.browser.settings.setSetting("disabledExtensions", JSON.stringify(disabledExtensions));
    }
    let installedExtensions = JSON.parse(this.browser.settings.getSetting("installedExtensions"));
    installedExtensions.splice(installedExtensions.indexOf(id), 1);
    this.browser.settings.setSetting("installedExtensions", JSON.stringify(installedExtensions));
    delete this.extensions[id];
  }

  getExtensionMetadata() {
    let metadata = [];
    for (const extension of Object.entries(this.extensions)) {
      metadata.push({
        id: extension[0],
        name: extension[1].manifest.name,
        version: extension[1].manifest.version,
        description: extension[1].description || "",
        type: extension[1].type,
        enabled: extension[1].enabled,
        internal: extension[0] == this.internalThemeId, /* this is for future internal extensions I may add */
        internalTheme: extension[0] == this.internalThemeId /* this is so users can't accidentally disable the one internal theme */
      });
    }
    return metadata;
  }

  setCurrentTheme(id) {
    let currentTheme = this.browser.settings.getSetting("themeId");
    this.extensions[currentTheme].enabled = false;
    this.extensions[id].enabled = true;
    this.browser.settings.setSetting("themeId", id);
    this.browser.reapplyTheme();
  }

  injectTheme() {
    this.extensions[this.browser.settings.getSetting("themeId")].inject();
  }

  injectThemeIntoFrame(url, iframe) {
    this.extensions[this.browser.settings.getSetting("themeId")].injectTheme(url, iframe);
  }

  async injectDOMContentLoaded(url, iframe) {
    await this.ensureExtensionsAreReady();
    for(const extension of Object.values(this.extensions)) {
      extension.injectDOMContentLoaded(url, iframe);
    }
  }

  async injectLoaded(url, iframe) {
    await this.ensureExtensionsAreReady();
    for(const extension of Object.values(this.extensions)) {
      extension.injectLoaded(url, iframe);
    }
  }
}
