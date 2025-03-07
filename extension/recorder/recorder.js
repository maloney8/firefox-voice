/* globals log, voice, util */

this.recorder = (function() {
  // If the permission doesn't return in this amount of time, we'll request that this tab
  // come to the foreground:
  const PERMISSION_TIMEOUT = 1000;
  const streamReady = util.makeNakedPromise();

  function setState(state, properties = {}) {
    document.body.className = state;
    for (const name in properties) {
      document.querySelector(name).textContent = properties[name];
    }
  }

  let stream;
  let activeRecorder;
  let oldActiveRecorder;

  async function init() {
    const timeoutId = setTimeout(() => {
      browser.runtime.sendMessage({ type: "makeRecorderActive" });
    }, PERMISSION_TIMEOUT);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamReady.resolve();
    } catch (e) {
      log.warn("Failed to acquire stream:", String(e));
      setState("error", { "#errorMessage": `Error getting stream: ${e}` });
      streamReady.reject(e);
      return;
    }
    clearTimeout(timeoutId);
    setState("recording");
    pause();
  }

  async function pause() {
    for (const track of stream.getTracks()) {
      track.enabled = false;
    }
    setState("paused");
  }

  async function start() {
    if (!stream) {
      throw new Error("Attempt to start stream before it is acquired");
    }
    for (const track of stream.getTracks()) {
      track.enabled = true;
    }
    setState("recording");
  }

  class ShimRecorder extends voice.Recorder {
    constructor(stream) {
      super(stream);
      this._destroyed = false;
    }

    stop() {
      if (this._destroyed) {
        log.error("stop called after ShimRecorder destroyed");
      } else {
        pause();
        // this.mediaStopped();
      }
    }

    onBeginRecording() {
      if (this._destroyed) {
        log.error("onBeginRecording called after ShimRecorder destroyed");
      } else {
        browser.runtime.sendMessage({
          type: "onVoiceShimForward",
          method: "onBeginRecording",
        });
      }
    }

    onEnd(json) {
      if (this._destroyed) {
        log.error("onEnd called after ShimRecorder destroyed");
      } else {
        browser.runtime.sendMessage({
          type: "onVoiceShimForward",
          method: "onEnd",
          args: [json],
        });
        pause();
      }
    }

    onError(exception) {
      if (this._destroyed) {
        log.error("onError called after ShimRecorder destroyed");
      } else {
        browser.runtime.sendMessage({
          type: "onVoiceShimForward",
          method: "onError",
          args: [String(exception)],
        });
      }
    }

    onProcessing() {
      if (this._destroyed) {
        log.error("onProcessing called after ShimRecorder destroyed");
      } else {
        browser.runtime.sendMessage({
          type: "onVoiceShimForward",
          method: "onProcessing",
          args: [],
        });
      }
    }

    onNoVoice() {
      if (this._destroyed) {
        log.error("onNoVoice called after ShimRecorder destroyed");
      } else {
        browser.runtime.sendMessage({
          type: "onVoiceShimForward",
          method: "onNoVoice",
          args: [],
        });
      }
    }

    destroy() {
      this._destroyed = true;
    }
  }

  browser.runtime.onMessage.addListener(message => {
    if (message.type !== "voiceShim") {
      return undefined;
    }
    return handleMessage(message);
  });

  async function handleMessage(message) {
    if (message.method === "ping") {
      await streamReady;
      return true;
    } else if (message.method === "constructor") {
      if (oldActiveRecorder) {
        // This forcefully makes sure that recorders can't overlap, even though
        // the activeRecorder might take some time to fully complete (send data
        // to server, etc):
        oldActiveRecorder.destroy();
        oldActiveRecorder = null;
      }
      start();
      if (activeRecorder) {
        throw new Error("Attempted to open recorder.ShimRecorder twice");
      }
      activeRecorder = new ShimRecorder(stream);
      return null;
    }
    if (!activeRecorder) {
      throw new Error(
        `Recorder.${message.method} called with no active recorder`
      );
    }
    if (message.method === "startRecording") {
      return activeRecorder.startRecording();
    } else if (message.method === "stop") {
      activeRecorder.stop();
      oldActiveRecorder = activeRecorder;
      activeRecorder = null;
      return null;
    } else if (message.method === "getVolumeLevel") {
      return activeRecorder.getVolumeLevel();
    }
    return undefined;
  }

  setState("acquiring");
  init();
})();
