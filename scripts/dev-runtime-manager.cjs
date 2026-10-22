const { shouldAccept } = require('./dev-runtime-lib.cjs');

class RuntimeCoordinator {
  constructor(mode, io) { this.mode = mode; this.io = io; this.drainReason = null; this.accepting = false; this.status = 'STARTING'; }
  get draining() { return this.drainReason !== null; }
  get stopRequested() { return this.drainReason === 'STOP_REQUESTED'; }
  async start() {
    if (this.mode === 'MOCK' && (await this.io.dependencies()).needsCallbacks) throw Error('OUTSTANDING_GATEWAY_USE_VNPAY');
    await this.io.startBackend(false);
    if (this.mode === 'VNPAY_SANDBOX') await this.io.startCallbacks();
    await this.io.startFrontend();
    await this.io.verifyServices();
    if (shouldAccept({ mode:this.mode, servicesHealthy:true, draining:this.draining })) await this.restart(true);
    this.status = 'READY';
  }
  async restart(accepting = this.accepting) {
    // Ingress/ngrok are independent handles, untouched by the backend restart.
    try {
      await this.io.restartBackend(accepting);
      this.accepting = accepting;
      await this.io.verifyServices();
    } catch (error) {
      this.status = 'DEGRADED';
      if (accepting) { await this.io.restartBackend(false); this.accepting = false; }
      throw error;
    }
  }
  async drain() {
    // A later drain command must not hide an outstanding shutdown request.
    if (!this.stopRequested) this.drainReason = 'OPERATOR_DRAIN';
    if (this.mode === 'VNPAY_SANDBOX' && this.accepting) await this.restart(false);
    this.status = this.stopRequested ? 'DRAINING_CALLBACKS_RETAINED' : 'DRAIN_ONLY';
  }
  async check() {
    try {
      await this.io.verifyServices();
      if (shouldAccept({ mode:this.mode, servicesHealthy:true, draining:this.draining }) && !this.accepting) await this.restart(true);
      this.status = this.stopRequested ? 'DRAINING_CALLBACKS_RETAINED' : this.draining ? 'DRAIN_ONLY' : 'READY';
    } catch {
      this.status = 'DEGRADED';
      if (this.mode === 'VNPAY_SANDBOX' && this.accepting) {
        try { await this.restart(false); } catch { /* Preserve callback handles for recovery. */ }
      }
    }
  }
  async stop() {
    this.drainReason = 'STOP_REQUESTED';
    await this.drain();
    if (this.mode === 'VNPAY_SANDBOX') {
      const audit = await this.io.dependencies();
      if (!audit.safeToStop) { this.status = 'DRAINING_CALLBACKS_RETAINED'; return { stopped:false, audit }; }
    }
    await this.io.stopAll(); this.status = 'STOPPED';
    return { stopped:true };
  }
  async recover() {
    if (this.mode === 'VNPAY_SANDBOX') await this.io.startCallbacks();
    // Explicit recovery cancels the operator's drain/stop intent only after
    // readiness succeeds. Financial dependencies still govern teardown, not
    // admission of independent Orders; their guards remain in the backend.
    await this.io.verifyServices(); this.drainReason = null;
    await this.check();
  }
}
module.exports = { RuntimeCoordinator };
