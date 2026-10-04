const { AsyncLocalStorage } = require('async_hooks');

const tenantCtx = new AsyncLocalStorage();
const adminCtx = new AsyncLocalStorage();

function getTenant() {
  return tenantCtx.getStore() || null;
}

function getAdmin() {
  return adminCtx.getStore() || null;
}

function runAsTenant(ctx, fn) {
  return tenantCtx.run(ctx, fn);
}

function runAsAdmin(ctx, fn) {
  return adminCtx.run(ctx, fn);
}

module.exports = {
  tenantCtx,
  adminCtx,
  getTenant,
  getAdmin,
  runAsTenant,
  runAsAdmin,
};